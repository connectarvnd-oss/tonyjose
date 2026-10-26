// Booking lifecycle: create → (pay) → confirm → reschedule / cancel / refund.
//
// Guarantees:
//  * Availability is re-checked (rules, blocks, DB bookings, Google busy)
//    immediately before a booking is written.
//  * The Postgres exclusion constraint `appointments_no_overlap` makes double
//    booking impossible even under concurrent requests.
//  * Paid bookings are confirmed only by verified provider webhooks.
//  * Every external side effect is idempotent (idempotency keys, deterministic
//    calendar event ids, notification dedupe keys).
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, pgErrorCode, EXCLUSION_VIOLATION, UNIQUE_VIOLATION } from "../db";
import { appointments, appointmentTypes, clients, payments, type Appointment } from "../db/schema";
import { audit } from "../audit";
import { CalendarUnavailableError, isSlotAvailable } from "../availability/service";
import { integrations } from "../integrations";
import { getSettings } from "../settings";
import { bookingReference, sha256 } from "../security/crypto";
import { StripeProvider } from "../payments/stripe";
import { TestPaymentProvider } from "../payments/test-provider";
import type { PaymentEvent, PaymentProvider } from "../payments/types";
import {
  alertAdmin,
  adminRecipient,
  cancelPendingReminders,
  enqueue,
  processDueNotifications,
  scheduleConfirmationNotifications,
} from "../email/notifications";
import { calendarConflict, syncAppointmentToCalendar } from "./calendar-sync";
import { latestPayment, loadAppointment } from "./queries";
import { manageTokenFor } from "./tokens";

export type BookingErrorCode =
  | "invalid"
  | "type_unavailable"
  | "slot_unavailable"
  | "free_limit"
  | "payments_unavailable"
  | "calendar_unavailable"
  | "not_allowed"
  | "not_found";

export class BookingError extends Error {
  constructor(public code: BookingErrorCode, message: string) {
    super(message);
    this.name = "BookingError";
  }
}

const siteUrl = () => (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export type CreateBookingInput = {
  appointmentTypeId: string;
  start: Date;
  name: string;
  email: string;
  phone?: string | null;
  country?: string | null;
  enquiryArea?: string | null;
  message?: string | null;
  timeZone: string;
  marketingOptIn: boolean;
  idempotencyKey: string;
};

export type CreateBookingResult = {
  appointmentId: string;
  reference: string;
  manageToken: string;
  status: Appointment["status"];
  checkoutUrl: string | null;
};

async function resultFor(appt: Appointment): Promise<CreateBookingResult> {
  let checkoutUrl: string | null = null;
  if (appt.status === "pending_payment") {
    const p = await latestPayment(appt.id);
    checkoutUrl = p?.status === "pending" ? p.checkoutUrl : null;
  }
  return { appointmentId: appt.id, reference: appt.reference, manageToken: manageTokenFor(appt.id), status: appt.status, checkoutUrl };
}

function providerById(id: string, fallback: PaymentProvider | null): PaymentProvider {
  if (fallback && fallback.id === id) return fallback;
  if (id === "stripe") return new StripeProvider();
  return new TestPaymentProvider();
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();

  // 1. Idempotent retry: the same request returns the same booking.
  const [existing] = await db.select().from(appointments).where(eq(appointments.idempotencyKey, input.idempotencyKey));
  if (existing) {
    if (["expired", "payment_failed"].includes(existing.status)) {
      throw new BookingError("slot_unavailable", "This reservation has expired. Please choose a time again.");
    }
    return resultFor(existing);
  }

  // 2. Appointment type
  const [type] = await db.select().from(appointmentTypes).where(eq(appointmentTypes.id, input.appointmentTypeId));
  if (!type || !type.isActive) throw new BookingError("type_unavailable", "This consultation type is not currently available.");

  // 3. Free-enquiry limit
  if (type.onePerClient) {
    const prior = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM appointments a JOIN clients c ON c.id = a.client_id
      WHERE lower(c.email) = ${email} AND a.appointment_type_id = ${type.id}
        AND (a.status IN ('confirmed','completed','no_show')
             OR (a.status = 'pending_payment' AND a.hold_expires_at > now()))`);
    if ((prior.rows[0]?.n ?? 0) > 0) {
      throw new BookingError(
        "free_limit",
        "The free initial enquiry is limited to one per person. You're welcome to book a full consultation instead.",
      );
    }
  }

  const s = await getSettings("booking", "calendar");
  const paid = type.priceCents > 0;
  const provider = paid ? await integrations().payments() : null;
  if (paid && !provider) {
    throw new BookingError("payments_unavailable", "Online payment isn't available right now. Please try again later or get in touch.");
  }

  // 4. Fresh availability check, including Google Calendar busy times.
  const end = new Date(input.start.getTime() + type.durationMinutes * 60_000);
  const buffer = type.bufferMinutes ?? s.booking.bufferMinutes;
  try {
    const ok = await isSlotAvailable({ type, start: input.start, settings: s });
    if (!ok) throw new BookingError("slot_unavailable", "Sorry — that time is no longer available. Please choose another.");
  } catch (err) {
    if (err instanceof CalendarUnavailableError) throw new BookingError("calendar_unavailable", err.message);
    throw err;
  }

  // 5. Write the booking. The exclusion constraint is the final arbiter.
  const now = new Date();
  const holdMinutes = provider?.id === "stripe" ? Math.max(s.booking.holdMinutes, 31) : s.booking.holdMinutes;
  let appt: Appointment;
  try {
    appt = await db.transaction(async (tx) => {
      // Release expired checkout holds that overlap this slot.
      await tx.execute(sql`
        UPDATE appointments SET status = 'expired', payment_status = 'expired', updated_at = now()
        WHERE status = 'pending_payment' AND hold_expires_at <= now()
          AND tstzrange(start_at, occupied_until, '[)') && tstzrange(${input.start.toISOString()}::timestamptz, ${new Date(end.getTime() + buffer * 60_000).toISOString()}::timestamptz, '[)')`);

      const [found] = await tx
        .select()
        .from(clients)
        .where(and(sql`lower(${clients.email}) = ${email}`, sql`${clients.anonymisedAt} IS NULL`))
        .for("update");
      let clientId: string;
      if (found) {
        clientId = found.id;
        await tx
          .update(clients)
          .set({
            name: input.name.trim(),
            phone: input.phone || found.phone,
            country: input.country || found.country,
            privacyAcceptedAt: now,
            updatedAt: now,
            // Consent is only ever added here, never silently withdrawn or bundled.
            ...(input.marketingOptIn && !found.marketingOptIn ? { marketingOptIn: true, marketingOptInAt: now } : {}),
          })
          .where(eq(clients.id, found.id));
      } else {
        const [c] = await tx
          .insert(clients)
          .values({
            name: input.name.trim(),
            email,
            phone: input.phone || null,
            country: input.country || null,
            privacyAcceptedAt: now,
            marketingOptIn: input.marketingOptIn,
            marketingOptInAt: input.marketingOptIn ? now : null,
          })
          .returning({ id: clients.id });
        clientId = c.id;
      }

      const id = crypto.randomUUID();
      const [row] = await tx
        .insert(appointments)
        .values({
          id,
          reference: bookingReference(),
          clientId,
          appointmentTypeId: type.id,
          startAt: input.start,
          endAt: end,
          occupiedUntil: new Date(end.getTime() + buffer * 60_000),
          timeZone: input.timeZone,
          status: paid ? "pending_payment" : "confirmed",
          paymentStatus: paid ? "pending" : "not_required",
          holdExpiresAt: paid ? new Date(now.getTime() + holdMinutes * 60_000) : null,
          priceCents: type.priceCents,
          currency: type.currency,
          enquiryArea: input.enquiryArea || null,
          message: input.message || null,
          calendarSyncStatus: "pending",
          manageTokenHash: sha256(manageTokenFor(id)),
          idempotencyKey: input.idempotencyKey,
          confirmedAt: paid ? null : now,
        })
        .returning();
      return row;
    });
  } catch (err) {
    const code = pgErrorCode(err);
    if (code === EXCLUSION_VIOLATION) {
      throw new BookingError("slot_unavailable", "Sorry — someone has just booked that time. Please choose another.");
    }
    if (code === UNIQUE_VIOLATION) {
      const [again] = await db.select().from(appointments).where(eq(appointments.idempotencyKey, input.idempotencyKey));
      if (again) return resultFor(again);
    }
    throw err;
  }

  await audit({ actor: "client", action: "booking.created", entityType: "appointment", entityId: appt.id, details: { reference: appt.reference, paid } });

  if (!paid) {
    await afterConfirmed(appt.id, "new");
    const [fresh] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
    return resultFor(fresh);
  }

  // 6. Paid: create checkout session. The slot stays held until it expires.
  const manageToken = manageTokenFor(appt.id);
  try {
    const checkout = await provider!.createCheckout({
      appointmentId: appt.id,
      reference: appt.reference,
      amountCents: type.priceCents,
      currency: type.currency,
      productName: `${type.name} with Tony Jose`,
      description: `${type.durationMinutes} minutes · Ref ${appt.reference}`,
      customerEmail: email,
      successUrl: `${siteUrl()}/booking/${appt.reference}?t=${manageToken}&paid=1`,
      cancelUrl: `${siteUrl()}/booking/${appt.reference}?t=${manageToken}&payment=cancelled`,
      expiresAt: appt.holdExpiresAt!,
    });
    await db.insert(payments).values({
      appointmentId: appt.id,
      provider: provider!.id,
      providerSessionId: checkout.sessionId,
      checkoutUrl: checkout.url,
      amountCents: type.priceCents,
      currency: type.currency,
      status: "pending",
    });
    return { appointmentId: appt.id, reference: appt.reference, manageToken, status: appt.status, checkoutUrl: checkout.url };
  } catch (err) {
    console.error("[booking] checkout creation failed", err);
    await db
      .update(appointments)
      .set({ status: "payment_failed", paymentStatus: "failed", updatedAt: new Date() })
      .where(eq(appointments.id, appt.id));
    throw new BookingError("payments_unavailable", "We couldn't start the payment. Your card has not been charged. Please try again.");
  }
}

/** Post-confirmation side effects. Each step is independent and retryable. */
export async function afterConfirmed(appointmentId: string, kind: "new" | "reschedule") {
  try {
    await syncAppointmentToCalendar(appointmentId);
  } catch (err) {
    console.error("[booking] calendar sync error", err);
  }
  try {
    const a = await loadAppointment(appointmentId);
    if (a) await scheduleConfirmationNotifications(a, { kind });
    await processDueNotifications({ appointmentId });
  } catch (err) {
    console.error("[booking] notification error", err);
  }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function handlePaymentEvent(event: PaymentEvent) {
  switch (event.kind) {
    case "succeeded":
      return confirmPaidAppointment(event.appointmentId, event.sessionId, event.paymentId);
    case "pending":
      await getDb().update(payments).set({ lastEvent: "processing", updatedAt: new Date() }).where(eq(payments.providerSessionId, event.sessionId));
      return "pending";
    case "failed":
    case "expired":
      return releaseUnpaid(event.appointmentId, event.sessionId, event.kind);
    case "refunded":
      return recordRefund(event.paymentId, event.refundedCents, event.fully);
  }
}

export async function confirmPaidAppointment(appointmentId: string, sessionId: string, paymentId: string | null) {
  const db = getDb();
  type Outcome = "confirmed" | "already" | "conflict" | "not_found";
  const outcome: Outcome = await db.transaction(async (tx) => {
    const [appt] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId)).for("update");
    if (!appt) return "not_found";
    await tx
      .update(payments)
      .set({ status: "paid", providerPaymentId: paymentId, lastEvent: "paid", updatedAt: new Date() })
      .where(and(eq(payments.appointmentId, appointmentId), eq(payments.providerSessionId, sessionId)));
    if (appt.paymentStatus === "paid" || appt.paymentStatus === "refunded" || appt.paymentStatus === "refund_pending") return "already";

    if (appt.status === "pending_payment") {
      await tx
        .update(appointments)
        .set({ status: "confirmed", paymentStatus: "paid", holdExpiresAt: null, confirmedAt: new Date(), updatedAt: new Date() })
        .where(eq(appointments.id, appointmentId));
      return "confirmed";
    }
    if (appt.status === "expired" || appt.status === "payment_failed") {
      // Paid after the hold lapsed: confirm only if the slot is still free.
      try {
        await tx.transaction(async (sp) => {
          await sp
            .update(appointments)
            .set({ status: "confirmed", paymentStatus: "paid", holdExpiresAt: null, confirmedAt: new Date(), updatedAt: new Date() })
            .where(eq(appointments.id, appointmentId));
        });
        return "confirmed";
      } catch (err) {
        if (pgErrorCode(err) !== EXCLUSION_VIOLATION) throw err;
      }
    }
    await tx
      .update(appointments)
      .set({
        status: "needs_attention",
        paymentStatus: "paid",
        attentionReason:
          appt.status === "cancelled"
            ? "Payment completed after the booking was cancelled."
            : "Payment completed but the time slot was no longer available.",
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, appointmentId));
    return "conflict";
  });

  if (outcome === "not_found") {
    await alertAdmin("Payment for unknown booking", `A payment (session ${sessionId}) referenced booking ${appointmentId}, which does not exist. Check the payment provider dashboard.`, `unknown-payment:${sessionId}`);
    return outcome;
  }
  if (outcome === "already") return outcome;

  if (outcome === "confirmed") {
    const a = await loadAppointment(appointmentId);
    const { booking } = await getSettings("booking");
    if (a && !a.appointment.googleEventId) {
      const buffer = a.type.bufferMinutes ?? booking.bufferMinutes;
      const clash = await calendarConflict(a.appointment.startAt, a.appointment.endAt, buffer);
      if (clash === true) {
        await db
          .update(appointments)
          .set({ status: "needs_attention", attentionReason: "Payment completed but Google Calendar now shows a conflicting busy event.", updatedAt: new Date() })
          .where(eq(appointments.id, appointmentId));
        await resolvePaymentConflict(appointmentId);
        return "conflict";
      }
    }
    await audit({ actor: "webhook", action: "booking.payment_confirmed", entityType: "appointment", entityId: appointmentId });
    await afterConfirmed(appointmentId, "new");
    return outcome;
  }

  await resolvePaymentConflict(appointmentId);
  return outcome;
}

/** Recovery workflow: a confirmed payment that cannot be matched to a valid slot. */
async function resolvePaymentConflict(appointmentId: string) {
  const { booking } = await getSettings("booking");
  const a = await loadAppointment(appointmentId);
  if (!a) return;
  let refundNote = "Tony will contact you shortly to arrange a new time or a refund.";
  if (booking.conflictResolution === "refund") {
    try {
      await refundAppointment(appointmentId, { reason: "slot_conflict" });
      refundNote = "Your payment has been refunded in full. Refunds usually appear within 5–10 business days.";
    } catch (err) {
      console.error("[booking] automatic refund failed", err);
      refundNote = "We will refund your payment in full; Tony has been notified.";
    }
  }
  await enqueue({
    appointmentId,
    type: "client_payment_issue",
    recipient: a.client.email,
    dedupeKey: `${appointmentId}:payment_issue:conflict`,
    payload: { extra: `Unfortunately the time you chose became unavailable while your payment was processing. ${refundNote}` },
  });
  await alertAdmin(
    "Paid booking needs attention",
    `${a.client.name} (${a.client.email}) paid for ${a.appointment.reference}, but the slot was no longer available (${a.appointment.attentionReason ?? ""}). ${
      booking.conflictResolution === "refund" ? "An automatic refund was initiated." : "No refund has been issued yet — please offer a new time or refund."
    }`,
    `conflict:${appointmentId}`,
    appointmentId,
  );
  await audit({ actor: "system", action: "booking.payment_conflict", entityType: "appointment", entityId: appointmentId });
  await processDueNotifications({ appointmentId });
}

async function releaseUnpaid(appointmentId: string, sessionId: string, kind: "failed" | "expired") {
  const db = getDb();
  const released = await db.transaction(async (tx) => {
    const [appt] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId)).for("update");
    if (!appt) return null;
    await tx
      .update(payments)
      .set({ status: kind === "failed" ? "failed" : "expired", lastEvent: kind, updatedAt: new Date() })
      .where(and(eq(payments.appointmentId, appointmentId), eq(payments.providerSessionId, sessionId), eq(payments.status, "pending")));
    if (appt.status !== "pending_payment") return null;
    await tx
      .update(appointments)
      .set({
        status: kind === "failed" ? "payment_failed" : "expired",
        paymentStatus: kind === "failed" ? "failed" : "expired",
        holdExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, appointmentId));
    return appt;
  });
  if (released) {
    const [client] = await db.select().from(clients).where(eq(clients.id, released.clientId));
    if (client) {
      await enqueue({
        appointmentId,
        type: "client_payment_issue",
        recipient: client.email,
        dedupeKey: `${appointmentId}:payment_issue`,
        payload: {
          extra:
            kind === "failed"
              ? "Your payment didn't go through, so the time has been released and you have not been charged. You're welcome to choose a time and try again."
              : "The payment wasn't completed in time, so the reserved slot has been released and you have not been charged. You're welcome to choose a time again.",
        },
      });
      await processDueNotifications({ appointmentId });
    }
    await audit({ actor: "webhook", action: `booking.payment_${kind}`, entityType: "appointment", entityId: appointmentId });
  }
  return released ? "released" : "ignored";
}

async function recordRefund(paymentId: string, refundedCents: number, fully: boolean) {
  const db = getDb();
  const [p] = await db.select().from(payments).where(eq(payments.providerPaymentId, paymentId));
  if (!p) return "ignored";
  await db
    .update(payments)
    .set({ refundStatus: fully ? "refunded" : "partially_refunded", refundedCents, updatedAt: new Date(), lastEvent: "refunded" })
    .where(eq(payments.id, p.id));
  await db
    .update(appointments)
    .set({ paymentStatus: fully ? "refunded" : "partially_refunded", updatedAt: new Date() })
    .where(eq(appointments.id, p.appointmentId));
  return "recorded";
}

export async function refundAppointment(
  appointmentId: string,
  opts: { amountCents?: number; reason: string; adminId?: string | null },
) {
  const db = getDb();
  const p = await latestPayment(appointmentId);
  if (!p || p.status !== "paid") throw new BookingError("not_allowed", "There is no completed payment to refund.");
  const remaining = p.amountCents - p.refundedCents;
  const amount = Math.min(opts.amountCents ?? remaining, remaining);
  if (amount <= 0) throw new BookingError("not_allowed", "This payment has already been refunded.");
  const provider = providerById(p.provider, await integrations().payments());
  const result = await provider.refund({
    sessionId: p.providerSessionId,
    paymentId: p.providerPaymentId,
    amountCents: amount,
    idempotencyKey: `refund_${p.id}_${p.refundedCents}_${amount}`,
  });
  if (result.status === "failed") {
    await db.update(payments).set({ refundStatus: "failed", updatedAt: new Date() }).where(eq(payments.id, p.id));
    throw new Error("The payment provider rejected the refund.");
  }
  const total = p.refundedCents + amount;
  const full = total >= p.amountCents;
  const settled = result.status === "succeeded";
  await db
    .update(payments)
    .set({
      refundStatus: settled ? (full ? "refunded" : "partially_refunded") : "pending",
      refundedCents: settled ? total : p.refundedCents,
      refundReference: result.refundId,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, p.id));
  await db
    .update(appointments)
    .set({ paymentStatus: settled ? (full ? "refunded" : "partially_refunded") : "refund_pending", updatedAt: new Date() })
    .where(eq(appointments.id, appointmentId));
  await audit({
    actor: opts.adminId ? "admin" : "system",
    adminId: opts.adminId,
    action: "payment.refund",
    entityType: "appointment",
    entityId: appointmentId,
    details: { amountCents: amount, reason: opts.reason, refundId: result.refundId },
  });
  return { amountCents: amount, status: result.status };
}

// ---------------------------------------------------------------------------
// Cancellation and rescheduling
// ---------------------------------------------------------------------------

export type CancelOptions = {
  by: "client" | "admin";
  reason?: string | null;
  /** policy: apply refund rules. full/none: admin override. */
  refund: "policy" | "full" | "none";
  adminId?: string | null;
  notifyClient?: boolean;
};

export function hoursUntil(date: Date, now = new Date()) {
  return (date.getTime() - now.getTime()) / 3600_000;
}

export async function cancelAppointment(appointmentId: string, opts: CancelOptions) {
  const db = getDb();
  const { booking, notifications: n } = await getSettings("booking", "notifications");
  const a = await loadAppointment(appointmentId);
  if (!a) throw new BookingError("not_found", "Booking not found.");
  const appt = a.appointment;

  if (opts.by === "client") {
    if (!booking.allowClientCancel) throw new BookingError("not_allowed", "Online cancellation is not available. Please get in touch.");
    if (appt.status === "confirmed" && hoursUntil(appt.startAt) < booking.cancellationNoticeHours) {
      throw new BookingError(
        "not_allowed",
        `Bookings can be cancelled online up to ${booking.cancellationNoticeHours} hours in advance. Please get in touch directly.`,
      );
    }
  }

  const prev = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(appointments).where(eq(appointments.id, appointmentId)).for("update");
    if (!row || !["confirmed", "pending_payment", "needs_attention"].includes(row.status)) return null;
    await tx
      .update(appointments)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: opts.by,
        cancellationReason: opts.reason ?? null,
        holdExpiresAt: null,
        paymentStatus: row.paymentStatus === "pending" ? "expired" : row.paymentStatus,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, appointmentId));
    return row;
  });
  if (!prev) throw new BookingError("not_allowed", "This booking can no longer be cancelled.");

  await cancelPendingReminders(appointmentId);
  if (prev.status === "pending_payment") {
    const p = await latestPayment(appointmentId);
    if (p?.providerSessionId && p.status === "pending") {
      const provider = providerById(p.provider, await integrations().payments());
      await provider.expireCheckout(p.providerSessionId);
      await db.update(payments).set({ status: "cancelled", updatedAt: new Date() }).where(eq(payments.id, p.id));
    }
  }
  try {
    await syncAppointmentToCalendar(appointmentId);
  } catch (err) {
    console.error("[booking] calendar removal failed", err);
  }

  // Refund workflow
  let refundNote: string | null = null;
  if (prev.paymentStatus === "paid") {
    const eligible =
      opts.refund === "full" ||
      (opts.refund === "policy" &&
        (opts.by === "admin" ||
          (booking.refundPolicy === "full_if_notice" && hoursUntil(prev.startAt) >= booking.cancellationNoticeHours)));
    if (eligible) {
      try {
        await refundAppointment(appointmentId, { reason: `cancelled_by_${opts.by}`, adminId: opts.adminId });
        refundNote = "Your payment is being refunded in full to your original payment method. Refunds usually appear within 5–10 business days.";
      } catch (err) {
        console.error("[booking] refund failed", err);
        refundNote = "Your refund is being processed manually and will follow shortly.";
        await alertAdmin("Refund failed", `Automatic refund for ${prev.reference} failed: ${(err as Error).message}`, `refund-failed:${appointmentId}`, appointmentId);
      }
    } else if (opts.refund === "policy") {
      refundNote = "As this cancellation was made within the notice period, no automatic refund applies. Please get in touch if something unexpected came up.";
    }
  }

  if (opts.notifyClient !== false && prev.status !== "pending_payment") {
    await enqueue({
      appointmentId,
      type: "client_cancellation",
      recipient: a.client.email,
      dedupeKey: `${appointmentId}:cancellation`,
      payload: { refundNote },
    });
  }
  const admin = await adminRecipient();
  if (n.notifyAdminOnCancel && admin && opts.by === "client") {
    await enqueue({
      appointmentId,
      type: "admin_cancellation",
      recipient: admin,
      dedupeKey: `${appointmentId}:admin_cancellation`,
      payload: { extra: opts.reason ? `Reason: ${opts.reason}` : null },
    });
  }
  await processDueNotifications({ appointmentId });
  await audit({ actor: opts.by, adminId: opts.adminId, action: "booking.cancelled", entityType: "appointment", entityId: appointmentId, details: { refund: opts.refund, reason: opts.reason } });
  return { refundNote };
}

export async function rescheduleAppointment(
  appointmentId: string,
  newStart: Date,
  opts: { by: "client" | "admin"; adminId?: string | null },
) {
  const db = getDb();
  const s = await getSettings("booking", "calendar");
  const a = await loadAppointment(appointmentId);
  if (!a) throw new BookingError("not_found", "Booking not found.");
  const appt = a.appointment;
  if (appt.status !== "confirmed") throw new BookingError("not_allowed", "Only confirmed bookings can be rescheduled.");
  if (opts.by === "client") {
    if (!s.booking.allowClientReschedule) throw new BookingError("not_allowed", "Online rescheduling is not available. Please get in touch.");
    if (hoursUntil(appt.startAt) < s.booking.rescheduleNoticeHours)
      throw new BookingError("not_allowed", `Bookings can be rescheduled online up to ${s.booking.rescheduleNoticeHours} hours in advance.`);
    if (appt.rescheduleCount >= s.booking.maxReschedules)
      throw new BookingError("not_allowed", "This booking has already been rescheduled the maximum number of times. Please get in touch.");
  }
  if (newStart.getTime() === appt.startAt.getTime()) return { unchanged: true };

  const duration = appt.endAt.getTime() - appt.startAt.getTime();
  const buffer = a.type.bufferMinutes ?? s.booking.bufferMinutes;
  try {
    const ok = await isSlotAvailable({
      type: { durationMinutes: duration / 60_000, bufferMinutes: buffer },
      start: newStart,
      settings: s,
      excludeAppointment: { id: appt.id, startAt: appt.startAt, endAt: appt.endAt },
    });
    if (!ok) throw new BookingError("slot_unavailable", "That time is not available. Please choose another.");
  } catch (err) {
    if (err instanceof CalendarUnavailableError) throw new BookingError("calendar_unavailable", err.message);
    throw err;
  }

  const newEnd = new Date(newStart.getTime() + duration);
  try {
    await db
      .update(appointments)
      .set({
        startAt: newStart,
        endAt: newEnd,
        occupiedUntil: new Date(newEnd.getTime() + buffer * 60_000),
        rescheduleCount: sql`${appointments.rescheduleCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.id, appointmentId), eq(appointments.status, "confirmed")));
  } catch (err) {
    if (pgErrorCode(err) === EXCLUSION_VIOLATION) throw new BookingError("slot_unavailable", "That time was just booked. Please choose another.");
    throw err;
  }

  await cancelPendingReminders(appointmentId);
  await audit({
    actor: opts.by,
    adminId: opts.adminId,
    action: "booking.rescheduled",
    entityType: "appointment",
    entityId: appointmentId,
    details: { from: appt.startAt.toISOString(), to: newStart.toISOString() },
  });
  await afterConfirmed(appointmentId, "reschedule");
  return { unchanged: false };
}

export async function setAppointmentOutcome(appointmentId: string, status: "completed" | "no_show" | "confirmed", adminId: string) {
  const db = getDb();
  const [row] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!row || !["confirmed", "completed", "no_show"].includes(row.status)) {
    throw new BookingError("not_allowed", "Only confirmed appointments can be marked completed or no-show.");
  }
  await db.update(appointments).set({ status, updatedAt: new Date() }).where(eq(appointments.id, appointmentId));
  if (status !== "confirmed") await cancelPendingReminders(appointmentId);
  await audit({ actor: "admin", adminId, action: `booking.marked_${status}`, entityType: "appointment", entityId: appointmentId });
}

export async function resendNotification(appointmentId: string, kind: "confirmation" | "reminder", adminId: string) {
  const a = await loadAppointment(appointmentId);
  if (!a || a.appointment.status !== "confirmed") throw new BookingError("not_allowed", "Only confirmed bookings can receive these emails.");
  await enqueue({
    appointmentId,
    type: kind === "confirmation" ? "client_confirmation" : "client_reminder",
    recipient: a.client.email,
    forStartAt: a.appointment.startAt,
    dedupeKey: `${appointmentId}:manual_${kind}:${Date.now()}`,
  });
  await processDueNotifications({ appointmentId });
  await audit({ actor: "admin", adminId, action: `notification.resend_${kind}`, entityType: "appointment", entityId: appointmentId });
}

// ---------------------------------------------------------------------------
// Maintenance (run from cron)
// ---------------------------------------------------------------------------

export async function expireStaleHolds(now = new Date()) {
  const db = getDb();
  const stale = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(and(eq(appointments.status, "pending_payment"), lte(appointments.holdExpiresAt, now)));
  for (const { id } of stale) {
    const p = await latestPayment(id);
    if (p?.providerSessionId) {
      const provider = providerById(p.provider, await integrations().payments());
      await provider.expireCheckout(p.providerSessionId);
      await releaseUnpaid(id, p.providerSessionId, "expired");
    } else {
      await db.update(appointments).set({ status: "expired", paymentStatus: "expired", updatedAt: new Date() }).where(eq(appointments.id, id));
    }
  }
  return stale.length;
}

export async function retryFailedCalendarSyncs() {
  const db = getDb();
  const rows = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        inArray(appointments.calendarSyncStatus, ["failed", "pending", "not_connected"]),
        inArray(appointments.status, ["confirmed"]),
        sql`${appointments.startAt} > now()`,
      ),
    )
    .limit(20);
  let synced = 0;
  for (const r of rows) if ((await syncAppointmentToCalendar(r.id)) === "synced") synced++;
  return { attempted: rows.length, synced };
}

export async function applyRetention(now = new Date()) {
  const db = getDb();
  const { privacy } = await getSettings("privacy");
  let messages = 0, anonymised = 0;
  if (privacy.messageRetentionMonths > 0) {
    const r = await db.execute(sql`
      UPDATE appointments SET message = NULL
      WHERE message IS NOT NULL AND end_at < ${now.toISOString()}::timestamptz - make_interval(months => ${privacy.messageRetentionMonths})`);
    messages = r.rowCount ?? 0;
  }
  if (privacy.retentionMonths > 0) {
    const r = await db.execute(sql`
      UPDATE clients c SET name = 'Anonymised client', email = 'anonymised+' || c.id || '@invalid', phone = NULL, country = NULL,
        marketing_opt_in = false, anonymised_at = now(), updated_at = now()
      WHERE c.anonymised_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM appointments a WHERE a.client_id = c.id
            AND a.end_at > ${now.toISOString()}::timestamptz - make_interval(months => ${privacy.retentionMonths}))`);
    anonymised = r.rowCount ?? 0;
  }
  return { messages, anonymised };
}

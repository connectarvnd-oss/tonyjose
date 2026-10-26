import { eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { getAvailableSlots } from "@/lib/availability/service";
import {
  BookingError,
  cancelAppointment,
  createBooking,
  expireStaleHolds,
  handlePaymentEvent,
  rescheduleAppointment,
} from "@/lib/booking/service";
import { verifyManageToken } from "@/lib/booking/tokens";
import { getDb } from "@/lib/db";
import { appointments, blockedPeriods, notifications, payments } from "@/lib/db/schema";
import { processDueNotifications } from "@/lib/email/notifications";
import { eventIdFor } from "@/lib/google/calendar";
import { parseStripeWebhook } from "@/lib/payments/stripe";
import { processVerifiedPaymentEvent } from "@/lib/payments/webhook";
import { berlin, count, futureDate, installFakes, resetDatabase, seedBasics } from "./helpers";

let types: Awaited<ReturnType<typeof seedBasics>>;
let fakes: ReturnType<typeof installFakes>;
const day = futureDate(5);

function input(over: Partial<Parameters<typeof createBooking>[0]> = {}) {
  return {
    appointmentTypeId: types.free.id,
    start: berlin(day, "10:00"),
    name: "Asha Menon",
    email: `asha+${Math.random().toString(36).slice(2)}@example.com`,
    timeZone: "Asia/Kolkata",
    marketingOptIn: false,
    idempotencyKey: crypto.randomUUID(),
    ...over,
  };
}

async function appt(id: string) {
  const [a] = await getDb().select().from(appointments).where(eq(appointments.id, id));
  return a;
}

beforeEach(async () => {
  await resetDatabase();
  types = await seedBasics();
  fakes = installFakes();
});

describe("Journey A — free enquiry", () => {
  it("confirms without payment, creates one calendar event and sends emails", async () => {
    const res = await createBooking(input());
    expect(res.status).toBe("confirmed");
    expect(res.checkoutUrl).toBeNull();
    expect(res.reference).toMatch(/^TJ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(verifyManageToken(res.appointmentId, res.manageToken)).toBe(true);
    expect(verifyManageToken(res.appointmentId, "forged")).toBe(false);

    const a = await appt(res.appointmentId);
    expect(a.paymentStatus).toBe("not_required");
    expect(a.calendarSyncStatus).toBe("synced");
    expect(a.meetingLink).toContain("meet.google.com");
    expect(fakes.calendar.events.get(eventIdFor(a.id))?.summary).toContain("[Free]");
    expect(fakes.payments.checkouts.size).toBe(0);
    const sent = fakes.mailer.sent.map((m) => m.to);
    expect(sent).toContain(a ? (await getDb().execute<{ email: string }>(sql`select email from clients where id = ${a.clientId}`)).rows[0].email : "");
    expect(sent).toContain("tony@example.com");
    expect(fakes.mailer.sent.find((m) => m.subject.includes("confirmed"))?.attachments?.[0].filename).toBe("consultation.ics");
  });

  it("enforces one free enquiry per client when enabled", async () => {
    await createBooking(input({ email: "same@example.com" }));
    await expect(createBooking(input({ email: "SAME@example.com", start: berlin(day, "14:00") }))).rejects.toMatchObject({ code: "free_limit" });
  });
});

describe("double-booking protection", () => {
  it("only one of two concurrent requests for the same slot succeeds", async () => {
    const results = await Promise.allSettled([createBooking(input()), createBooking(input()), createBooking(input())]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed.every((f) => f.reason instanceof BookingError && f.reason.code === "slot_unavailable")).toBe(true);
    expect(await count("appointments", "status = 'confirmed'")).toBe(1);
  });

  it("is idempotent: retrying the same request returns the same booking", async () => {
    const i = input();
    const a = await createBooking(i);
    const b = await createBooking(i);
    expect(b.appointmentId).toBe(a.appointmentId);
    expect(await count("appointments")).toBe(1);
    expect(fakes.calendar.inserts).toBe(1);
  });

  it("applies the buffer between consultations", async () => {
    await createBooking(input({ start: berlin(day, "10:00") })); // 10:00–10:15, buffer to 10:30
    await expect(createBooking(input({ start: berlin(day, "10:15") }))).rejects.toMatchObject({ code: "slot_unavailable" });
    await expect(createBooking(input({ start: berlin(day, "10:30") }))).resolves.toBeTruthy();
  });

  it("rejects times outside working hours", async () => {
    await expect(createBooking(input({ start: berlin(day, "07:00") }))).rejects.toMatchObject({ code: "slot_unavailable" });
  });
});

describe("Journey B — paid consultation", () => {
  it("holds the slot, then confirms only after a verified payment event", async () => {
    const res = await createBooking(input({ appointmentTypeId: types.paid.id }));
    expect(res.status).toBe("pending_payment");
    expect(res.checkoutUrl).toContain("pay.example");
    let a = await appt(res.appointmentId);
    expect(a.paymentStatus).toBe("pending");
    expect(fakes.calendar.inserts).toBe(0);

    // Slot is held while paying
    await expect(createBooking(input({ start: berlin(day, "10:00") }))).rejects.toMatchObject({ code: "slot_unavailable" });

    const session = fakes.payments.checkouts.get(a.id)!;
    await processVerifiedPaymentEvent("test", "evt_1", "succeeded", { kind: "succeeded", appointmentId: a.id, sessionId: session, paymentId: "pi_1" });
    a = await appt(a.id);
    expect(a.status).toBe("confirmed");
    expect(a.paymentStatus).toBe("paid");
    expect(a.calendarSyncStatus).toBe("synced");
    expect(fakes.calendar.events.get(eventIdFor(a.id))?.summary).toContain("[Paid]");
    const [p] = await getDb().select().from(payments).where(eq(payments.appointmentId, a.id));
    expect(p.providerPaymentId).toBe("pi_1");

    // Duplicate webhook delivery is ignored
    const again = await processVerifiedPaymentEvent("test", "evt_1", "succeeded", { kind: "succeeded", appointmentId: a.id, sessionId: session, paymentId: "pi_1" });
    expect(again).toBe("duplicate");
    expect(fakes.calendar.inserts).toBe(1);
    expect(fakes.mailer.sent.filter((m) => m.subject.includes("confirmed"))).toHaveLength(1);
  });

  it("retried checkout requests reuse the same session (no double charge)", async () => {
    const i = input({ appointmentTypeId: types.paid.id });
    const a = await createBooking(i);
    const b = await createBooking(i);
    expect(b.checkoutUrl).toBe(a.checkoutUrl);
    expect(fakes.payments.checkouts.size).toBe(1);
  });
});

describe("Journey F — payment failure", () => {
  it("failed payment releases the slot and is never marked paid", async () => {
    const res = await createBooking(input({ appointmentTypeId: types.paid.id }));
    const session = fakes.payments.checkouts.get(res.appointmentId)!;
    await handlePaymentEvent({ kind: "failed", appointmentId: res.appointmentId, sessionId: session, reason: "card_declined" });
    const a = await appt(res.appointmentId);
    expect(a.status).toBe("payment_failed");
    expect(a.paymentStatus).toBe("failed");
    expect(fakes.mailer.sent.some((m) => m.subject.includes("not completed"))).toBe(true);
    await expect(createBooking(input({ start: berlin(day, "10:00") }))).resolves.toMatchObject({ status: "confirmed" });
  });

  it("abandoned checkout is released after the hold expires", async () => {
    const res = await createBooking(input({ appointmentTypeId: types.paid.id }));
    await getDb().update(appointments).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(appointments.id, res.appointmentId));
    expect(await expireStaleHolds()).toBe(1);
    const a = await appt(res.appointmentId);
    expect(a.status).toBe("expired");
    expect(fakes.payments.expired).toContain(fakes.payments.checkouts.get(res.appointmentId));
  });

  it("payment that arrives after the slot was taken triggers refund and admin alert", async () => {
    const res = await createBooking(input({ appointmentTypeId: types.paid.id }));
    await getDb().update(appointments).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(appointments.id, res.appointmentId));
    // Someone else books the same time (expired hold is swept inside the transaction)
    await createBooking(input({ start: berlin(day, "10:15") }));
    const session = fakes.payments.checkouts.get(res.appointmentId)!;
    const outcome = await handlePaymentEvent({ kind: "succeeded", appointmentId: res.appointmentId, sessionId: session, paymentId: "pi_late" });
    expect(outcome).toBe("conflict");
    const a = await appt(res.appointmentId);
    expect(a.status).toBe("needs_attention");
    expect(a.paymentStatus).toBe("refunded");
    expect(fakes.payments.refunds).toHaveLength(1);
    expect(fakes.mailer.sent.some((m) => m.to === "tony@example.com" && m.subject.includes("Action needed"))).toBe(true);
  });

  it("late payment is accepted if the slot is still free", async () => {
    const res = await createBooking(input({ appointmentTypeId: types.paid.id }));
    await getDb().update(appointments).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(appointments.id, res.appointmentId));
    await expireStaleHolds();
    const session = fakes.payments.checkouts.get(res.appointmentId)!;
    expect(await handlePaymentEvent({ kind: "succeeded", appointmentId: res.appointmentId, sessionId: session, paymentId: "pi_ok" })).toBe("confirmed");
  });
});

describe("Journey C & D — blocks and Google busy time", () => {
  it("blocked periods and Google busy events remove slots and prevent booking", async () => {
    const before = await getAvailableSlots({ type: types.free, fromDate: day, toDate: day });
    await getDb().insert(blockedPeriods).values({ startAt: berlin(day, "09:00"), endAt: berlin(day, "12:00"), reason: "Dentist" });
    fakes.calendar.busy.push({ start: berlin(day, "14:00"), end: berlin(day, "15:00") });
    const after = await getAvailableSlots({ type: types.free, fromDate: day, toDate: day });
    expect(after.slots.length).toBeLessThan(before.slots.length);
    expect(after.slots.some((s) => s.start === berlin(day, "10:00").toISOString())).toBe(false);
    expect(after.slots.some((s) => s.start === berlin(day, "14:30").toISOString())).toBe(false);
    await expect(createBooking(input({ start: berlin(day, "10:00") }))).rejects.toMatchObject({ code: "slot_unavailable" });
    await expect(createBooking(input({ start: berlin(day, "14:30") }))).rejects.toMatchObject({ code: "slot_unavailable" });
  });

  it("refuses to book when Google is connected but unreachable", async () => {
    fakes.calendar.fail = true;
    await expect(createBooking(input())).rejects.toMatchObject({ code: "calendar_unavailable" });
  });
});

describe("Journey E — rescheduling and cancellation", () => {
  it("moves the booking, updates the same calendar event and replaces reminders", async () => {
    const res = await createBooking(input({ appointmentTypeId: types.paid.id }));
    const session = fakes.payments.checkouts.get(res.appointmentId)!;
    await handlePaymentEvent({ kind: "succeeded", appointmentId: res.appointmentId, sessionId: session, paymentId: "pi_2" });
    const pendingBefore = await count("notifications", `appointment_id = '${res.appointmentId}' and type = 'client_reminder' and status = 'pending'`);
    expect(pendingBefore).toBe(1);

    // Overlapping its own current slot is allowed (own event is ignored)
    await rescheduleAppointment(res.appointmentId, berlin(day, "10:30"), { by: "admin" });
    const a = await appt(res.appointmentId);
    expect(a.startAt.toISOString()).toBe(berlin(day, "10:30").toISOString());
    expect(fakes.calendar.inserts).toBe(1);
    expect(fakes.calendar.events.get(eventIdFor(a.id))?.start.toISOString()).toBe(a.startAt.toISOString());
    expect(await count("notifications", `appointment_id = '${a.id}' and type = 'client_reminder' and status = 'cancelled'`)).toBe(1);
    expect(await count("notifications", `appointment_id = '${a.id}' and type = 'client_reminder' and status = 'pending'`)).toBe(1);
    // Old slot is free again
    await expect(createBooking(input({ start: berlin(day, "09:00") }))).resolves.toBeTruthy();
    // Cannot move onto another booking
    await createBooking(input({ start: berlin(day, "15:00") }));
    await expect(rescheduleAppointment(a.id, berlin(day, "15:00"), { by: "admin" })).rejects.toMatchObject({ code: "slot_unavailable" });
  });

  it("client cancellation with notice refunds in full, removes the event and stops reminders", async () => {
    const res = await createBooking(input({ appointmentTypeId: types.paid.id }));
    const session = fakes.payments.checkouts.get(res.appointmentId)!;
    await handlePaymentEvent({ kind: "succeeded", appointmentId: res.appointmentId, sessionId: session, paymentId: "pi_3" });
    await cancelAppointment(res.appointmentId, { by: "client", refund: "policy" });
    const a = await appt(res.appointmentId);
    expect(a.status).toBe("cancelled");
    expect(a.paymentStatus).toBe("refunded");
    expect(fakes.payments.refunds[0].amountCents).toBe(2800);
    expect(fakes.calendar.events.get(eventIdFor(a.id))?.deleted).toBe(true);

    // A reminder that comes due later is not sent
    await getDb().update(notifications).set({ status: "pending", scheduledAt: new Date(0) }).where(eq(notifications.type, "client_reminder"));
    const sentBefore = fakes.mailer.sent.length;
    await processDueNotifications();
    expect(fakes.mailer.sent.length).toBe(sentBefore);
  });

  it("client cannot cancel online inside the notice period", async () => {
    const soon = new Date(Date.now() + 3 * 3600_000);
    soon.setUTCMinutes(0, 0, 0);
    const d = futureDate(0);
    await getDb().execute(sql`INSERT INTO availability_overrides (date, start_time, end_time) VALUES (${d}, '00:00', '23:59'), (${futureDate(1)}, '00:00', '23:59')`);
    const res = await createBooking(input({ start: soon }));
    await expect(cancelAppointment(res.appointmentId, { by: "client", refund: "policy" })).rejects.toMatchObject({ code: "not_allowed" });
  });
});

describe("Stripe webhook verification", () => {
  it("accepts correctly signed events and rejects forged ones", () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({
      id: "evt_test",
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", object: "checkout.session", payment_status: "paid", payment_intent: "pi_9", metadata: { appointment_id: "a1" }, client_reference_id: "a1" } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const parsed = parseStripeWebhook(payload, header, secret);
    expect(parsed.event).toEqual({ kind: "succeeded", appointmentId: "a1", sessionId: "cs_1", paymentId: "pi_9" });
    expect(() => parseStripeWebhook(payload, header, "whsec_wrong")).toThrow();
    expect(() => parseStripeWebhook(payload.replace("paid", "unpaid"), header, secret)).toThrow();
  });

  it("treats completed-but-unpaid sessions as pending, not paid", () => {
    const secret = "whsec_x";
    const payload = JSON.stringify({ id: "evt_2", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_2", payment_status: "unpaid", metadata: { appointment_id: "a2" } } } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(parseStripeWebhook(payload, header, secret).event?.kind).toBe("pending");
  });
});

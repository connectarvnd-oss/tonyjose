// Notification queue: every email is a row first, then delivered. This makes
// sending idempotent (dedupe_key), retryable, and auditable, and lets
// reminders be cancelled when an appointment is cancelled or rescheduled.
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { notifications } from "../db/schema";
import { buildIcs } from "../ics";
import { integrations } from "../integrations";
import { getSettings } from "../settings";
import { loadAppointment, type FullAppointment } from "../booking/queries";
import { renderAdminAlert, renderEmail, type EmailContext, type TemplateName } from "./templates";
import { eventIdFor } from "../google/calendar";
import { manageTokenFor } from "../booking/tokens";

const siteUrl = () => (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

type Enqueue = {
  appointmentId: string | null;
  type: TemplateName | "admin_alert";
  recipient: string;
  scheduledAt?: Date;
  forStartAt?: Date | null;
  dedupeKey: string;
  payload?: Record<string, unknown>;
};

export async function enqueue(n: Enqueue) {
  if (!n.recipient) return;
  await getDb()
    .insert(notifications)
    .values({
      appointmentId: n.appointmentId,
      type: n.type,
      recipient: n.recipient,
      scheduledAt: n.scheduledAt ?? new Date(),
      forStartAt: n.forStartAt ?? null,
      dedupeKey: n.dedupeKey,
      payload: n.payload ?? null,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey });
}

export async function adminRecipient() {
  const { notifications: n } = await getSettings("notifications");
  return n.adminEmail || process.env.ADMIN_NOTIFICATION_EMAIL || "";
}

/** Queue confirmation, admin notice and reminders for a newly confirmed appointment. */
export async function scheduleConfirmationNotifications(a: FullAppointment, opts: { kind: "new" | "reschedule" }) {
  const { notifications: n } = await getSettings("notifications");
  const admin = await adminRecipient();
  const startKey = a.appointment.startAt.toISOString();
  const id = a.appointment.id;
  const clientType: TemplateName = opts.kind === "new" ? "client_confirmation" : "client_reschedule";
  await enqueue({ appointmentId: id, type: clientType, recipient: a.client.email, forStartAt: a.appointment.startAt, dedupeKey: `${id}:${clientType}:${startKey}` });
  if (n.notifyAdminOnBooking && admin) {
    const adminType: TemplateName = opts.kind === "new" ? "admin_new_booking" : "admin_reschedule";
    await enqueue({ appointmentId: id, type: adminType, recipient: admin, forStartAt: a.appointment.startAt, dedupeKey: `${id}:${adminType}:${startKey}` });
  }
  await scheduleReminders(a);
}

export async function scheduleReminders(a: FullAppointment) {
  const { notifications: n } = await getSettings("notifications");
  const now = Date.now();
  for (const r of n.reminders) {
    if (!r.enabled) continue;
    const at = new Date(a.appointment.startAt.getTime() - r.hoursBefore * 3600_000);
    if (at.getTime() <= now) continue;
    await enqueue({
      appointmentId: a.appointment.id,
      type: "client_reminder",
      recipient: a.client.email,
      scheduledAt: at,
      forStartAt: a.appointment.startAt,
      dedupeKey: `${a.appointment.id}:reminder:${a.appointment.startAt.toISOString()}:${r.hoursBefore}h`,
    });
  }
}

/** Prevents stale reminders after a cancellation or reschedule. */
export async function cancelPendingReminders(appointmentId: string) {
  await getDb()
    .update(notifications)
    .set({ status: "cancelled" })
    .where(and(eq(notifications.appointmentId, appointmentId), eq(notifications.status, "pending"), eq(notifications.type, "client_reminder")));
}

export async function alertAdmin(subject: string, message: string, dedupeKey: string, appointmentId: string | null = null) {
  const admin = await adminRecipient();
  console.warn(`[admin-alert] ${subject}: ${message}`);
  if (!admin) return;
  await enqueue({ appointmentId, type: "admin_alert", recipient: admin, dedupeKey: `alert:${dedupeKey}`, payload: { subject, message } });
}

export async function buildEmailContext(a: FullAppointment, extra: Partial<EmailContext> = {}): Promise<EmailContext> {
  const s = await getSettings("booking", "meeting");
  const rules = s.booking.allowClientCancel
    ? `You can reschedule or cancel up to ${s.booking.cancellationNoticeHours} hours before the appointment using the link in this email.${
        a.appointment.priceCents > 0 && s.booking.refundPolicy === "full_if_notice" ? " Paid consultations cancelled in time are refunded in full." : ""
      }`
    : "To reschedule or cancel, please reply to this email.";
  return {
    clientName: a.client.name,
    clientEmail: a.client.email,
    clientPhone: a.client.phone,
    clientCountry: a.client.country,
    typeName: a.type.name,
    durationMinutes: Math.round((a.appointment.endAt.getTime() - a.appointment.startAt.getTime()) / 60000),
    priceCents: a.appointment.priceCents,
    currency: a.appointment.currency,
    paymentStatus: a.appointment.paymentStatus,
    reference: a.appointment.reference,
    start: a.appointment.startAt,
    end: a.appointment.endAt,
    clientTimeZone: a.appointment.timeZone,
    businessTimeZone: s.booking.timeZone,
    manageUrl: `${siteUrl()}/booking/${a.appointment.reference}?t=${manageTokenFor(a.appointment.id)}`,
    meetingLink: a.appointment.meetingLink,
    meetingInstructions: s.meeting.mode === "custom" ? s.meeting.customInstructions : s.meeting.mode === "google_meet" && !a.appointment.meetingLink ? "Tony will send the meeting details before the appointment." : null,
    enquiryArea: a.appointment.enquiryArea,
    message: a.appointment.message,
    adminUrl: `${siteUrl()}/admin/appointments/${a.appointment.id}`,
    cancellationRules: rules,
    ...extra,
  };
}

/**
 * Sends due notifications. Rows are claimed with SKIP LOCKED so concurrent
 * cron runs never double-send.
 */
export async function processDueNotifications(opts: { appointmentId?: string; limit?: number } = {}) {
  const db = getDb();
  const limit = opts.limit ?? 25;
  const claimed = await db.execute<{ id: string }>(sql`
    UPDATE notifications SET status = 'sending', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM notifications
      WHERE status = 'pending' AND scheduled_at <= now()
      ${opts.appointmentId ? sql`AND appointment_id = ${opts.appointmentId}` : sql``}
      ORDER BY scheduled_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`);
  const ids = claimed.rows.map((r) => r.id);
  if (!ids.length) return { sent: 0, failed: 0, skipped: 0 };
  const rows = await db.select().from(notifications).where(inArray(notifications.id, ids));
  const { email } = await getSettings("email");
  const mailer = integrations().mailer();
  const fromAddress = email.fromAddress || process.env.EMAIL_FROM || "bookings@example.com";
  const from = `${email.fromName} <${fromAddress}>`;
  let sent = 0, failed = 0, skipped = 0;

  for (const n of rows) {
    try {
      let rendered: { subject: string; html: string; text: string };
      let attachments: { filename: string; content: string; contentType: string }[] | undefined;
      if (n.type === "admin_alert") {
        const p = (n.payload ?? {}) as { subject?: string; message?: string };
        rendered = renderAdminAlert(p.subject ?? "Booking system alert", p.message ?? "", `${siteUrl()}/admin`);
      } else {
        const a = n.appointmentId ? await loadAppointment(n.appointmentId) : null;
        if (!a) {
          await db.update(notifications).set({ status: "skipped", error: "Appointment not found" }).where(eq(notifications.id, n.id));
          skipped++;
          continue;
        }
        if (n.type === "client_reminder") {
          const stillValid =
            a.appointment.status === "confirmed" &&
            n.forStartAt &&
            n.forStartAt.getTime() === a.appointment.startAt.getTime() &&
            a.appointment.startAt.getTime() > Date.now();
          if (!stillValid) {
            await db.update(notifications).set({ status: "cancelled", error: "Appointment changed" }).where(eq(notifications.id, n.id));
            skipped++;
            continue;
          }
        }
        const payload = (n.payload ?? {}) as { extra?: string; refundNote?: string };
        const ctx = await buildEmailContext(a, { extra: payload.extra ?? null, refundNote: payload.refundNote ?? null });
        rendered = renderEmail(n.type as TemplateName, ctx, email);
        if (n.type === "client_confirmation" || n.type === "client_reschedule") {
          attachments = [
            {
              filename: "consultation.ics",
              contentType: "text/calendar; charset=utf-8; method=PUBLISH",
              content: buildIcs({
                uid: `${eventIdFor(a.appointment.id)}@tonyjose`,
                start: a.appointment.startAt,
                end: a.appointment.endAt,
                summary: `${a.type.name} with Tony Jose`,
                description: `Booking reference ${a.appointment.reference}${a.appointment.meetingLink ? `\nJoin: ${a.appointment.meetingLink}` : ""}\nManage: ${ctx.manageUrl}`,
                location: a.appointment.meetingLink,
                organizerName: email.fromName,
                organizerEmail: fromAddress,
                sequence: a.appointment.rescheduleCount,
              }),
            },
          ];
        }
      }
      const res = await mailer.send({
        to: n.recipient,
        from,
        replyTo: email.replyTo || undefined,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        attachments,
        idempotencyKey: n.dedupeKey,
      });
      await db
        .update(notifications)
        .set({ status: "sent", sentAt: new Date(), providerMessageId: res.id, error: mailer.live ? null : "Logged only — no email provider configured" })
        .where(eq(notifications.id, n.id));
      sent++;
    } catch (err) {
      const msg = (err as Error).message;
      const retry = n.attempts < 5;
      await db
        .update(notifications)
        .set({
          status: retry ? "pending" : "failed",
          error: msg.slice(0, 500),
          scheduledAt: new Date(Date.now() + 2 ** n.attempts * 60_000),
        })
        .where(eq(notifications.id, n.id));
      console.error(`[notifications] ${n.type} to ${n.recipient} failed`, msg);
      failed++;
    }
  }
  return { sent, failed, skipped };
}

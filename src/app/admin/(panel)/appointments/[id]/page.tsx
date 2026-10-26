import { desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminReschedule } from "@/components/admin/AdminReschedule";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { Badge, btnDangerCls, btnSecondaryCls, Card, Flash, inputCls, labelCls, PaymentBadge, StatusBadge } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { loadAppointment } from "@/lib/booking/queries";
import { manageTokenFor } from "@/lib/booking/tokens";
import { formatPrice } from "@/lib/content";
import { getDb } from "@/lib/db";
import { adminUsers, appointmentNotes, auditLogs, notifications, payments } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";
import { addNote, cancel, refund, reschedule, resend, retrySync, setOutcome } from "./actions";

export const metadata = { title: "Appointment" };

export default async function AppointmentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const [{ id }, sp, admin] = await Promise.all([params, searchParams, requireAdmin()]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const a = await loadAppointment(id);
  if (!a) notFound();
  const { timeZone } = await getSetting("booking");
  const db = getDb();
  const [notes, pays, notifs, history] = await Promise.all([
    db.select({ n: appointmentNotes, by: adminUsers.name }).from(appointmentNotes).leftJoin(adminUsers, eq(adminUsers.id, appointmentNotes.adminId)).where(eq(appointmentNotes.appointmentId, id)).orderBy(desc(appointmentNotes.createdAt)),
    db.select().from(payments).where(eq(payments.appointmentId, id)).orderBy(desc(payments.createdAt)),
    db.select().from(notifications).where(eq(notifications.appointmentId, id)).orderBy(desc(notifications.scheduledAt)),
    db.select().from(auditLogs).where(eq(auditLogs.entityId, id)).orderBy(desc(auditLogs.createdAt)).limit(30),
  ]);
  const { appointment: appt, client, type } = a;
  const fmt = (d: Date, z = timeZone) => DateTime.fromJSDate(d, { zone: z }).toFormat("ccc d LLL yyyy, HH:mm");
  const paidPayment = pays.find((p) => p.status === "paid");
  const refundable = paidPayment ? paidPayment.amountCents - paidPayment.refundedCents : 0;
  const active = appt.status === "confirmed";
  const past = appt.startAt.getTime() < Date.now();

  return (
    <div className="max-w-5xl">
      <Link href="/admin/appointments" className="text-sm text-muted hover:text-ink">← Appointments</Link>
      <div className="mb-8 mt-3 flex flex-col gap-3 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-sm text-muted">{appt.reference}</p>
          <h1 className="mt-1 font-display text-4xl md:text-5xl">{client.name}</h1>
          <p className="mt-2 text-charcoal">
            {type.name} · {fmt(appt.startAt)}–{DateTime.fromJSDate(appt.endAt, { zone: timeZone }).toFormat("HH:mm")} ({timeZone})
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={appt.status} />
          <PaymentBadge status={appt.paymentStatus} />
          {appt.calendarSyncStatus === "synced" && <Badge tone="green">In Google Calendar</Badge>}
          {appt.calendarSyncStatus === "failed" && <Badge tone="red">Calendar sync failed</Badge>}
          {appt.calendarSyncStatus === "not_connected" && <Badge tone="amber">Calendar not connected</Badge>}
        </div>
      </div>

      <Flash message={sp.ok} />
      <Flash message={sp.err} tone="red" />
      {appt.status === "needs_attention" && (
        <div className="mb-6 rounded-md border border-danger/40 bg-danger/5 p-4 text-sm">
          <strong>Needs attention:</strong> {appt.attentionReason} Resolve by refunding, or contact the client to agree a new time.
        </div>
      )}
      {appt.calendarSyncStatus === "failed" && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger/5 p-4 text-sm">
          <span><strong>Calendar sync failed:</strong> {appt.calendarSyncError}</span>
          <form action={retrySync.bind(null, id)}><SubmitButton className={btnSecondaryCls}>Retry calendar sync</SubmitButton></form>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title="Details">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted">Email</dt><dd><a href={`mailto:${client.email}`} className="underline">{client.email}</a></dd>
              <dt className="text-muted">Phone</dt><dd>{client.phone ?? "—"}</dd>
              <dt className="text-muted">Country</dt><dd>{client.country ?? "—"}</dd>
              <dt className="text-muted">Area</dt><dd>{appt.enquiryArea ?? "—"}</dd>
              <dt className="text-muted">Client's message</dt><dd className="whitespace-pre-wrap">{appt.message ?? "—"}</dd>
              <dt className="text-muted">Client time zone</dt><dd>{appt.timeZone} ({fmt(appt.startAt, appt.timeZone)})</dd>
              <dt className="text-muted">Price</dt><dd>{formatPrice(appt.priceCents, appt.currency)}</dd>
              <dt className="text-muted">Meeting link</dt><dd>{appt.meetingLink ? <a href={appt.meetingLink} className="text-accent underline" target="_blank" rel="noreferrer">{appt.meetingLink}</a> : "—"}</dd>
              <dt className="text-muted">Marketing consent</dt><dd>{client.marketingOptIn ? `Yes (${client.marketingOptInAt?.toLocaleDateString("en-GB")})` : "No"}</dd>
              <dt className="text-muted">Booked</dt><dd>{fmt(appt.createdAt)}</dd>
              {appt.rescheduleCount > 0 && (<><dt className="text-muted">Rescheduled</dt><dd>{appt.rescheduleCount}×</dd></>)}
              {appt.cancelledAt && (<><dt className="text-muted">Cancelled</dt><dd>{fmt(appt.cancelledAt)} by {appt.cancelledBy}{appt.cancellationReason ? ` — “${appt.cancellationReason}”` : ""}</dd></>)}
            </dl>
          </Card>

          <Card title="Private notes" description="Only visible to administrators. Never shown or sent to the client.">
            <form action={addNote.bind(null, id)} className="space-y-3">
              <textarea name="body" rows={3} className={inputCls} placeholder="Add a note…" required maxLength={4000} />
              <SubmitButton>Add note</SubmitButton>
            </form>
            <ul className="mt-5 space-y-4">
              {notes.map(({ n, by }) => (
                <li key={n.id} className="border-l-2 border-line pl-4 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">{by ?? "Admin"} · {fmt(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Payments">
            {pays.length === 0 ? (
              <p className="text-sm text-muted">No payment required.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {pays.map((p) => (
                  <li key={p.id} className="py-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>{formatPrice(p.amountCents, p.currency)} via {p.provider === "test" ? "test mode (simulated)" : p.provider}</span>
                      <span className="flex gap-2"><Badge tone={p.status === "paid" ? "green" : p.status === "pending" ? "amber" : "grey"}>{p.status}</Badge>{p.refundStatus !== "none" && <Badge tone="blue">refund: {p.refundStatus}</Badge>}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted">
                      session {p.providerSessionId ?? "—"} · payment {p.providerPaymentId ?? "—"}
                      {p.refundReference ? ` · refund ${p.refundReference}` : ""}
                      {p.refundedCents ? ` · refunded ${formatPrice(p.refundedCents, p.currency)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {refundable > 0 && admin.role === "owner" && (
              <form action={refund.bind(null, id)} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                <label>
                  <span className={labelCls}>Refund amount (€)</span>
                  <input name="amount" inputMode="decimal" defaultValue={(refundable / 100).toFixed(2)} className={`${inputCls} w-32`} />
                </label>
                <SubmitButton className={btnSecondaryCls} confirm="Issue this refund through the payment provider?">Issue refund</SubmitButton>
              </form>
            )}
          </Card>

          <Card title="Emails">
            {notifs.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <ul className="divide-y divide-line text-sm">
                {notifs.map((n) => (
                  <li key={n.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                    <span>{n.type.replace(/_/g, " ")} → {n.recipient}</span>
                    <span className="text-muted">
                      {n.status === "sent" ? `sent ${fmt(n.sentAt ?? n.scheduledAt)}` : n.status === "pending" ? `scheduled ${fmt(n.scheduledAt)}` : n.status}
                      {n.error ? ` · ${n.error}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="History">
            <ul className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex justify-between gap-3">
                  <span>{h.actor} · {h.action.replace(/[._]/g, " ")}</span>
                  <span className="text-muted">{fmt(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Actions">
            <div className="space-y-4">
              {active && (
                <AdminReschedule reference={appt.reference} token={manageTokenFor(appt.id)} businessTimeZone={timeZone} action={reschedule.bind(null, id)} />
              )}
              {(active || appt.status === "completed" || appt.status === "no_show") && (
                <form action={setOutcome.bind(null, id)} className="flex flex-wrap gap-2">
                  {appt.status !== "completed" && past && <SubmitButton name="status" value="completed" className={btnSecondaryCls}>Mark completed</SubmitButton>}
                  {appt.status !== "no_show" && past && <SubmitButton name="status" value="no_show" className={btnSecondaryCls}>Mark no-show</SubmitButton>}
                  {appt.status !== "confirmed" && <SubmitButton name="status" value="confirmed" className={btnSecondaryCls}>Revert to confirmed</SubmitButton>}
                  {!past && active && <p className="text-xs text-muted">Completed / no-show become available after the start time.</p>}
                </form>
              )}
              {active && (
                <form action={resend.bind(null, id)} className="flex flex-wrap gap-2">
                  <SubmitButton name="kind" value="confirmation" className={btnSecondaryCls}>Resend confirmation</SubmitButton>
                  {!past && <SubmitButton name="kind" value="reminder" className={btnSecondaryCls}>Send reminder now</SubmitButton>}
                </form>
              )}
              {appt.calendarSyncStatus !== "synced" && active && (
                <form action={retrySync.bind(null, id)}><SubmitButton className={btnSecondaryCls}>Sync to Google Calendar</SubmitButton></form>
              )}
            </div>
          </Card>

          {["confirmed", "pending_payment", "needs_attention"].includes(appt.status) && (
            <Card title="Cancel appointment">
              <form action={cancel.bind(null, id)} className="space-y-3 text-sm">
                <label className="block">
                  <span className={labelCls}>Reason (optional, shared with client)</span>
                  <input name="reason" className={inputCls} maxLength={500} />
                </label>
                {appt.paymentStatus === "paid" && (
                  <fieldset className="space-y-1">
                    <legend className={labelCls}>Refund</legend>
                    <label className="flex gap-2"><input type="radio" name="refund" value="full" defaultChecked /> Full refund</label>
                    <label className="flex gap-2"><input type="radio" name="refund" value="none" /> No refund</label>
                  </fieldset>
                )}
                <label className="flex gap-2"><input type="checkbox" name="notify" defaultChecked /> Email the client</label>
                <SubmitButton className={btnDangerCls} confirm="Cancel this appointment? The slot will be released and the calendar event removed.">Cancel appointment</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

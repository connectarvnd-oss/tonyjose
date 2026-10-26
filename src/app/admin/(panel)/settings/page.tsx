import { asc } from "drizzle-orm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { Badge, btnCls, btnSecondaryCls, Card, Flash, inputCls, labelCls, PageHeader } from "@/components/admin/ui";
import { integrationStatus } from "@/lib/admin/integration-status";
import { requireAdmin } from "@/lib/auth/admin";
import { getDb } from "@/lib/db";
import { adminUsers } from "@/lib/db/schema";
import { getGoogleAccount, listCalendars, redirectUri } from "@/lib/google/calendar";
import { getSettings } from "@/lib/settings";
import { addAdmin, changePassword, disconnectGoogleAction, saveBooking, saveCalendar, saveEmail, saveMeeting, saveNotifications, savePayments, savePrivacy } from "./actions";

export const metadata = { title: "Settings" };

const GOOGLE_MSG: Record<string, string> = {
  connected: "Google Calendar connected.",
  denied: "Google access was not granted.",
  state_mismatch: "The connection attempt expired or was tampered with. Please try again.",
  not_configured: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (see the setup guide).",
  missing_code: "Google did not return an authorisation code.",
};

function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={checked} /> {label}</label>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; google?: string; message?: string }> }) {
  const admin = await requireAdmin("owner");
  const sp = await searchParams;
  const s = await getSettings("booking", "calendar", "meeting", "email", "notifications", "payments", "privacy");
  const [status, account, admins] = await Promise.all([integrationStatus(), getGoogleAccount(), getDb().select().from(adminUsers).orderBy(asc(adminUsers.createdAt))]);
  let calendars: { id: string; summary: string; primary: boolean; accessRole: string }[] = [];
  let calendarsError: string | null = null;
  if (account && account.status !== "revoked") {
    try {
      calendars = await listCalendars();
    } catch (err) {
      calendarsError = (err as Error).message;
    }
  }
  const googleMsg = sp.google ? (GOOGLE_MSG[sp.google] ?? `Google connection failed: ${sp.message ?? "unknown error"}`) : null;
  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  const testAllowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_TEST_PAYMENTS === "true";
  const tmpl = s.email.templates;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" description="Credentials (API keys, OAuth secrets) are set as environment variables on the server — never here, and never in the browser." />
      <Flash message={sp.ok} />
      <Flash message={sp.err} tone="red" />
      <Flash message={googleMsg} tone={sp.google === "connected" ? "green" : "red"} />
      <nav className="mb-6 flex flex-wrap gap-2 text-sm">
        {["integrations", "booking", "meeting", "notifications", "email", "payments", "privacy", "account"].map((k) => (
          <a key={k} href={`#${k}`} className="rounded-md border border-line bg-white px-2.5 py-1 capitalize hover:border-ink">{k}</a>
        ))}
      </nav>

      <div className="space-y-6">
        <Card id="integrations" title="Integration status">
          <ul className="divide-y divide-line">
            {status.map((i) => (
              <li key={i.key} className="grid gap-1 py-3 sm:grid-cols-[11rem_9rem_1fr] sm:items-baseline">
                <span className="font-medium">{i.label}</span>
                <span><Badge tone={i.ok ? (i.live ? "green" : "amber") : "red"}>{i.status}</Badge></span>
                <span className="text-sm text-muted">{i.detail}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Google Calendar" description={`Tony connects his own Google account. Authorised redirect URI to register in Google Cloud: ${redirectUri()}`}>
          <div className="flex flex-wrap items-center gap-3">
            {account ? (
              <>
                <p className="text-sm">Connected as <strong>{account.email ?? "unknown"}</strong> {account.status !== "connected" && <Badge tone="red">{account.status}</Badge>}</p>
                <a href="/api/google/oauth/start" className={btnSecondaryCls}>Reconnect</a>
                <form action={disconnectGoogleAction}><SubmitButton className={btnSecondaryCls} confirm="Disconnect Google Calendar? Availability will no longer consider Google busy times.">Disconnect</SubmitButton></form>
              </>
            ) : (
              <a href="/api/google/oauth/start" className={btnCls}>Connect Google Calendar</a>
            )}
          </div>
          {calendarsError && <p className="mt-3 text-sm text-danger">Couldn't list calendars: {calendarsError}</p>}
          <form action={saveCalendar} className="mt-6 space-y-4 border-t border-line pt-5">
            <label className="block">
              <span className={labelCls}>Calendar for new consultation events</span>
              {calendars.length ? (
                <select name="bookingCalendarId" defaultValue={s.calendar.bookingCalendarId} className={inputCls}>
                  {calendars.filter((c) => ["owner", "writer"].includes(c.accessRole)).map((c) => (
                    <option key={c.id} value={c.primary ? "primary" : c.id}>{c.summary}{c.primary ? " (primary)" : ""}</option>
                  ))}
                </select>
              ) : (
                <input name="bookingCalendarId" defaultValue={s.calendar.bookingCalendarId} className={inputCls} />
              )}
            </label>
            <fieldset>
              <legend className={labelCls}>Calendars whose busy times block bookings</legend>
              {calendars.length ? (
                <div className="space-y-1">
                  {calendars.map((c) => {
                    const id = c.primary ? "primary" : c.id;
                    return <Check key={c.id} name="busyCalendarIds" label={`${c.summary}${c.primary ? " (primary)" : ""}`} checked={s.calendar.busyCalendarIds.includes(id)} />;
                  })}
                </div>
              ) : (
                <input name="busyCalendarIds" defaultValue={s.calendar.busyCalendarIds.join(",")} className={inputCls} />
              )}
              <p className="mt-1 text-xs text-muted">Only free/busy times are read. Event titles and descriptions are never shown to visitors.</p>
            </fieldset>
            <Check name="sendInvites" label="Add the client as a guest and send them a Google Calendar invitation" checked={s.calendar.sendInvites} />
            <Check name="includeClientContact" label="Include the client's email and phone in Tony's event description" checked={s.calendar.includeClientContact} />
            <SubmitButton>Save calendar settings</SubmitButton>
          </form>
        </Card>

        <Card id="booking" title="Booking, cancellation & rescheduling rules" description="Working hours, buffers and notice periods are on the Availability page.">
          <form action={saveBooking} className="grid gap-4 sm:grid-cols-2">
            <label><span className={labelCls}>Time zone</span><input name="timeZone" defaultValue={s.booking.timeZone} className={inputCls} /></label>
            <label><span className={labelCls}>Hold a paid slot during checkout (min)</span><input name="holdMinutes" type="number" min={5} max={1440} defaultValue={s.booking.holdMinutes} className={inputCls} /><span className="mt-1 block text-xs text-muted">Stripe Checkout requires at least 30.</span></label>
            <div className="space-y-2 sm:col-span-2">
              <Check name="allowClientCancel" label="Clients can cancel online" checked={s.booking.allowClientCancel} />
              <Check name="allowClientReschedule" label="Clients can reschedule online" checked={s.booking.allowClientReschedule} />
              <Check name="requireCalendarCheck" label="Pause public booking if Google Calendar can't be checked (recommended)" checked={s.booking.requireCalendarCheck} />
            </div>
            <label><span className={labelCls}>Cancellation notice (hours)</span><input name="cancellationNoticeHours" type="number" min={0} defaultValue={s.booking.cancellationNoticeHours} className={inputCls} /></label>
            <label><span className={labelCls}>Reschedule notice (hours)</span><input name="rescheduleNoticeHours" type="number" min={0} defaultValue={s.booking.rescheduleNoticeHours} className={inputCls} /></label>
            <label><span className={labelCls}>Max reschedules per booking</span><input name="maxReschedules" type="number" min={0} max={10} defaultValue={s.booking.maxReschedules} className={inputCls} /></label>
            <label>
              <span className={labelCls}>Refund when a client cancels</span>
              <select name="refundPolicy" defaultValue={s.booking.refundPolicy} className={inputCls}>
                <option value="full_if_notice">Automatic full refund if within notice period</option>
                <option value="manual">Never automatic — I decide</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className={labelCls}>If a payment completes but the slot is no longer free</span>
              <select name="conflictResolution" defaultValue={s.booking.conflictResolution} className={inputCls}>
                <option value="refund">Refund automatically, then alert me</option>
                <option value="review">Alert me and let me resolve it</option>
              </select>
            </label>
            <div className="sm:col-span-2"><SubmitButton>Save rules</SubmitButton></div>
          </form>
        </Card>

        <Card id="meeting" title="Online meetings">
          <form action={saveMeeting} className="space-y-4">
            <fieldset className="space-y-1 text-sm">
              <label className="flex gap-2"><input type="radio" name="mode" value="google_meet" defaultChecked={s.meeting.mode === "google_meet"} /> Create a Google Meet link automatically (requires Google Calendar)</label>
              <label className="flex gap-2"><input type="radio" name="mode" value="custom" defaultChecked={s.meeting.mode === "custom"} /> Use my own instructions (e.g. Zoom link, phone)</label>
              <label className="flex gap-2"><input type="radio" name="mode" value="none" defaultChecked={s.meeting.mode === "none"} /> None</label>
            </fieldset>
            <label className="block"><span className={labelCls}>Custom meeting instructions</span><textarea name="customInstructions" rows={3} defaultValue={s.meeting.customInstructions} className={inputCls} /></label>
            <SubmitButton>Save</SubmitButton>
          </form>
        </Card>

        <Card id="notifications" title="Notifications & reminders">
          <form action={saveNotifications} className="space-y-4">
            <label className="block"><span className={labelCls}>Tony's notification email</span><input type="email" name="adminEmail" defaultValue={s.notifications.adminEmail} placeholder={process.env.ADMIN_NOTIFICATION_EMAIL ?? ""} className={inputCls} /></label>
            <Check name="notifyAdminOnBooking" label="Email me about new and rescheduled bookings" checked={s.notifications.notifyAdminOnBooking} />
            <Check name="notifyAdminOnCancel" label="Email me when a client cancels" checked={s.notifications.notifyAdminOnCancel} />
            <fieldset>
              <legend className={labelCls}>Client reminders (hours before)</legend>
              <div className="space-y-2">
                {[0, 1, 2].map((i) => {
                  const r = s.notifications.reminders[i];
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <input type="number" name={`reminder.${i}.hours`} min={0} step="0.25" defaultValue={r?.hoursBefore ?? ""} placeholder="e.g. 2" className={`${inputCls} w-28`} aria-label={`Reminder ${i + 1} hours`} />
                      <Check name={`reminder.${i}.enabled`} label="enabled" checked={r?.enabled ?? false} />
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted">Reminders are never sent for cancelled or moved appointments. Changes apply to new bookings.</p>
            </fieldset>
            <SubmitButton>Save</SubmitButton>
          </form>
        </Card>

        <Card id="email" title="Email sender & templates" description="Placeholders: {{name}} (first name), {{fullName}}, {{type}}, {{date}}, {{reference}}. Booking details, links and the calendar file are added automatically.">
          <form action={saveEmail} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className={labelCls}>Sender name</span><input name="fromName" defaultValue={s.email.fromName} className={inputCls} /></label>
              <label><span className={labelCls}>Sender address</span><input name="fromAddress" defaultValue={s.email.fromAddress} placeholder={process.env.EMAIL_FROM ?? "bookings@yourdomain"} className={inputCls} /></label>
              <label><span className={labelCls}>Reply-to</span><input name="replyTo" defaultValue={s.email.replyTo} className={inputCls} /></label>
            </div>
            <label className="block"><span className={labelCls}>Signature</span><input name="signature" defaultValue={s.email.signature} className={inputCls} /></label>
            {(
              [
                ["confirmation", "Confirmation"],
                ["reminder", "Reminder"],
                ["reschedule", "Rescheduled"],
                ["cancellation", "Cancellation"],
                ["paymentIssue", "Payment not completed"],
              ] as const
            ).map(([k, label]) => (
              <fieldset key={k} className="grid gap-2 border-t border-line pt-3">
                <legend className="text-sm font-medium">{label}</legend>
                <input name={`${k}.subject`} defaultValue={tmpl[k].subject} className={inputCls} aria-label={`${label} subject`} />
                <textarea name={`${k}.intro`} rows={2} defaultValue={tmpl[k].intro} className={inputCls} aria-label={`${label} intro`} />
              </fieldset>
            ))}
            <SubmitButton>Save email settings</SubmitButton>
          </form>
        </Card>

        <Card id="payments" title="Payments" description="Keys are environment variables: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Card details never touch this server.">
          <form action={savePayments} className="space-y-4">
            <label className="block">
              <span className={labelCls}>Provider</span>
              <select name="provider" defaultValue={s.payments.provider ?? ""} className={inputCls}>
                <option value="">Automatic (Stripe if configured)</option>
                <option value="stripe" disabled={!stripeReady}>Stripe {stripeReady ? "" : "(not configured)"}</option>
                <option value="test" disabled={!testAllowed}>Test mode — simulated, no real payments {testAllowed ? "" : "(disabled in production)"}</option>
              </select>
            </label>
            <p className="text-xs text-muted">Stripe webhook endpoint: <code>{(process.env.SITE_URL ?? "").replace(/\/$/, "")}/api/webhooks/stripe</code></p>
            <SubmitButton>Save</SubmitButton>
          </form>
        </Card>

        <Card id="privacy" title="Privacy & data retention" description="Old personal data is anonymised automatically by the scheduled job. Payment records stay for accounting.">
          <form action={savePrivacy} className="grid gap-3 sm:grid-cols-2">
            <label><span className={labelCls}>Anonymise clients after (months since last appointment, 0 = never)</span><input type="number" name="retentionMonths" min={0} max={120} defaultValue={s.privacy.retentionMonths} className={inputCls} /></label>
            <label><span className={labelCls}>Delete clients' messages after (months)</span><input type="number" name="messageRetentionMonths" min={0} max={120} defaultValue={s.privacy.messageRetentionMonths} className={inputCls} /></label>
            <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div>
          </form>
        </Card>

        <Card id="account" title="Administrators & password">
          <ul className="mb-5 divide-y divide-line text-sm">
            {admins.map((a) => (
              <li key={a.id} className="flex justify-between py-2"><span>{a.name} · {a.email}</span><Badge tone={a.role === "owner" ? "blue" : "grey"}>{a.role}</Badge></li>
            ))}
          </ul>
          <form action={addAdmin} className="grid gap-3 border-t border-line pt-5 sm:grid-cols-4">
            <input name="name" placeholder="Name" className={inputCls} aria-label="Name" />
            <input name="email" type="email" placeholder="Email" className={inputCls} aria-label="Email" />
            <input name="password" type="password" placeholder="Temporary password (12+)" className={inputCls} aria-label="Password" />
            <select name="role" className={inputCls} aria-label="Role"><option value="staff">Staff (no settings)</option><option value="owner">Owner</option></select>
            <div><SubmitButton>Add administrator</SubmitButton></div>
          </form>
          <form action={changePassword} className="mt-6 grid gap-3 border-t border-line pt-5 sm:grid-cols-3">
            <p className="text-sm font-medium sm:col-span-3">Change your password ({admin.email})</p>
            <input name="current" type="password" autoComplete="current-password" placeholder="Current password" className={inputCls} aria-label="Current password" />
            <input name="next" type="password" autoComplete="new-password" placeholder="New password (12+)" className={inputCls} aria-label="New password" />
            <div><SubmitButton>Change password</SubmitButton></div>
          </form>
        </Card>
      </div>
    </div>
  );
}

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { settings } from "../db/schema";
import { getGoogleAccount } from "../google/calendar";
import { resolvePaymentProvider } from "../integrations";
import { getSettings } from "../settings";

export type IntegrationState = { key: string; label: string; ok: boolean; live: boolean; status: string; detail: string };

export async function integrationStatus(): Promise<IntegrationState[]> {
  const out: IntegrationState[] = [];
  const s = await getSettings("email", "notifications");

  // Google Calendar
  const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const acct = googleConfigured ? await getGoogleAccount() : null;
  if (!googleConfigured) {
    out.push({ key: "google", label: "Google Calendar", ok: false, live: false, status: "Not configured", detail: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then connect Tony's account. Until then, availability ignores Google Calendar and no events are created." });
  } else if (!acct) {
    out.push({ key: "google", label: "Google Calendar", ok: false, live: false, status: "Not connected", detail: "Click “Connect Google Calendar” to authorise Tony's account." });
  } else if (acct.status === "revoked") {
    out.push({ key: "google", label: "Google Calendar", ok: false, live: false, status: "Access revoked", detail: `${acct.lastError ?? "Google refused the stored credentials."} Reconnect to resume syncing. Public booking is paused while access is missing if “require calendar check” is on.` });
  } else if (acct.status === "error") {
    out.push({ key: "google", label: "Google Calendar", ok: false, live: true, status: "Error", detail: `Last error: ${acct.lastError ?? "unknown"}. Will retry automatically.` });
  } else {
    out.push({ key: "google", label: "Google Calendar", ok: true, live: true, status: "Connected", detail: `Connected as ${acct.email ?? "unknown account"}${acct.lastSuccessAt ? `, last successful call ${acct.lastSuccessAt.toLocaleString("en-GB")}` : ""}.` });
  }

  // Payments
  const provider = await resolvePaymentProvider();
  if (!provider) {
    out.push({ key: "payments", label: "Payments", ok: false, live: false, status: "Not configured", detail: "Paid consultations cannot be booked. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET." });
  } else if (provider.id === "test") {
    out.push({ key: "payments", label: "Payments", ok: false, live: false, status: "Test mode (simulated)", detail: "Payments are simulated — no money is taken. Configure Stripe before launch." });
  } else if (!provider.live) {
    out.push({ key: "payments", label: "Payments", ok: true, live: false, status: "Stripe test mode", detail: "Stripe test keys are in use. Switch to live keys (sk_live_…) and a live webhook secret to accept real payments." });
  } else {
    out.push({ key: "payments", label: "Payments", ok: true, live: true, status: "Stripe live", detail: "Live payments enabled. Webhook signature verification is active." });
  }

  // Email
  const emailProvider = process.env.EMAIL_PROVIDER ?? (process.env.RESEND_API_KEY ? "resend" : "console");
  const resend = emailProvider === "resend" && Boolean(process.env.RESEND_API_KEY);
  const smtp = emailProvider === "smtp" && Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
  const from = s.email.fromAddress || process.env.EMAIL_FROM || (smtp ? process.env.SMTP_USER : undefined);
  if (!resend && !smtp) {
    out.push({ key: "email", label: "Email", ok: false, live: false, status: "Not sending (log only)", detail: "Emails are written to the server log, not delivered. Add RESEND_API_KEY and a verified sender address, or SMTP_USER and SMTP_PASSWORD." });
  } else if (!from) {
    out.push({ key: "email", label: "Email", ok: false, live: false, status: "Sender missing", detail: "Set a sender address (Settings → Email) on a domain verified in Resend." });
  } else {
    out.push({ key: "email", label: "Email", ok: true, live: true, status: smtp ? "SMTP" : "Resend", detail: `Sending from ${s.email.fromName} <${from}>.` });
  }
  const adminEmail = s.notifications.adminEmail || process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail) out.push({ key: "admin-email", label: "Tony's notifications", ok: false, live: false, status: "No address", detail: "Set the notification email in Settings so Tony receives booking alerts." });

  // Cron
  const [cron] = await getDb().select().from(settings).where(eq(settings.key, "system.cron"));
  const last = (cron?.value as { lastRunAt?: string } | undefined)?.lastRunAt;
  const fresh = last && Date.now() - Date.parse(last) < 30 * 60_000;
  out.push({
    key: "cron",
    label: "Scheduled jobs",
    ok: Boolean(fresh),
    live: Boolean(fresh),
    status: last ? (fresh ? "Running" : "Stale") : "Never run",
    detail: last ? `Last run ${new Date(last).toLocaleString("en-GB")}. Sends reminders, releases expired holds, retries calendar sync.` : "Schedule GET /api/cron every 5 minutes with the CRON_SECRET bearer token. Reminders are not sent until this runs.",
  });
  return out;
}

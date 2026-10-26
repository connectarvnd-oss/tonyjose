// Central place that wires the real external services. Tests replace these
// with fakes through setIntegrationsForTesting().
import type { TimeRange } from "./availability/engine";
import * as google from "./google/calendar";
import { ConsoleMailer, ResendMailer } from "./email/providers";
import type { Mailer } from "./email/types";
import { StripeProvider } from "./payments/stripe";
import { TestPaymentProvider } from "./payments/test-provider";
import type { PaymentProvider } from "./payments/types";
import { getSetting } from "./settings";

export type CalendarStatus = "connected" | "not_configured" | "not_connected" | "revoked" | "error";

export interface CalendarPort {
  status(): Promise<CalendarStatus>;
  getBusy(range: TimeRange, calendarIds: string[]): Promise<TimeRange[]>;
  upsertEvent(input: google.CalendarEventInput): Promise<{ eventId: string; meetingLink: string | null }>;
  cancelEvent(calendarId: string, eventId: string, sendUpdates: boolean): Promise<void>;
}

const googleCalendar: CalendarPort = {
  async status() {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return "not_configured";
    const acct = await google.getGoogleAccount();
    if (!acct) return "not_connected";
    if (acct.status === "revoked") return "revoked";
    // "error" is a transient flag (e.g. outage); still attempt calls.
    return "connected";
  },
  getBusy: google.getBusy,
  upsertEvent: google.upsertEvent,
  cancelEvent: google.cancelEvent,
};

type Integrations = {
  calendar: CalendarPort;
  payments: () => Promise<PaymentProvider | null>;
  mailer: () => Mailer;
};

let override: Partial<Integrations> | null = null;

export function setIntegrationsForTesting(i: Partial<Integrations> | null) {
  override = i;
}

let consoleMailer: ConsoleMailer | null = null;

function defaultMailer(): Mailer {
  const provider = process.env.EMAIL_PROVIDER ?? (process.env.RESEND_API_KEY ? "resend" : "console");
  if (provider === "resend" && process.env.RESEND_API_KEY) return new ResendMailer(process.env.RESEND_API_KEY);
  consoleMailer ??= new ConsoleMailer();
  return consoleMailer;
}

/** Resolves which payment provider to use: admin setting, then env, never test mode in production unless allowed. */
export async function resolvePaymentProvider(): Promise<PaymentProvider | null> {
  const testAllowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_TEST_PAYMENTS === "true";
  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  let chosen: string | undefined;
  try {
    chosen = (await getSetting("payments")).provider;
  } catch {
    chosen = undefined;
  }
  chosen ??= process.env.PAYMENT_PROVIDER ?? (stripeReady ? "stripe" : "test");
  if (chosen === "stripe" && stripeReady) return new StripeProvider();
  if (chosen === "test" && testAllowed) return new TestPaymentProvider();
  if (stripeReady) return new StripeProvider();
  return testAllowed ? new TestPaymentProvider() : null;
}

export function integrations(): Integrations {
  return {
    calendar: override?.calendar ?? googleCalendar,
    payments: override?.payments ?? resolvePaymentProvider,
    mailer: override?.mailer ?? defaultMailer,
  };
}

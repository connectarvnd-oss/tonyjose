// Server-only configuration. Never import this from client components.
import "server-only";

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  get siteUrl() {
    return (optional("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get encryptionKey() {
    return optional("APP_ENCRYPTION_KEY");
  },
  get cronSecret() {
    return optional("CRON_SECRET");
  },
  google: {
    get clientId() {
      return optional("GOOGLE_CLIENT_ID");
    },
    get clientSecret() {
      return optional("GOOGLE_CLIENT_SECRET");
    },
    get configured() {
      return Boolean(optional("GOOGLE_CLIENT_ID") && optional("GOOGLE_CLIENT_SECRET"));
    },
  },
  stripe: {
    get secretKey() {
      return optional("STRIPE_SECRET_KEY");
    },
    get webhookSecret() {
      return optional("STRIPE_WEBHOOK_SECRET");
    },
    get configured() {
      return Boolean(optional("STRIPE_SECRET_KEY") && optional("STRIPE_WEBHOOK_SECRET"));
    },
    get isLiveKey() {
      return (optional("STRIPE_SECRET_KEY") ?? "").startsWith("sk_live_");
    },
  },
  payments: {
    /** 'stripe' | 'test'. Defaults to stripe when keys exist, otherwise test (non-production only). */
    get provider(): "stripe" | "test" | "none" {
      const p = optional("PAYMENT_PROVIDER");
      if (p === "stripe" || p === "test") return p;
      if (optional("STRIPE_SECRET_KEY")) return "stripe";
      return process.env.NODE_ENV === "production" ? "none" : "test";
    },
    get testModeAllowed() {
      return process.env.NODE_ENV !== "production" || optional("ALLOW_TEST_PAYMENTS") === "true";
    },
  },
  email: {
    get provider(): "resend" | "console" {
      const p = optional("EMAIL_PROVIDER");
      if (p === "resend" || p === "console") return p;
      return optional("RESEND_API_KEY") ? "resend" : "console";
    },
    get resendApiKey() {
      return optional("RESEND_API_KEY");
    },
    get fromAddress() {
      return optional("EMAIL_FROM");
    },
  },
  turnstileSecret: () => optional("TURNSTILE_SECRET_KEY"),
};

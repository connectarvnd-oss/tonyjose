// A clearly-labelled simulated payment provider for local development and
// demos. It never moves money and is refused in production unless
// ALLOW_TEST_PAYMENTS=true is set explicitly.
import { randomToken } from "../security/crypto";
import type { CheckoutArgs, PaymentProvider } from "./types";

export class TestPaymentProvider implements PaymentProvider {
  id = "test" as const;
  live = false;

  async createCheckout(args: CheckoutArgs) {
    const sessionId = `test_cs_${randomToken(12)}`;
    const base = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const url = `${base}/booking/test-checkout?session=${encodeURIComponent(sessionId)}&appointment=${encodeURIComponent(args.appointmentId)}`;
    return { sessionId, url };
  }

  async expireCheckout() {}

  async refund(args: { idempotencyKey: string }) {
    return { refundId: `test_re_${args.idempotencyKey.slice(0, 16)}`, status: "succeeded" as const };
  }
}

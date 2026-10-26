import Stripe from "stripe";
import type { CheckoutArgs, PaymentEvent, PaymentProvider, RefundArgs } from "./types";

let client: Stripe | null = null;
export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) client = new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
  return client;
}

export class StripeProvider implements PaymentProvider {
  id = "stripe" as const;
  get live() {
    return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");
  }

  async createCheckout(args: CheckoutArgs) {
    // Stripe requires expires_at between 30 minutes and 24 hours from now.
    const minExpiry = Date.now() + 31 * 60_000;
    const expiresAt = Math.floor(Math.max(args.expiresAt.getTime(), minExpiry) / 1000);
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: "payment",
        customer_email: args.customerEmail,
        client_reference_id: args.appointmentId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: args.currency.toLowerCase(),
              unit_amount: args.amountCents,
              product_data: { name: args.productName, description: args.description },
            },
          },
        ],
        metadata: { appointment_id: args.appointmentId, reference: args.reference },
        payment_intent_data: { metadata: { appointment_id: args.appointmentId, reference: args.reference } },
        success_url: args.successUrl,
        cancel_url: args.cancelUrl,
        expires_at: expiresAt,
      },
      // Retried booking requests reuse the same Checkout Session: never charged twice.
      { idempotencyKey: `checkout_${args.appointmentId}` },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { sessionId: session.id, url: session.url };
  }

  async expireCheckout(sessionId: string) {
    try {
      const s = await stripeClient().checkout.sessions.retrieve(sessionId);
      if (s.status === "open") await stripeClient().checkout.sessions.expire(sessionId);
    } catch {
      // Already completed/expired; webhooks are authoritative.
    }
  }

  async refund(args: RefundArgs) {
    let paymentIntent = args.paymentId;
    if (!paymentIntent && args.sessionId) {
      const s = await stripeClient().checkout.sessions.retrieve(args.sessionId);
      paymentIntent = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);
    }
    if (!paymentIntent) throw new Error("No payment intent to refund");
    const refund = await stripeClient().refunds.create(
      { payment_intent: paymentIntent, amount: args.amountCents },
      { idempotencyKey: args.idempotencyKey },
    );
    const status = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending";
    return { refundId: refund.id, status } as const;
  }
}

/**
 * Verifies the Stripe signature and maps the event to a normalised PaymentEvent.
 * Throws if the signature is invalid. Returns null for irrelevant events.
 */
export function parseStripeWebhook(
  rawBody: string,
  signature: string,
  secret: string,
): { id: string; type: string; event: PaymentEvent | null } {
  const evt = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  const base = { id: evt.id, type: evt.type };
  switch (evt.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const s = evt.data.object as Stripe.Checkout.Session;
      const appointmentId = s.metadata?.appointment_id ?? s.client_reference_id;
      if (!appointmentId) return { ...base, event: null };
      const paymentId = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);
      if (evt.type === "checkout.session.expired") return { ...base, event: { kind: "expired", appointmentId, sessionId: s.id } };
      if (evt.type === "checkout.session.async_payment_failed")
        return { ...base, event: { kind: "failed", appointmentId, sessionId: s.id, reason: "Payment failed" } };
      // completed: only "paid" counts. "unpaid" means a delayed method is still processing.
      if (s.payment_status === "paid")
        return { ...base, event: { kind: "succeeded", appointmentId, sessionId: s.id, paymentId } };
      return { ...base, event: { kind: "pending", appointmentId, sessionId: s.id } };
    }
    case "charge.refunded": {
      const c = evt.data.object as Stripe.Charge;
      const paymentId = typeof c.payment_intent === "string" ? c.payment_intent : (c.payment_intent?.id ?? null);
      if (!paymentId) return { ...base, event: null };
      return {
        ...base,
        event: { kind: "refunded", paymentId, refundedCents: c.amount_refunded, fully: c.amount_refunded >= c.amount },
      };
    }
    default:
      return { ...base, event: null };
  }
}

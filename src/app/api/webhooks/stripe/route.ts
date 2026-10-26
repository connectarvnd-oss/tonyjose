import { NextResponse, type NextRequest } from "next/server";
import { parseStripeWebhook } from "@/lib/payments/stripe";
import { processVerifiedPaymentEvent } from "@/lib/payments/webhook";

export const dynamic = "force-dynamic";

// Stripe → this endpoint. Events subscribed:
//   checkout.session.completed, checkout.session.async_payment_succeeded,
//   checkout.session.async_payment_failed, checkout.session.expired, charge.refunded
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const raw = await req.text();
  let parsed;
  try {
    parsed = parseStripeWebhook(raw, signature, secret);
  } catch {
    // Never act on unverified payloads.
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    const result = await processVerifiedPaymentEvent("stripe", parsed.id, parsed.type, parsed.event);
    return NextResponse.json({ received: true, result });
  } catch (err) {
    console.error("[stripe webhook] processing failed", err);
    // 500 → Stripe retries with backoff.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

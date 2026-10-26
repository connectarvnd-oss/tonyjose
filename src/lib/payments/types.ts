export type CheckoutArgs = {
  appointmentId: string;
  reference: string;
  amountCents: number;
  currency: string;
  productName: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
};

export type RefundArgs = {
  sessionId: string | null;
  paymentId: string | null;
  amountCents: number;
  idempotencyKey: string;
};

export interface PaymentProvider {
  id: "stripe" | "test";
  /** True only when real money moves (live Stripe key). */
  live: boolean;
  createCheckout(args: CheckoutArgs): Promise<{ sessionId: string; url: string }>;
  /** Prevent a late payment on an abandoned checkout. Best effort. */
  expireCheckout(sessionId: string): Promise<void>;
  refund(args: RefundArgs): Promise<{ refundId: string; status: "pending" | "succeeded" | "failed" }>;
}

/** Normalised payment events produced by verified webhooks. */
export type PaymentEvent =
  | { kind: "succeeded"; appointmentId: string; sessionId: string; paymentId: string | null }
  | { kind: "pending"; appointmentId: string; sessionId: string }
  | { kind: "failed"; appointmentId: string; sessionId: string; reason: string }
  | { kind: "expired"; appointmentId: string; sessionId: string }
  | { kind: "refunded"; paymentId: string; refundedCents: number; fully: boolean };

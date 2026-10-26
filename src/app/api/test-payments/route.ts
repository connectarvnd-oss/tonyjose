import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { payments } from "@/lib/db/schema";
import { processVerifiedPaymentEvent } from "@/lib/payments/webhook";

// Simulated payment outcomes for TEST MODE only. Disabled in production
// unless ALLOW_TEST_PAYMENTS=true, and only for sessions created by the
// test provider.
const body = z.object({
  session: z.string().startsWith("test_cs_").max(100),
  appointment: z.string().uuid(),
  outcome: z.enum(["succeeded", "failed", "expired"]),
});

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_PAYMENTS !== "true") {
    return NextResponse.json({ error: "Test payments are disabled" }, { status: 404 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { session, appointment, outcome } = parsed.data;
  const [p] = await getDb()
    .select()
    .from(payments)
    .where(and(eq(payments.providerSessionId, session), eq(payments.appointmentId, appointment), eq(payments.provider, "test")));
  if (!p) return NextResponse.json({ error: "Unknown test session" }, { status: 404 });
  const event =
    outcome === "succeeded"
      ? { kind: "succeeded" as const, appointmentId: appointment, sessionId: session, paymentId: `test_pi_${session.slice(8)}` }
      : outcome === "failed"
        ? { kind: "failed" as const, appointmentId: appointment, sessionId: session, reason: "Simulated failure" }
        : { kind: "expired" as const, appointmentId: appointment, sessionId: session };
  const result = await processVerifiedPaymentEvent("test", `${session}:${outcome}`, outcome, event);
  return NextResponse.json({ ok: true, result });
}

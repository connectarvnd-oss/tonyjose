import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { TestCheckoutButtons } from "@/components/booking/TestCheckoutButtons";
import { formatPrice } from "@/lib/content";
import { getDb } from "@/lib/db";
import { payments } from "@/lib/db/schema";
import { loadAppointment } from "@/lib/booking/queries";
import { manageTokenFor } from "@/lib/booking/tokens";

export const metadata = { title: "Test checkout", robots: { index: false } };

export default async function TestCheckout({ searchParams }: { searchParams: Promise<{ session?: string; appointment?: string }> }) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_PAYMENTS !== "true") notFound();
  const { session, appointment } = await searchParams;
  if (!session || !appointment || !/^[0-9a-f-]{36}$/.test(appointment)) notFound();
  const [p] = await getDb().select().from(payments).where(and(eq(payments.providerSessionId, session), eq(payments.appointmentId, appointment)));
  const a = await loadAppointment(appointment);
  if (!p || !a) notFound();
  const back = `/booking/${a.appointment.reference}?t=${manageTokenFor(a.appointment.id)}`;
  return (
    <div className="page-x mx-auto max-w-2xl py-16">
      <p className="border-2 border-dashed border-accent bg-accent-soft/60 p-5 font-mono text-sm uppercase tracking-wider text-accent">
        Test mode — simulated payment. No money moves. Configure Stripe to take real payments.
      </p>
      <h1 className="mt-10 font-display text-display-md">Simulated checkout</h1>
      <dl className="mt-8 divide-y divide-line border-y border-line">
        <div className="flex justify-between py-4"><dt className="text-muted">Item</dt><dd>{a.type.name}</dd></div>
        <div className="flex justify-between py-4"><dt className="text-muted">Reference</dt><dd className="font-mono">{a.appointment.reference}</dd></div>
        <div className="flex justify-between py-4"><dt className="text-muted">Amount</dt><dd className="font-display text-3xl">{formatPrice(p.amountCents, p.currency)}</dd></div>
      </dl>
      <TestCheckoutButtons session={session} appointment={appointment} successUrl={`${back}&paid=1`} cancelUrl={`${back}&payment=cancelled`} />
    </div>
  );
}

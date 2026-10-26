import { notFound } from "next/navigation";
import { RescheduleFlow } from "@/components/booking/RescheduleFlow";
import { loadAppointmentByReference } from "@/lib/booking/queries";
import { verifyManageToken } from "@/lib/booking/tokens";
import { formatTimeRange } from "@/lib/format";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Reschedule", robots: { index: false } };

export default async function ReschedulePage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ ref }, { t }] = await Promise.all([params, searchParams]);
  const a = await loadAppointmentByReference(ref);
  if (!a || !verifyManageToken(a.appointment.id, t)) notFound();
  const booking = await getSetting("booking");
  return (
    <div className="page-x mx-auto max-w-page pb-24 pt-12 md:pt-16">
      <p className="eyebrow">Reschedule {a.appointment.reference}</p>
      <h1 className="mt-6 font-display text-display-md">Choose a new time.</h1>
      <p className="mt-4 text-charcoal">
        Currently: {a.type.name}, {formatTimeRange(a.appointment.startAt, a.appointment.endAt, a.appointment.timeZone)}
      </p>
      <div className="mt-12">
        <RescheduleFlow reference={a.appointment.reference} token={t!} businessTimeZone={booking.timeZone} maxAdvanceDays={booking.maxAdvanceDays} />
      </div>
    </div>
  );
}

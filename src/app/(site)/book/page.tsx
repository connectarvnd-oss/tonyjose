import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { getAppointmentTypes } from "@/lib/content";
import { paymentMode } from "@/lib/payments/mode";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Book a Consultation",
  description: "Book a free 15-minute initial enquiry or a full 60-minute consultation (€28) with Tony Jose. Choose a time that suits you.",
  alternates: { canonical: "/book" },
};

export default async function BookPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const [{ type }, types, booking, mode] = await Promise.all([searchParams, getAppointmentTypes(), getSetting("booking"), paymentMode()]);
  return (
    <div className="page-x mx-auto max-w-page pb-24 pt-10 md:pt-16">
      <header className="mb-10 grid gap-6 md:mb-14 md:grid-cols-12">
        <p className="eyebrow md:col-span-4">Booking</p>
        <div className="md:col-span-8">
          <h1 className="font-display text-display-lg">Find a time to talk.</h1>
          <p className="mt-5 max-w-xl text-lg text-charcoal">Choose a consultation, pick a time, and you're done — it takes about a minute.</p>
        </div>
      </header>
      {types.length === 0 ? (
        <p className="text-lg">Online booking is temporarily unavailable. Please get in touch by email.</p>
      ) : (
        <BookingFlow
          types={types.map((t) => ({
            id: t.id,
            slug: t.slug,
            name: t.name,
            description: t.description,
            durationMinutes: t.durationMinutes,
            priceCents: t.priceCents,
            currency: t.currency,
            onePerClient: t.onePerClient,
          }))}
          initialTypeSlug={type}
          businessTimeZone={booking.timeZone}
          maxAdvanceDays={booking.maxAdvanceDays}
          paymentMode={mode}
          cancellationNoticeHours={booking.cancellationNoticeHours}
        />
      )}
    </div>
  );
}

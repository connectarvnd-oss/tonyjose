import type { Metadata } from "next";
import { DateTime } from "luxon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelBooking, PaymentPoller, RescheduleLink } from "@/components/booking/ManageActions";
import { loadAppointmentByReference, latestPayment } from "@/lib/booking/queries";
import { hoursUntil } from "@/lib/booking/service";
import { verifyManageToken } from "@/lib/booking/tokens";
import { formatPrice } from "@/lib/content";
import { paymentLabel } from "@/lib/email/templates";
import { formatTimeRange, zoneLabel } from "@/lib/format";
import { googleCalendarLink } from "@/lib/ics";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false } };

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ t?: string; payment?: string; new?: string; paid?: string }> };

export default async function BookingPage({ params, searchParams }: Props) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const a = await loadAppointmentByReference(ref);
  if (!a || !verifyManageToken(a.appointment.id, sp.t)) notFound();
  const token = sp.t!;
  const { appointment: appt, client, type } = a;
  const { booking, meeting } = await getSettings("booking", "meeting");
  const payment = appt.priceCents > 0 ? await latestPayment(appt.id) : null;
  const firstName = client.name.split(" ")[0];
  const zone = appt.timeZone;
  const upcoming = appt.startAt.getTime() > Date.now();
  const canCancel = appt.status === "confirmed" && upcoming && booking.allowClientCancel && hoursUntil(appt.startAt) >= booking.cancellationNoticeHours;
  const canReschedule =
    appt.status === "confirmed" && upcoming && booking.allowClientReschedule && hoursUntil(appt.startAt) >= booking.rescheduleNoticeHours && appt.rescheduleCount < booking.maxReschedules;
  const paidNote =
    appt.paymentStatus === "paid"
      ? booking.refundPolicy === "full_if_notice"
        ? "As you're cancelling with enough notice, your payment will be refunded in full."
        : "Refunds are handled individually; Tony will be in touch."
      : null;

  const heading = {
    confirmed: `You're booked, ${firstName}.`,
    pending_payment: sp.payment === "cancelled" ? "Payment not completed." : "Almost there.",
    expired: "This reservation was released.",
    payment_failed: "The payment didn't go through.",
    cancelled: "This booking has been cancelled.",
    completed: "Thank you for your time.",
    no_show: "This appointment has passed.",
    needs_attention: "We're sorting this out for you.",
  }[appt.status];

  const details: [string, React.ReactNode][] = [
    ["Name", client.name],
    ["Consultation", `${type.name} · ${Math.round((appt.endAt.getTime() - appt.startAt.getTime()) / 60000)} minutes`],
    ["Date & time", formatTimeRange(appt.startAt, appt.endAt, zone)],
    ["Time zone", zoneLabel(zone, appt.startAt)],
    ...(zone !== booking.timeZone ? ([["Tony's time", `${formatTimeRange(appt.startAt, appt.endAt, booking.timeZone)} (${zoneLabel(booking.timeZone, appt.startAt)})`]] as [string, string][]) : []),
    ["Price", appt.priceCents === 0 ? "Free" : `${formatPrice(appt.priceCents, appt.currency)} · ${paymentLabel(appt.paymentStatus)}`],
    ["Reference", <span key="ref" className="font-mono">{appt.reference}</span>],
  ];
  if (appt.status === "confirmed") {
    if (appt.meetingLink) {
      details.push(["Meeting", <a key="m" href={appt.meetingLink} className="text-accent underline underline-offset-4" rel="noopener noreferrer" target="_blank">{appt.meetingLink}</a>]);
    } else if (meeting.mode === "custom" && meeting.customInstructions) {
      details.push(["Meeting", meeting.customInstructions]);
    } else if (meeting.mode === "google_meet") {
      details.push(["Meeting", "Tony will send the meeting details by email before the appointment."]);
    }
  }

  const gcal = googleCalendarLink({
    start: appt.startAt,
    end: appt.endAt,
    summary: `${type.name} with Tony Jose`,
    details: `Booking reference ${appt.reference}${appt.meetingLink ? `\nJoin: ${appt.meetingLink}` : ""}`,
    location: appt.meetingLink,
  });

  return (
    <div className="page-x mx-auto max-w-page pb-24 pt-12 md:pt-20">
      <div className="grid gap-10 md:grid-cols-12">
        <div className="md:col-span-4">
          <p className="eyebrow">Booking {appt.reference}</p>
          {appt.status === "confirmed" && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-sm text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden /> Confirmed
            </p>
          )}
        </div>
        <div className="md:col-span-8">
          <h1 className="reveal font-display text-display-lg">
            <span className="block">{heading}</span>
          </h1>

          {appt.status === "confirmed" && (
            <p className="mt-6 max-w-xl text-lg text-charcoal">
              {sp.new || sp.paid ? "A confirmation email is on its way to " : "Confirmation sent to "}
              <span className="text-ink">{client.email}</span>.
            </p>
          )}
          {appt.status === "pending_payment" && (
            <div className="mt-6 max-w-xl">
              {sp.payment === "cancelled" ? (
                <>
                  <p className="text-lg text-charcoal">
                    You haven't been charged. Your time is held until{" "}
                    <strong className="text-ink">{appt.holdExpiresAt ? DateTime.fromJSDate(appt.holdExpiresAt, { zone }).toFormat("HH:mm") : "shortly"}</strong>; after that it's released for others.
                  </p>
                  <div className="mt-8 flex flex-wrap gap-3">
                    {payment?.checkoutUrl && payment.status === "pending" && (
                      <a href={payment.checkoutUrl} className="btn-primary">
                        Return to payment <span className="arrow" aria-hidden>→</span>
                      </a>
                    )}
                    <CancelBooking reference={appt.reference} token={token} paidNote={null} />
                  </div>
                </>
              ) : (
                <>
                  <p className="text-lg text-charcoal">We're confirming your payment. This page updates automatically.</p>
                  <PaymentPoller reference={appt.reference} token={token} />
                </>
              )}
            </div>
          )}
          {(appt.status === "expired" || appt.status === "payment_failed") && (
            <div className="mt-6 max-w-xl">
              <p className="text-lg text-charcoal">You have not been charged. Please choose a time again — it only takes a minute.</p>
              <Link href={`/book?type=${type.slug}`} className="btn-primary mt-8">
                Choose a new time <span className="arrow" aria-hidden>→</span>
              </Link>
            </div>
          )}
          {appt.status === "cancelled" && (
            <div className="mt-6 max-w-xl">
              {appt.paymentStatus === "refunded" || appt.paymentStatus === "refund_pending" ? (
                <p className="text-lg text-charcoal">Your payment is being refunded to your original payment method. Refunds usually appear within 5–10 business days.</p>
              ) : null}
              <Link href="/book" className="btn-primary mt-8">
                Book a new time <span className="arrow" aria-hidden>→</span>
              </Link>
            </div>
          )}
          {appt.status === "needs_attention" && (
            <p className="mt-6 max-w-xl text-lg text-charcoal">
              Your payment was received, but the time you chose became unavailable while it was processing. Tony has been notified and you'll receive an email
              about a refund or a new time shortly.
            </p>
          )}

          <dl className="mt-12 max-w-3xl divide-y divide-line border-y border-line">
            {details.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-4 sm:grid-cols-3">
                <dt className="text-muted">{k}</dt>
                <dd className="break-words sm:col-span-2">{v}</dd>
              </div>
            ))}
          </dl>

          {appt.status === "confirmed" && upcoming && (
            <>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[0.95rem]">
                <a href={gcal} target="_blank" rel="noopener noreferrer" className="link-underline">
                  Add to Google Calendar ↗
                </a>
                <a href={`/api/bookings/${appt.reference}/ics?t=${encodeURIComponent(token)}`} className="link-underline">
                  Download calendar file (.ics)
                </a>
              </div>

              <section className="mt-16 max-w-3xl border-t border-line pt-10" aria-labelledby="manage-title">
                <h2 id="manage-title" className="font-display text-3xl">
                  Need to change something?
                </h2>
                <p className="mt-3 text-charcoal">
                  You can reschedule or cancel online up to {booking.cancellationNoticeHours} hours before your appointment.
                  {appt.priceCents > 0 && booking.refundPolicy === "full_if_notice" && " Paid consultations cancelled in time are refunded in full."} Keep this link — it's
                  also in your confirmation email.{" "}
                  <Link href="/legal/cancellation" className="underline underline-offset-4">
                    Policy
                  </Link>
                </p>
                <div className="mt-6 flex flex-wrap items-start gap-3">
                  {canReschedule && <RescheduleLink reference={appt.reference} token={token} />}
                  {canCancel && <CancelBooking reference={appt.reference} token={token} paidNote={paidNote} />}
                  {!canCancel && !canReschedule && <p className="text-sm text-muted">Online changes are no longer available for this booking. Please reply to your confirmation email.</p>}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

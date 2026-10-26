import { NextResponse, type NextRequest } from "next/server";
import { BookingError, createBooking } from "@/lib/booking/service";
import { bookingRequestSchema, fieldErrors } from "@/lib/booking/validation";
import { isValidZone } from "@/lib/format";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { looksLikeBot, verifyTurnstile } from "@/lib/security/spam";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  invalid: 400,
  type_unavailable: 404,
  slot_unavailable: 409,
  free_limit: 409,
  payments_unavailable: 503,
  calendar_unavailable: 503,
  not_allowed: 403,
  not_found: 404,
};

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!(await rateLimit(`book:ip:${ip}`, 10, 600))) {
    return NextResponse.json({ error: "Too many booking attempts. Please wait a few minutes and try again." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = bookingRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the highlighted fields.", fields: fieldErrors(parsed.error) }, { status: 400 });
  }
  const d = parsed.data;
  if (looksLikeBot(d.website, d.startedAt) || !(await verifyTurnstile(d.turnstileToken, ip))) {
    return NextResponse.json({ error: "We couldn't verify this request. Please try again." }, { status: 400 });
  }
  if (!(await rateLimit(`book:email:${d.email}`, 6, 3600))) {
    return NextResponse.json({ error: "Too many booking attempts for this email. Please try again later." }, { status: 429 });
  }
  try {
    const result = await createBooking({
      appointmentTypeId: d.appointmentTypeId,
      start: new Date(d.start),
      name: d.name,
      email: d.email,
      phone: d.phone,
      country: d.country,
      enquiryArea: d.enquiryArea ?? null,
      message: d.message,
      timeZone: isValidZone(d.timeZone) ? d.timeZone : "Europe/Berlin",
      marketingOptIn: d.marketingOptIn,
      idempotencyKey: d.idempotencyKey,
    });
    return NextResponse.json({
      reference: result.reference,
      token: result.manageToken,
      status: result.status,
      checkoutUrl: result.checkoutUrl,
    });
  } catch (err) {
    if (err instanceof BookingError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: STATUS[err.code] ?? 400 });
    }
    console.error("[api/bookings]", err);
    return NextResponse.json({ error: "Something went wrong while booking. You have not been charged. Please try again." }, { status: 500 });
  }
}

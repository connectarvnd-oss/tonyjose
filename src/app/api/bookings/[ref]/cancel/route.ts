import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadAppointmentByReference } from "@/lib/booking/queries";
import { BookingError, cancelAppointment } from "@/lib/booking/service";
import { verifyManageToken } from "@/lib/booking/tokens";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

const body = z.object({ t: z.string().max(100), reason: z.string().trim().max(500).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  if (!(await rateLimit(`manage:${clientIp(req.headers)}`, 20, 600))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const { ref } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const a = await loadAppointmentByReference(ref);
  if (!a || !verifyManageToken(a.appointment.id, parsed.data.t)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const res = await cancelAppointment(a.appointment.id, { by: "client", reason: parsed.data.reason ?? null, refund: "policy" });
    return NextResponse.json({ ok: true, refundNote: res.refundNote });
  } catch (err) {
    if (err instanceof BookingError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error("[api/cancel]", err);
    return NextResponse.json({ error: "Could not cancel. Please contact us." }, { status: 500 });
  }
}

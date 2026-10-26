import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CalendarUnavailableError, getAvailableSlots } from "@/lib/availability/service";
import { loadAppointmentByReference } from "@/lib/booking/queries";
import { verifyManageToken } from "@/lib/booking/tokens";
import { getDb } from "@/lib/db";
import { appointmentTypes } from "@/lib/db/schema";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const query = z.object({
  type: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ref: z.string().max(20).optional(),
  t: z.string().max(100).optional(),
});

export async function GET(req: NextRequest) {
  if (!(await rateLimit(`avail:${clientIp(req.headers)}`, 120, 60))) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { from, to, ref, t } = parsed.data;
  // Limit range to ~6 weeks per request
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 45) return NextResponse.json({ error: "Range too large" }, { status: 400 });

  try {
    // Rescheduling: availability for an existing booking, excluding its own slot.
    if (ref) {
      const a = await loadAppointmentByReference(ref);
      if (!a || !verifyManageToken(a.appointment.id, t)) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const res = await getAvailableSlots({
        type: { durationMinutes: (a.appointment.endAt.getTime() - a.appointment.startAt.getTime()) / 60000, bufferMinutes: a.type.bufferMinutes },
        fromDate: from,
        toDate: to,
        excludeAppointment: { id: a.appointment.id, startAt: a.appointment.startAt, endAt: a.appointment.endAt },
      });
      return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
    }
    if (!parsed.data.type) return NextResponse.json({ error: "Missing type" }, { status: 400 });
    const [type] = await getDb().select().from(appointmentTypes).where(eq(appointmentTypes.id, parsed.data.type));
    if (!type || !type.isActive) return NextResponse.json({ error: "Unknown consultation type" }, { status: 404 });
    const res = await getAvailableSlots({ type, fromDate: from, toDate: to });
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof CalendarUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error("[api/availability]", err);
    return NextResponse.json({ error: "Could not load availability." }, { status: 500 });
  }
}

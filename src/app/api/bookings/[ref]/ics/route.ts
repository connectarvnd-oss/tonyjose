import { type NextRequest } from "next/server";
import { loadAppointmentByReference } from "@/lib/booking/queries";
import { verifyManageToken } from "@/lib/booking/tokens";
import { eventIdFor } from "@/lib/google/calendar";
import { buildIcs } from "@/lib/ics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const a = await loadAppointmentByReference(ref);
  if (!a || !verifyManageToken(a.appointment.id, req.nextUrl.searchParams.get("t"))) {
    return new Response("Not found", { status: 404 });
  }
  const ics = buildIcs({
    uid: `${eventIdFor(a.appointment.id)}@tonyjose`,
    start: a.appointment.startAt,
    end: a.appointment.endAt,
    summary: `${a.type.name} with Tony Jose`,
    description: `Booking reference ${a.appointment.reference}${a.appointment.meetingLink ? `\nJoin: ${a.appointment.meetingLink}` : ""}`,
    location: a.appointment.meetingLink,
    organizerName: "Tony Jose",
    cancelled: a.appointment.status === "cancelled",
    sequence: a.appointment.rescheduleCount,
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="consultation-${a.appointment.reference}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}

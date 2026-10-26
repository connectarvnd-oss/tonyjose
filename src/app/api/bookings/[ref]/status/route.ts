import { NextResponse, type NextRequest } from "next/server";
import { loadAppointmentByReference } from "@/lib/booking/queries";
import { verifyManageToken } from "@/lib/booking/tokens";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const a = await loadAppointmentByReference(ref);
  if (!a || !verifyManageToken(a.appointment.id, req.nextUrl.searchParams.get("t"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(
    { status: a.appointment.status, paymentStatus: a.appointment.paymentStatus },
    { headers: { "Cache-Control": "no-store" } },
  );
}

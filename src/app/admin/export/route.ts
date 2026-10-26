import { DateTime } from "luxon";
import { type NextRequest } from "next/server";
import { adminFromRequest } from "@/lib/auth/admin";
import { audit } from "@/lib/audit";
import { listAppointments } from "@/lib/admin/appointments";
import { getSetting } from "@/lib/settings";

function csvCell(v: unknown) {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const admin = await adminFromRequest();
  if (!admin) return new Response("Unauthorized", { status: 401 });
  const { timeZone } = await getSetting("booking");
  const f = Object.fromEntries(req.nextUrl.searchParams);
  const { rows } = await listAppointments(f, timeZone, { limit: 10_000 });
  const header = ["Reference", "Start", "End", "Time zone (client)", "Type", "Status", "Payment status", "Price", "Currency", "Client name", "Email", "Phone", "Country", "Area", "Marketing opt-in", "Created", "Cancelled at", "Calendar sync"];
  const lines = rows.map(({ a, c, t }) =>
    [
      a.reference,
      DateTime.fromJSDate(a.startAt, { zone: timeZone }).toFormat("yyyy-LL-dd HH:mm"),
      DateTime.fromJSDate(a.endAt, { zone: timeZone }).toFormat("yyyy-LL-dd HH:mm"),
      a.timeZone,
      t.name,
      a.status,
      a.paymentStatus,
      (a.priceCents / 100).toFixed(2),
      a.currency,
      c.name,
      c.email,
      c.phone,
      c.country,
      a.enquiryArea,
      c.marketingOptIn ? "yes" : "no",
      a.createdAt.toISOString(),
      a.cancelledAt?.toISOString() ?? "",
      a.calendarSyncStatus,
    ]
      .map(csvCell)
      .join(","),
  );
  await audit({ actor: "admin", adminId: admin.id, action: "appointments.exported", details: { count: rows.length, filters: f } });
  const body = "﻿" + [header.map(csvCell).join(","), ...lines].join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="appointments-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

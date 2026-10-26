import { type NextRequest } from "next/server";
import { adminFromRequest } from "@/lib/auth/admin";
import { audit } from "@/lib/audit";
import { exportPayload, findClientData } from "@/lib/admin/privacy";

export async function GET(req: NextRequest) {
  const admin = await adminFromRequest();
  if (!admin) return new Response("Unauthorized", { status: 401 });
  const email = req.nextUrl.searchParams.get("email") ?? "";
  const data = await findClientData(email);
  if (!data) return new Response("Not found", { status: 404 });
  await audit({ actor: "admin", adminId: admin.id, action: "privacy.data_exported" });
  return new Response(JSON.stringify(exportPayload(data), null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="data-export.json"`, "Cache-Control": "no-store" },
  });
}

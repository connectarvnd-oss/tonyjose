import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { adminFromRequest } from "@/lib/auth/admin";
import { audit } from "@/lib/audit";
import { exchangeCodeAndStore } from "@/lib/google/calendar";
import { safeEqual } from "@/lib/security/crypto";

export async function GET(req: NextRequest) {
  const base = process.env.SITE_URL ?? "http://localhost:3000";
  const back = (q: string) => NextResponse.redirect(new URL(`/admin/settings?google=${q}#integrations`, base));
  const admin = await adminFromRequest("owner");
  if (!admin) return NextResponse.redirect(new URL("/admin/login", base));

  const jar = await cookies();
  const expected = jar.get("tj_google_oauth")?.value;
  jar.delete("tj_google_oauth");
  const state = req.nextUrl.searchParams.get("state");
  if (!expected || !state || !safeEqual(expected, state)) return back("state_mismatch");
  if (req.nextUrl.searchParams.get("error")) return back("denied");
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back("missing_code");
  try {
    const { email } = await exchangeCodeAndStore(code);
    await audit({ actor: "admin", adminId: admin.id, action: "google.connected", details: { email } });
    return back("connected");
  } catch (err) {
    console.error("[google oauth]", err);
    return back(`error&message=${encodeURIComponent((err as Error).message.slice(0, 200))}`);
  }
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminFromRequest } from "@/lib/auth/admin";
import { buildAuthUrl } from "@/lib/google/calendar";
import { randomToken } from "@/lib/security/crypto";

export async function GET() {
  const admin = await adminFromRequest("owner");
  if (!admin) return NextResponse.redirect(new URL("/admin/login", process.env.SITE_URL ?? "http://localhost:3000"));
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/admin/settings?google=not_configured", process.env.SITE_URL ?? "http://localhost:3000"));
  }
  const state = randomToken(24);
  (await cookies()).set("tj_google_oauth", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google/oauth",
    maxAge: 600,
  });
  return NextResponse.redirect(buildAuthUrl(state));
}

import "server-only";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { adminSessions, adminUsers } from "../db/schema";
import { randomToken, sha256 } from "../security/crypto";
import { clientIp, rateLimit } from "../security/rate-limit";
import { audit } from "../audit";

export const ADMIN_COOKIE = "tj_admin";
const SESSION_HOURS = 8;

export type AdminUser = { id: string; name: string; email: string; role: "owner" | "staff" };

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const h = await headers();
  const ip = clientIp(h);
  const normalised = email.trim().toLowerCase();
  const allowedIp = await rateLimit(`login:ip:${ip}`, 20, 900);
  const allowedUser = await rateLimit(`login:user:${normalised}`, 8, 900);
  if (!allowedIp || !allowedUser) return { ok: false, error: "Too many attempts. Please wait 15 minutes and try again." };

  const db = getDb();
  const [user] = await db.select().from(adminUsers).where(sql`lower(${adminUsers.email}) = ${normalised}`);
  // Always run a bcrypt comparison so timing doesn't reveal which emails exist.
  const valid = await bcrypt.compare(password, user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !valid) {
    await audit({ actor: "system", action: "admin.login_failed", details: { email: normalised, ip } });
    return { ok: false, error: "Email or password is incorrect." };
  }
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await db.insert(adminSessions).values({
    adminId: user.id,
    tokenHash: sha256(token),
    expiresAt,
    ip,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  await audit({ actor: "admin", adminId: user.id, action: "admin.login", details: { ip } });
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) await getDb().delete(adminSessions).where(eq(adminSessions.tokenHash, sha256(token)));
  jar.delete(ADMIN_COOKIE);
}

export async function currentAdmin(): Promise<AdminUser | null> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const [row] = await getDb()
    .select({ id: adminUsers.id, name: adminUsers.name, email: adminUsers.email, role: adminUsers.role })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
    .where(and(eq(adminSessions.tokenHash, sha256(token)), gt(adminSessions.expiresAt, new Date())));
  return row ?? null;
}

/** Server-side authorisation guard. Use in every admin page, action and route. */
export async function requireAdmin(role: "owner" | "staff" = "staff"): Promise<AdminUser> {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/login");
  if (role === "owner" && admin.role !== "owner") redirect("/admin?error=forbidden");
  return admin;
}

/** For route handlers: returns null instead of redirecting. */
export async function adminFromRequest(role: "owner" | "staff" = "staff"): Promise<AdminUser | null> {
  const admin = await currentAdmin();
  if (!admin) return null;
  if (role === "owner" && admin.role !== "owner") return null;
  return admin;
}

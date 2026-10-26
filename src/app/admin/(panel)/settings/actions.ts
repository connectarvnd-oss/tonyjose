"use server";

import bcrypt from "bcryptjs";
import { eq, ne, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireAdmin } from "@/lib/auth/admin";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { adminSessions, adminUsers } from "@/lib/db/schema";
import { disconnectGoogle } from "@/lib/google/calendar";
import { isValidZone } from "@/lib/format";
import { getSettings, saveSetting, type Settings } from "@/lib/settings";

function done(msg: string, anchor = "", tone: "ok" | "err" = "ok"): never {
  revalidatePath("/", "layout");
  redirect(`/admin/settings?${tone}=${encodeURIComponent(msg)}${anchor ? `#${anchor}` : ""}`);
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string, d: number) => (Number.isFinite(Number(fd.get(k))) && s(fd, k) !== "" ? Number(fd.get(k)) : d);
const b = (fd: FormData, k: string) => fd.get(k) === "on";

async function save<K extends keyof Settings>(key: K, value: Settings[K], adminId: string, anchor: string) {
  try {
    await saveSetting(key, value);
  } catch {
    done("Some values were out of range. Nothing was saved.", anchor, "err");
  }
  await audit({ actor: "admin", adminId, action: `settings.${key}_updated` });
  done("Settings saved.", anchor);
}

export async function saveBooking(fd: FormData) {
  const admin = await requireAdmin("owner");
  const { booking } = await getSettings("booking");
  const tz = s(fd, "timeZone");
  if (!isValidZone(tz)) done("Unknown time zone.", "booking", "err");
  await save(
    "booking",
    {
      ...booking,
      timeZone: tz,
      holdMinutes: n(fd, "holdMinutes", booking.holdMinutes),
      allowClientCancel: b(fd, "allowClientCancel"),
      cancellationNoticeHours: n(fd, "cancellationNoticeHours", booking.cancellationNoticeHours),
      allowClientReschedule: b(fd, "allowClientReschedule"),
      rescheduleNoticeHours: n(fd, "rescheduleNoticeHours", booking.rescheduleNoticeHours),
      maxReschedules: n(fd, "maxReschedules", booking.maxReschedules),
      refundPolicy: s(fd, "refundPolicy") === "manual" ? "manual" : "full_if_notice",
      conflictResolution: s(fd, "conflictResolution") === "review" ? "review" : "refund",
      requireCalendarCheck: b(fd, "requireCalendarCheck"),
    },
    admin.id,
    "booking",
  );
}

export async function saveCalendar(fd: FormData) {
  const admin = await requireAdmin("owner");
  const bookingCalendarId = s(fd, "bookingCalendarId") || "primary";
  const busy = fd.getAll("busyCalendarIds").map(String).filter(Boolean);
  await save(
    "calendar",
    { bookingCalendarId, busyCalendarIds: busy.length ? busy : [bookingCalendarId], sendInvites: b(fd, "sendInvites"), includeClientContact: b(fd, "includeClientContact") },
    admin.id,
    "integrations",
  );
}

export async function saveMeeting(fd: FormData) {
  const admin = await requireAdmin("owner");
  const mode = s(fd, "mode") as Settings["meeting"]["mode"];
  await save("meeting", { mode: ["google_meet", "custom", "none"].includes(mode) ? mode : "google_meet", customInstructions: s(fd, "customInstructions").slice(0, 2000) }, admin.id, "meeting");
}

export async function saveNotifications(fd: FormData) {
  const admin = await requireAdmin("owner");
  const reminders = [0, 1, 2]
    .map((i) => ({ hoursBefore: n(fd, `reminder.${i}.hours`, 0), enabled: b(fd, `reminder.${i}.enabled`) }))
    .filter((r) => r.hoursBefore > 0);
  await save(
    "notifications",
    { adminEmail: s(fd, "adminEmail"), notifyAdminOnBooking: b(fd, "notifyAdminOnBooking"), notifyAdminOnCancel: b(fd, "notifyAdminOnCancel"), reminders },
    admin.id,
    "notifications",
  );
}

export async function saveEmail(fd: FormData) {
  const admin = await requireAdmin("owner");
  const t = (k: string) => ({ subject: s(fd, `${k}.subject`), intro: s(fd, `${k}.intro`) });
  await save(
    "email",
    {
      fromName: s(fd, "fromName"),
      fromAddress: s(fd, "fromAddress"),
      replyTo: s(fd, "replyTo"),
      signature: s(fd, "signature"),
      templates: { confirmation: t("confirmation"), reminder: t("reminder"), cancellation: t("cancellation"), reschedule: t("reschedule"), paymentIssue: t("paymentIssue") },
    },
    admin.id,
    "email",
  );
}

export async function savePayments(fd: FormData) {
  const admin = await requireAdmin("owner");
  const p = s(fd, "provider");
  await save("payments", { provider: p === "stripe" || p === "test" ? p : undefined, statementDescriptor: s(fd, "statementDescriptor").slice(0, 22) || "TONY JOSE CONSULT" }, admin.id, "payments");
}

export async function savePrivacy(fd: FormData) {
  const admin = await requireAdmin("owner");
  await save("privacy", { retentionMonths: n(fd, "retentionMonths", 24), messageRetentionMonths: n(fd, "messageRetentionMonths", 6) }, admin.id, "privacy");
}

export async function disconnectGoogleAction() {
  const admin = await requireAdmin("owner");
  await disconnectGoogle();
  await audit({ actor: "admin", adminId: admin.id, action: "google.disconnected" });
  done("Google Calendar disconnected.", "integrations");
}

export async function changePassword(fd: FormData) {
  const admin = await requireAdmin();
  const current = s(fd, "current");
  const next = s(fd, "next");
  if (next.length < 12) done("New password must be at least 12 characters.", "account", "err");
  const db = getDb();
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
  if (!row || !(await bcrypt.compare(current, row.passwordHash))) done("Current password is incorrect.", "account", "err");
  await db.update(adminUsers).set({ passwordHash: await hashPassword(next) }).where(eq(adminUsers.id, admin.id));
  // Sign out other sessions.
  await db.delete(adminSessions).where(and(eq(adminSessions.adminId, admin.id), ne(adminSessions.expiresAt, new Date(0))));
  await audit({ actor: "admin", adminId: admin.id, action: "admin.password_changed" });
  redirect("/admin/login");
}

export async function addAdmin(fd: FormData) {
  const admin = await requireAdmin("owner");
  const email = s(fd, "email").toLowerCase();
  const name = s(fd, "name");
  const password = s(fd, "password");
  const role = s(fd, "role") === "owner" ? "owner" : "staff";
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !name || password.length < 12) done("Enter a name, valid email and a password of 12+ characters.", "account", "err");
  try {
    await getDb().insert(adminUsers).values({ email, name, role, passwordHash: await hashPassword(password) });
  } catch {
    done("An administrator with that email already exists.", "account", "err");
  }
  await audit({ actor: "admin", adminId: admin.id, action: "admin.created", details: { email, role } });
  done(`Administrator ${email} added.`, "account");
}

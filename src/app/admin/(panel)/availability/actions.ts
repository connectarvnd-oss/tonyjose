"use server";

import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { audit } from "@/lib/audit";
import { expandRecurringBlocks, type TimeRange } from "@/lib/availability/engine";
import { cancelAppointment } from "@/lib/booking/service";
import { getDb } from "@/lib/db";
import { appointmentNotes, appointments, availabilityOverrides, availabilityRules, blockedPeriods, clients } from "@/lib/db/schema";
import { getSetting, saveSetting } from "@/lib/settings";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export async function saveWeeklyHours(json: string) {
  const admin = await requireAdmin();
  const windows = z
    .array(z.object({ weekday: z.number().int().min(1).max(7), startTime: time, endTime: time }))
    .parse(JSON.parse(json))
    .filter((w) => w.endTime > w.startTime);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(availabilityRules);
    if (windows.length) await tx.insert(availabilityRules).values(windows);
  });
  await audit({ actor: "admin", adminId: admin.id, action: "availability.hours_updated", details: { windows: windows.length } });
  revalidatePath("/admin/availability");
  return { ok: true };
}

export async function saveBookingRules(fd: FormData) {
  const admin = await requireAdmin();
  const current = await getSetting("booking");
  const num = (k: string, fallback: number) => {
    const v = Number(fd.get(k));
    return Number.isFinite(v) ? v : fallback;
  };
  await saveSetting("booking", {
    ...current,
    bufferMinutes: num("bufferMinutes", current.bufferMinutes),
    slotIntervalMinutes: num("slotIntervalMinutes", current.slotIntervalMinutes),
    minNoticeHours: num("minNoticeHours", current.minNoticeHours),
    maxAdvanceDays: num("maxAdvanceDays", current.maxAdvanceDays),
  });
  await audit({ actor: "admin", adminId: admin.id, action: "settings.booking_rules_updated" });
  revalidatePath("/admin/availability");
}

export type BlockState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "conflict"; conflicts: { id: string; name: string; when: string }[]; values: Record<string, string | string[]> }
  | { status: "done"; message: string; flagged?: { id: string; name: string; when: string }[] };

const blockSchema = z.object({
  mode: z.enum(["days", "range", "weekly"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).optional(),
  until: z.string().optional(),
  kind: z.enum(["holiday", "personal", "other"]),
  reason: z.string().max(300).optional(),
  conflictAction: z.enum(["preserve", "reschedule", "cancel"]).optional(),
});

export async function createBlock(_prev: BlockState, fd: FormData): Promise<BlockState> {
  const admin = await requireAdmin();
  const parsed = blockSchema.safeParse({
    mode: fd.get("mode"),
    startDate: fd.get("startDate"),
    endDate: fd.get("endDate") || undefined,
    startTime: fd.get("startTime") || undefined,
    endTime: fd.get("endTime") || undefined,
    weekdays: fd.getAll("weekdays"),
    until: fd.get("until") || undefined,
    kind: fd.get("kind") || "personal",
    reason: fd.get("reason") || undefined,
    conflictAction: fd.get("conflictAction") || undefined,
  });
  if (!parsed.success) return { status: "error", message: "Please complete the date fields." };
  const b = parsed.data;
  const { timeZone: zone } = await getSetting("booking");

  let row: { startAt: Date; endAt: Date; allDay: boolean; recurrence: { weekdays: number[]; startTime: string; endTime: string; until: string | null } | null };
  let ranges: TimeRange[];
  if (b.mode === "days") {
    const end = b.endDate && b.endDate >= b.startDate ? b.endDate : b.startDate;
    const s = DateTime.fromISO(b.startDate, { zone }).startOf("day");
    const e = DateTime.fromISO(end, { zone }).plus({ days: 1 }).startOf("day");
    row = { startAt: s.toJSDate(), endAt: e.toJSDate(), allDay: true, recurrence: null };
    ranges = [{ start: row.startAt, end: row.endAt }];
  } else if (b.mode === "range") {
    if (!b.startTime || !b.endTime || !time.safeParse(b.startTime).success || !time.safeParse(b.endTime).success) return { status: "error", message: "Enter a start and end time." };
    const s = DateTime.fromISO(`${b.startDate}T${b.startTime}`, { zone });
    const e = DateTime.fromISO(`${b.endDate || b.startDate}T${b.endTime}`, { zone });
    if (e <= s) return { status: "error", message: "The end must be after the start." };
    row = { startAt: s.toJSDate(), endAt: e.toJSDate(), allDay: false, recurrence: null };
    ranges = [{ start: row.startAt, end: row.endAt }];
  } else {
    if (!b.weekdays?.length) return { status: "error", message: "Choose at least one weekday." };
    if (!b.startTime || !b.endTime || b.endTime <= b.startTime) return { status: "error", message: "Enter a valid time range." };
    const s = DateTime.fromISO(b.startDate, { zone }).startOf("day");
    row = {
      startAt: s.toJSDate(),
      endAt: s.plus({ days: 1 }).toJSDate(),
      allDay: false,
      recurrence: { weekdays: b.weekdays, startTime: b.startTime, endTime: b.endTime, until: b.until || null },
    };
    const horizon = DateTime.now().setZone(zone).plus({ days: 366 }).toISODate()!;
    ranges = expandRecurringBlocks([{ fromDate: b.startDate, until: b.until, weekdays: b.weekdays, startTime: b.startTime, endTime: b.endTime }], b.startDate, b.until && b.until < horizon ? b.until : horizon, zone);
  }

  // Warn before blocking time that already has confirmed appointments.
  const db = getDb();
  const minStart = new Date(Math.min(...ranges.map((r) => r.start.getTime()), Date.now()));
  const maxEnd = new Date(Math.max(...ranges.map((r) => r.end.getTime()), Date.now()));
  const candidates = await db
    .select({ id: appointments.id, startAt: appointments.startAt, endAt: appointments.endAt, name: clients.name })
    .from(appointments)
    .innerJoin(clients, eq(clients.id, appointments.clientId))
    .where(and(inArray(appointments.status, ["confirmed", "pending_payment"]), lt(appointments.startAt, maxEnd), gt(appointments.endAt, minStart), gt(appointments.startAt, new Date())));
  const conflicts = candidates
    .filter((a) => ranges.some((r) => a.startAt < r.end && a.endAt > r.start))
    .map((a) => ({ id: a.id, name: a.name, when: DateTime.fromJSDate(a.startAt, { zone }).toFormat("ccc d LLL, HH:mm") }));

  if (conflicts.length && !b.conflictAction) {
    const values: Record<string, string | string[]> = {};
    for (const k of ["mode", "startDate", "endDate", "startTime", "endTime", "until", "kind", "reason"]) values[k] = String(fd.get(k) ?? "");
    values.weekdays = fd.getAll("weekdays").map(String);
    return { status: "conflict", conflicts, values };
  }

  const [created] = await db
    .insert(blockedPeriods)
    .values({ ...row, kind: b.kind, reason: b.reason ?? null, createdBy: admin.id })
    .returning({ id: blockedPeriods.id });
  await audit({ actor: "admin", adminId: admin.id, action: "availability.blocked", entityType: "blocked_period", entityId: created.id, details: { mode: b.mode, conflicts: conflicts.length, conflictAction: b.conflictAction } });

  let message = "Time blocked. Those slots are no longer offered to visitors.";
  if (conflicts.length && b.conflictAction === "cancel") {
    for (const c of conflicts) {
      await cancelAppointment(c.id, { by: "admin", refund: "full", reason: "Tony is unavailable at this time.", adminId: admin.id, notifyClient: true });
    }
    message += ` ${conflicts.length} affected appointment(s) cancelled, clients notified and paid bookings refunded.`;
  } else if (conflicts.length && b.conflictAction === "reschedule") {
    for (const c of conflicts) {
      await db.insert(appointmentNotes).values({ appointmentId: c.id, adminId: admin.id, body: "Falls inside a newly blocked period — needs rescheduling." });
    }
    revalidatePath("/admin/availability");
    return { status: "done", message: `${message} Reschedule the affected appointments below.`, flagged: conflicts };
  } else if (conflicts.length) {
    message += ` ${conflicts.length} existing appointment(s) were kept.`;
  }
  revalidatePath("/admin/availability");
  return { status: "done", message };
}

export async function deleteBlock(id: string) {
  const admin = await requireAdmin();
  await getDb().delete(blockedPeriods).where(eq(blockedPeriods.id, id));
  await audit({ actor: "admin", adminId: admin.id, action: "availability.unblocked", entityType: "blocked_period", entityId: id });
  revalidatePath("/admin/availability");
}

export async function addOverride(fd: FormData) {
  const admin = await requireAdmin();
  const date = String(fd.get("date") ?? "");
  const startTime = String(fd.get("startTime") ?? "");
  const endTime = String(fd.get("endTime") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time.safeParse(startTime).success || !time.safeParse(endTime).success || endTime <= startTime) return;
  await getDb().insert(availabilityOverrides).values({ date, startTime, endTime, note: String(fd.get("note") ?? "") || null, createdBy: admin.id });
  await audit({ actor: "admin", adminId: admin.id, action: "availability.override_added", details: { date, startTime, endTime } });
  revalidatePath("/admin/availability");
}

export async function deleteOverride(id: string) {
  const admin = await requireAdmin();
  await getDb().delete(availabilityOverrides).where(eq(availabilityOverrides.id, id));
  await audit({ actor: "admin", adminId: admin.id, action: "availability.override_removed", entityId: id });
  revalidatePath("/admin/availability");
}


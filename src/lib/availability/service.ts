import { and, eq, gt, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { getDb } from "../db";
import {
  appointments,
  availabilityOverrides,
  availabilityRules,
  blockedPeriods,
  type AppointmentType,
} from "../db/schema";
import { integrations } from "../integrations";
import { getSettings, type Settings } from "../settings";
import { computeSlots, rangeForDates, type RecurringBlock, type Slot, type TimeRange } from "./engine";

export class CalendarUnavailableError extends Error {
  constructor(message = "We couldn't check the calendar right now. Please try again in a moment.") {
    super(message);
    this.name = "CalendarUnavailableError";
  }
}

/** Removes `cut` from each range (used to ignore an appointment's own calendar event when rescheduling). */
export function subtractRange(ranges: TimeRange[], cut: TimeRange): TimeRange[] {
  const out: TimeRange[] = [];
  for (const r of ranges) {
    if (r.end <= cut.start || r.start >= cut.end) {
      out.push(r);
      continue;
    }
    if (r.start < cut.start) out.push({ start: r.start, end: cut.start });
    if (r.end > cut.end) out.push({ start: cut.end, end: r.end });
  }
  return out;
}

export type AvailabilityOptions = {
  type: Pick<AppointmentType, "durationMinutes" | "bufferMinutes">;
  fromDate: string;
  toDate: string;
  now?: Date;
  /** When rescheduling, the appointment's own slot should not block itself. */
  excludeAppointment?: { id: string; startAt: Date; endAt: Date } | null;
  settings?: Pick<Settings, "booking" | "calendar">;
};

export type AvailabilityResult = {
  slots: Slot[];
  timeZone: string;
  calendarChecked: boolean;
};

export async function loadAvailabilityData(range: TimeRange, now: Date, excludeId?: string | null) {
  const db = getDb();
  const [rules, overrides, oneOff, recurring, booked] = await Promise.all([
    db.select().from(availabilityRules).where(eq(availabilityRules.isActive, true)),
    db.select().from(availabilityOverrides),
    db
      .select()
      .from(blockedPeriods)
      .where(and(isNull(blockedPeriods.recurrence), lt(blockedPeriods.startAt, range.end), gt(blockedPeriods.endAt, range.start))),
    db.select().from(blockedPeriods).where(isNotNull(blockedPeriods.recurrence)),
    db
      .select({ id: appointments.id, startAt: appointments.startAt, occupiedUntil: appointments.occupiedUntil })
      .from(appointments)
      .where(
        and(
          lt(appointments.startAt, range.end),
          gt(appointments.occupiedUntil, range.start),
          or(
            eq(appointments.status, "confirmed"),
            and(eq(appointments.status, "pending_payment"), gt(appointments.holdExpiresAt, now)),
          ),
          excludeId ? ne(appointments.id, excludeId) : sql`true`,
        ),
      ),
  ]);
  return { rules, overrides, oneOff, recurring, booked };
}

export async function getAvailableSlots(opts: AvailabilityOptions): Promise<AvailabilityResult> {
  const now = opts.now ?? new Date();
  const s = opts.settings ?? (await getSettings("booking", "calendar"));
  const zone = s.booking.timeZone;

  // Clamp the requested window to [today, today + maxAdvanceDays].
  const today = DateTime.fromJSDate(now, { zone }).toISODate()!;
  const lastDay = DateTime.fromJSDate(now, { zone }).plus({ days: s.booking.maxAdvanceDays }).toISODate()!;
  const fromDate = opts.fromDate < today ? today : opts.fromDate;
  const toDate = opts.toDate > lastDay ? lastDay : opts.toDate;
  if (fromDate > toDate) return { slots: [], timeZone: zone, calendarChecked: true };

  const range = rangeForDates(fromDate, toDate, zone);
  const data = await loadAvailabilityData(range, now, opts.excludeAppointment?.id);

  let busy: TimeRange[] = [];
  let calendarChecked = false;
  const calendar = integrations().calendar;
  const status = await calendar.status();
  if (status === "connected") {
    try {
      busy = await calendar.getBusy(range, s.calendar.busyCalendarIds.length ? s.calendar.busyCalendarIds : [s.calendar.bookingCalendarId]);
      calendarChecked = true;
    } catch (err) {
      console.error("[availability] Google free/busy failed", err);
      if (s.booking.requireCalendarCheck) throw new CalendarUnavailableError();
    }
  } else if (status === "revoked" && s.booking.requireCalendarCheck) {
    // Tony connected a calendar before, but access was lost: don't risk clashes.
    throw new CalendarUnavailableError();
  }
  if (opts.excludeAppointment) {
    busy = subtractRange(busy, { start: opts.excludeAppointment.startAt, end: opts.excludeAppointment.endAt });
  }

  const recurringBlocks: RecurringBlock[] = data.recurring
    .filter((b) => b.recurrence)
    .map((b) => ({
      fromDate: DateTime.fromJSDate(b.startAt, { zone }).toISODate()!,
      until: b.recurrence!.until ?? null,
      weekdays: b.recurrence!.weekdays,
      startTime: b.recurrence!.startTime,
      endTime: b.recurrence!.endTime,
    }));

  const slots = computeSlots({
    now,
    fromDate,
    toDate,
    timeZone: zone,
    durationMinutes: opts.type.durationMinutes,
    bufferMinutes: opts.type.bufferMinutes ?? s.booking.bufferMinutes,
    slotIntervalMinutes: s.booking.slotIntervalMinutes,
    minNoticeHours: s.booking.minNoticeHours,
    maxAdvanceDays: s.booking.maxAdvanceDays,
    rules: data.rules,
    overrides: data.overrides,
    blocks: data.oneOff.map((b) => ({ start: b.startAt, end: b.endAt })),
    recurringBlocks,
    busy,
    booked: data.booked.map((b) => ({ start: b.startAt, end: b.occupiedUntil })),
  });

  return { slots, timeZone: zone, calendarChecked: calendarChecked || status !== "connected" };
}

/** Fresh check for one exact start time — always run right before confirming. */
export async function isSlotAvailable(opts: Omit<AvailabilityOptions, "fromDate" | "toDate"> & { start: Date }) {
  const s = opts.settings ?? (await getSettings("booking", "calendar"));
  const date = DateTime.fromJSDate(opts.start, { zone: s.booking.timeZone }).toISODate()!;
  const { slots } = await getAvailableSlots({ ...opts, settings: s, fromDate: date, toDate: date });
  return slots.some((slot) => new Date(slot.start).getTime() === opts.start.getTime());
}

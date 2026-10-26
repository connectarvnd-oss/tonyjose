// Pure availability calculation. No I/O — everything is passed in, which makes
// the rules easy to test (DST, buffers, notice periods, blocks, busy events).
import { DateTime, Interval } from "luxon";

export type TimeRange = { start: Date; end: Date };

export type WeeklyRule = { weekday: number; startTime: string; endTime: string };
export type DateOverride = { date: string; startTime: string; endTime: string };
export type RecurringBlock = {
  /** First local date the recurrence applies (yyyy-MM-dd) */
  fromDate: string;
  until?: string | null;
  weekdays: number[];
  startTime: string;
  endTime: string;
};

export type AvailabilityInput = {
  now: Date;
  /** Inclusive local start date (yyyy-MM-dd) in the business time zone. */
  fromDate: string;
  /** Inclusive local end date (yyyy-MM-dd). */
  toDate: string;
  timeZone: string;
  durationMinutes: number;
  bufferMinutes: number;
  slotIntervalMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  rules: WeeklyRule[];
  overrides: DateOverride[];
  /** One-off blocked periods (admin blocks). Slots may not overlap these. */
  blocks: TimeRange[];
  recurringBlocks: RecurringBlock[];
  /** External busy periods (Google Calendar). Buffer applies on both sides. */
  busy: TimeRange[];
  /** Existing website bookings, already including their trailing buffer. */
  booked: TimeRange[];
};

export type Slot = { start: string; end: string };

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function localDateTime(date: string, time: string, zone: string): DateTime {
  // Luxon shifts non-existent local times (spring-forward gap) forward,
  // and picks the earlier offset for ambiguous times (autumn fall-back).
  return DateTime.fromISO(`${date}T${time}`, { zone });
}

export function expandRecurringBlocks(
  blocks: RecurringBlock[],
  fromDate: string,
  toDate: string,
  zone: string,
): TimeRange[] {
  const out: TimeRange[] = [];
  const start = DateTime.fromISO(fromDate, { zone });
  const end = DateTime.fromISO(toDate, { zone });
  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    const date = d.toISODate()!;
    for (const b of blocks) {
      if (date < b.fromDate) continue;
      if (b.until && date > b.until) continue;
      if (!b.weekdays.includes(d.weekday)) continue;
      const s = localDateTime(date, b.startTime, zone);
      const e = localDateTime(date, b.endTime, zone);
      if (e > s) out.push({ start: s.toJSDate(), end: e.toJSDate() });
    }
  }
  return out;
}

export function computeSlots(input: AvailabilityInput): Slot[] {
  const zone = input.timeZone;
  const now = input.now.getTime();
  const earliest = now + input.minNoticeHours * 3600_000;
  const latest = DateTime.fromJSDate(input.now, { zone })
    .plus({ days: input.maxAdvanceDays })
    .endOf("day")
    .toMillis();
  const durationMs = input.durationMinutes * 60_000;
  const bufferMs = input.bufferMinutes * 60_000;
  const stepMs = input.slotIntervalMinutes * 60_000;

  const blocks = [
    ...input.blocks,
    ...expandRecurringBlocks(input.recurringBlocks, input.fromDate, input.toDate, zone),
  ].map((b) => [b.start.getTime(), b.end.getTime()] as const);
  const busy = input.busy.map((b) => [b.start.getTime(), b.end.getTime()] as const);
  const booked = input.booked.map((b) => [b.start.getTime(), b.end.getTime()] as const);

  const seen = new Set<number>();
  const slots: Slot[] = [];

  const startDay = DateTime.fromISO(input.fromDate, { zone });
  const endDay = DateTime.fromISO(input.toDate, { zone });
  for (let day = startDay; day <= endDay; day = day.plus({ days: 1 })) {
    const date = day.toISODate()!;
    const windows = [
      ...input.rules.filter((r) => r.weekday === day.weekday),
      ...input.overrides.filter((o) => o.date === date),
    ];
    for (const w of windows) {
      const ws = localDateTime(date, w.startTime, zone).toMillis();
      const we = localDateTime(date, w.endTime, zone).toMillis();
      for (let s = ws; s + durationMs <= we; s += stepMs) {
        const e = s + durationMs;
        if (s < earliest || s > latest) continue;
        if (seen.has(s)) continue;
        // Website bookings store occupied_until = end + buffer, so the new
        // slot only needs its own trailing buffer to keep the gap symmetric.
        if (booked.some(([bs, be]) => overlaps(s, e + bufferMs, bs, be))) continue;
        if (busy.some(([bs, be]) => overlaps(s - bufferMs, e + bufferMs, bs, be))) continue;
        if (blocks.some(([bs, be]) => overlaps(s, e, bs, be))) continue;
        seen.add(s);
        slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
      }
    }
  }
  slots.sort((a, b) => a.start.localeCompare(b.start));
  return slots;
}

/** UTC range covering the given local dates, padded so buffers near midnight are respected. */
export function rangeForDates(fromDate: string, toDate: string, zone: string, padMinutes = 240): TimeRange {
  const s = DateTime.fromISO(fromDate, { zone }).startOf("day").minus({ minutes: padMinutes });
  const e = DateTime.fromISO(toDate, { zone }).endOf("day").plus({ minutes: padMinutes });
  return { start: s.toJSDate(), end: e.toJSDate() };
}

export function isSameInstant(a: string | Date, b: string | Date) {
  return new Date(a).getTime() === new Date(b).getTime();
}

export function intervalOverlaps(a: TimeRange, b: TimeRange) {
  return Interval.fromDateTimes(a.start, a.end).overlaps(Interval.fromDateTimes(b.start, b.end));
}

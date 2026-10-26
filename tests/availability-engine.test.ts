import { describe, expect, it } from "vitest";
import { computeSlots, expandRecurringBlocks, type AvailabilityInput } from "@/lib/availability/engine";

const base: AvailabilityInput = {
  now: new Date("2026-03-01T00:00:00Z"),
  fromDate: "2026-03-02", // Monday
  toDate: "2026-03-02",
  timeZone: "Europe/Berlin",
  durationMinutes: 60,
  bufferMinutes: 15,
  slotIntervalMinutes: 15,
  minNoticeHours: 0,
  maxAdvanceDays: 60,
  rules: [{ weekday: 1, startTime: "09:00", endTime: "12:00" }],
  overrides: [],
  blocks: [],
  recurringBlocks: [],
  busy: [],
  booked: [],
};

const times = (slots: { start: string }[]) => slots.map((s) => s.start.slice(11, 16));

describe("availability engine", () => {
  it("generates slots that fit inside working hours (Berlin = UTC+1 in winter)", () => {
    const slots = computeSlots(base);
    expect(times(slots)[0]).toBe("08:00"); // 09:00 Berlin
    expect(times(slots).at(-1)).toBe("10:00"); // last 60-min slot starts 11:00 Berlin
    expect(slots).toHaveLength(9);
  });

  it("returns nothing on days without working hours", () => {
    expect(computeSlots({ ...base, fromDate: "2026-03-03", toDate: "2026-03-03" })).toHaveLength(0);
  });

  it("respects daylight-saving changes", () => {
    // 30 March 2026 is the Monday after clocks go forward: Berlin = UTC+2
    const slots = computeSlots({ ...base, fromDate: "2026-03-30", toDate: "2026-03-30" });
    expect(times(slots)[0]).toBe("07:00");
  });

  it("applies buffers around existing website bookings", () => {
    // Booking 10:00–11:00 Berlin, occupied until 11:15 incl. buffer
    const booked = [{ start: new Date("2026-03-02T09:00:00Z"), end: new Date("2026-03-02T10:15:00Z") }];
    expect(computeSlots({ ...base, booked })).toHaveLength(0);
    const wider = times(computeSlots({ ...base, booked, rules: [{ weekday: 1, startTime: "08:00", endTime: "12:00" }] }));
    expect(wider).toContain("07:45"); // ends 09:45 Berlin, 15-min gap before 10:00
    expect(wider).not.toContain("08:00"); // would leave no buffer
  });

  it("excludes Google busy periods with buffer on both sides", () => {
    const busy = [{ start: new Date("2026-03-02T09:30:00Z"), end: new Date("2026-03-02T09:45:00Z") }];
    expect(times(computeSlots({ ...base, busy }))).toEqual(["08:00", "08:15", "10:00"]);
  });

  it("excludes blocked periods and recurring blocks", () => {
    const blocks = [{ start: new Date("2026-03-02T08:00:00Z"), end: new Date("2026-03-02T09:00:00Z") }];
    expect(times(computeSlots({ ...base, blocks }))[0]).toBe("09:00");
    const rec = computeSlots({ ...base, recurringBlocks: [{ fromDate: "2026-03-01", weekdays: [1], startTime: "09:00", endTime: "11:00" }] });
    expect(times(rec)).toEqual(["10:00"]);
  });

  it("supports date overrides that open extra hours", () => {
    const slots = computeSlots({ ...base, fromDate: "2026-03-07", toDate: "2026-03-07", overrides: [{ date: "2026-03-07", startTime: "10:00", endTime: "11:00" }] });
    expect(times(slots)).toEqual(["09:00"]);
  });

  it("respects minimum notice and maximum advance window", () => {
    const now = new Date("2026-03-02T07:30:00Z");
    expect(times(computeSlots({ ...base, now, minNoticeHours: 1 }))[0]).toBe("08:30");
    expect(computeSlots({ ...base, now: new Date("2026-01-01T00:00:00Z"), maxAdvanceDays: 30 })).toHaveLength(0);
  });

  it("expands recurring blocks only within the until date", () => {
    const r = expandRecurringBlocks([{ fromDate: "2026-03-01", until: "2026-03-09", weekdays: [1], startTime: "12:00", endTime: "13:00" }], "2026-03-01", "2026-03-31", "Europe/Berlin");
    expect(r).toHaveLength(2);
  });
});

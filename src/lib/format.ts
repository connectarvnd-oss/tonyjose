import { DateTime } from "luxon";

export function formatInZone(date: Date, zone: string, opts: { withZone?: boolean } = {}) {
  const dt = DateTime.fromJSDate(date, { zone });
  const base = dt.toFormat("cccc d LLLL yyyy, HH:mm");
  return opts.withZone ? `${base} (${zoneLabel(zone, date)})` : base;
}

export function formatTimeRange(start: Date, end: Date, zone: string) {
  const s = DateTime.fromJSDate(start, { zone });
  const e = DateTime.fromJSDate(end, { zone });
  return `${s.toFormat("cccc d LLLL yyyy")}, ${s.toFormat("HH:mm")}–${e.toFormat("HH:mm")}`;
}

export function zoneLabel(zone: string, at: Date = new Date()) {
  const dt = DateTime.fromJSDate(at, { zone });
  const city = zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
  return `${city} time, ${dt.toFormat("ZZZZ")}`;
}

export function isValidZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  return DateTime.local().setZone(zone).isValid;
}

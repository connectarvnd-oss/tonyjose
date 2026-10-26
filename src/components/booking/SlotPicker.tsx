"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type Slot = { start: string; end: string };

type Props = {
  /** Query string identifying what to fetch: `type=<id>` or `ref=<ref>&t=<token>` */
  query: string;
  businessTimeZone: string;
  maxAdvanceDays: number;
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
  /** Bump to force a refetch (e.g. after a slot was taken). */
  refreshKey?: number;
  displayZone: string;
  onDisplayZoneChange: (zone: string) => void;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function partsInZone(date: Date, zone: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatTime(iso: string, zone: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date(iso));
}

export function formatDateLong(iso: string, zone: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: zone }).format(new Date(iso));
}

export function zoneName(zone: string) {
  return zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function SlotPicker({ query, businessTimeZone, maxAdvanceDays, selected, onSelect, refreshKey = 0, displayZone, onDisplayZoneChange }: Props) {
  const today = partsInZone(new Date(), displayZone);
  const lastDay = addDays(today, maxAdvanceDays);
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) }));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const autoAdvanced = useRef(0);
  const visitorZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const first = ymd(cursor.y, cursor.m, 1);
    const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
    const last = ymd(cursor.y, cursor.m, daysInMonth);
    // Pad by a day either side so time-zone differences don't hide slots.
    const res = await fetch(`/api/availability?${query}&from=${addDays(first, -1)}&to=${addDays(last, 1)}`, { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) {
      const msg = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : null;
      setError(msg ?? "We couldn't load available times. Please check your connection and try again.");
      setSlots([]);
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { slots: Slot[] };
    setSlots(data.slots);
    setLoading(false);
  }, [cursor, query]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = partsInZone(new Date(s.start), displayZone);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [slots, displayZone]);

  const monthPrefix = `${cursor.y}-${String(cursor.m).padStart(2, "0")}`;
  const daysWithSlots = [...byDay.keys()].filter((k) => k.startsWith(monthPrefix)).sort();

  // Pick a sensible day: keep the selection, else first available.
  useEffect(() => {
    if (loading) return;
    if (selected) {
      const k = partsInZone(new Date(selected.start), displayZone);
      if (k.startsWith(monthPrefix) && byDay.has(k)) {
        setDay(k);
        return;
      }
    }
    if (day && byDay.has(day) && day.startsWith(monthPrefix)) return;
    if (daysWithSlots.length) {
      setDay(daysWithSlots[0]);
    } else {
      setDay(null);
      // Nothing this month: look ahead automatically (up to twice).
      const nextFirst = ymd(cursor.m === 12 ? cursor.y + 1 : cursor.y, cursor.m === 12 ? 1 : cursor.m + 1, 1);
      if (autoAdvanced.current < 2 && nextFirst <= lastDay && !error) {
        autoAdvanced.current++;
        setCursor((c) => (c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, byDay, monthPrefix]);

  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(cursor.y, cursor.m - 1, 1)).getUTCDay() + 6) % 7;
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cursor.y, cursor.m - 1, 1)));
  const canPrev = monthPrefix > today.slice(0, 7);
  const canNext = monthPrefix < lastDay.slice(0, 7);
  const daySlots = day ? (byDay.get(day) ?? []) : [];

  const groups = [
    { label: "Morning", items: daySlots.filter((s) => Number(formatTime(s.start, displayZone).slice(0, 2)) < 12) },
    { label: "Afternoon", items: daySlots.filter((s) => { const h = Number(formatTime(s.start, displayZone).slice(0, 2)); return h >= 12 && h < 17; }) },
    { label: "Evening", items: daySlots.filter((s) => Number(formatTime(s.start, displayZone).slice(0, 2)) >= 17) },
  ].filter((g) => g.items.length);

  const zoneOptions = visitorZone === businessTimeZone ? [businessTimeZone] : [visitorZone, businessTimeZone];

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
      <div>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-3xl" aria-live="polite">
            {monthLabel}
          </h3>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/20 transition-colors hover:border-ink disabled:opacity-30"
              onClick={() => { autoAdvanced.current = 2; setCursor((c) => (c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 })); }}
              disabled={!canPrev}
              aria-label="Previous month"
            >
              ←
            </button>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/20 transition-colors hover:border-ink disabled:opacity-30"
              onClick={() => { autoAdvanced.current = 2; setCursor((c) => (c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 })); }}
              disabled={!canNext}
              aria-label="Next month"
            >
              →
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-7 text-center" role="grid" aria-label={`Available dates in ${monthLabel}`} aria-busy={loading}>
          <div role="row" className="contents">
            {WEEKDAYS.map((w) => (
              <div key={w} role="columnheader" className="eyebrow pb-3">
                {w}
              </div>
            ))}
          </div>
          {Array.from({ length: firstWeekday }).map((_, i) => (
            <div key={`pad-${i}`} aria-hidden />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = ymd(cursor.y, cursor.m, i + 1);
            const available = byDay.has(d);
            const isSelected = d === day;
            const isToday = d === today;
            const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
            return (
              <div key={d} role="gridcell" className="flex aspect-square items-center justify-center p-0.5">
                <button
                  type="button"
                  disabled={!available}
                  onClick={() => setDay(d)}
                  aria-pressed={isSelected}
                  aria-label={`${label}${available ? `, ${byDay.get(d)!.length} times available` : ", unavailable"}`}
                  className={`relative flex h-full max-h-14 w-full max-w-14 items-center justify-center rounded-full text-[0.95rem] transition-all duration-300 ease-editorial ${
                    isSelected
                      ? "bg-ink text-paper"
                      : available
                        ? "font-medium text-ink hover:bg-ink/[0.07]"
                        : "cursor-default text-muted/40"
                  }`}
                >
                  {i + 1}
                  {available && !isSelected && <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-accent" aria-hidden />}
                  {isToday && !isSelected && <span className="sr-only">(today)</span>}
                </button>
              </div>
            );
          })}
        </div>

        <fieldset className="mt-8">
          <legend className="eyebrow mb-3">Show times in</legend>
          <div className="flex flex-wrap gap-2">
            {zoneOptions.map((z) => (
              <label
                key={z}
                className={`cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors ${
                  displayZone === z ? "border-ink bg-ink text-paper" : "border-ink/20 hover:border-ink"
                }`}
              >
                <input type="radio" name="zone" value={z} className="sr-only" checked={displayZone === z} onChange={() => onDisplayZoneChange(z)} />
                {z === visitorZone ? `Your time (${zoneName(z)})` : `Tony's time (${zoneName(z)})`}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="min-h-[18rem]">
        {loading ? (
          <div className="space-y-3" aria-label="Loading available times">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-full bg-ink/[0.05]" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="border-l-2 border-danger pl-5">
            <p className="font-medium">Availability couldn't be loaded</p>
            <p className="mt-2 text-sm text-charcoal">{error}</p>
            <button type="button" className="btn-secondary mt-5 min-h-[42px]" onClick={load}>
              Try again
            </button>
          </div>
        ) : !day ? (
          <div>
            <p className="font-display text-2xl">No times available this month.</p>
            <p className="mt-3 text-charcoal">{canNext ? "Try the next month, or get in touch if nothing suits." : "Please get in touch if nothing suits."}</p>
          </div>
        ) : (
          <div>
            <p className="eyebrow">{formatDateLong(daySlots[0].start, displayZone)}</p>
            <div className="mt-6 space-y-7">
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="mb-3 text-sm text-muted">{g.label}</p>
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
                    {g.items.map((s) => {
                      const isSel = selected?.start === s.start;
                      return (
                        <li key={s.start}>
                          <button
                            type="button"
                            onClick={() => onSelect(s)}
                            aria-pressed={isSel}
                            className={`w-full rounded-full border py-3 text-[0.95rem] tabular-nums transition-all duration-300 ease-editorial ${
                              isSel ? "border-accent bg-accent text-paper" : "border-ink/20 hover:border-ink hover:bg-ink hover:text-paper"
                            }`}
                          >
                            {formatTime(s.start, displayZone)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

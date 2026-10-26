import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, gt } from "drizzle-orm";
import { DateTime } from "luxon";
import Link from "next/link";
import { BlockForm } from "@/components/admin/BlockForm";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { WeeklyHours } from "@/components/admin/WeeklyHours";
import { btnCls, btnSecondaryCls, Card, inputCls, labelCls, PageHeader } from "@/components/admin/ui";
import { expandRecurringBlocks, type TimeRange } from "@/lib/availability/engine";
import { CalendarUnavailableError, getAvailableSlots } from "@/lib/availability/service";
import { getAppointmentTypes } from "@/lib/content";
import { getDb } from "@/lib/db";
import { appointments, availabilityOverrides, availabilityRules, blockedPeriods, clients } from "@/lib/db/schema";
import { integrations } from "@/lib/integrations";
import { getSettings } from "@/lib/settings";
import { addOverride, createBlock, deleteBlock, deleteOverride, saveBookingRules, saveWeeklyHours } from "./actions";

export const metadata = { title: "Availability" };
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string }> }) {
  const sp = await searchParams;
  const s = await getSettings("booking", "calendar");
  const zone = s.booking.timeZone;
  const now = DateTime.now().setZone(zone);
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? DateTime.fromISO(`${sp.month}-01`, { zone }) : now.startOf("month");
  const monthStart = month.startOf("month");
  const monthEnd = month.endOf("month");
  const selectedDay = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  const db = getDb();

  const [rules, oneOffBlocks, recurringBlocks, overrides, booked, types] = await Promise.all([
    db.select().from(availabilityRules).orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime)),
    db.select().from(blockedPeriods).where(and(isNull(blockedPeriods.recurrence), gt(blockedPeriods.endAt, monthStart.minus({ days: 7 }).toJSDate()))).orderBy(asc(blockedPeriods.startAt)),
    db.select().from(blockedPeriods).where(isNotNull(blockedPeriods.recurrence)),
    db.select().from(availabilityOverrides).where(gte(availabilityOverrides.date, now.toISODate()!)).orderBy(asc(availabilityOverrides.date)),
    db
      .select({ id: appointments.id, startAt: appointments.startAt, endAt: appointments.endAt, status: appointments.status, priceCents: appointments.priceCents, name: clients.name })
      .from(appointments)
      .innerJoin(clients, eq(clients.id, appointments.clientId))
      .where(and(inArray(appointments.status, ["confirmed", "pending_payment", "completed", "no_show"]), gte(appointments.startAt, monthStart.toJSDate()), lt(appointments.startAt, monthEnd.toJSDate())))
      .orderBy(asc(appointments.startAt)),
    getAppointmentTypes(),
  ]);

  // Available slot counts per day for the shortest active consultation.
  const reference = [...types].sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
  let slotsByDay = new Map<string, number>();
  let availabilityError: string | null = null;
  if (reference) {
    try {
      const res = await getAvailableSlots({ type: reference, fromDate: monthStart.toISODate()!, toDate: monthEnd.toISODate()!, settings: s });
      slotsByDay = res.slots.reduce((m, sl) => {
        const k = DateTime.fromISO(sl.start, { zone }).toISODate()!;
        m.set(k, (m.get(k) ?? 0) + 1);
        return m;
      }, new Map<string, number>());
    } catch (err) {
      availabilityError = err instanceof CalendarUnavailableError ? "Google Calendar couldn't be reached, so public booking is paused until it recovers." : "Availability could not be calculated.";
    }
  }

  // Google busy periods (times only — titles are never fetched).
  let googleBusy: TimeRange[] = [];
  const calendar = integrations().calendar;
  if ((await calendar.status()) === "connected") {
    try {
      googleBusy = await calendar.getBusy({ start: monthStart.toJSDate(), end: monthEnd.toJSDate() }, s.calendar.busyCalendarIds.length ? s.calendar.busyCalendarIds : [s.calendar.bookingCalendarId]);
    } catch {
      availabilityError ??= "Google Calendar busy times couldn't be loaded.";
    }
  }

  const recurringExpanded = expandRecurringBlocks(
    recurringBlocks.map((b) => ({ fromDate: DateTime.fromJSDate(b.startAt, { zone }).toISODate()!, until: b.recurrence!.until, weekdays: b.recurrence!.weekdays, startTime: b.recurrence!.startTime, endTime: b.recurrence!.endTime })),
    monthStart.toISODate()!,
    monthEnd.toISODate()!,
    zone,
  );

  const dayInfo = (date: string) => {
    const ds = DateTime.fromISO(date, { zone }).startOf("day");
    const de = ds.plus({ days: 1 });
    const overlaps = (r: { start: Date; end: Date }) => r.start < de.toJSDate() && r.end > ds.toJSDate();
    return {
      bookings: booked.filter((b) => DateTime.fromJSDate(b.startAt, { zone }).toISODate() === date),
      blocks: oneOffBlocks.filter((b) => overlaps({ start: b.startAt, end: b.endAt })),
      recurring: recurringExpanded.filter(overlaps),
      busy: googleBusy.filter(overlaps),
      overrides: overrides.filter((o) => o.date === date),
      slots: slotsByDay.get(date) ?? 0,
      fullDayBlocked: oneOffBlocks.some((b) => b.startAt <= ds.toJSDate() && b.endAt >= de.toJSDate()),
    };
  };

  const fmtT = (d: Date) => DateTime.fromJSDate(d, { zone }).toFormat("HH:mm");
  const fmtRange = (a: Date, b: Date) => {
    const s1 = DateTime.fromJSDate(a, { zone });
    const e1 = DateTime.fromJSDate(b, { zone });
    return s1.hasSame(e1.minus({ minutes: 1 }), "day") ? `${s1.toFormat("ccc d LLL, HH:mm")}–${e1.toFormat("HH:mm")}` : `${s1.toFormat("ccc d LLL HH:mm")} → ${e1.toFormat("ccc d LLL HH:mm")}`;
  };
  const prev = monthStart.minus({ months: 1 }).toFormat("yyyy-LL");
  const next = monthStart.plus({ months: 1 }).toFormat("yyyy-LL");
  const lead = monthStart.weekday - 1;
  const sel = selectedDay ? dayInfo(selectedDay) : null;

  return (
    <div>
      <PageHeader title="Availability" description={`Everything is in ${zone}. Busy events in Google Calendar are excluded automatically — no need to block them here.`} />
      {availabilityError && <p className="mb-6 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">{availabilityError}</p>}

      <div className="grid gap-6 2xl:grid-cols-[1fr_26rem]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-3xl">{monthStart.toFormat("LLLL yyyy")}</h2>
            <div className="flex gap-2">
              <Link href={`?month=${prev}`} className={btnSecondaryCls} aria-label="Previous month">←</Link>
              <Link href={`?month=${now.toFormat("yyyy-LL")}`} className={btnSecondaryCls}>Today</Link>
              <Link href={`?month=${next}`} className={btnSecondaryCls} aria-label="Next month">→</Link>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success/60" /> open slots</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ink" /> booking</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger/60" /> blocked</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-400" /> Google busy</span>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line bg-line text-sm">
            {WD.map((d) => (
              <div key={d} className="bg-paper-deep/60 px-2 py-1.5 text-xs font-medium text-muted">{d}</div>
            ))}
            {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} className="bg-paper/60" />)}
            {Array.from({ length: monthStart.daysInMonth! }).map((_, i) => {
              const date = monthStart.plus({ days: i }).toISODate()!;
              const info = dayInfo(date);
              const isPast = date < now.toISODate()!;
              const isSel = date === selectedDay;
              return (
                <Link
                  key={date}
                  href={`?month=${monthStart.toFormat("yyyy-LL")}&day=${date}#day`}
                  className={`min-h-[5.5rem] bg-white p-1.5 transition-colors hover:bg-paper ${isSel ? "outline outline-2 -outline-offset-2 outline-ink" : ""} ${isPast ? "opacity-50" : ""} ${info.fullDayBlocked ? "bg-danger/5" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${date === now.toISODate() ? "rounded-full bg-accent px-1.5 text-paper" : ""}`}>{i + 1}</span>
                    {!isPast && info.slots > 0 && <span className="rounded bg-success/15 px-1 text-[0.65rem] text-success">{info.slots} open</span>}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {info.bookings.slice(0, 3).map((b) => (
                      <div key={b.id} className="truncate rounded bg-ink px-1 text-[0.65rem] text-paper">{fmtT(b.startAt)} {b.name.split(" ")[0]}</div>
                    ))}
                    {info.bookings.length > 3 && <div className="text-[0.65rem] text-muted">+{info.bookings.length - 3} more</div>}
                    {(info.blocks.length > 0 || info.recurring.length > 0) && <div className="truncate rounded bg-danger/15 px-1 text-[0.65rem] text-danger">{info.fullDayBlocked ? "Blocked" : "Partly blocked"}</div>}
                    {info.busy.length > 0 && <div className="truncate rounded bg-sky-100 px-1 text-[0.65rem] text-sky-900">{info.busy.length} busy</div>}
                    {info.overrides.length > 0 && <div className="truncate rounded bg-success/15 px-1 text-[0.65rem] text-success">extra hours</div>}
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        <div className="space-y-6">
          {sel && selectedDay && (
            <Card id="day" title={DateTime.fromISO(selectedDay, { zone }).toFormat("cccc d LLLL yyyy")}>
              <div className="space-y-4 text-sm">
                <p>{sel.slots} slot(s) currently open{reference ? ` for ${reference.shortName.toLowerCase()}` : ""}.</p>
                {sel.bookings.length > 0 && (
                  <div>
                    <p className={labelCls}>Bookings</p>
                    <ul className="space-y-1">
                      {sel.bookings.map((b) => (
                        <li key={b.id}><Link className="underline" href={`/admin/appointments/${b.id}`}>{fmtT(b.startAt)}–{fmtT(b.endAt)} {b.name}</Link> {b.status === "pending_payment" && <span className="text-xs text-muted">(awaiting payment)</span>}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {sel.busy.length > 0 && (
                  <div>
                    <p className={labelCls}>Google Calendar busy</p>
                    <ul>{sel.busy.map((b, i) => <li key={i}>{fmtT(b.start)}–{fmtT(b.end)}</li>)}</ul>
                  </div>
                )}
                {(sel.blocks.length > 0 || sel.recurring.length > 0) && (
                  <div>
                    <p className={labelCls}>Blocked</p>
                    <ul className="space-y-1">
                      {sel.blocks.map((b) => (
                        <li key={b.id} className="flex items-center justify-between gap-2">
                          <span>{b.allDay ? fmtRange(b.startAt, b.endAt).replace(/, 00:00.*$/, "") + " (all day)" : fmtRange(b.startAt, b.endAt)}{b.reason ? ` · ${b.reason}` : ""}</span>
                          <form action={deleteBlock.bind(null, b.id)}><SubmitButton className="text-xs text-danger underline">Unblock</SubmitButton></form>
                        </li>
                      ))}
                      {sel.recurring.map((r, i) => <li key={`r${i}`}>{fmtT(r.start)}–{fmtT(r.end)} (recurring)</li>)}
                    </ul>
                  </div>
                )}
                {selectedDay >= now.toISODate()! && (
                  <BlockForm action={createBlock} defaultDate={selectedDay} />
                )}
                <form action={addOverride} className="grid grid-cols-2 gap-2 border-t border-line pt-4">
                  <p className="col-span-2 text-sm font-medium">Open extra hours on this date</p>
                  <input type="hidden" name="date" value={selectedDay} />
                  <input type="time" name="startTime" required className={inputCls} aria-label="Start" />
                  <input type="time" name="endTime" required className={inputCls} aria-label="End" />
                  <input name="note" placeholder="Note (optional)" className={`${inputCls} col-span-2`} />
                  <div className="col-span-2"><SubmitButton className={btnSecondaryCls}>Add availability</SubmitButton></div>
                </form>
              </div>
            </Card>
          )}
          {!sel && (
            <Card title="Block time" description="Holidays, personal commitments or recurring unavailability. Blocked slots disappear from the booking page immediately.">
              <BlockForm action={createBlock} defaultDate={now.toISODate()!} />
            </Card>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Working hours" description="Add several windows per day; the gaps between them act as breaks.">
          <WeeklyHours initial={rules.filter((r) => r.isActive).map((r) => ({ weekday: r.weekday, startTime: r.startTime, endTime: r.endTime }))} save={saveWeeklyHours} />
        </Card>

        <div className="space-y-6">
          <Card title="Booking rules">
            <form action={saveBookingRules} className="grid gap-3 sm:grid-cols-2">
              <label><span className={labelCls}>Buffer between consultations (min)</span><input type="number" min={0} max={240} name="bufferMinutes" defaultValue={s.booking.bufferMinutes} className={inputCls} /></label>
              <label><span className={labelCls}>Start times every (min)</span><input type="number" min={5} max={120} name="slotIntervalMinutes" defaultValue={s.booking.slotIntervalMinutes} className={inputCls} /></label>
              <label><span className={labelCls}>Minimum notice (hours)</span><input type="number" min={0} step="0.5" name="minNoticeHours" defaultValue={s.booking.minNoticeHours} className={inputCls} /></label>
              <label><span className={labelCls}>Book up to (days ahead)</span><input type="number" min={1} max={365} name="maxAdvanceDays" defaultValue={s.booking.maxAdvanceDays} className={inputCls} /></label>
              <div className="sm:col-span-2 flex items-center gap-3">
                <SubmitButton className={btnCls}>Save rules</SubmitButton>
                <Link href="/admin/types" className="text-sm text-muted underline">Consultation lengths &amp; prices →</Link>
              </div>
            </form>
          </Card>

          <Card title="Recurring unavailability">
            {recurringBlocks.length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="divide-y divide-line text-sm">
                {recurringBlocks.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      Every {b.recurrence!.weekdays.map((w) => WD[w - 1]).join(", ")} {b.recurrence!.startTime}–{b.recurrence!.endTime}
                      <span className="text-muted"> · from {DateTime.fromJSDate(b.startAt, { zone }).toFormat("d LLL yyyy")}{b.recurrence!.until ? ` until ${b.recurrence!.until}` : ""}{b.reason ? ` · ${b.reason}` : ""}</span>
                    </span>
                    <form action={deleteBlock.bind(null, b.id)}><SubmitButton className="text-xs text-danger underline">Remove</SubmitButton></form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Upcoming blocks">
            {oneOffBlocks.filter((b) => b.endAt > new Date()).length === 0 ? <p className="text-sm text-muted">None.</p> : (
              <ul className="divide-y divide-line text-sm">
                {oneOffBlocks.filter((b) => b.endAt > new Date()).map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{fmtRange(b.startAt, b.endAt)} <span className="text-muted">· {b.kind}{b.reason ? ` · ${b.reason}` : ""}</span></span>
                    <form action={deleteBlock.bind(null, b.id)}><SubmitButton className="text-xs text-danger underline">Unblock</SubmitButton></form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Extra availability">
            {overrides.length === 0 ? <p className="text-sm text-muted">None. Select a day in the calendar to open extra hours.</p> : (
              <ul className="divide-y divide-line text-sm">
                {overrides.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{DateTime.fromISO(o.date).toFormat("ccc d LLL yyyy")} {o.startTime}–{o.endTime}{o.note ? <span className="text-muted"> · {o.note}</span> : null}</span>
                    <form action={deleteOverride.bind(null, o.id)}><SubmitButton className="text-xs text-danger underline">Remove</SubmitButton></form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "@/lib/db";
import { appointmentTypes, availabilityRules } from "@/lib/db/schema";
import type { TimeRange } from "@/lib/availability/engine";
import { setIntegrationsForTesting, type CalendarPort } from "@/lib/integrations";
import { ConsoleMailer } from "@/lib/email/providers";
import type { PaymentProvider } from "@/lib/payments/types";
import { saveSetting } from "@/lib/settings";

export async function resetDatabase() {
  const pool = getPool();
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const dir = path.join(process.cwd(), "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(dir, f), "utf8"));
  }
}

export async function seedBasics() {
  const db = getDb();
  const [free] = await db
    .insert(appointmentTypes)
    .values({ slug: "free-enquiry", name: "Free Initial Enquiry", shortName: "Free enquiry", durationMinutes: 15, priceCents: 0, onePerClient: true, calendarLabel: "Free" })
    .returning();
  const [paid] = await db
    .insert(appointmentTypes)
    .values({ slug: "full-consultation", name: "Full Consultation", shortName: "Full consultation", durationMinutes: 60, priceCents: 2800, calendarLabel: "Paid" })
    .returning();
  // Every day 09:00–17:00 so tests don't depend on the weekday they run.
  await db.insert(availabilityRules).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));
  await saveSetting("booking", {
    timeZone: "Europe/Berlin",
    slotIntervalMinutes: 15,
    bufferMinutes: 15,
    minNoticeHours: 0,
    maxAdvanceDays: 365,
    holdMinutes: 30,
    allowClientCancel: true,
    allowClientReschedule: true,
    cancellationNoticeHours: 24,
    rescheduleNoticeHours: 24,
    maxReschedules: 2,
    refundPolicy: "full_if_notice",
    conflictResolution: "refund",
    requireCalendarCheck: true,
  });
  return { free, paid };
}

export class FakeCalendar implements CalendarPort {
  connected = true;
  fail = false;
  busy: TimeRange[] = [];
  events = new Map<string, { start: Date; end: Date; summary: string; deleted?: boolean }>();
  inserts = 0;
  async status() {
    return this.connected ? ("connected" as const) : ("not_connected" as const);
  }
  async getBusy(range: TimeRange) {
    if (this.fail) throw new Error("Google outage");
    const own = [...this.events.values()].filter((e) => !e.deleted).map((e) => ({ start: e.start, end: e.end }));
    return [...this.busy, ...own].filter((b) => b.start < range.end && b.end > range.start);
  }
  async upsertEvent(input: { eventId: string; start: Date; end: Date; summary: string }) {
    if (this.fail) throw new Error("Google outage");
    if (!this.events.has(input.eventId)) this.inserts++;
    this.events.set(input.eventId, { start: input.start, end: input.end, summary: input.summary });
    return { eventId: input.eventId, meetingLink: "https://meet.google.com/abc-defg-hij" };
  }
  async cancelEvent(_cal: string, eventId: string) {
    const e = this.events.get(eventId);
    if (e) e.deleted = true;
  }
}

export class FakePayments implements PaymentProvider {
  id = "test" as const;
  live = false;
  checkouts = new Map<string, string>(); // idempotency (appointment) -> session
  refunds: { amountCents: number; key: string }[] = [];
  expired: string[] = [];
  async createCheckout(args: { appointmentId: string }) {
    const existing = this.checkouts.get(args.appointmentId);
    const sessionId = existing ?? `test_cs_${this.checkouts.size + 1}`;
    this.checkouts.set(args.appointmentId, sessionId);
    return { sessionId, url: `https://pay.example/${sessionId}` };
  }
  async expireCheckout(sessionId: string) {
    this.expired.push(sessionId);
  }
  async refund(args: { amountCents: number; idempotencyKey: string }) {
    if (!this.refunds.some((r) => r.key === args.idempotencyKey)) this.refunds.push({ amountCents: args.amountCents, key: args.idempotencyKey });
    return { refundId: `re_${this.refunds.length}`, status: "succeeded" as const };
  }
}

export function installFakes() {
  const calendar = new FakeCalendar();
  const payments = new FakePayments();
  const mailer = new ConsoleMailer();
  setIntegrationsForTesting({ calendar, payments: async () => payments, mailer: () => mailer });
  return { calendar, payments, mailer };
}

/** A future date (yyyy-mm-dd) N days from now. */
export function futureDate(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function berlin(date: string, time: string) {
  // Europe/Berlin local time → Date (handles DST via Intl)
  const guess = new Date(`${date}T${time}:00Z`);
  const offset = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")!.value;
    const m = p.match(/GMT([+-]\d+)?/);
    return m && m[1] ? Number(m[1]) : 0;
  };
  return new Date(guess.getTime() - offset(guess) * 3600_000);
}

export async function count(table: string, where = "true") {
  const r = await getDb().execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`));
  return r.rows[0].n;
}

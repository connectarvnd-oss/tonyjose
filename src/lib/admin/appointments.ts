import { and, asc, desc, eq, gt, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { DateTime } from "luxon";
import { getDb } from "../db";
import { appointments, appointmentTypes, clients } from "../db/schema";

export type AppointmentFilters = {
  q?: string;
  status?: string;
  payment?: string;
  type?: string;
  from?: string;
  to?: string;
  when?: string;
  page?: string;
};

export function buildWhere(f: AppointmentFilters, zone: string) {
  const conds: SQL[] = [];
  if (f.q) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(clients.name, q), ilike(clients.email, q), ilike(appointments.reference, q))!);
  }
  if (f.status) conds.push(eq(appointments.status, f.status as never));
  if (f.payment) conds.push(eq(appointments.paymentStatus, f.payment as never));
  if (f.type === "free") conds.push(eq(appointments.priceCents, 0));
  else if (f.type === "paid") conds.push(gt(appointments.priceCents, 0));
  else if (f.type && /^[0-9a-f-]{36}$/.test(f.type)) conds.push(eq(appointments.appointmentTypeId, f.type));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(appointments.startAt, DateTime.fromISO(f.from, { zone }).startOf("day").toJSDate()));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lt(appointments.startAt, DateTime.fromISO(f.to, { zone }).endOf("day").toJSDate()));
  if (f.when === "upcoming") conds.push(gte(appointments.startAt, new Date()));
  if (f.when === "past") conds.push(lt(appointments.startAt, new Date()));
  // Abandoned checkouts are noise unless explicitly requested.
  if (!f.status) conds.push(sql`${appointments.status} NOT IN ('expired')`);
  return conds.length ? and(...conds) : undefined;
}

export async function listAppointments(f: AppointmentFilters, zone: string, opts: { limit?: number; offset?: number } = {}) {
  const where = buildWhere(f, zone);
  const order = f.when === "upcoming" ? asc(appointments.startAt) : desc(appointments.startAt);
  const db = getDb();
  const rows = await db
    .select({ a: appointments, c: clients, t: appointmentTypes })
    .from(appointments)
    .innerJoin(clients, eq(clients.id, appointments.clientId))
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
    .where(where)
    .orderBy(order)
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointments)
    .innerJoin(clients, eq(clients.id, appointments.clientId))
    .where(where);
  return { rows, total: n };
}

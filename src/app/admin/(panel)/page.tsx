import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import Link from "next/link";
import { Badge, Card, PageHeader, PaymentBadge, Stat, StatusBadge } from "@/components/admin/ui";
import { integrationStatus } from "@/lib/admin/integration-status";
import { formatPrice } from "@/lib/content";
import { getDb } from "@/lib/db";
import { appointments, appointmentTypes, auditLogs, clients } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings";

const PERIODS = { "7": 7, "30": 30, "90": 90, "365": 365 } as const;

export default async function Overview({ searchParams }: { searchParams: Promise<{ period?: string; error?: string }> }) {
  const sp = await searchParams;
  const days = PERIODS[(sp.period ?? "30") as keyof typeof PERIODS] ?? 30;
  const db = getDb();
  const { timeZone } = await getSetting("booking");
  const now = DateTime.now().setZone(timeZone);
  const since = now.minus({ days }).toJSDate();
  const dayStart = now.startOf("day").toJSDate();
  const dayEnd = now.endOf("day").toJSDate();

  const base = () => db
    .select({ a: appointments, c: clients, t: appointmentTypes })
    .from(appointments)
    .innerJoin(clients, eq(clients.id, appointments.clientId))
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId));

  const [today, upcoming, attention, stats, revenue, recent, integrations] = await Promise.all([
    base().where(and(gte(appointments.startAt, dayStart), lt(appointments.startAt, dayEnd), inArray(appointments.status, ["confirmed", "completed", "no_show"]))).orderBy(appointments.startAt),
    base().where(and(gte(appointments.startAt, new Date()), eq(appointments.status, "confirmed"))).orderBy(appointments.startAt).limit(8),
    base()
      .where(sql`${appointments.status} = 'needs_attention' OR (${appointments.calendarSyncStatus} = 'failed' AND ${appointments.status} = 'confirmed') OR ${appointments.paymentStatus} = 'refund_pending'`)
      .orderBy(desc(appointments.updatedAt))
      .limit(10),
    db.execute<{ free: number; paid: number; pending: number; cancelled: number }>(sql`
      SELECT
        count(*) FILTER (WHERE price_cents = 0 AND status IN ('confirmed','completed','no_show'))::int AS free,
        count(*) FILTER (WHERE price_cents > 0 AND status IN ('confirmed','completed','no_show'))::int AS paid,
        count(*) FILTER (WHERE status = 'pending_payment' AND hold_expires_at > now())::int AS pending,
        count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
      FROM appointments WHERE created_at >= ${since.toISOString()}::timestamptz`),
    db.execute<{ gross: number; refunded: number }>(sql`
      SELECT coalesce(sum(amount_cents),0)::int AS gross, coalesce(sum(refunded_cents),0)::int AS refunded
      FROM payments WHERE status = 'paid' AND created_at >= ${since.toISOString()}::timestamptz`),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(10),
    integrationStatus(),
  ]);
  const st = stats.rows[0];
  const rev = revenue.rows[0];
  const problems = integrations.filter((i) => !i.ok);
  const time = (d: Date) => DateTime.fromJSDate(d, { zone: timeZone }).toFormat("HH:mm");
  const date = (d: Date) => DateTime.fromJSDate(d, { zone: timeZone }).toFormat("ccc d LLL, HH:mm");

  return (
    <div>
      <PageHeader
        title={`Good ${now.hour < 12 ? "morning" : now.hour < 18 ? "afternoon" : "evening"}.`}
        description={`${now.toFormat("cccc d LLLL yyyy")} · ${timeZone}`}
        actions={
          <div className="flex rounded-md border border-line bg-white text-sm">
            {Object.keys(PERIODS).map((p) => (
              <Link key={p} href={`/admin?period=${p}`} className={`px-3 py-1.5 ${String(days) === p ? "bg-ink text-paper" : "hover:bg-ink/[0.05]"}`}>
                {p === "365" ? "1y" : `${p}d`}
              </Link>
            ))}
          </div>
        }
      />
      {sp.error === "forbidden" && <p className="mb-6 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">That area is only available to the owner account.</p>}

      {problems.length > 0 && (
        <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-5">
          <p className="font-medium text-amber-950">Setup needs attention</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-950">
            {problems.map((p) => (
              <li key={p.key}>
                <strong>{p.label}:</strong> {p.status}. {p.detail}
              </li>
            ))}
          </ul>
          <Link href="/admin/settings#integrations" className="mt-3 inline-block text-sm font-medium underline">Open integration settings →</Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Free enquiries" value={st.free} hint={`booked, last ${days} days`} href="/admin/appointments?type=free" />
        <Stat label="Paid consultations" value={st.paid} hint={`booked, last ${days} days`} href="/admin/appointments?type=paid" />
        <Stat label="Revenue" value={formatPrice(rev.gross - rev.refunded, "EUR").replace("Free", "€0")} hint={rev.refunded ? `${formatPrice(rev.refunded)} refunded` : "net of refunds"} />
        <Stat label="Pending payments" value={st.pending} hint="slots on hold now" href="/admin/appointments?status=pending_payment" />
        <Stat label="Cancellations" value={st.cancelled} hint={`last ${days} days`} href="/admin/appointments?status=cancelled" />
      </div>

      {attention.length > 0 && (
        <Card title="Needs your attention" className="mt-8 border-danger/40">
          <ul className="divide-y divide-line">
            {attention.map(({ a, c }) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/admin/appointments/${a.id}`} className="font-medium hover:underline">{c.name}</Link>{" "}
                  <span className="text-sm text-muted">· {a.reference} · {date(a.startAt)}</span>
                  <p className="text-sm text-danger">
                    {a.status === "needs_attention" ? a.attentionReason : a.paymentStatus === "refund_pending" ? "Refund pending confirmation from provider" : `Calendar sync failed: ${a.calendarSyncError ?? ""}`}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Card title="Today">
          {today.length === 0 ? (
            <p className="text-sm text-muted">No appointments today.</p>
          ) : (
            <ul className="divide-y divide-line">
              {today.map(({ a, c, t }) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-baseline gap-4">
                    <span className="font-mono text-sm">{time(a.startAt)}</span>
                    <Link href={`/admin/appointments/${a.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <span className="text-sm text-muted">{t.shortName}</span>
                  </div>
                  <div className="flex gap-2">
                    {a.meetingLink && <a href={a.meetingLink} target="_blank" rel="noreferrer" className="text-sm text-accent underline">Join</a>}
                    <StatusBadge status={a.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Upcoming">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">No upcoming appointments.</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map(({ a, c, t }) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <Link href={`/admin/appointments/${a.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <p className="text-sm text-muted">{date(a.startAt)} · {t.shortName}</p>
                  </div>
                  <div className="flex gap-2">
                    <PaymentBadge status={a.paymentStatus} />
                    {a.calendarSyncStatus === "failed" && <Badge tone="red">Sync failed</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/appointments" className="mt-4 inline-block text-sm font-medium underline">All appointments →</Link>
        </Card>
      </div>

      <Card title="Recent activity" className="mt-8">
        <ul className="divide-y divide-line text-sm">
          {recent.map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2.5">
              <span>
                <span className="font-mono text-xs text-muted">{r.actor}</span> {r.action.replace(/[._]/g, " ")}
                {r.entityType === "appointment" && r.entityId && (
                  <Link href={`/admin/appointments/${r.entityId}`} className="ml-2 text-accent underline">view</Link>
                )}
              </span>
              <span className="text-muted">{DateTime.fromJSDate(r.createdAt, { zone: timeZone }).toRelative()}</span>
            </li>
          ))}
        </ul>
        <Link href="/admin/activity" className="mt-4 inline-block text-sm font-medium underline">Full activity log →</Link>
      </Card>
    </div>
  );
}

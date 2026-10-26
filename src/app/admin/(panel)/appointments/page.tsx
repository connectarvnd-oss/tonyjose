import { DateTime } from "luxon";
import Link from "next/link";
import { Badge, btnSecondaryCls, inputCls, labelCls, PageHeader, PaymentBadge, StatusBadge } from "@/components/admin/ui";
import { listAppointments, type AppointmentFilters } from "@/lib/admin/appointments";
import { getAppointmentTypes, formatPrice } from "@/lib/content";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Appointments" };

const STATUSES = ["confirmed", "pending_payment", "completed", "no_show", "cancelled", "needs_attention", "payment_failed", "expired"];
const PAYMENTS = ["not_required", "pending", "paid", "failed", "expired", "refund_pending", "refunded", "partially_refunded"];

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<AppointmentFilters> }) {
  const f = await searchParams;
  const { timeZone } = await getSetting("booking");
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const [{ rows, total }, types] = await Promise.all([listAppointments(f, timeZone, { limit: 50, offset: (page - 1) * 50 }), getAppointmentTypes(true)]);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(f as Record<string, string>), ...extra }).toString();

  return (
    <div>
      <PageHeader
        title="Appointments"
        description={`${total} matching ${total === 1 ? "booking" : "bookings"} · times shown in ${timeZone}`}
        actions={
          <a href={`/admin/export?${qs({})}`} className={btnSecondaryCls}>
            Export CSV
          </a>
        }
      />

      <form className="mb-6 grid gap-3 rounded-lg border border-line bg-white/50 p-4 sm:grid-cols-2 lg:grid-cols-7" role="search">
        <label className="lg:col-span-2">
          <span className={labelCls}>Search</span>
          <input name="q" defaultValue={f.q} placeholder="Name, email or reference" className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>Type</span>
          <select name="type" defaultValue={f.type ?? ""} className={inputCls}>
            <option value="">All</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>Status</span>
          <select name="status" defaultValue={f.status ?? ""} className={inputCls}>
            <option value="">Any (excl. expired)</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label>
          <span className={labelCls}>Payment</span>
          <select name="payment" defaultValue={f.payment ?? ""} className={inputCls}>
            <option value="">Any</option>
            {PAYMENTS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label>
          <span className={labelCls}>From</span>
          <input type="date" name="from" defaultValue={f.from} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>To</span>
          <input type="date" name="to" defaultValue={f.to} className={inputCls} />
        </label>
        <div className="flex items-end gap-2 lg:col-span-7">
          <select name="when" defaultValue={f.when ?? ""} className={`${inputCls} w-auto`} aria-label="When">
            <option value="">All dates</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
          </select>
          <button className="rounded-md bg-ink px-4 py-2 text-sm text-paper">Apply</button>
          <Link href="/admin/appointments" className="px-2 py-2 text-sm text-muted hover:text-ink">Reset</Link>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-white/50">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium">Ref</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No appointments match these filters.</td></tr>
            )}
            {rows.map(({ a, c, t }) => (
              <tr key={a.id} className="hover:bg-ink/[0.02]">
                <td className="whitespace-nowrap px-4 py-3">
                  <Link href={`/admin/appointments/${a.id}`} className="font-medium hover:underline">
                    {DateTime.fromJSDate(a.startAt, { zone: timeZone }).toFormat("ccc d LLL yyyy, HH:mm")}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/appointments/${a.id}`} className="hover:underline">{c.name}</Link>
                  <p className="text-xs text-muted">{c.email}</p>
                </td>
                <td className="px-4 py-3">
                  {t.shortName}
                  <p className="text-xs text-muted">{formatPrice(a.priceCents, a.currency)}</p>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.status} />
                  {a.calendarSyncStatus === "failed" && <span className="ml-1"><Badge tone="red">Sync</Badge></span>}
                </td>
                <td className="px-4 py-3"><PaymentBadge status={a.paymentStatus} /></td>
                <td className="px-4 py-3 font-mono text-xs">{a.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > 50 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted">Page {page} of {Math.ceil(total / 50)}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className={btnSecondaryCls} href={`?${qs({ page: String(page - 1) })}`}>Previous</Link>}
            {page * 50 < total && <Link className={btnSecondaryCls} href={`?${qs({ page: String(page + 1) })}`}>Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

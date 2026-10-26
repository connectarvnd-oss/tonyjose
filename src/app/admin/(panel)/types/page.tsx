import { SubmitButton } from "@/components/admin/SubmitButton";
import { Badge, Card, Flash, inputCls, labelCls, PageHeader } from "@/components/admin/ui";
import { getAppointmentTypes } from "@/lib/content";
import { saveType } from "../content-actions";
import type { AppointmentType } from "@/lib/db/schema";

export const metadata = { title: "Consultations & prices" };

function TypeForm({ t }: { t?: AppointmentType }) {
  return (
    <form action={saveType.bind(null, t?.id ?? null)} className="grid gap-3 sm:grid-cols-6">
      <label className="sm:col-span-3"><span className={labelCls}>Name</span><input name="name" required defaultValue={t?.name} className={inputCls} /></label>
      <label className="sm:col-span-2"><span className={labelCls}>Short name (calendar)</span><input name="shortName" required defaultValue={t?.shortName} className={inputCls} /></label>
      <label><span className={labelCls}>URL slug</span><input name="slug" required pattern="[a-z0-9-]+" defaultValue={t?.slug} className={inputCls} /></label>
      <label className="sm:col-span-6"><span className={labelCls}>Description</span><textarea name="description" rows={2} defaultValue={t?.description} className={inputCls} /></label>
      <label><span className={labelCls}>Duration (min)</span><input name="durationMinutes" type="number" min={5} max={480} required defaultValue={t?.durationMinutes ?? 60} className={inputCls} /></label>
      <label><span className={labelCls}>Price (€, 0 = free)</span><input name="price" type="number" min={0} step="0.01" required defaultValue={t ? (t.priceCents / 100).toFixed(2) : "28.00"} className={inputCls} /></label>
      <label><span className={labelCls}>Buffer (min)</span><input name="bufferMinutes" type="number" min={0} placeholder="default" defaultValue={t?.bufferMinutes ?? ""} className={inputCls} /></label>
      <label><span className={labelCls}>Calendar label</span><input name="calendarLabel" defaultValue={t?.calendarLabel} placeholder="Free / Paid" className={inputCls} /></label>
      <label className="sm:col-span-1"><span className={labelCls}>Button text</span><input name="ctaLabel" defaultValue={t?.ctaLabel ?? "Book"} className={inputCls} /></label>
      <label><span className={labelCls}>Order</span><input name="sortOrder" type="number" defaultValue={t?.sortOrder ?? 10} className={inputCls} /></label>
      <div className="flex flex-wrap items-center gap-5 text-sm sm:col-span-6">
        <label className="flex gap-2"><input type="checkbox" name="isActive" defaultChecked={t?.isActive ?? true} /> Bookable</label>
        <label className="flex gap-2"><input type="checkbox" name="onePerClient" defaultChecked={t?.onePerClient ?? false} /> Limit to one per client (by email)</label>
        <SubmitButton>{t ? "Save" : "Add consultation type"}</SubmitButton>
      </div>
    </form>
  );
}

export default async function TypesPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const [types, sp] = await Promise.all([getAppointmentTypes(true), searchParams]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Consultations & prices" description="Durations, prices and booking rules per consultation type. Changes apply immediately to new bookings." />
      <Flash message={sp.ok} />
      <div className="space-y-6">
        {types.map((t) => (
          <Card key={t.id} title={t.name} description={`${t.durationMinutes} min · ${t.priceCents ? `€${(t.priceCents / 100).toFixed(2)}` : "Free"}`}>
            <div className="mb-4 flex gap-2">{t.isActive ? <Badge tone="green">Bookable</Badge> : <Badge>Hidden</Badge>}{t.priceCents > 0 && <Badge tone="blue">Paid at booking</Badge>}</div>
            <TypeForm t={t} />
          </Card>
        ))}
        <Card title="Add a consultation type" description="For example a 90-minute session. Paid types are charged in full at booking.">
          <TypeForm />
        </Card>
      </div>
    </div>
  );
}

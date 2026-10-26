import { desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { Badge, btnDangerCls, btnSecondaryCls, Card, Flash, inputCls, labelCls, PageHeader, StatusBadge } from "@/components/admin/ui";
import { anonymiseClient, findClientData } from "@/lib/admin/privacy";
import { requireAdmin } from "@/lib/auth/admin";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { dataRequests } from "@/lib/db/schema";

export const metadata = { title: "Privacy requests" };

async function logRequest(fd: FormData) {
  "use server";
  const admin = await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const type = String(fd.get("type")) as "access" | "deletion" | "correction";
  if (!email || !["access", "deletion", "correction"].includes(type)) return;
  await getDb().insert(dataRequests).values({ email, type, notes: String(fd.get("notes") ?? "") || null });
  await audit({ actor: "admin", adminId: admin.id, action: "privacy.request_logged", details: { type } });
  redirect(`/admin/privacy?email=${encodeURIComponent(email)}`);
}

async function completeRequest(id: string) {
  "use server";
  const admin = await requireAdmin();
  await getDb().update(dataRequests).set({ status: "completed", completedAt: new Date() }).where(eq(dataRequests.id, id));
  await audit({ actor: "admin", adminId: admin.id, action: "privacy.request_completed", entityId: id });
  revalidatePath("/admin/privacy");
}

async function erase(email: string) {
  "use server";
  const admin = await requireAdmin("owner");
  const n = await anonymiseClient(email);
  await audit({ actor: "admin", adminId: admin.id, action: "privacy.client_anonymised", details: { records: n } });
  redirect(`/admin/privacy?ok=${encodeURIComponent(`Personal data anonymised (${n} client record(s)). Booking and payment records were kept without personal details.`)}`);
}

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ email?: string; ok?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const email = sp.email?.trim();
  const [data, requests] = await Promise.all([email ? findClientData(email) : null, getDb().select().from(dataRequests).orderBy(desc(dataRequests.createdAt)).limit(30)]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Privacy requests" description="Handle GDPR access, correction and deletion requests. Log each request, act on it, then mark it complete (respond within one month)." />
      <Flash message={sp.ok} />
      <div className="space-y-6">
        <Card title="Find a person's data">
          <form className="flex gap-2">
            <input name="email" type="email" required defaultValue={email} placeholder="client@example.com" className={inputCls} aria-label="Email" />
            <button className={btnSecondaryCls}>Search</button>
          </form>
          {email && !data && <p className="mt-4 text-sm text-muted">No records found for {email}.</p>}
          {email && data && (
            <div className="mt-5 space-y-4 text-sm">
              {data.clients.map((c) => (
                <p key={c.id}>{c.name} · {c.email} · {c.phone ?? "no phone"} · {c.country ?? "no country"} · marketing {c.marketingOptIn ? "yes" : "no"}</p>
              ))}
              <ul className="divide-y divide-line">
                {data.appointments.map(({ a, t }) => (
                  <li key={a.id} className="flex justify-between py-2"><Link href={`/admin/appointments/${a.id}`} className="underline">{a.reference} · {t} · {DateTime.fromJSDate(a.startAt).toFormat("d LLL yyyy")}</Link><StatusBadge status={a.status} /></li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <a href={`/admin/privacy-export?email=${encodeURIComponent(email)}`} className={btnSecondaryCls}>Download data export (JSON)</a>
                {admin.role === "owner" && (
                  <form action={erase.bind(null, email)}>
                    <SubmitButton className={btnDangerCls} confirm="Permanently anonymise this person's personal data? This cannot be undone.">Erase personal data</SubmitButton>
                  </form>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card title="Log a request">
          <form action={logRequest} className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <label><span className={labelCls}>Requester email</span><input name="email" type="email" required defaultValue={email} className={inputCls} /></label>
            <label><span className={labelCls}>Type</span><select name="type" className={inputCls}><option value="access">Access</option><option value="deletion">Deletion</option><option value="correction">Correction</option></select></label>
            <label className="sm:col-span-2"><span className={labelCls}>Notes</span><input name="notes" className={inputCls} /></label>
            <div><SubmitButton>Log request</SubmitButton></div>
          </form>
        </Card>

        <Card title="Recent requests">
          {requests.length === 0 ? <p className="text-sm text-muted">None.</p> : (
            <ul className="divide-y divide-line text-sm">
              {requests.map((r) => {
                const due = DateTime.fromJSDate(r.createdAt).plus({ months: 1 });
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><Link className="underline" href={`/admin/privacy?email=${encodeURIComponent(r.email)}`}>{r.email}</Link> · {r.type} · {DateTime.fromJSDate(r.createdAt).toFormat("d LLL yyyy")}{r.notes ? ` · ${r.notes}` : ""}</span>
                    <span className="flex items-center gap-2">
                      {r.status === "open" ? <Badge tone={due < DateTime.now().plus({ days: 7 }) ? "red" : "amber"}>due {due.toFormat("d LLL")}</Badge> : <Badge tone="green">completed</Badge>}
                      {r.status === "open" && <form action={completeRequest.bind(null, r.id)}><SubmitButton className="text-xs underline">Mark complete</SubmitButton></form>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

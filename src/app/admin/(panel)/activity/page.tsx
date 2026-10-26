import { desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import Link from "next/link";
import { btnSecondaryCls, PageHeader } from "@/components/admin/ui";
import { getDb } from "@/lib/db";
import { adminUsers, auditLogs } from "@/lib/db/schema";

export const metadata = { title: "Activity log" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page ?? 1) || 1);
  const rows = await getDb()
    .select({ l: auditLogs, by: adminUsers.name })
    .from(auditLogs)
    .leftJoin(adminUsers, eq(adminUsers.id, auditLogs.adminId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100)
    .offset((page - 1) * 100);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Activity log" description="Every booking change, admin action, sign-in and payment event." />
      <div className="overflow-x-auto rounded-lg border border-line bg-white/50">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
            <tr><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">Who</th><th className="px-4 py-2 font-medium">Action</th><th className="px-4 py-2 font-medium">Record</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ l, by }) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap px-4 py-2 text-muted">{DateTime.fromJSDate(l.createdAt).toFormat("d LLL yyyy HH:mm:ss")}</td>
                <td className="px-4 py-2">{by ?? l.actor}</td>
                <td className="px-4 py-2">{l.action}</td>
                <td className="px-4 py-2">{l.entityType === "appointment" && l.entityId ? <Link className="underline" href={`/admin/appointments/${l.entityId}`}>appointment</Link> : (l.entityType ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex gap-2">
        {page > 1 && <Link className={btnSecondaryCls} href={`?page=${page - 1}`}>Newer</Link>}
        {rows.length === 100 && <Link className={btnSecondaryCls} href={`?page=${page + 1}`}>Older</Link>}
      </div>
    </div>
  );
}

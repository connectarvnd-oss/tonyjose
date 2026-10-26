import Link from "next/link";
import { SubmitButton } from "@/components/admin/SubmitButton";
import { Card, Flash, inputCls, labelCls, PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { getLegalPage } from "@/lib/content";
import { legalSlugs } from "@/lib/content-defaults";
import { saveLegalPage } from "../content-actions";

export const metadata = { title: "Legal pages" };

export default async function PagesPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const pages = await Promise.all(legalSlugs.map(async (s) => ({ slug: s, page: (await getLegalPage(s))! })));
  return (
    <div className="max-w-4xl">
      <PageHeader title="Legal pages" description="Written in Markdown. Text in [square brackets] is a placeholder that must be completed with Tony's real details — and reviewed by a legal adviser — before launch." />
      <Flash message={sp.ok} />
      <div className="space-y-6">
        {pages.map(({ slug, page }) => {
          const placeholders = (page.bodyMd.match(/\[[^\]]+\]/g) ?? []).length;
          return (
            <Card key={slug} id={slug} title={page.title} description={placeholders ? `${placeholders} placeholder(s) still to complete` : "No placeholders remaining"}>
              <form action={saveLegalPage.bind(null, slug)} className="space-y-3">
                <label className="block"><span className={labelCls}>Title</span><input name="title" defaultValue={page.title} className={inputCls} disabled={admin.role !== "owner"} /></label>
                <label className="block"><span className={labelCls}>Content (Markdown)</span><textarea name="bodyMd" rows={14} defaultValue={page.bodyMd} className={`${inputCls} font-mono text-xs`} disabled={admin.role !== "owner"} /></label>
                <div className="flex items-center gap-4">
                  {admin.role === "owner" && <SubmitButton>Save</SubmitButton>}
                  <Link href={`/legal/${slug}`} target="_blank" className="text-sm text-muted underline">View page ↗</Link>
                </div>
              </form>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

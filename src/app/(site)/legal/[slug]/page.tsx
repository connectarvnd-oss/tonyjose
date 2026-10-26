import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLegalPage } from "@/lib/content";
import { legalSlugs } from "@/lib/content-defaults";
import { renderMarkdown } from "@/lib/markdown";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getLegalPage(slug);
  if (!page) return {};
  return { title: page.title, alternates: { canonical: `/legal/${slug}` } };
}

export default async function LegalPage({ params }: Props) {
  const { slug } = await params;
  if (!legalSlugs.includes(slug)) notFound();
  const page = await getLegalPage(slug);
  if (!page) notFound();
  return (
    <article className="page-x mx-auto max-w-page py-16 md:py-24">
      <div className="grid gap-10 md:grid-cols-12">
        <div className="md:col-span-4">
          <p className="eyebrow">Legal</p>
          {page.updatedAt && (
            <p className="mt-3 text-sm text-muted">
              Last updated {page.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
        </div>
        <div className="md:col-span-8">
          <h1 className="font-display text-display-md">{page.title}</h1>
          <div className="prose-legal mt-10 max-w-2xl" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.bodyMd) }} />
        </div>
      </div>
    </article>
  );
}

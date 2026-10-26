import { SubmitButton } from "@/components/admin/SubmitButton";
import { Card, Flash, inputCls, labelCls, PageHeader } from "@/components/admin/ui";
import { getContent, getFaqs, getServices } from "@/lib/content";
import { defaultContent, type SiteContentKey } from "@/lib/content-defaults";
import { getDb } from "@/lib/db";
import { testimonials as testimonialsTable } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { deleteFaq, deleteService, deleteTestimonial, saveFaq, saveSection, saveService, saveTestimonial } from "../content-actions";

export const metadata = { title: "Website content" };

const SECTION_LABELS: Record<SiteContentKey, string> = {
  brand: "Name & description",
  hero: "Hero",
  intro: "Introduction",
  howItWorks: "How it works",
  experience: "Experience",
  pricing: "Pricing section",
  faq: "FAQ heading",
  finalCta: "Closing call to action",
  contact: "Contact details",
  disclaimer: "Disclaimer",
  seo: "Search engines (title & description)",
};

const human = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function SectionForm({ k, value }: { k: SiteContentKey; value: Record<string, unknown> }) {
  const defaults = defaultContent[k] as Record<string, unknown>;
  return (
    <form action={saveSection.bind(null, k)} className="space-y-3">
      {Object.entries(defaults).map(([field, def]) => {
        const v = value[field];
        if (typeof def === "string") {
          const long = def.length > 90;
          return (
            <label key={field} className="block">
              <span className={labelCls}>{human(field)}</span>
              {long ? <textarea name={field} rows={3} defaultValue={String(v ?? "")} className={inputCls} /> : <input name={field} defaultValue={String(v ?? "")} className={inputCls} />}
              {k === "hero" && field === "emphasis" && <span className="mt-1 block text-xs text-muted">The end of the headline to show in italic accent colour.</span>}
            </label>
          );
        }
        if (Array.isArray(def) && def.every((x) => typeof x === "string")) {
          const arr = (Array.isArray(v) ? v : def) as string[];
          const isAddress = k === "contact";
          return (
            <label key={field} className="block">
              <span className={labelCls}>{human(field)} {isAddress ? "(one line each)" : "(blank line between paragraphs)"}</span>
              <textarea name={field} rows={isAddress ? 3 : 6} defaultValue={arr.join(isAddress ? "\n" : "\n\n")} className={inputCls} />
            </label>
          );
        }
        const items = (Array.isArray(v) ? v : def) as { title: string; body: string }[];
        return (
          <fieldset key={field} className="space-y-2">
            <legend className={labelCls}>{human(field)}</legend>
            {[...items, { title: "", body: "" }].slice(0, 6).map((it, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[14rem_1fr]">
                <input name={`${field}.${i}.title`} defaultValue={it.title} placeholder="Title" className={inputCls} />
                <input name={`${field}.${i}.body`} defaultValue={it.body} placeholder="Text" className={inputCls} />
              </div>
            ))}
            <p className="text-xs text-muted">Clear both fields to remove an item.</p>
          </fieldset>
        );
      })}
      <SubmitButton>Save</SubmitButton>
    </form>
  );
}

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const [content, services, faqs, testimonials, sp] = await Promise.all([
    getContent(),
    getServices(true),
    getFaqs(true),
    getDb().select().from(testimonialsTable).orderBy(asc(testimonialsTable.sortOrder)),
    searchParams,
  ]);
  const keys = Object.keys(defaultContent) as SiteContentKey[];
  return (
    <div className="max-w-4xl">
      <PageHeader title="Website content" description="Edit the text on the public website. Changes are live as soon as you save." />
      <Flash message={sp.ok} />
      <nav className="mb-6 flex flex-wrap gap-2 text-sm">
        {["services", "faqs", "testimonials", ...keys].map((k) => (
          <a key={k} href={`#${k}`} className="rounded-md border border-line bg-white px-2.5 py-1 hover:border-ink">{SECTION_LABELS[k as SiteContentKey] ?? human(k)}</a>
        ))}
      </nav>
      <div className="space-y-6">
        <Card id="services" title="Services" description="Shown as the numbered list on the homepage. Don't add country-specific expertise, qualifications or registrations unless verified.">
          <div className="space-y-6">
            {services.map((s) => (
              <form key={s.id} action={saveService.bind(null, s.id)} className="grid gap-2 border-b border-line pb-6 sm:grid-cols-[1fr_6rem]">
                <input name="title" defaultValue={s.title} className={inputCls} aria-label="Title" />
                <input name="sortOrder" type="number" defaultValue={s.sortOrder} className={inputCls} aria-label="Order" />
                <textarea name="description" rows={2} defaultValue={s.description} className={`${inputCls} sm:col-span-2`} aria-label="Description" />
                <div className="flex items-center gap-4 text-sm sm:col-span-2">
                  <label className="flex gap-2"><input type="checkbox" name="isActive" defaultChecked={s.isActive} /> Visible</label>
                  <SubmitButton>Save</SubmitButton>
                  <button formAction={deleteService.bind(null, s.id)} className="text-sm text-danger underline">Delete</button>
                </div>
              </form>
            ))}
            <form action={saveService.bind(null, null)} className="grid gap-2 sm:grid-cols-[1fr_6rem]">
              <input name="title" placeholder="New service title" className={inputCls} />
              <input name="sortOrder" type="number" defaultValue={services.length + 1} className={inputCls} aria-label="Order" />
              <textarea name="description" rows={2} placeholder="Description" className={`${inputCls} sm:col-span-2`} />
              <input type="hidden" name="isActive" value="on" />
              <div><SubmitButton>Add service</SubmitButton></div>
            </form>
          </div>
        </Card>

        <Card id="faqs" title="Frequently asked questions">
          <div className="space-y-6">
            {faqs.map((f) => (
              <form key={f.id} action={saveFaq.bind(null, f.id)} className="grid gap-2 border-b border-line pb-6 sm:grid-cols-[1fr_6rem]">
                <input name="question" defaultValue={f.question} className={inputCls} aria-label="Question" />
                <input name="sortOrder" type="number" defaultValue={f.sortOrder} className={inputCls} aria-label="Order" />
                <textarea name="answer" rows={3} defaultValue={f.answer} className={`${inputCls} sm:col-span-2`} aria-label="Answer" />
                <div className="flex items-center gap-4 text-sm sm:col-span-2">
                  <label className="flex gap-2"><input type="checkbox" name="isActive" defaultChecked={f.isActive} /> Visible</label>
                  <SubmitButton>Save</SubmitButton>
                  <button formAction={deleteFaq.bind(null, f.id)} className="text-sm text-danger underline">Delete</button>
                </div>
              </form>
            ))}
            <form action={saveFaq.bind(null, null)} className="grid gap-2">
              <input name="question" placeholder="New question" className={inputCls} />
              <textarea name="answer" rows={3} placeholder="Answer" className={inputCls} />
              <input type="hidden" name="isActive" value="on" />
              <input type="hidden" name="sortOrder" value={faqs.length + 1} />
              <div><SubmitButton>Add FAQ</SubmitButton></div>
            </form>
          </div>
        </Card>

        <Card id="testimonials" title="Testimonials" description="None are shown until you add real ones. Only publish with the client's documented permission.">
          <div className="space-y-6">
            {testimonials.map((t) => (
              <form key={t.id} action={saveTestimonial.bind(null, t.id)} className="grid gap-2 border-b border-line pb-6 sm:grid-cols-2">
                <textarea name="quote" rows={3} defaultValue={t.quote} className={`${inputCls} sm:col-span-2`} aria-label="Quote" />
                <input name="author" defaultValue={t.author} className={inputCls} aria-label="Author" />
                <input name="context" defaultValue={t.context ?? ""} placeholder="Context, e.g. Study abroad, 2025" className={inputCls} />
                <input type="hidden" name="sortOrder" value={t.sortOrder} />
                <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
                  <label className="flex gap-2"><input type="checkbox" name="consentConfirmed" defaultChecked={t.consentConfirmed} /> Client gave written consent</label>
                  <label className="flex gap-2"><input type="checkbox" name="isPublished" defaultChecked={t.isPublished} /> Published</label>
                  <SubmitButton>Save</SubmitButton>
                  <button formAction={deleteTestimonial.bind(null, t.id)} className="text-sm text-danger underline">Delete</button>
                </div>
              </form>
            ))}
            <form action={saveTestimonial.bind(null, null)} className="grid gap-2 sm:grid-cols-2">
              <textarea name="quote" rows={3} placeholder="Quote" className={`${inputCls} sm:col-span-2`} />
              <input name="author" placeholder="Author (as they agreed to be named)" className={inputCls} />
              <input name="context" placeholder="Context (optional)" className={inputCls} />
              <input type="hidden" name="sortOrder" value={testimonials.length + 1} />
              <label className="flex gap-2 text-sm sm:col-span-2"><input type="checkbox" name="consentConfirmed" /> Client gave written consent</label>
              <div><SubmitButton>Add testimonial (unpublished)</SubmitButton></div>
            </form>
          </div>
        </Card>

        {keys.map((k) => (
          <Card key={k} id={k} title={SECTION_LABELS[k]}>
            <SectionForm k={k} value={content[k] as Record<string, unknown>} />
          </Card>
        ))}
      </div>
    </div>
  );
}

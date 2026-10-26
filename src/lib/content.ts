import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { appointmentTypes, faqs, legalPages, services, siteContent, testimonials } from "./db/schema";
import { defaultContent, defaultLegalPages, type SiteContent, type SiteContentKey } from "./content-defaults";

function mergeSection<T>(fallback: T, stored: unknown): T {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return fallback;
  const out: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (k in out && v !== undefined && v !== null) out[k] = v;
  }
  return out as T;
}

export async function getContent(): Promise<SiteContent> {
  const rows = await getDb().select().from(siteContent);
  const out = { ...defaultContent } as Record<SiteContentKey, unknown>;
  for (const row of rows) {
    const key = row.key as SiteContentKey;
    if (key in defaultContent) out[key] = mergeSection(defaultContent[key], row.value);
  }
  return out as SiteContent;
}

export async function saveContentSection<K extends SiteContentKey>(key: K, value: SiteContent[K]) {
  await getDb()
    .insert(siteContent)
    .values({ key, value })
    .onConflictDoUpdate({ target: siteContent.key, set: { value, updatedAt: new Date() } });
}

export async function getServices(includeInactive = false) {
  const db = getDb();
  const q = db.select().from(services).orderBy(asc(services.sortOrder), asc(services.title));
  return includeInactive ? q : q.where(eq(services.isActive, true));
}

export async function getFaqs(includeInactive = false) {
  const db = getDb();
  const q = db.select().from(faqs).orderBy(asc(faqs.sortOrder));
  return includeInactive ? q : q.where(eq(faqs.isActive, true));
}

export async function getPublishedTestimonials() {
  return getDb()
    .select()
    .from(testimonials)
    .where(and(eq(testimonials.isPublished, true), eq(testimonials.consentConfirmed, true)))
    .orderBy(asc(testimonials.sortOrder));
}

export async function getAppointmentTypes(includeInactive = false) {
  const db = getDb();
  const q = db.select().from(appointmentTypes).orderBy(asc(appointmentTypes.sortOrder));
  return includeInactive ? q : q.where(eq(appointmentTypes.isActive, true));
}

export async function getLegalPage(slug: string) {
  const [row] = await getDb().select().from(legalPages).where(eq(legalPages.slug, slug));
  if (row) return row;
  const d = defaultLegalPages.find((p) => p.slug === slug);
  return d ? { ...d, updatedAt: null as Date | null } : null;
}

export function formatPrice(cents: number, currency = "EUR", locale = "en-IE") {
  if (cents === 0) return "Free";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

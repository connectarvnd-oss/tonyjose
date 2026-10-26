"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { audit } from "@/lib/audit";
import { saveContentSection } from "@/lib/content";
import { defaultContent, legalSlugs, type SiteContentKey } from "@/lib/content-defaults";
import { getDb } from "@/lib/db";
import { appointmentTypes, faqs, legalPages, services, testimonials } from "@/lib/db/schema";

function refresh(path: string, msg = "Saved. The website has been updated."): never {
  revalidatePath("/", "layout");
  redirect(`${path}?ok=${encodeURIComponent(msg)}`);
}

const str = (fd: FormData, k: string, max = 5000) => String(fd.get(k) ?? "").trim().slice(0, max);
const lines = (fd: FormData, k: string) => str(fd, k, 10000).split(/\n\s*\n|\r\n\s*\r\n/).map((s) => s.trim()).filter(Boolean);

// ── Site text sections ─────────────────────────────────────────────────────
export async function saveSection(key: SiteContentKey, fd: FormData) {
  const admin = await requireAdmin();
  const d = defaultContent[key] as Record<string, unknown>;
  const value: Record<string, unknown> = {};
  for (const [field, def] of Object.entries(d)) {
    if (typeof def === "string") value[field] = str(fd, field);
    else if (Array.isArray(def) && def.every((x) => typeof x === "string")) value[field] = key === "contact" ? str(fd, field).split("\n").map((s) => s.trim()).filter(Boolean) : lines(fd, field);
    else if (Array.isArray(def)) {
      // arrays of {title, body}
      const items: { title: string; body: string }[] = [];
      for (let i = 0; i < 10; i++) {
        const title = str(fd, `${field}.${i}.title`, 200);
        const body = str(fd, `${field}.${i}.body`, 1000);
        if (title || body) items.push({ title, body });
      }
      value[field] = items;
    }
  }
  await saveContentSection(key, value as never);
  await audit({ actor: "admin", adminId: admin.id, action: "content.updated", entityType: "site_content", entityId: key });
  refresh("/admin/content");
}

// ── Services ───────────────────────────────────────────────────────────────
export async function saveService(id: string | null, fd: FormData) {
  const admin = await requireAdmin();
  const values = { title: str(fd, "title", 120), description: str(fd, "description", 1000), sortOrder: Number(fd.get("sortOrder") ?? 0) || 0, isActive: fd.get("isActive") === "on", updatedAt: new Date() };
  if (!values.title) refresh("/admin/content", "A service needs a title.");
  const db = getDb();
  if (id) await db.update(services).set(values).where(eq(services.id, id));
  else await db.insert(services).values(values);
  await audit({ actor: "admin", adminId: admin.id, action: id ? "service.updated" : "service.created", entityType: "service", entityId: id ?? undefined });
  refresh("/admin/content");
}

export async function deleteService(id: string) {
  const admin = await requireAdmin();
  await getDb().delete(services).where(eq(services.id, id));
  await audit({ actor: "admin", adminId: admin.id, action: "service.deleted", entityType: "service", entityId: id });
  refresh("/admin/content", "Service deleted.");
}

// ── FAQs ───────────────────────────────────────────────────────────────────
export async function saveFaq(id: string | null, fd: FormData) {
  const admin = await requireAdmin();
  const values = { question: str(fd, "question", 300), answer: str(fd, "answer", 3000), sortOrder: Number(fd.get("sortOrder") ?? 0) || 0, isActive: fd.get("isActive") === "on", updatedAt: new Date() };
  if (!values.question || !values.answer) refresh("/admin/content", "Question and answer are required.");
  const db = getDb();
  if (id) await db.update(faqs).set(values).where(eq(faqs.id, id));
  else await db.insert(faqs).values(values);
  await audit({ actor: "admin", adminId: admin.id, action: id ? "faq.updated" : "faq.created", entityType: "faq", entityId: id ?? undefined });
  refresh("/admin/content");
}

export async function deleteFaq(id: string) {
  const admin = await requireAdmin();
  await getDb().delete(faqs).where(eq(faqs.id, id));
  await audit({ actor: "admin", adminId: admin.id, action: "faq.deleted", entityType: "faq", entityId: id });
  refresh("/admin/content", "FAQ deleted.");
}

// ── Testimonials ───────────────────────────────────────────────────────────
export async function saveTestimonial(id: string | null, fd: FormData) {
  const admin = await requireAdmin();
  const consent = fd.get("consentConfirmed") === "on";
  const values = {
    quote: str(fd, "quote", 1500),
    author: str(fd, "author", 120),
    context: str(fd, "context", 200) || null,
    consentConfirmed: consent,
    isPublished: consent && fd.get("isPublished") === "on",
    sortOrder: Number(fd.get("sortOrder") ?? 0) || 0,
    updatedAt: new Date(),
  };
  if (!values.quote || !values.author) refresh("/admin/content", "Quote and author are required.");
  const db = getDb();
  if (id) await db.update(testimonials).set(values).where(eq(testimonials.id, id));
  else await db.insert(testimonials).values(values);
  await audit({ actor: "admin", adminId: admin.id, action: id ? "testimonial.updated" : "testimonial.created", entityType: "testimonial", entityId: id ?? undefined });
  refresh("/admin/content", fd.get("isPublished") === "on" && !consent ? "Saved, but not published: confirm the client's consent first." : undefined);
}

export async function deleteTestimonial(id: string) {
  const admin = await requireAdmin();
  await getDb().delete(testimonials).where(eq(testimonials.id, id));
  await audit({ actor: "admin", adminId: admin.id, action: "testimonial.deleted", entityType: "testimonial", entityId: id });
  refresh("/admin/content", "Testimonial deleted.");
}

// ── Appointment types ──────────────────────────────────────────────────────
const typeSchema = z.object({
  name: z.string().min(2).max(120),
  shortName: z.string().min(2).max(60),
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  description: z.string().max(1000),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  price: z.coerce.number().min(0).max(10000),
  bufferMinutes: z.union([z.literal(""), z.coerce.number().int().min(0).max(240)]),
  calendarLabel: z.string().max(40),
  ctaLabel: z.string().max(60),
  sortOrder: z.coerce.number().int(),
});

export async function saveType(id: string | null, fd: FormData) {
  const admin = await requireAdmin();
  const parsed = typeSchema.safeParse(Object.fromEntries(["name", "shortName", "slug", "description", "durationMinutes", "price", "bufferMinutes", "calendarLabel", "ctaLabel", "sortOrder"].map((k) => [k, str(fd, k)])));
  if (!parsed.success) refresh("/admin/types", `Please check: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  const p = parsed.data;
  const values = {
    name: p.name,
    shortName: p.shortName,
    slug: p.slug,
    description: p.description,
    durationMinutes: p.durationMinutes,
    priceCents: Math.round(p.price * 100),
    bufferMinutes: p.bufferMinutes === "" ? null : p.bufferMinutes,
    calendarLabel: p.calendarLabel,
    ctaLabel: p.ctaLabel,
    sortOrder: p.sortOrder,
    isActive: fd.get("isActive") === "on",
    onePerClient: fd.get("onePerClient") === "on",
    updatedAt: new Date(),
  };
  const db = getDb();
  try {
    if (id) await db.update(appointmentTypes).set(values).where(eq(appointmentTypes.id, id));
    else await db.insert(appointmentTypes).values(values);
  } catch {
    refresh("/admin/types", "That URL slug is already used by another consultation type.");
  }
  await audit({ actor: "admin", adminId: admin.id, action: id ? "appointment_type.updated" : "appointment_type.created", entityType: "appointment_type", entityId: id ?? undefined, details: { priceCents: values.priceCents, durationMinutes: values.durationMinutes } });
  refresh("/admin/types", "Saved. Existing bookings keep the price and duration they were booked with.");
}

// ── Legal pages ────────────────────────────────────────────────────────────
export async function saveLegalPage(slug: string, fd: FormData) {
  const admin = await requireAdmin("owner");
  if (!legalSlugs.includes(slug)) refresh("/admin/pages", "Unknown page.");
  const title = str(fd, "title", 200);
  const bodyMd = str(fd, "bodyMd", 100_000);
  await getDb()
    .insert(legalPages)
    .values({ slug, title, bodyMd })
    .onConflictDoUpdate({ target: legalPages.slug, set: { title, bodyMd, updatedAt: new Date() } });
  await audit({ actor: "admin", adminId: admin.id, action: "legal_page.updated", entityType: "legal_page", entityId: slug });
  refresh(`/admin/pages`, `${title} saved.`);
}

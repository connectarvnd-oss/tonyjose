import Link from "next/link";
import type { SiteContent } from "@/lib/content-defaults";

export function Footer({ content, services }: { content: SiteContent; services: { id: string; title: string }[] }) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-paper">
      <div className="page-x mx-auto grid max-w-page gap-12 py-16 md:grid-cols-12 md:py-20">
        <div className="md:col-span-5">
          <p className="font-display text-4xl leading-none">{content.brand.name}</p>
          <p className="mt-5 max-w-sm text-[0.95rem] leading-relaxed text-muted">{content.brand.shortDescription}</p>
          <Link href="/book" className="btn-primary mt-8">
            Book an appointment <span className="arrow" aria-hidden>→</span>
          </Link>
        </div>

        <nav aria-label="Services" className="md:col-span-3">
          <p className="eyebrow mb-5">Services</p>
          <ul className="space-y-3 text-[0.95rem]">
            {services.map((s) => (
              <li key={s.id}>
                <Link href="/#services" className="link-underline">
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="md:col-span-4">
          <p className="eyebrow mb-5">Contact</p>
          <address className="space-y-2 text-[0.95rem] not-italic">
            {content.contact.email && (
              <p>
                <a href={`mailto:${content.contact.email}`} className="link-underline">
                  {content.contact.email}
                </a>
              </p>
            )}
            {content.contact.phone && (
              <p>
                <a href={`tel:${content.contact.phone.replace(/\s/g, "")}`} className="link-underline">
                  {content.contact.phone}
                </a>
              </p>
            )}
            {content.contact.addressLines.filter(Boolean).map((l) => (
              <p key={l} className="text-muted">
                {l}
              </p>
            ))}
            {content.contact.responseNote && <p className="pt-2 text-sm text-muted">{content.contact.responseNote}</p>}
          </address>
        </div>
      </div>

      <div className="page-x mx-auto max-w-page border-t border-line py-8">
        <p className="max-w-3xl text-[0.8rem] leading-relaxed text-muted">{content.disclaimer.text}</p>
        <div className="mt-6 flex flex-col gap-4 text-[0.82rem] text-muted md:flex-row md:items-center md:justify-between">
          <p>
            © {year} {content.brand.name}
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/legal/privacy" className="link-underline">Privacy Policy</Link>
            <Link href="/legal/impressum" className="link-underline">Legal Notice / Impressum</Link>
            <Link href="/legal/terms" className="link-underline">Terms of Service</Link>
            <Link href="/legal/cancellation" className="link-underline">Cancellation &amp; Refunds</Link>
            <Link href="/legal/cookies" className="link-underline">Cookies</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { LocalClock } from "@/components/site/LocalClock";
import { formatPrice, getAppointmentTypes, getContent, getFaqs, getPublishedTestimonials, getServices } from "@/lib/content";
import { getSetting } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getContent();
  return {
    title: { absolute: c.seo.title },
    description: c.seo.description,
    alternates: { canonical: "/" },
    openGraph: { title: c.seo.title, description: c.seo.description, url: "/" },
  };
}

function Arrow() {
  return (
    <span className="arrow" aria-hidden>
      →
    </span>
  );
}

function SectionLabel({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <p className="eyebrow flex items-center gap-3">
      <span className="text-accent">({index})</span>
      {children}
    </p>
  );
}

export default async function HomePage() {
  const [c, services, faqs, types, testimonials, booking] = await Promise.all([
    getContent(),
    getServices(),
    getFaqs(),
    getAppointmentTypes(),
    getPublishedTestimonials(),
    getSetting("booking"),
  ]);
  const free = types.find((t) => t.priceCents === 0);
  const paid = types.filter((t) => t.priceCents > 0);
  const headline = c.hero.headline;
  const emphasis = c.hero.emphasis && headline.endsWith(c.hero.emphasis) ? c.hero.emphasis : "";
  const lead = emphasis ? headline.slice(0, headline.length - emphasis.length) : headline;
  const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "ProfessionalService",
      name: c.brand.name,
      url: siteUrl,
      description: c.brand.shortDescription,
      founder: { "@type": "Person", name: c.brand.name, jobTitle: "Visa consultant" },
      makesOffer: types.map((t) => ({
        "@type": "Offer",
        name: t.name,
        price: (t.priceCents / 100).toFixed(2),
        priceCurrency: t.currency,
        url: `${siteUrl}/book?type=${t.slug}`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="hero-title" className="page-x mx-auto max-w-page">
        <div className="flex min-h-[calc(100svh-5rem)] flex-col justify-between pb-10 pt-10 sm:pt-16">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <p className="eyebrow animate-fade text-ink">{c.hero.eyebrow}</p>
            <div className="animate-fade sm:text-right">
              <LocalClock zone={booking.timeZone} />
            </div>
          </div>

          <div className="reveal py-12">
            <h1 id="hero-title" className="max-w-[14ch] font-display text-display-xl text-ink">
              {lead}
              {emphasis && <em className="text-accent">{emphasis}</em>}
            </h1>
            <div className="mt-10 grid gap-8 md:mt-14 md:grid-cols-12">
              <p className="text-lg leading-relaxed text-charcoal md:col-span-5 md:col-start-7 md:text-xl">{c.hero.supporting}</p>
              <div className="flex flex-col gap-3 sm:flex-row md:col-span-6 md:col-start-7">
                <Link href="/book" className="btn-primary">
                  {c.hero.primaryCta} <Arrow />
                </Link>
                <Link href="#services" className="btn-secondary">
                  {c.hero.secondaryCta}
                </Link>
              </div>
            </div>
          </div>

          <div className="rule flex flex-wrap items-center justify-between gap-x-8 gap-y-3 pt-5">
            <ul className="eyebrow flex flex-wrap gap-x-6 gap-y-2" aria-label="Areas of guidance">
              {services.map((s) => (
                <li key={s.id}>{s.title}</li>
              ))}
            </ul>
            {free && <p className="eyebrow text-ink">Free {free.durationMinutes}-minute enquiry available</p>}
          </div>
        </div>
      </section>

      {/* ── Introduction ─────────────────────────────────────────────────── */}
      <section aria-labelledby="intro-title" className="page-x mx-auto max-w-page py-24 md:py-36">
        <div className="grid gap-10 md:grid-cols-12" data-reveal>
          <div className="md:col-span-4">
            <SectionLabel index="01">Introduction</SectionLabel>
          </div>
          <div className="md:col-span-8">
            <h2 id="intro-title" className="font-display text-display-md">
              {c.intro.heading}
            </h2>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-charcoal md:text-[1.3rem] md:leading-[1.6]">{c.intro.body}</p>
          </div>
        </div>
      </section>

      {/* ── Services ─────────────────────────────────────────────────────── */}
      <section id="services" aria-labelledby="services-title" className="scroll-mt-20 border-t border-line">
        <div className="page-x mx-auto max-w-page py-24 md:py-32">
          <div className="grid gap-6 md:grid-cols-12" data-reveal>
            <div className="md:col-span-4">
              <SectionLabel index="02">Services</SectionLabel>
            </div>
            <h2 id="services-title" className="font-display text-display-lg md:col-span-8">
              Guidance for the decisions that move you.
            </h2>
          </div>

          <ol className="mt-16 md:mt-24">
            {services.map((s, i) => (
              <li key={s.id} className="group border-t border-line last:border-b" data-reveal>
                <div className="grid gap-4 py-10 transition-colors duration-500 md:grid-cols-12 md:items-baseline md:gap-8 md:py-12">
                  <span className="font-mono text-sm text-muted md:col-span-1">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="font-display text-[2.2rem] leading-[1.02] tracking-tight transition-transform duration-500 ease-editorial group-hover:translate-x-1 md:col-span-4 md:text-5xl">
                    {s.title}
                  </h3>
                  <p className="max-w-xl text-[1.05rem] leading-relaxed text-charcoal md:col-span-5">{s.description}</p>
                  <div className="md:col-span-2 md:text-right">
                    <Link
                      href="/book"
                      className="inline-flex items-center gap-2 text-[0.92rem] font-medium text-ink transition-colors hover:text-accent"
                      aria-label={`Book a consultation about ${s.title}`}
                    >
                      <span className="link-underline">Book a Consultation</span>
                      <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section aria-labelledby="how-title" className="bg-paper-deep/60">
        <div className="page-x mx-auto max-w-page py-24 md:py-32">
          <div className="grid gap-6 md:grid-cols-12" data-reveal>
            <div className="md:col-span-4">
              <SectionLabel index="03">Process</SectionLabel>
            </div>
            <h2 id="how-title" className="font-display text-display-lg md:col-span-8">
              {c.howItWorks.heading}
            </h2>
          </div>
          <ol className="mt-16 grid gap-y-14 md:mt-24 md:grid-cols-3 md:gap-x-12">
            {c.howItWorks.steps.map((step, i) => (
              <li key={step.title} className="relative" data-reveal>
                <div className="flex items-center gap-4">
                  <span className="font-display text-7xl leading-none text-accent md:text-8xl">{i + 1}</span>
                  <span className="h-px flex-1 bg-ink/20" aria-hidden />
                </div>
                <h3 className="mt-8 text-xl font-medium">{step.title}</h3>
                <p className="mt-3 max-w-sm leading-relaxed text-charcoal">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-16" data-reveal>
            <Link href="/book" className="btn-primary">
              Start booking <Arrow />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Experience ───────────────────────────────────────────────────── */}
      <section id="approach" aria-labelledby="experience-title" className="scroll-mt-20">
        <div className="page-x mx-auto max-w-page py-24 md:py-36">
          <div className="grid gap-12 md:grid-cols-12">
            <div className="md:col-span-5" data-reveal>
              <SectionLabel index="04">Experience</SectionLabel>
              <p aria-hidden className="mt-6 select-none font-display text-[clamp(9rem,26vw,22rem)] leading-[0.8] tracking-[-0.06em] text-ink">
                12
              </p>
              <p className="eyebrow mt-4">Years across migration &amp; admissions</p>
            </div>
            <div className="md:col-span-7 md:pt-24" data-reveal>
              <h2 id="experience-title" className="font-display text-display-md">
                {c.experience.heading}
              </h2>
              <div className="mt-8 max-w-2xl space-y-5 text-lg leading-relaxed text-charcoal">
                {c.experience.paragraphs.map((p) => (
                  <p key={p.slice(0, 24)}>{p}</p>
                ))}
              </div>
              <dl className="mt-14 grid gap-8 sm:grid-cols-3">
                {c.experience.principles.map((p) => (
                  <div key={p.title} className="border-t border-ink pt-5">
                    <dt className="font-medium">{p.title}</dt>
                    <dd className="mt-2 text-[0.95rem] leading-relaxed text-muted">{p.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {testimonials.length > 0 && (
            <div className="mt-24 grid gap-10 md:grid-cols-2" aria-label="Client words">
              {testimonials.map((t) => (
                <figure key={t.id} className="border-t border-line pt-8" data-reveal>
                  <blockquote className="font-display text-3xl leading-tight">“{t.quote}”</blockquote>
                  <figcaption className="eyebrow mt-6">
                    {t.author}
                    {t.context ? ` — ${t.context}` : ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 border-t border-line">
        <div className="page-x mx-auto max-w-page py-24 md:py-32">
          <div className="grid gap-6 md:grid-cols-12" data-reveal>
            <div className="md:col-span-4">
              <SectionLabel index="05">Consultations</SectionLabel>
            </div>
            <div className="md:col-span-8">
              <h2 id="pricing-title" className="font-display text-display-lg">
                {c.pricing.heading}
              </h2>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-charcoal">{c.pricing.note}</p>
            </div>
          </div>

          <div className="mt-16 grid border-y border-line md:mt-24 md:grid-cols-2">
            {[...(free ? [free] : []), ...paid].map((t, i) => {
              const isFree = t.priceCents === 0;
              const hourly = !isFree && t.durationMinutes === 60;
              return (
                <article
                  key={t.id}
                  className={`flex flex-col py-12 md:px-10 md:py-16 ${i % 2 === 1 ? "border-t border-line md:border-l md:border-t-0" : ""} ${i === 0 ? "md:pl-0" : ""}`}
                  data-reveal
                  aria-labelledby={`type-${t.slug}`}
                >
                  <p className="eyebrow">{isFree ? "Initial enquiry" : "Full consultation"}</p>
                  <h3 id={`type-${t.slug}`} className="sr-only">
                    {t.name}
                  </h3>
                  <p className="mt-6 flex items-baseline gap-3">
                    <span className="font-display text-[clamp(4.5rem,9vw,8rem)] leading-none tracking-tight">
                      {isFree ? "Free" : formatPrice(t.priceCents, t.currency)}
                    </span>
                    {hourly && <span className="text-lg text-muted">per hour</span>}
                  </p>
                  <dl className="mt-10 divide-y divide-line border-y border-line text-[0.98rem]">
                    <div className="flex justify-between gap-6 py-4">
                      <dt className="text-muted">Duration</dt>
                      <dd>{t.durationMinutes} minutes</dd>
                    </div>
                    <div className="flex justify-between gap-6 py-4">
                      <dt className="text-muted">Price</dt>
                      <dd>{isFree ? "Free — no payment required" : `${formatPrice(t.priceCents, t.currency)}, paid when booking`}</dd>
                    </div>
                    {t.onePerClient && (
                      <div className="flex justify-between gap-6 py-4">
                        <dt className="text-muted">Limit</dt>
                        <dd>One per person</dd>
                      </div>
                    )}
                  </dl>
                  <p className="mt-8 max-w-md flex-1 leading-relaxed text-charcoal">{t.description}</p>
                  <div className="mt-10">
                    <Link href={`/book?type=${t.slug}`} className={isFree ? "btn-secondary" : "btn-primary"}>
                      {t.ctaLabel} <Arrow />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted">
            {c.disclaimer.text}{" "}
            <Link href="/legal/cancellation" className="underline underline-offset-4 hover:text-ink">
              Cancellation &amp; refund policy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t border-line">
        <div className="page-x mx-auto grid max-w-page gap-12 py-24 md:grid-cols-12 md:py-32">
          <div className="md:col-span-4">
            <div className="md:sticky md:top-28">
              <SectionLabel index="06">FAQ</SectionLabel>
              <h2 id="faq-title" className="mt-6 font-display text-display-md">
                {c.faq.heading}
              </h2>
            </div>
          </div>
          <div className="md:col-span-8">
            {faqs.map((f) => (
              <details key={f.id} className="group border-t border-line last:border-b">
                <summary className="flex cursor-pointer items-start justify-between gap-6 py-7 text-left text-lg font-medium transition-colors hover:text-accent md:text-xl">
                  <span>{f.question}</span>
                  <span
                    aria-hidden
                    className="relative mt-2 h-3 w-3 shrink-0 before:absolute before:left-0 before:top-1/2 before:h-px before:w-3 before:bg-current after:absolute after:left-1/2 after:top-0 after:h-3 after:w-px after:bg-current after:transition-transform after:duration-300 group-open:after:scale-y-0"
                  />
                </summary>
                <p className="max-w-2xl pb-8 leading-relaxed text-charcoal">{f.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section aria-labelledby="cta-title" className="bg-ink text-paper">
        <div className="page-x mx-auto max-w-page py-28 md:py-40">
          <p className="eyebrow text-paper/60">(07) Begin</p>
          <h2 id="cta-title" className="mt-8 max-w-[16ch] font-display text-display-lg" data-reveal>
            {c.finalCta.heading}
          </h2>
          <div className="mt-12 flex flex-col gap-8 md:flex-row md:items-end md:justify-between" data-reveal>
            <p className="max-w-md text-lg leading-relaxed text-paper/75">{c.finalCta.supporting}</p>
            <Link href="/book" className="btn-light">
              {c.finalCta.cta} <Arrow />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const nav = [
  { href: "/#services", label: "Services" },
  { href: "/#approach", label: "Approach" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export function Header({ name, tagline }: { name: string; tagline: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-40 transition-[background-color,border-color] duration-500 ${
        scrolled || open ? "border-b border-line/80 bg-paper/90 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <div className="page-x mx-auto flex h-16 max-w-page items-center justify-between gap-6 sm:h-20">
        <Link href="/" className="group flex items-baseline gap-3" aria-label={`${name} — home`}>
          <span className="font-display text-[1.6rem] leading-none tracking-tight">{name}</span>
          <span className="hidden text-[0.8rem] text-muted md:inline">{tagline}</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="link-underline text-[0.92rem] text-charcoal hover:text-ink">
              {n.label}
            </Link>
          ))}
          <Link href="/book" className="btn-primary min-h-[42px] px-5 text-[0.88rem]">
            Book a Consultation <span className="arrow" aria-hidden>→</span>
          </Link>
        </nav>

        <div className="flex items-center gap-2 lg:hidden">
          <Link href="/book" className="btn-primary min-h-[40px] px-4 text-[0.85rem]">
            Book
          </Link>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/20"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            <span aria-hidden className="relative block h-3 w-5">
              <span className={`absolute left-0 block h-px w-5 bg-ink transition-transform duration-300 ${open ? "top-1.5 rotate-45" : "top-0"}`} />
              <span className={`absolute left-0 block h-px w-5 bg-ink transition-transform duration-300 ${open ? "top-1.5 -rotate-45" : "top-3"}`} />
            </span>
          </button>
        </div>
      </div>

      <div id="mobile-nav" hidden={!open} className="page-x h-[calc(100dvh-4rem)] overflow-y-auto border-t border-line bg-paper pb-10 lg:hidden">
        <nav aria-label="Mobile" className="flex flex-col pt-6">
          {nav.map((n, i) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex items-baseline gap-4 border-b border-line py-5">
              <span className="font-mono text-xs text-muted">0{i + 1}</span>
              <span className="font-display text-4xl">{n.label}</span>
            </Link>
          ))}
        </nav>
        <Link href="/book" onClick={() => setOpen(false)} className="btn-primary mt-10 w-full">
          Book a Consultation <span className="arrow" aria-hidden>→</span>
        </Link>
      </div>
    </header>
  );
}

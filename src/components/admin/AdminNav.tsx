"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/appointments", label: "Appointments" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/types", label: "Consultations & prices" },
  { href: "/admin/content", label: "Website content" },
  { href: "/admin/pages", label: "Legal pages" },
  { href: "/admin/privacy", label: "Privacy requests" },
  { href: "/admin/activity", label: "Activity log" },
  { href: "/admin/settings", label: "Settings", owner: true },
];

export function AdminNav({ isOwner }: { isOwner: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0">
      {items
        .filter((i) => !i.owner || isOwner)
        .map((i) => {
          const active = i.href === "/admin" ? path === "/admin" : path.startsWith(i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-ink text-paper" : "text-charcoal hover:bg-ink/[0.06]"}`}
            >
              {i.label}
            </Link>
          );
        })}
    </nav>
  );
}

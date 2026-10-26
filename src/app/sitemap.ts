import type { MetadataRoute } from "next";
import { legalSlugs } from "@/lib/content-defaults";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/book`, changeFrequency: "weekly", priority: 0.9 },
    ...legalSlugs.map((s) => ({ url: `${base}/legal/${s}`, changeFrequency: "yearly" as const, priority: 0.2 })),
  ];
}

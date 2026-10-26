import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { RevealObserver } from "@/components/site/Reveal";
import { getContent, getServices } from "@/lib/content";

// Content is edited in the admin dashboard and read on each request, so
// changes appear without a redeploy.
export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [content, services] = await Promise.all([getContent(), getServices()]);
  return (
    <>
      <Header name={content.brand.name} tagline={content.brand.tagline} />
      <main id="main">{children}</main>
      <Footer content={content} services={services} />
      <RevealObserver />
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { logout, requireAdmin } from "@/lib/auth/admin";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";

export const metadata: Metadata = { title: { default: "Dashboard", template: "%s · Dashboard" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

async function logoutAction() {
  "use server";
  await logout();
  redirect("/admin/login");
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-screen bg-paper md:grid md:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-paper-deep/50 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-5 md:block">
          <Link href="/admin" className="font-display text-2xl">Tony Jose</Link>
          <p className="hidden text-xs text-muted md:mt-1 md:block">Signed in as {admin.name}</p>
        </div>
        <AdminNav isOwner={admin.role === "owner"} />
        <div className="hidden px-5 pb-5 md:absolute md:bottom-0 md:block">
          <Link href="/" className="block text-sm text-muted hover:text-ink" target="_blank">View website ↗</Link>
          <form action={logoutAction} className="mt-2">
            <button className="text-sm text-muted hover:text-ink">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-8 md:px-10 md:py-10">{children}</main>
    </div>
  );
}

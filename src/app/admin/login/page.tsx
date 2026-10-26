import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAdmin, login } from "@/lib/auth/admin";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const res = await login(email, password);
  if (!res.ok) return { error: res.error };
  redirect("/admin");
}

export default async function LoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-5">
      <div className="w-full max-w-sm">
        <p className="font-display text-3xl">Tony Jose</p>
        <p className="eyebrow mt-2">Dashboard</p>
        <LoginForm action={loginAction} />
      </div>
    </main>
  );
}

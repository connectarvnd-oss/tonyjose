import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-x mx-auto flex min-h-screen max-w-page flex-col justify-center py-24">
      <p className="eyebrow">404</p>
      <h1 className="mt-6 font-display text-display-lg">This page took a different route.</h1>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/" className="btn-primary">Back to home</Link>
        <Link href="/book" className="btn-secondary">Book a consultation</Link>
      </div>
    </main>
  );
}

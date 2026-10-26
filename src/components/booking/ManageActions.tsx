"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function PaymentPoller({ reference, token }: { reference: string; token: string }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    let n = 0;
    const id = setInterval(async () => {
      n++;
      const res = await fetch(`/api/bookings/${reference}/status?t=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok) {
        const d = (await res.json()) as { status: string };
        if (d.status !== "pending_payment") {
          clearInterval(id);
          router.refresh();
        }
      }
      if (n >= 40) {
        clearInterval(id);
        setTimedOut(true);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [reference, token, router]);
  return (
    <p className="mt-4 flex items-center gap-3 text-charcoal" role="status">
      {!timedOut && <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/20 border-t-ink" aria-hidden />}
      {timedOut
        ? "This is taking longer than usual. You'll receive an email as soon as the payment is confirmed — you can safely close this page."
        : "Waiting for the payment provider to confirm your payment…"}
    </p>
  );
}

export function CancelBooking({ reference, token, paidNote }: { reference: string; token: string; paidNote: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/bookings/${reference}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token, reason: reason || undefined }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : { error: "Network error. Please try again." };
    setBusy(false);
    if (!res?.ok) {
      setError(data.error ?? "Could not cancel.");
      return;
    }
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        Cancel booking
      </button>
    );
  }
  return (
    <div className="w-full max-w-xl border border-line p-6">
      <p className="font-medium">Cancel this booking?</p>
      {paidNote && <p className="mt-2 text-sm text-charcoal">{paidNote}</p>}
      <label htmlFor="cancel-reason" className="field-label mt-5">
        Reason <span className="font-normal text-muted">· Optional</span>
      </label>
      <input id="cancel-reason" className="field" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className="btn-primary bg-danger hover:bg-ink" onClick={cancel} disabled={busy}>
          {busy ? "Cancelling…" : "Yes, cancel"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
          Keep booking
        </button>
      </div>
    </div>
  );
}

export function RescheduleLink({ reference, token }: { reference: string; token: string }) {
  return (
    <Link href={`/booking/${reference}/reschedule?t=${encodeURIComponent(token)}`} className="btn-primary">
      Reschedule <span className="arrow" aria-hidden>→</span>
    </Link>
  );
}

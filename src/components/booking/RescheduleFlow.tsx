"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDateLong, formatTime, SlotPicker, zoneName, type Slot } from "./SlotPicker";

export function RescheduleFlow({ reference, token, businessTimeZone, maxAdvanceDays }: { reference: string; token: string; businessTimeZone: string; maxAdvanceDays: number }) {
  const router = useRouter();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [zone, setZone] = useState(businessTimeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  async function confirm() {
    if (!slot) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/bookings/${reference}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token, start: slot.start }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as { error?: string; code?: string }) : { error: "Network error." };
    setBusy(false);
    if (!res?.ok) {
      setError(data.error ?? "Could not reschedule.");
      if (data.code === "slot_unavailable") {
        setSlot(null);
        setRefresh((r) => r + 1);
      }
      return;
    }
    router.push(`/booking/${reference}?t=${encodeURIComponent(token)}`);
    router.refresh();
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-8 border-l-2 border-accent bg-accent-soft/60 px-5 py-4">
          {error}
        </p>
      )}
      <SlotPicker
        query={`ref=${reference}&t=${encodeURIComponent(token)}`}
        businessTimeZone={businessTimeZone}
        maxAdvanceDays={maxAdvanceDays}
        selected={slot}
        onSelect={setSlot}
        refreshKey={refresh}
        displayZone={zone}
        onDisplayZoneChange={setZone}
      />
      <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-charcoal">
          {slot ? `${formatDateLong(slot.start, zone)}, ${formatTime(slot.start, zone)} (${zoneName(zone)})` : "Choose a new date and time."}
        </p>
        <button type="button" className="btn-primary" disabled={!slot || busy} onClick={confirm}>
          {busy ? "Rescheduling…" : "Confirm new time"} <span className="arrow" aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

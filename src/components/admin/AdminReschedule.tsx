"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SlotPicker, formatDateLong, formatTime, type Slot } from "@/components/booking/SlotPicker";
import { btnCls, btnSecondaryCls } from "./ui";

export function AdminReschedule({
  reference,
  token,
  businessTimeZone,
  action,
}: {
  reference: string;
  token: string;
  businessTimeZone: string;
  action: (start: string) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [zone, setZone] = useState(businessTimeZone);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  if (!open) return <button className={btnSecondaryCls} onClick={() => setOpen(true)}>Reschedule…</button>;
  return (
    <div className="mt-4 w-full rounded-lg border border-line bg-paper p-5">
      <SlotPicker query={`ref=${reference}&t=${encodeURIComponent(token)}`} businessTimeZone={businessTimeZone} maxAdvanceDays={365} selected={slot} onSelect={setSlot} refreshKey={refresh} displayZone={zone} onDisplayZoneChange={setZone} />
      {msg && <p role="alert" className="mt-4 text-sm text-danger">{msg}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          className={btnCls}
          disabled={!slot || busy}
          onClick={async () => {
            if (!slot) return;
            setBusy(true);
            setMsg(null);
            const res = await action(slot.start);
            setBusy(false);
            if (res.error) {
              setMsg(res.error);
              setRefresh((r) => r + 1);
              return;
            }
            setOpen(false);
            router.refresh();
          }}
        >
          {busy ? "Rescheduling…" : slot ? `Move to ${formatDateLong(slot.start, zone)}, ${formatTime(slot.start, zone)}` : "Choose a new time"}
        </button>
        <button className={btnSecondaryCls} onClick={() => setOpen(false)}>Close</button>
        <p className="text-xs text-muted">The client and Tony are notified, and the Google Calendar event is updated.</p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

function fmt(zone: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date());
}

/** Shows Tony's local time next to the visitor's, which matters when booking across time zones. */
export function LocalClock({ zone }: { zone: string }) {
  const [state, setState] = useState<{ tony: string; you: string; youZone: string } | null>(null);
  useEffect(() => {
    const youZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tick = () => setState({ tony: fmt(zone), you: fmt(youZone), youZone });
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, [zone]);

  const city = zone.split("/").pop()?.replace(/_/g, " ");
  if (!state) return <p className="eyebrow invisible" aria-hidden>00:00</p>;
  const same = state.youZone === zone;
  return (
    <p className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1" aria-live="off">
      <span className="inline-flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
        {city} {state.tony}
      </span>
      {!same && (
        <>
          <span aria-hidden>·</span>
          <span>Your time {state.you}</span>
        </>
      )}
    </p>
  );
}

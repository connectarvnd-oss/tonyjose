"use client";

import { useState, useTransition } from "react";
import { btnCls, inputCls } from "./ui";

type Window = { weekday: number; startTime: string; endTime: string };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function WeeklyHours({ initial, save }: { initial: Window[]; save: (json: string) => Promise<{ ok: boolean }> }) {
  const [windows, setWindows] = useState<Window[]>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const update = (i: number, patch: Partial<Window>) => {
    setSaved(false);
    setWindows((w) => w.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };

  return (
    <div>
      <div className="divide-y divide-line">
        {DAYS.map((label, d) => {
          const weekday = d + 1;
          const items = windows.map((w, i) => ({ w, i })).filter(({ w }) => w.weekday === weekday);
          return (
            <div key={label} className="grid gap-3 py-3 sm:grid-cols-[8rem_1fr]">
              <div className="flex items-center gap-2 pt-1.5 text-sm font-medium">
                {label}
                {!items.length && <span className="text-xs font-normal text-muted">Unavailable</span>}
              </div>
              <div className="space-y-2">
                {items.map(({ w, i }) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input type="time" value={w.startTime} onChange={(e) => update(i, { startTime: e.target.value })} className={`${inputCls} w-32`} aria-label={`${label} start`} />
                    <span className="text-muted">–</span>
                    <input type="time" value={w.endTime} onChange={(e) => update(i, { endTime: e.target.value })} className={`${inputCls} w-32`} aria-label={`${label} end`} />
                    {w.endTime <= w.startTime && <span className="text-xs text-danger">End must be after start</span>}
                    <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => { setSaved(false); setWindows((ws) => ws.filter((_, j) => j !== i)); }} aria-label={`Remove ${label} window`}>
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-sm text-accent hover:underline"
                  onClick={() => {
                    setSaved(false);
                    const last = items.at(-1)?.w;
                    setWindows((ws) => [...ws, { weekday, startTime: last ? last.endTime : "09:00", endTime: last ? "18:00" : "17:00" }]);
                  }}
                >
                  + Add {items.length ? "another window (gap = break)" : "hours"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className={btnCls} disabled={pending} onClick={() => start(async () => { await save(JSON.stringify(windows)); setSaved(true); })}>
          {pending ? "Saving…" : "Save working hours"}
        </button>
        {saved && <span className="text-sm text-success" role="status">Saved. Public availability updated.</span>}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { BlockState } from "@/app/admin/(panel)/availability/actions";
import { btnCls, inputCls, labelCls } from "./ui";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function BlockForm({ action, defaultDate }: { action: (prev: BlockState, fd: FormData) => Promise<BlockState>; defaultDate: string }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as BlockState);
  const [mode, setMode] = useState<"days" | "range" | "weekly">("days");
  const v = state.status === "conflict" ? state.values : {};
  const val = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  useEffect(() => {
    if (state.status === "conflict") setMode(state.values.mode as typeof mode);
  }, [state]);

  return (
    <form action={formAction} className="space-y-4" key={JSON.stringify(state)}>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Block type">
        {(
          [
            ["days", "Whole day(s)"],
            ["range", "Time range"],
            ["weekly", "Recurring weekly"],
          ] as const
        ).map(([v, l]) => (
          <label key={v} className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${mode === v ? "border-ink bg-ink text-paper" : "border-line bg-white"}`}>
            <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v)} className="sr-only" />
            {l}
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={labelCls}>{mode === "weekly" ? "Starting from" : "From date"}</span>
          <input type="date" name="startDate" required defaultValue={val("startDate") ?? defaultDate} className={inputCls} />
        </label>
        {mode !== "weekly" && (
          <label>
            <span className={labelCls}>To date {mode === "days" ? "(inclusive, optional)" : "(optional)"}</span>
            <input type="date" name="endDate" defaultValue={val("endDate")} className={inputCls} />
          </label>
        )}
        {mode === "weekly" && (
          <label>
            <span className={labelCls}>Until (optional)</span>
            <input type="date" name="until" defaultValue={val("until")} className={inputCls} />
          </label>
        )}
        {mode !== "days" && (
          <>
            <label>
              <span className={labelCls}>Start time</span>
              <input type="time" name="startTime" required defaultValue={val("startTime")} className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>End time</span>
              <input type="time" name="endTime" required defaultValue={val("endTime")} className={inputCls} />
            </label>
          </>
        )}
      </div>
      {mode === "weekly" && (
        <fieldset>
          <legend className={labelCls}>Weekdays</legend>
          <div className="flex flex-wrap gap-2">
            {WD.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm">
                <input type="checkbox" name="weekdays" value={i + 1} defaultChecked={Array.isArray(v.weekdays) && v.weekdays.includes(String(i + 1))} /> {d}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label>
          <span className={labelCls}>Kind</span>
          <select name="kind" className={inputCls} defaultValue={val("kind") || "personal"}>
            <option value="holiday">Holiday</option>
            <option value="personal">Personal commitment</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          <span className={labelCls}>Private note</span>
          <input name="reason" maxLength={300} defaultValue={val("reason")} className={inputCls} placeholder="Only visible to you" />
        </label>
      </div>

      {state.status === "conflict" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm" role="alert">
          <p className="font-medium text-amber-950">This period already contains {state.conflicts.length} booked appointment(s):</p>
          <ul className="mt-2 list-disc pl-5">
            {state.conflicts.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/appointments/${c.id}`} className="underline" target="_blank">{c.name}</Link> — {c.when}
              </li>
            ))}
          </ul>
          <fieldset className="mt-3 space-y-1">
            <legend className="font-medium">What should happen to them?</legend>
            <label className="flex gap-2"><input type="radio" name="conflictAction" value="preserve" defaultChecked /> Keep them (block only the free time)</label>
            <label className="flex gap-2"><input type="radio" name="conflictAction" value="reschedule" /> Keep for now and flag them for rescheduling</label>
            <label className="flex gap-2"><input type="radio" name="conflictAction" value="cancel" /> Cancel them, notify clients and refund paid bookings</label>
          </fieldset>
        </div>
      )}
      {state.status === "error" && <p role="alert" className="text-sm text-danger">{state.message}</p>}
      {state.status === "done" && (
        <div role="status" className="rounded-md bg-success/10 p-3 text-sm text-success">
          {state.message}
          {state.flagged && (
            <ul className="mt-2 list-disc pl-5 text-ink">
              {state.flagged.map((c) => (
                <li key={c.id}><Link className="underline" href={`/admin/appointments/${c.id}`}>Reschedule {c.name} ({c.when})</Link></li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button className={btnCls} disabled={pending}>{pending ? "Saving…" : state.status === "conflict" ? "Confirm block" : "Block time"}</button>
    </form>
  );
}

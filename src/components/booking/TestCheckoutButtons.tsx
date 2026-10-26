"use client";

import { useState } from "react";

export function TestCheckoutButtons({ session, appointment, successUrl, cancelUrl }: { session: string; appointment: string; successUrl: string; cancelUrl: string }) {
  const [busy, setBusy] = useState(false);
  async function send(outcome: "succeeded" | "failed") {
    setBusy(true);
    await fetch("/api/test-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session, appointment, outcome }) });
    window.location.assign(outcome === "succeeded" ? successUrl : cancelUrl.replace("payment=cancelled", "payment=failed"));
  }
  return (
    <div className="mt-10 flex flex-wrap gap-3">
      <button type="button" className="btn-primary" disabled={busy} onClick={() => send("succeeded")}>Simulate successful payment</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => send("failed")}>Simulate failed payment</button>
      <a className="btn-secondary" href={cancelUrl}>Abandon (go back)</a>
    </div>
  );
}

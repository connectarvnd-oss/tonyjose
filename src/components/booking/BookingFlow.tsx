"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateLong, formatTime, SlotPicker, zoneName, type Slot } from "./SlotPicker";

export type PublicType = {
  id: string;
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  onePerClient: boolean;
};

type Props = {
  types: PublicType[];
  initialTypeSlug?: string;
  businessTimeZone: string;
  maxAdvanceDays: number;
  paymentMode: "live" | "stripe_test" | "test" | "none";
  cancellationNoticeHours: number;
};

const AREAS = ["Visa", "Study Abroad", "Admissions", "Migration", "Other"] as const;
const STORAGE_KEY = "tj-booking-draft";

function price(cents: number, currency: string) {
  if (cents === 0) return "Free";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Form = {
  name: string;
  email: string;
  phone: string;
  country: string;
  enquiryArea: string;
  message: string;
  privacyAccepted: boolean;
  marketingOptIn: boolean;
  website: string;
};

const emptyForm: Form = { name: "", email: "", phone: "", country: "", enquiryArea: "", message: "", privacyAccepted: false, marketingOptIn: false, website: "" };

export function BookingFlow({ types, initialTypeSlug, businessTimeZone, maxAdvanceDays, paymentMode, cancellationNoticeHours }: Props) {
  const router = useRouter();
  const initial = types.find((t) => t.slug === initialTypeSlug);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initial ? 2 : 1);
  const [typeId, setTypeId] = useState<string | null>(initial?.id ?? null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [displayZone, setDisplayZone] = useState(businessTimeZone);
  const idempotencyKey = useRef<string>(newKey());
  const startedAt = useRef<number>(Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const type = useMemo(() => types.find((t) => t.id === typeId) ?? null, [types, typeId]);
  const paid = Boolean(type && type.priceCents > 0);

  useEffect(() => {
    setDisplayZone(Intl.DateTimeFormat().resolvedOptions().timeZone || businessTimeZone);
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setForm((f) => ({ ...f, ...(JSON.parse(saved) as Partial<Form>), privacyAccepted: false, website: "" }));
    } catch {
      // storage unavailable — fine
    }
  }, [businessTimeZone]);

  useEffect(() => {
    try {
      const { name, email, phone, country, enquiryArea, message } = form;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ name, email, phone, country, enquiryArea, message }));
    } catch {
      // ignore
    }
  }, [form]);

  // New type or slot → new idempotency key (a retry of the same request keeps it).
  useEffect(() => {
    idempotencyKey.current = newKey();
  }, [typeId, slot?.start]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  function chooseType(id: string) {
    setTypeId(id);
    setSlot(null);
    setStep(2);
    const t = types.find((x) => x.id === id);
    if (t) window.history.replaceState(null, "", `/book?type=${t.slug}`);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Please enter your full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "Please enter a valid email address.";
    if (form.phone && !/^[+()\d\s.-]{5,40}$/.test(form.phone)) e.phone = "Please enter a valid phone number.";
    if (form.message.length > 1000) e.message = "Please keep this under 1000 characters.";
    if (!form.privacyAccepted) e.privacyAccepted = "Please confirm you have read the privacy notice.";
    setErrors(e);
    if (Object.keys(e).length) {
      const first = document.getElementById(`f-${Object.keys(e)[0]}`);
      first?.focus();
    }
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!type || !slot) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentTypeId: type.id,
          start: slot.start,
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          country: form.country || null,
          enquiryArea: form.enquiryArea || null,
          message: form.message || null,
          timeZone: displayZone,
          privacyAccepted: form.privacyAccepted,
          marketingOptIn: form.marketingOptIn,
          idempotencyKey: idempotencyKey.current,
          website: form.website,
          startedAt: startedAt.current,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        reference?: string;
        token?: string;
        checkoutUrl?: string | null;
        error?: string;
        code?: string;
        fields?: Record<string, string>;
      };
      if (!res.ok) {
        if (data.code === "slot_unavailable") {
          setSlot(null);
          setRefreshKey((k) => k + 1);
          setStep(2);
          setBanner(data.error ?? "That time is no longer available. Please choose another.");
        } else if (data.fields) {
          setErrors(data.fields);
          setStep(3);
          setBanner(data.error ?? "Please check the highlighted fields.");
        } else {
          setBanner(data.error ?? "Something went wrong. Please try again.");
        }
        setSubmitting(false);
        return;
      }
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      router.push(`/booking/${data.reference}?t=${data.token}&new=1`);
    } catch {
      setBanner("We couldn't reach the server. Check your connection and try again — you won't be booked twice.");
      setSubmitting(false);
    }
  }

  const steps = ["Consultation", "Date & time", "Your details", "Confirm"];
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };

  return (
    <div>
      {/* Progress */}
      <ol className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line pb-5" aria-label="Booking progress">
        {steps.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3 | 4;
          const done = n < step;
          const current = n === step;
          return (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                disabled={!done}
                onClick={() => setStep(n)}
                aria-current={current ? "step" : undefined}
                className={`eyebrow flex items-center gap-2 transition-colors ${current ? "text-ink" : done ? "text-ink hover:text-accent" : "text-muted/60"}`}
              >
                <span className={current ? "text-accent" : ""}>{String(n).padStart(2, "0")}</span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      {banner && (
        <div role="alert" className="mt-8 border-l-2 border-accent bg-accent-soft/60 px-5 py-4 text-[0.95rem]">
          {banner}
        </div>
      )}

      {/* Step 1 — type */}
      {step === 1 && (
        <section className="animate-fade pt-10" aria-labelledby="step-title">
          <h2 id="step-title" ref={headingRef} tabIndex={-1} className="font-display text-display-md outline-none">
            Choose your consultation
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => chooseType(t.id)}
                className={`group flex flex-col items-start border p-7 text-left transition-all duration-300 ease-editorial hover:border-ink md:p-9 ${
                  typeId === t.id ? "border-ink bg-ink/[0.03]" : "border-line"
                }`}
              >
                <span className="eyebrow">{t.priceCents === 0 ? "No payment required" : "Paid securely online"}</span>
                <span className="mt-6 font-display text-4xl">{t.name}</span>
                <span className="mt-4 flex items-baseline gap-3">
                  <span className="font-display text-5xl text-accent">{price(t.priceCents, t.currency)}</span>
                  <span className="text-muted">· {t.durationMinutes} minutes</span>
                </span>
                <span className="mt-5 max-w-sm leading-relaxed text-charcoal">{t.description}</span>
                {t.onePerClient && <span className="mt-4 text-sm text-muted">Limited to one per person.</span>}
                <span className="mt-8 inline-flex items-center gap-2 font-medium">
                  Select <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Step 2 — date/time */}
      {step === 2 && type && (
        <section className="animate-fade pt-10" aria-labelledby="step-title">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="step-title" ref={headingRef} tabIndex={-1} className="font-display text-display-md outline-none">
              Select a suitable time
            </h2>
            <p className="text-sm text-muted">
              {type.name} · {type.durationMinutes} min · {price(type.priceCents, type.currency)}{" "}
              <button type="button" className="ml-2 underline underline-offset-4 hover:text-ink" onClick={() => setStep(1)}>
                Change
              </button>
            </p>
          </div>
          <div className="mt-10">
            <SlotPicker
              query={`type=${type.id}`}
              businessTimeZone={businessTimeZone}
              maxAdvanceDays={maxAdvanceDays}
              selected={slot}
              onSelect={(s) => {
                setSlot(s);
                setBanner(null);
              }}
              refreshKey={refreshKey}
              displayZone={displayZone}
              onDisplayZoneChange={setDisplayZone}
            />
          </div>
          <div className="sticky bottom-0 z-10 -mx-5 mt-10 border-t border-line bg-paper/95 px-5 py-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-charcoal" aria-live="polite">
                {slot ? (
                  <>
                    <span className="font-medium text-ink">{formatDateLong(slot.start, displayZone)}</span>, {formatTime(slot.start, displayZone)}–
                    {formatTime(slot.end, displayZone)} ({zoneName(displayZone)})
                  </>
                ) : (
                  "Choose a date, then a time."
                )}
              </p>
              <button type="button" className="btn-primary" disabled={!slot} onClick={() => setStep(3)}>
                Continue <span className="arrow" aria-hidden>→</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Step 3 — details */}
      {step === 3 && type && slot && (
        <section className="animate-fade pt-10" aria-labelledby="step-title">
          <h2 id="step-title" ref={headingRef} tabIndex={-1} className="font-display text-display-md outline-none">
            Your details
          </h2>
          <p className="mt-4 max-w-xl text-charcoal">
            Just enough to arrange the consultation. Please don't include passport numbers, identity documents, or financial details.
          </p>
          <form
            noValidate
            className="mt-10 grid max-w-3xl gap-x-10 gap-y-8 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (validate()) setStep(4);
            }}
          >
            <Field id="name" label="Full name" required error={errors.name}>
              <input id="f-name" className="field" autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "e-name" : undefined} required />
            </Field>
            <Field id="email" label="Email address" required error={errors.email}>
              <input id="f-email" type="email" inputMode="email" className="field" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "e-email" : undefined} required />
            </Field>
            <Field id="phone" label="Phone number" hint="Optional" error={errors.phone}>
              <input id="f-phone" type="tel" className="field" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "e-phone" : undefined} />
            </Field>
            <Field id="country" label="Country of residence" hint="Optional">
              <input id="f-country" className="field" autoComplete="country-name" value={form.country} onChange={(e) => set("country", e.target.value)} />
            </Field>
            <fieldset className="md:col-span-2">
              <legend className="field-label">
                Area of enquiry <span className="font-normal text-muted">· Optional</span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {AREAS.map((a) => (
                  <label key={a} className={`cursor-pointer rounded-full border px-4 py-2.5 text-sm transition-colors ${form.enquiryArea === a ? "border-ink bg-ink text-paper" : "border-ink/20 hover:border-ink"}`}>
                    <input type="radio" name="area" className="sr-only" checked={form.enquiryArea === a} onChange={() => set("enquiryArea", a)} onClick={() => form.enquiryArea === a && set("enquiryArea", "")} />
                    {a}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="md:col-span-2">
              <Field id="message" label="Your question, briefly" hint={`Optional · ${form.message.length}/1000`} error={errors.message}>
                <textarea id="f-message" rows={4} maxLength={1000} className="field resize-y" value={form.message} onChange={(e) => set("message", e.target.value)} aria-invalid={Boolean(errors.message)} />
              </Field>
            </div>

            {/* Honeypot — hidden from people, tempting for bots */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="f-website">Website</label>
              <input id="f-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} />
            </div>

            <div className="space-y-4 md:col-span-2">
              <label className="flex cursor-pointer items-start gap-3">
                <input id="f-privacyAccepted" type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(170,58,22)]" checked={form.privacyAccepted} onChange={(e) => set("privacyAccepted", e.target.checked)} aria-invalid={Boolean(errors.privacyAccepted)} aria-describedby={errors.privacyAccepted ? "e-privacyAccepted" : undefined} required />
                <span className="text-[0.95rem] leading-relaxed">
                  I have read the{" "}
                  <Link href="/legal/privacy" target="_blank" className="underline underline-offset-4">
                    privacy notice
                  </Link>{" "}
                  and understand my details are used to arrange this consultation. <span className="text-accent">*</span>
                </span>
              </label>
              {errors.privacyAccepted && (
                <p id="e-privacyAccepted" className="text-sm text-danger">
                  {errors.privacyAccepted}
                </p>
              )}
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(170,58,22)]" checked={form.marketingOptIn} onChange={(e) => set("marketingOptIn", e.target.checked)} />
                <span className="text-[0.95rem] leading-relaxed text-charcoal">
                  Optional: I'd like to receive occasional updates by email. You can unsubscribe at any time. This doesn't affect your booking.
                </span>
              </label>
            </div>

            <div className="flex flex-wrap gap-3 md:col-span-2">
              <button type="submit" className="btn-primary">
                Review booking <span className="arrow" aria-hidden>→</span>
              </button>
              <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                Back
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Step 4 — review */}
      {step === 4 && type && slot && (
        <section className="animate-fade pt-10" aria-labelledby="step-title">
          <h2 id="step-title" ref={headingRef} tabIndex={-1} className="font-display text-display-md outline-none">
            {paid ? "Review and pay" : "Confirm your booking"}
          </h2>
          <dl className="mt-10 max-w-3xl divide-y divide-line border-y border-line">
            {[
              ["Consultation", `${type.name} · ${type.durationMinutes} minutes`],
              ["Date", formatDateLong(slot.start, displayZone)],
              ["Time", `${formatTime(slot.start, displayZone)}–${formatTime(slot.end, displayZone)} (${zoneName(displayZone)})`],
              ...(displayZone !== businessTimeZone
                ? [["Tony's time", `${formatTime(slot.start, businessTimeZone)}–${formatTime(slot.end, businessTimeZone)} (${zoneName(businessTimeZone)})`]]
                : []),
              ["Name", form.name],
              ["Email", form.email],
              ...(form.phone ? [["Phone", form.phone]] : []),
              ...(form.enquiryArea ? [["Area", form.enquiryArea]] : []),
            ].map(([k, v]) => (
              <div key={k} className="grid gap-1 py-4 sm:grid-cols-3">
                <dt className="text-muted">{k}</dt>
                <dd className="sm:col-span-2">{v}</dd>
              </div>
            ))}
            <div className="grid gap-1 py-5 sm:grid-cols-3">
              <dt className="font-medium">Total</dt>
              <dd className="font-display text-4xl sm:col-span-2">{price(type.priceCents, type.currency)}</dd>
            </div>
          </dl>

          <div className="mt-8 max-w-3xl space-y-3 text-sm leading-relaxed text-charcoal">
            {paid ? (
              <>
                <p>
                  You'll be taken to a secure payment page. Your time is held while you pay, and the booking is confirmed as soon as the payment is verified.
                  Card details are handled by the payment provider and never stored on this website.
                </p>
                {paymentMode !== "live" && (
                  <p className="border-l-2 border-accent bg-accent-soft/60 px-4 py-3 font-medium text-ink">
                    {paymentMode === "none"
                      ? "Online payments are not configured yet, so paid consultations cannot be booked right now."
                      : paymentMode === "stripe_test"
                        ? "TEST MODE — Stripe test keys are in use. No real payment will be taken."
                        : "TEST MODE — payments are simulated. No real payment will be taken."}
                  </p>
                )}
              </>
            ) : (
              <p>The free enquiry requires no payment.</p>
            )}
            <p>
              You can reschedule or cancel up to {cancellationNoticeHours} hours before the appointment.{" "}
              <Link href="/legal/cancellation" target="_blank" className="underline underline-offset-4">
                Cancellation &amp; refund policy
              </Link>
              .
            </p>
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <button type="button" className="btn-primary" onClick={submit} disabled={submitting || (paid && paymentMode === "none")} aria-busy={submitting}>
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-paper/40 border-t-paper" aria-hidden />
                  {paid ? "Preparing payment…" : "Confirming…"}
                </>
              ) : paid ? (
                <>
                  Continue to payment · {price(type.priceCents, type.currency)} <span className="arrow" aria-hidden>→</span>
                </>
              ) : (
                <>
                  Confirm booking <span className="arrow" aria-hidden>→</span>
                </>
              )}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setStep(3)} disabled={submitting}>
              Edit details
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ id, label, hint, required, error, children }: { id: string; label: string; hint?: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={`f-${id}`} className="field-label">
        {label} {required && <span className="text-accent">*</span>}
        {hint && <span className="font-normal text-muted"> · {hint}</span>}
      </label>
      {children}
      {error && (
        <p id={`e-${id}`} className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

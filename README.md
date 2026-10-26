# Tony Jose — consultation website

A personal website and booking system for Tony Jose, visa consultant: an editorial public site, a booking flow for a free 15‑minute enquiry and a €28/60‑minute paid consultation, Google Calendar sync, Stripe payments, email confirmations and reminders, and a private admin dashboard.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · PostgreSQL (Drizzle ORM, SQL migrations) · Google Calendar REST API (OAuth 2.0) · Stripe Checkout + verified webhooks · Resend · Vitest.

---

## What works today, and what still needs credentials

| Area | Status without credentials | Needed to go live |
| --- | --- | --- |
| Public website, booking flow, admin dashboard | **Working** | — |
| Availability engine, overlap protection, holds, reschedule/cancel | **Working** (tested) | — |
| Google Calendar | **Not live.** Availability ignores Google; no events are created. Dashboard shows "Not configured". | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, then Tony clicks **Connect Google Calendar** |
| Payments | **Test mode only** — a clearly labelled *simulated* checkout. No money moves. Refused in production unless `ALLOW_TEST_PAYMENTS=true`. | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Email | **Not sent** — emails are written to the server log ("console" provider). | `RESEND_API_KEY`, verified sender domain, `EMAIL_FROM` |
| Reminders / hold expiry | Need the scheduled job to run | A cron calling `/api/cron` every 5 minutes |
| Legal pages | **Placeholders** in `[square brackets]` | Tony's real business details + legal review |

The Google and Stripe integrations are fully implemented but have **not been tested against the real services** (no credentials were available). Test them end‑to‑end with the checklist below before launch.

---

## Local development

Requirements: Node 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # then fill in APP_ENCRYPTION_KEY, APP_SECRET, CRON_SECRET (commands in the file)
createdb tony                   # or use any Postgres URL in DATABASE_URL
npm run db:migrate              # applies migrations/*.sql
npm run db:seed                 # consultation types, placeholder working hours, services, FAQs, legal pages
npm run admin:create -- --email tony@example.com --name "Tony Jose"   # prompts for a password (12+ chars)
npm run dev
```

- Website: http://localhost:3000 · Dashboard: http://localhost:3000/admin
- In development, paid bookings use the simulated checkout and emails print to the terminal.
- Run reminders/hold expiry manually: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron`

### Tests

```bash
createdb tony_test
TEST_DATABASE_URL=postgres://…/tony_test npm test
```

The suite runs against a real Postgres database (it drops and recreates the schema in the test DB) with fake Google/Stripe/email adapters. It covers: slot generation incl. DST, buffers, notice and advance limits, blocks, recurring blocks, Google busy times; concurrent double‑booking attempts; idempotent retries; free enquiry limit; paid confirmation only via verified events; duplicate webhooks; failed and abandoned payments; late payment after the slot was taken (refund + admin alert); rescheduling (same calendar event, reminders replaced); cancellation with refund; Stripe signature verification.

---

## Setup checklist for launch

### 1. Hosting and database
- [ ] Create a PostgreSQL database (Supabase, Neon, Railway, RDS…). EU region recommended. Set `DATABASE_URL` (and `DATABASE_SSL=true` if required).
- [ ] Deploy to a Node host with HTTPS (Vercel recommended — see *Deployment*). Set `SITE_URL` to the final https URL.
- [ ] Generate and set `APP_ENCRYPTION_KEY`, `APP_SECRET`, `CRON_SECRET`.
- [ ] Run `npm run db:migrate && npm run db:seed` against the production database, then `npm run admin:create`.

### 2. Google Calendar (Tony's own account)
1. In [Google Cloud Console](https://console.cloud.google.com/) create a project and **enable the Google Calendar API**.
2. **OAuth consent screen:** External, app name "Tony Jose Booking", add Tony's email as a test user (or publish the app). Scopes: `openid`, `email`, `…/auth/calendar.readonly`, `…/auth/calendar.events`.
3. **Credentials → Create OAuth client ID → Web application.** Authorised redirect URI: `https://YOUR-DOMAIN/api/google/oauth/callback`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, redeploy.
5. Tony signs in to `/admin` → **Settings → Connect Google Calendar**, approves access.
6. In Settings choose the calendar for new consultation events and which calendars' busy times block bookings. Choose invitation and meeting (Google Meet) options.
7. **Test:** add a busy event in Google Calendar → the slot disappears from `/book`. Make a booking → the event appears with `[Free]`/`[Paid]` in the title and a Meet link.

> While the OAuth app is in "Testing" status Google expires refresh tokens after 7 days. Publish the app (or complete verification) for a permanent connection. If access is lost, the dashboard shows a warning and, with "Pause public booking if Google Calendar can't be checked" on, booking pauses rather than risking clashes.

### 3. Stripe
1. Create/activate a Stripe account for Tony's business (EUR).
2. Developers → API keys → set `STRIPE_SECRET_KEY` (start with `sk_test_…`).
3. Developers → Webhooks → add endpoint `https://YOUR-DOMAIN/api/webhooks/stripe` with events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. Set `STRIPE_WEBHOOK_SECRET` (`whsec_…`).
4. Set `PAYMENT_PROVIDER=stripe` (or choose Stripe in Settings → Payments).
5. **Test with test keys:** book a full consultation, pay with card `4242 4242 4242 4242` → confirmed. Use `4000 0000 0000 0002` → declined, slot released. Abandon checkout → slot released after the hold. Cancel ≥24h ahead → refund appears in Stripe.
6. Switch to live keys + live webhook secret. The dashboard will show "Stripe live".

### 4. Email (Resend)
1. Create a Resend account, add and **verify Tony's domain** (DNS records).
2. Set `RESEND_API_KEY`, `EMAIL_PROVIDER=resend`, `EMAIL_FROM=bookings@your-domain`.
3. In Settings → Notifications, set Tony's notification email. Adjust reminder timings and templates in Settings → Email.
4. Make a test booking and check both emails arrive (client confirmation includes a calendar file).

### 5. Scheduled job
- [ ] Vercel: `vercel.json` schedules `/api/cron` once a day so it deploys on the free Hobby plan. On Pro, change the schedule to `*/5 * * * *`; on Hobby, also call it every 5 minutes from an external scheduler (below). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
- [ ] Elsewhere: call `GET /api/cron` with header `Authorization: Bearer <CRON_SECRET>` every 5 minutes (GitHub Actions, cron-job.org, systemd timer…).
- [ ] Dashboard → Settings shows "Scheduled jobs: Running" once it has run.

### 6. Content and legal (before launch)
- [ ] **Legal pages** (Dashboard → Legal pages): replace every `[placeholder]` — legal name, address, contact, VAT/registration if applicable, hosting/processors, retention period, supervisory authority — and have them reviewed (Impressum, GDPR privacy notice, consumer withdrawal information in the Terms).
- [ ] Contact details (Dashboard → Website content → Contact).
- [ ] Working hours, buffers, notice period (Dashboard → Availability). The seeded hours (Mon–Fri 09:00–12:30, 13:30–17:30) are placeholders.
- [ ] Confirm cancellation/refund rules match Settings → Booking rules.
- [ ] Add a real portrait of Tony if desired; the layout is designed to work without one. No testimonials are shown until real ones (with consent) are added.
- [ ] Do not add qualifications, registrations, countries or success claims unless verified.

---

## Deployment (Vercel)

1. Push this repository to GitHub and import it in Vercel (framework: Next.js).
2. Add all variables from `.env.example` in Project → Settings → Environment Variables (Production). Never commit `.env`.
3. Deploy. The `vercel-build` script runs `scripts/deploy-setup.ts` before `next build`: it applies migrations and seeds default content on every deploy (both are safe to repeat), and creates the first admin if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set (an existing admin is never changed; remove `ADMIN_PASSWORD` afterwards). Without `DATABASE_URL` it is skipped. You can still run the steps by hand:
   ```bash
   DATABASE_URL=… DATABASE_SSL=true npm run db:migrate
   DATABASE_URL=… DATABASE_SSL=true npm run db:seed
   DATABASE_URL=… DATABASE_SSL=true npm run admin:create -- --email tony@…
   ```
   If `SITE_URL` is not set, the Vercel production URL (`https://<project>.vercel.app`) is used.
4. Add the custom domain; HTTPS is automatic. HSTS is sent in production.
5. Complete the Google, Stripe and Resend steps above using the production domain.

Any Node host works (`npm run build && npm start`) as long as it provides HTTPS, environment variables and a way to call `/api/cron` on a schedule.

---

## How it works

### Booking lifecycle
1. **Availability** (`src/lib/availability/`) = weekly working windows (gaps are breaks) + date overrides − blocked periods (one‑off and weekly recurring) − Google busy times (with buffer) − existing bookings (with buffer), limited by minimum notice and the advance window. All rules run in the business time zone (Europe/Berlin by default), so DST is handled; visitors see times in their own zone with a toggle.
2. **Booking** (`src/lib/booking/service.ts`): availability is re‑checked right before writing (including a live Google free/busy call). The write happens in a transaction; a Postgres **exclusion constraint** (`appointments_no_overlap`) makes overlapping active bookings impossible even under concurrent requests. Requests carry an idempotency key, so retries return the same booking.
3. **Free enquiry** → confirmed immediately → Google event (deterministic event id, so retries never duplicate) → emails queued and sent.
4. **Paid consultation** → slot held as `pending_payment` (default 30 min) → Stripe Checkout (idempotency key per booking, so no double charges) → **only a verified webhook** confirms it. Failed/expired payments release the slot. If a payment arrives after the hold lapsed and the slot was taken (or Google now shows a clash), the booking is flagged *Needs attention*, refunded automatically (configurable) and Tony is alerted.
5. **Reschedule/cancel**: clients use the private link in their email (HMAC‑signed token); admins use the dashboard. The same Google event is updated/removed, pending reminders are cancelled and recreated, refunds follow the policy.
6. **Notifications** are rows in `notifications` first (dedupe keys, retries with backoff, `SKIP LOCKED` claiming). Reminders check the appointment is still confirmed at the same time before sending.

### Source of truth
Google Calendar is the source of truth for Tony's external commitments; the database is the source of truth for website bookings and payment status. Availability uses both.

### Security & privacy
- Admin: bcrypt passwords, DB‑backed sessions (httpOnly, SameSite=Lax, 8h), server‑side checks in every page/action/route (`requireAdmin`), owner/staff roles, login rate limiting, audit log.
- Public forms: Zod validation, DB‑backed rate limits, honeypot + minimum fill time, optional Cloudflare Turnstile.
- Secrets only in environment variables; Google tokens encrypted at rest (AES‑256‑GCM); nothing sensitive reaches the browser; only free/busy is read from Google (never event titles).
- Webhooks verified by signature; events de‑duplicated.
- Security headers incl. CSP, HSTS, frame denial; booking/admin pages are `noindex`.
- Data minimisation (no ID/financial data collected), separate optional marketing consent, automatic retention (anonymise after N months, delete messages earlier), and a privacy‑requests page for access exports and erasure.
- No analytics or non‑essential cookies, so no cookie banner is needed. Add consent controls before adding any tracking.

### Project layout
```
migrations/            SQL schema (exclusion constraint, checks)
scripts/               migrate, seed, create-admin
src/app/(site)/        public pages: home, /book, /booking/[ref], /legal/[slug]
src/app/admin/         dashboard (login, overview, appointments, availability, content, prices, legal, privacy, activity, settings)
src/app/api/           availability, bookings, webhooks/stripe, google/oauth, cron, test-payments
src/lib/availability/  pure slot engine + data loading
src/lib/booking/       booking lifecycle, calendar sync, tokens
src/lib/google/        Google OAuth + Calendar REST client
src/lib/payments/      provider interface, Stripe, simulated test provider, webhook processing
src/lib/email/         templates, providers (Resend/console), notification queue
tests/                 Vitest (engine unit tests + Postgres integration tests)
```

### Changing the payment provider
Implement `PaymentProvider` (`src/lib/payments/types.ts`: `createCheckout`, `expireCheckout`, `refund`), add a webhook route that verifies the provider's signature and calls `processVerifiedPaymentEvent`, and register it in `resolvePaymentProvider` (`src/lib/integrations.ts`).

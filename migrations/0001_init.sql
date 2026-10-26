-- Initial schema for Tony Jose consultation website.
-- Website bookings and payment status live here; Google Calendar remains the
-- source of truth for Tony's external commitments.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Administrators
-- ---------------------------------------------------------------------------
CREATE TABLE admin_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text NOT NULL,
  password_hash   text NOT NULL,
  role            text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);
CREATE UNIQUE INDEX admin_users_email_idx ON admin_users (lower(email));

CREATE TABLE admin_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ip          text,
  user_agent  text
);
CREATE INDEX admin_sessions_admin_idx ON admin_sessions (admin_id);

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
CREATE TABLE clients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  email                 text NOT NULL,
  phone                 text,
  country               text,
  marketing_opt_in      boolean NOT NULL DEFAULT false,
  marketing_opt_in_at   timestamptz,
  privacy_accepted_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  anonymised_at         timestamptz
);
CREATE UNIQUE INDEX clients_email_idx ON clients (lower(email)) WHERE anonymised_at IS NULL;

-- ---------------------------------------------------------------------------
-- Appointment types (editable from admin)
-- ---------------------------------------------------------------------------
CREATE TABLE appointment_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  name              text NOT NULL,
  short_name        text NOT NULL,
  description       text NOT NULL DEFAULT '',
  duration_minutes  integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  price_cents       integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency          text NOT NULL DEFAULT 'EUR',
  is_active         boolean NOT NULL DEFAULT true,
  one_per_client    boolean NOT NULL DEFAULT false,
  buffer_minutes    integer CHECK (buffer_minutes IS NULL OR buffer_minutes >= 0),
  calendar_label    text NOT NULL DEFAULT '',
  cta_label         text NOT NULL DEFAULT 'Book',
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
CREATE TABLE appointments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL UNIQUE,
  client_id             uuid NOT NULL REFERENCES clients(id),
  appointment_type_id   uuid NOT NULL REFERENCES appointment_types(id),
  start_at              timestamptz NOT NULL,
  end_at                timestamptz NOT NULL,
  -- end_at + buffer; used for overlap protection.
  occupied_until        timestamptz NOT NULL,
  time_zone             text NOT NULL DEFAULT 'Europe/Berlin',
  status                text NOT NULL CHECK (status IN (
                          'pending_payment', 'confirmed', 'cancelled', 'completed',
                          'no_show', 'expired', 'payment_failed', 'needs_attention')),
  payment_status        text NOT NULL CHECK (payment_status IN (
                          'not_required', 'pending', 'paid', 'failed', 'expired',
                          'refund_pending', 'refunded', 'partially_refunded')),
  hold_expires_at       timestamptz,
  price_cents           integer NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'EUR',
  enquiry_area          text,
  message               text,
  google_event_id       text,
  calendar_sync_status  text NOT NULL DEFAULT 'pending' CHECK (calendar_sync_status IN (
                          'pending', 'synced', 'failed', 'not_connected', 'removed')),
  calendar_sync_error   text,
  meeting_link          text,
  manage_token_hash     text NOT NULL,
  idempotency_key       text NOT NULL UNIQUE,
  reschedule_count      integer NOT NULL DEFAULT 0,
  attention_reason      text,
  cancellation_reason   text,
  cancelled_by          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  confirmed_at          timestamptz,
  cancelled_at          timestamptz,
  CHECK (end_at > start_at),
  CHECK (occupied_until >= end_at),
  -- Database-level guarantee: two active bookings (confirmed or holding a slot
  -- during checkout) can never overlap, even under concurrent requests.
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
    tstzrange(start_at, occupied_until, '[)') WITH &&
  ) WHERE (status IN ('pending_payment', 'confirmed'))
);
CREATE INDEX appointments_start_idx ON appointments (start_at);
CREATE INDEX appointments_client_idx ON appointments (client_id);
CREATE INDEX appointments_status_idx ON appointments (status);

CREATE TABLE appointment_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  admin_id        uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Availability
-- ---------------------------------------------------------------------------
CREATE TABLE availability_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekday     integer NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO: 1 = Monday
  start_time  text NOT NULL CHECK (start_time ~ '^\d{2}:\d{2}$'),
  end_time    text NOT NULL CHECK (end_time ~ '^\d{2}:\d{2}$'),
  is_active   boolean NOT NULL DEFAULT true,
  CHECK (end_time > start_time)
);

-- Extra availability opened on a specific date.
CREATE TABLE availability_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  start_time  text NOT NULL CHECK (start_time ~ '^\d{2}:\d{2}$'),
  end_time    text NOT NULL CHECK (end_time ~ '^\d{2}:\d{2}$'),
  note        text,
  created_by  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

-- Blocked periods. A row with recurrence = NULL blocks [start_at, end_at).
-- A recurring row repeats weekly: {"weekdays":[1,3],"startTime":"12:00","endTime":"13:00","until":"2027-01-01"}
-- starting from start_at's date (in the business time zone).
CREATE TABLE blocked_periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  all_day     boolean NOT NULL DEFAULT false,
  recurrence  jsonb,
  kind        text NOT NULL DEFAULT 'personal' CHECK (kind IN ('holiday', 'personal', 'other')),
  reason      text,
  created_by  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX blocked_periods_range_idx ON blocked_periods (start_at, end_at);

-- ---------------------------------------------------------------------------
-- Payments (no card data is ever stored)
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id        uuid NOT NULL REFERENCES appointments(id),
  provider              text NOT NULL,
  provider_session_id   text,
  provider_payment_id   text,
  checkout_url          text,
  amount_cents          integer NOT NULL,
  currency              text NOT NULL,
  status                text NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'cancelled')),
  refund_status         text NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'pending', 'refunded', 'partially_refunded', 'failed')),
  refunded_cents        integer NOT NULL DEFAULT 0,
  refund_reference      text,
  last_event            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_session_id)
);
CREATE INDEX payments_appointment_idx ON payments (appointment_id);

CREATE TABLE webhook_events (
  id           text PRIMARY KEY,         -- "<provider>:<event id>"
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Notifications (emails, reminders, admin alerts)
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id        uuid REFERENCES appointments(id) ON DELETE CASCADE,
  type                  text NOT NULL,
  recipient             text NOT NULL,
  scheduled_at          timestamptz NOT NULL DEFAULT now(),
  for_start_at          timestamptz,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled', 'skipped')),
  attempts              integer NOT NULL DEFAULT 0,
  sent_at               timestamptz,
  provider_message_id   text,
  error                 text,
  payload               jsonb,
  dedupe_key            text NOT NULL UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_due_idx ON notifications (status, scheduled_at);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  actor        text NOT NULL,           -- 'admin', 'client', 'system', 'webhook'
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  details      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- Google account (single connected calendar owner). Tokens are encrypted at
-- the application layer with APP_ENCRYPTION_KEY.
-- ---------------------------------------------------------------------------
CREATE TABLE google_accounts (
  id                        integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email                     text,
  encrypted_refresh_token   text NOT NULL,
  encrypted_access_token    text,
  access_token_expires_at   timestamptz,
  scopes                    text,
  status                    text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'revoked', 'error')),
  last_error                text,
  last_success_at           timestamptz,
  connected_at              timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Settings and editable content
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_content (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  description  text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE faqs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question     text NOT NULL,
  answer       text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Empty by default: no testimonials are invented. Only publish real ones
-- with the client's documented consent.
CREATE TABLE testimonials (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote              text NOT NULL,
  author             text NOT NULL,
  context            text,
  consent_confirmed  boolean NOT NULL DEFAULT false,
  is_published       boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_published OR consent_confirmed)
);

CREATE TABLE legal_pages (
  slug        text PRIMARY KEY,
  title       text NOT NULL,
  body_md     text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Rate limiting and privacy requests
-- ---------------------------------------------------------------------------
CREATE TABLE rate_limits (
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE data_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  type          text NOT NULL CHECK (type IN ('access', 'deletion', 'correction')),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'rejected')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

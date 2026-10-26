// Drizzle table definitions mirroring migrations/*.sql.
// Constraints (exclusion constraint, checks) live in the SQL migrations.
import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<"owner" | "staff">().notNull().default("owner"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastLoginAt: ts("last_login_at"),
});

export const adminSessions = pgTable("admin_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: uuid("admin_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  country: text("country"),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  marketingOptInAt: ts("marketing_opt_in_at"),
  privacyAcceptedAt: ts("privacy_accepted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  anonymisedAt: ts("anonymised_at"),
});

export const appointmentTypes = pgTable("appointment_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  description: text("description").notNull().default(""),
  durationMinutes: integer("duration_minutes").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("EUR"),
  isActive: boolean("is_active").notNull().default(true),
  onePerClient: boolean("one_per_client").notNull().default(false),
  bufferMinutes: integer("buffer_minutes"),
  calendarLabel: text("calendar_label").notNull().default(""),
  ctaLabel: text("cta_label").notNull().default("Book"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type AppointmentStatus =
  | "pending_payment"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show"
  | "expired"
  | "payment_failed"
  | "needs_attention";

export type PaymentStatus =
  | "not_required"
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "refund_pending"
  | "refunded"
  | "partially_refunded";

export type CalendarSyncStatus = "pending" | "synced" | "failed" | "not_connected" | "removed";

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: text("reference").notNull(),
  clientId: uuid("client_id").notNull(),
  appointmentTypeId: uuid("appointment_type_id").notNull(),
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at").notNull(),
  occupiedUntil: ts("occupied_until").notNull(),
  timeZone: text("time_zone").notNull().default("Europe/Berlin"),
  status: text("status").$type<AppointmentStatus>().notNull(),
  paymentStatus: text("payment_status").$type<PaymentStatus>().notNull(),
  holdExpiresAt: ts("hold_expires_at"),
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("EUR"),
  enquiryArea: text("enquiry_area"),
  message: text("message"),
  googleEventId: text("google_event_id"),
  calendarSyncStatus: text("calendar_sync_status").$type<CalendarSyncStatus>().notNull().default("pending"),
  calendarSyncError: text("calendar_sync_error"),
  meetingLink: text("meeting_link"),
  manageTokenHash: text("manage_token_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  rescheduleCount: integer("reschedule_count").notNull().default(0),
  attentionReason: text("attention_reason"),
  cancellationReason: text("cancellation_reason"),
  cancelledBy: text("cancelled_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  confirmedAt: ts("confirmed_at"),
  cancelledAt: ts("cancelled_at"),
});

export const appointmentNotes = pgTable("appointment_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentId: uuid("appointment_id").notNull(),
  adminId: uuid("admin_id"),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const availabilityRules = pgTable("availability_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const availabilityOverrides = pgTable("availability_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date", { mode: "string" }).notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Recurrence = {
  weekdays: number[];
  startTime: string;
  endTime: string;
  until?: string | null;
};

export const blockedPeriods = pgTable("blocked_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at").notNull(),
  allDay: boolean("all_day").notNull().default(false),
  recurrence: jsonb("recurrence").$type<Recurrence | null>(),
  kind: text("kind").$type<"holiday" | "personal" | "other">().notNull().default("personal"),
  reason: text("reason"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentId: uuid("appointment_id").notNull(),
  provider: text("provider").notNull(),
  providerSessionId: text("provider_session_id"),
  providerPaymentId: text("provider_payment_id"),
  checkoutUrl: text("checkout_url"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  status: text("status").$type<"pending" | "paid" | "failed" | "expired" | "cancelled">().notNull(),
  refundStatus: text("refund_status")
    .$type<"none" | "pending" | "refunded" | "partially_refunded" | "failed">()
    .notNull()
    .default("none"),
  refundedCents: integer("refunded_cents").notNull().default(0),
  refundReference: text("refund_reference"),
  lastEvent: text("last_event"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentId: uuid("appointment_id"),
  type: text("type").notNull(),
  recipient: text("recipient").notNull(),
  scheduledAt: ts("scheduled_at").notNull().defaultNow(),
  forStartAt: ts("for_start_at"),
  status: text("status").$type<"pending" | "sending" | "sent" | "failed" | "cancelled" | "skipped">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  sentAt: ts("sent_at"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: uuid("admin_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  details: jsonb("details").$type<Record<string, unknown> | null>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const googleAccounts = pgTable("google_accounts", {
  id: integer("id").primaryKey().default(1),
  email: text("email"),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  encryptedAccessToken: text("encrypted_access_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  scopes: text("scopes"),
  status: text("status").$type<"connected" | "revoked" | "error">().notNull().default("connected"),
  lastError: text("last_error"),
  lastSuccessAt: ts("last_success_at"),
  connectedAt: ts("connected_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const siteContent = pgTable("site_content", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const faqs = pgTable("faqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const testimonials = pgTable("testimonials", {
  id: uuid("id").primaryKey().defaultRandom(),
  quote: text("quote").notNull(),
  author: text("author").notNull(),
  context: text("context"),
  consentConfirmed: boolean("consent_confirmed").notNull().default(false),
  isPublished: boolean("is_published").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const legalPages = pgTable("legal_pages", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const dataRequests = pgTable("data_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  type: text("type").$type<"access" | "deletion" | "correction">().notNull(),
  status: text("status").$type<"open" | "completed" | "rejected">().notNull().default("open"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export type Appointment = typeof appointments.$inferSelect;
export type AppointmentType = typeof appointmentTypes.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type BlockedPeriod = typeof blockedPeriods.$inferSelect;
export type Payment = typeof payments.$inferSelect;

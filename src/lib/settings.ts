import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db";
import { settings as settingsTable } from "./db/schema";

const time = z.string().regex(/^\d{2}:\d{2}$/);

export const bookingSettingsSchema = z.object({
  timeZone: z.string().default("Europe/Berlin"),
  slotIntervalMinutes: z.number().int().min(5).max(120).default(15),
  bufferMinutes: z.number().int().min(0).max(240).default(15),
  minNoticeHours: z.number().min(0).max(24 * 30).default(12),
  maxAdvanceDays: z.number().int().min(1).max(365).default(60),
  /** How long a paid slot is held while the client pays. Stripe requires >= 30. */
  holdMinutes: z.number().int().min(5).max(24 * 60).default(30),
  allowClientCancel: z.boolean().default(true),
  allowClientReschedule: z.boolean().default(true),
  cancellationNoticeHours: z.number().min(0).max(24 * 30).default(24),
  rescheduleNoticeHours: z.number().min(0).max(24 * 30).default(24),
  maxReschedules: z.number().int().min(0).max(10).default(2),
  /** full_if_notice: automatic full refund when a client cancels with enough notice. */
  refundPolicy: z.enum(["full_if_notice", "manual"]).default("full_if_notice"),
  /** What to do when a payment succeeds but the slot is no longer available. */
  conflictResolution: z.enum(["refund", "review"]).default("refund"),
  /** Refuse bookings when Google is connected but cannot be reached. */
  requireCalendarCheck: z.boolean().default(true),
});

export const calendarSettingsSchema = z.object({
  bookingCalendarId: z.string().default("primary"),
  busyCalendarIds: z.array(z.string()).default(["primary"]),
  sendInvites: z.boolean().default(true),
  includeClientContact: z.boolean().default(true),
});

export const meetingSettingsSchema = z.object({
  mode: z.enum(["google_meet", "custom", "none"]).default("google_meet"),
  customInstructions: z.string().max(2000).default(""),
});

const templateSchema = z.object({ subject: z.string().max(200), intro: z.string().max(3000) });

export const emailSettingsSchema = z.object({
  fromName: z.string().max(100).default("Tony Jose"),
  fromAddress: z.string().max(200).default(""),
  replyTo: z.string().max(200).default(""),
  signature: z.string().max(1000).default("Tony Jose"),
  templates: z
    .object({
      confirmation: templateSchema,
      reminder: templateSchema,
      cancellation: templateSchema,
      reschedule: templateSchema,
      paymentIssue: templateSchema,
    })
    .default({
      confirmation: {
        subject: "Your consultation is confirmed: {{date}}",
        intro: "Hi {{name}}, thank you for booking. Your {{type}} is confirmed. The details are below.",
      },
      reminder: {
        subject: "Reminder: your consultation on {{date}}",
        intro: "Hi {{name}}, this is a friendly reminder of your upcoming {{type}}.",
      },
      cancellation: {
        subject: "Your consultation has been cancelled",
        intro: "Hi {{name}}, your {{type}} on {{date}} has been cancelled.",
      },
      reschedule: {
        subject: "Your consultation has moved to {{date}}",
        intro: "Hi {{name}}, your {{type}} has been rescheduled. The new details are below.",
      },
      paymentIssue: {
        subject: "Your booking was not completed",
        intro: "Hi {{name}}, we couldn't complete your booking for {{date}}.",
      },
    }),
});

export const notificationSettingsSchema = z.object({
  adminEmail: z.string().max(200).default(""),
  notifyAdminOnBooking: z.boolean().default(true),
  notifyAdminOnCancel: z.boolean().default(true),
  reminders: z
    .array(z.object({ hoursBefore: z.number().min(0.25).max(24 * 14), enabled: z.boolean() }))
    .default([
      { hoursBefore: 24, enabled: true },
      { hoursBefore: 1, enabled: false },
    ]),
});

export const paymentSettingsSchema = z.object({
  /** Which configured provider to use. Credentials always come from environment variables. */
  provider: z.enum(["stripe", "test"]).optional(),
  statementDescriptor: z.string().max(22).default("TONY JOSE CONSULT"),
});

export const privacySettingsSchema = z.object({
  /** Anonymise client personal data this many months after their last appointment. 0 disables. */
  retentionMonths: z.number().int().min(0).max(120).default(24),
  /** Delete the free-text message earlier, as it may contain personal details. */
  messageRetentionMonths: z.number().int().min(0).max(120).default(6),
});

const schemas = {
  booking: bookingSettingsSchema,
  calendar: calendarSettingsSchema,
  meeting: meetingSettingsSchema,
  email: emailSettingsSchema,
  notifications: notificationSettingsSchema,
  payments: paymentSettingsSchema,
  privacy: privacySettingsSchema,
} as const;

export type SettingsKey = keyof typeof schemas;
export type Settings = { [K in SettingsKey]: z.infer<(typeof schemas)[K]> };

export function parseSetting<K extends SettingsKey>(key: K, value: unknown): Settings[K] {
  const parsed = schemas[key].safeParse(value ?? {});
  if (parsed.success) return parsed.data as Settings[K];
  // Fall back to defaults if stored JSON is invalid rather than breaking booking.
  return schemas[key].parse({}) as Settings[K];
}

export async function getSettings<K extends SettingsKey>(...keys: K[]): Promise<Pick<Settings, K>> {
  const db = getDb();
  const rows = await db.select().from(settingsTable).where(inArray(settingsTable.key, keys));
  const out = {} as Pick<Settings, K>;
  for (const key of keys) {
    const row = rows.find((r) => r.key === key);
    out[key] = parseSetting(key, row?.value) as Pick<Settings, K>[K];
  }
  return out;
}

export async function getSetting<K extends SettingsKey>(key: K): Promise<Settings[K]> {
  return (await getSettings(key))[key];
}

export async function saveSetting<K extends SettingsKey>(key: K, value: Settings[K]): Promise<void> {
  const db = getDb();
  const valid = schemas[key].parse(value);
  await db
    .insert(settingsTable)
    .values({ key, value: valid })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: valid, updatedAt: new Date() } });
}

export async function deleteSetting(key: SettingsKey) {
  await getDb().delete(settingsTable).where(eq(settingsTable.key, key));
}

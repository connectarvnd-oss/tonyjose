import { z } from "zod";

export const ENQUIRY_AREAS = ["Visa", "Study Abroad", "Admissions", "Migration", "Other"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const bookingRequestSchema = z.object({
  appointmentTypeId: z.string().uuid(),
  start: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2, "Please enter your full name.").max(120),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address.").max(200),
  phone: optionalText(40).refine((v) => !v || /^[+()\d\s.-]{5,40}$/.test(v), "Please enter a valid phone number."),
  country: optionalText(80),
  enquiryArea: z.enum(ENQUIRY_AREAS).optional().nullable(),
  message: optionalText(1000),
  timeZone: z.string().max(64),
  privacyAccepted: z.literal(true, { errorMap: () => ({ message: "Please confirm you have read the privacy notice." }) }),
  marketingOptIn: z.boolean().default(false),
  idempotencyKey: z.string().min(16).max(80),
  // Spam protection
  website: z.string().max(200).optional(),
  startedAt: z.number().optional(),
  turnstileToken: z.string().max(4000).optional(),
});

export type BookingRequest = z.infer<typeof bookingRequestSchema>;

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const k = issue.path.join(".");
    if (!out[k]) out[k] = issue.message;
  }
  return out;
}

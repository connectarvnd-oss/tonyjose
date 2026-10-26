import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { appointments, appointmentTypes, clients, notifications, payments } from "../db/schema";
import { cancelPendingReminders } from "../email/notifications";

export async function findClientData(email: string) {
  const db = getDb();
  const cs = await db.select().from(clients).where(sql`lower(${clients.email}) = ${email.trim().toLowerCase()}`);
  if (!cs.length) return null;
  const ids = cs.map((c) => c.id);
  const appts = await db
    .select({ a: appointments, t: appointmentTypes.name })
    .from(appointments)
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
    .where(inArray(appointments.clientId, ids));
  const pays = appts.length ? await db.select().from(payments).where(inArray(payments.appointmentId, appts.map((x) => x.a.id))) : [];
  return { clients: cs, appointments: appts, payments: pays };
}

/** Data subject access export: everything held about the person, excluding admin-internal notes. */
export function exportPayload(data: NonNullable<Awaited<ReturnType<typeof findClientData>>>) {
  return {
    exportedAt: new Date().toISOString(),
    clients: data.clients.map((c) => ({
      name: c.name,
      email: c.email,
      phone: c.phone,
      country: c.country,
      marketingOptIn: c.marketingOptIn,
      marketingOptInAt: c.marketingOptInAt,
      privacyAcceptedAt: c.privacyAcceptedAt,
      createdAt: c.createdAt,
    })),
    appointments: data.appointments.map(({ a, t }) => ({
      reference: a.reference,
      type: t,
      start: a.startAt,
      end: a.endAt,
      timeZone: a.timeZone,
      status: a.status,
      paymentStatus: a.paymentStatus,
      price: a.priceCents / 100,
      currency: a.currency,
      enquiryArea: a.enquiryArea,
      message: a.message,
      createdAt: a.createdAt,
    })),
    payments: data.payments.map((p) => ({ provider: p.provider, amount: p.amountCents / 100, currency: p.currency, status: p.status, refunded: p.refundedCents / 100, createdAt: p.createdAt })),
  };
}

/**
 * Erasure: anonymises personal data. Booking and payment records remain
 * (without personal details) where needed for accounting obligations.
 */
export async function anonymiseClient(email: string) {
  const db = getDb();
  const data = await findClientData(email);
  if (!data) return 0;
  for (const c of data.clients) {
    for (const { a } of data.appointments.filter((x) => x.a.clientId === c.id)) {
      await cancelPendingReminders(a.id);
      await db.update(notifications).set({ status: "cancelled" }).where(eq(notifications.appointmentId, a.id));
    }
    await db
      .update(clients)
      .set({ name: "Anonymised client", email: `anonymised+${c.id}@invalid`, phone: null, country: null, marketingOptIn: false, anonymisedAt: new Date(), updatedAt: new Date() })
      .where(eq(clients.id, c.id));
    await db.update(appointments).set({ message: null, enquiryArea: null, updatedAt: new Date() }).where(eq(appointments.clientId, c.id));
  }
  return data.clients.length;
}

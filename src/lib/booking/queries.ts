import { eq } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { appointments, appointmentTypes, clients, payments } from "../db/schema";

export async function loadAppointment(id: string, db: DB = getDb()) {
  const [row] = await db
    .select({ appointment: appointments, client: clients, type: appointmentTypes })
    .from(appointments)
    .innerJoin(clients, eq(clients.id, appointments.clientId))
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
    .where(eq(appointments.id, id));
  return row ?? null;
}

export async function loadAppointmentByReference(reference: string) {
  const [row] = await getDb()
    .select({ appointment: appointments, client: clients, type: appointmentTypes })
    .from(appointments)
    .innerJoin(clients, eq(clients.id, appointments.clientId))
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, appointments.appointmentTypeId))
    .where(eq(appointments.reference, reference.toUpperCase()));
  return row ?? null;
}

export async function latestPayment(appointmentId: string, db: DB = getDb()) {
  const rows = await db.select().from(payments).where(eq(payments.appointmentId, appointmentId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

export type FullAppointment = NonNullable<Awaited<ReturnType<typeof loadAppointment>>>;

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { audit } from "@/lib/audit";
import { syncAppointmentToCalendar } from "@/lib/booking/calendar-sync";
import {
  BookingError,
  cancelAppointment,
  refundAppointment,
  rescheduleAppointment,
  resendNotification,
  setAppointmentOutcome,
} from "@/lib/booking/service";
import { getDb } from "@/lib/db";
import { appointmentNotes } from "@/lib/db/schema";

function back(id: string, msg: string, tone: "ok" | "err" = "ok"): never {
  revalidatePath(`/admin/appointments/${id}`);
  redirect(`/admin/appointments/${id}?${tone}=${encodeURIComponent(msg)}`);
}

async function run(id: string, fn: () => Promise<string>) {
  let msg: string;
  try {
    msg = await fn();
  } catch (err) {
    if (err instanceof BookingError) back(id, err.message, "err");
    console.error(err);
    back(id, (err as Error).message || "Something went wrong.", "err");
  }
  back(id, msg);
}

export async function addNote(id: string, fd: FormData) {
  const admin = await requireAdmin();
  const body = String(fd.get("body") ?? "").trim().slice(0, 4000);
  if (!body) back(id, "Note is empty.", "err");
  await getDb().insert(appointmentNotes).values({ appointmentId: id, adminId: admin.id, body });
  await audit({ actor: "admin", adminId: admin.id, action: "booking.note_added", entityType: "appointment", entityId: id });
  back(id, "Note added.");
}

export async function setOutcome(id: string, fd: FormData) {
  const admin = await requireAdmin();
  const status = String(fd.get("status")) as "completed" | "no_show" | "confirmed";
  await run(id, async () => {
    await setAppointmentOutcome(id, status, admin.id);
    return status === "completed" ? "Marked as completed." : status === "no_show" ? "Marked as no-show." : "Marked as confirmed.";
  });
}

export async function cancel(id: string, fd: FormData) {
  const admin = await requireAdmin();
  const refund = String(fd.get("refund") ?? "full") as "full" | "none";
  const notify = fd.get("notify") === "on";
  const reason = String(fd.get("reason") ?? "").slice(0, 500) || null;
  await run(id, async () => {
    await cancelAppointment(id, { by: "admin", refund, reason, adminId: admin.id, notifyClient: notify });
    return `Appointment cancelled${refund === "full" ? " and refund initiated (if paid)" : ""}.`;
  });
}

export async function reschedule(id: string, start: string) {
  const admin = await requireAdmin();
  try {
    await rescheduleAppointment(id, new Date(start), { by: "admin", adminId: admin.id });
  } catch (err) {
    return { error: err instanceof BookingError ? err.message : "Could not reschedule." };
  }
  revalidatePath(`/admin/appointments/${id}`);
  return { ok: true };
}

export async function refund(id: string, fd: FormData) {
  const admin = await requireAdmin("owner");
  const euros = Number(String(fd.get("amount") ?? "").replace(",", "."));
  const cents = Number.isFinite(euros) && euros > 0 ? Math.round(euros * 100) : undefined;
  await run(id, async () => {
    const r = await refundAppointment(id, { amountCents: cents, reason: "admin", adminId: admin.id });
    return `Refund of €${(r.amountCents / 100).toFixed(2)} ${r.status === "succeeded" ? "completed" : "initiated"}.`;
  });
}

export async function resend(id: string, fd: FormData) {
  const admin = await requireAdmin();
  const kind = String(fd.get("kind")) as "confirmation" | "reminder";
  await run(id, async () => {
    await resendNotification(id, kind, admin.id);
    return kind === "confirmation" ? "Confirmation email sent." : "Reminder email sent.";
  });
}

export async function retrySync(id: string) {
  const admin = await requireAdmin();
  await run(id, async () => {
    const r = await syncAppointmentToCalendar(id);
    await audit({ actor: "admin", adminId: admin.id, action: "calendar.retry_sync", entityType: "appointment", entityId: id, details: { result: r } });
    if (r === "failed") throw new Error("Calendar sync failed again. See the error below.");
    return r === "not_connected" ? "Google Calendar is not connected." : "Calendar synchronised.";
  });
}

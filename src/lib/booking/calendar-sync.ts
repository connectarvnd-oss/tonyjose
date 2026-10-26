import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appointments } from "../db/schema";
import { eventIdFor } from "../google/calendar";
import { integrations } from "../integrations";
import { getSettings } from "../settings";
import { alertAdmin } from "../email/notifications";
import { loadAppointment } from "./queries";

/**
 * Returns true if Google shows a busy period overlapping the given time
 * (plus buffer). Returns null if the calendar could not be checked.
 */
export async function calendarConflict(start: Date, end: Date, bufferMinutes: number): Promise<boolean | null> {
  const calendar = integrations().calendar;
  if ((await calendar.status()) !== "connected") return false;
  const { calendar: c } = await getSettings("calendar");
  const buf = bufferMinutes * 60_000;
  const range = { start: new Date(start.getTime() - buf), end: new Date(end.getTime() + buf) };
  try {
    const busy = await calendar.getBusy(range, c.busyCalendarIds.length ? c.busyCalendarIds : [c.bookingCalendarId]);
    return busy.some((b) => b.start < range.end && b.end > range.start);
  } catch (err) {
    console.error("[calendar] conflict check failed", err);
    return null;
  }
}

/**
 * Brings Tony's Google Calendar in line with the booking database for one
 * appointment. Safe to call repeatedly: the event id is derived from the
 * appointment id, so retries update rather than duplicate.
 */
export async function syncAppointmentToCalendar(appointmentId: string): Promise<"synced" | "failed" | "not_connected" | "removed" | "skipped"> {
  const db = getDb();
  const a = await loadAppointment(appointmentId);
  if (!a) return "skipped";
  const calendar = integrations().calendar;
  const status = await calendar.status();
  const { calendar: c, meeting, booking } = await getSettings("calendar", "meeting", "booking");
  const appt = a.appointment;
  const active = appt.status === "confirmed" || appt.status === "completed" || appt.status === "no_show";

  if (status !== "connected") {
    if (status === "revoked" && active) {
      await alertAdmin(
        "Google Calendar disconnected",
        `Booking ${appt.reference} could not be added to Google Calendar because access was revoked. Reconnect Google Calendar in Settings, then use "Retry calendar sync".`,
        `calendar-revoked:${new Date().toISOString().slice(0, 10)}`,
      );
    }
    await db.update(appointments).set({ calendarSyncStatus: "not_connected", updatedAt: new Date() }).where(eq(appointments.id, appointmentId));
    return "not_connected";
  }

  const eventId = appt.googleEventId ?? eventIdFor(appt.id);
  try {
    if (!active) {
      if (appt.googleEventId) await calendar.cancelEvent(c.bookingCalendarId, appt.googleEventId, c.sendInvites);
      await db.update(appointments).set({ calendarSyncStatus: "removed", calendarSyncError: null, updatedAt: new Date() }).where(eq(appointments.id, appointmentId));
      return "removed";
    }
    const isPaid = appt.priceCents > 0;
    const label = a.type.calendarLabel || (isPaid ? "Paid" : "Free");
    const lines = [
      `Booking reference: ${appt.reference}`,
      `Type: ${a.type.name} (${isPaid ? `paid, ${(appt.priceCents / 100).toFixed(2)} ${appt.currency}` : "free"})`,
      `Client: ${a.client.name}`,
      ...(c.includeClientContact ? [`Email: ${a.client.email}`, ...(a.client.phone ? [`Phone: ${a.client.phone}`] : [])] : []),
      ...(a.client.country ? [`Country of residence: ${a.client.country}`] : []),
      ...(appt.enquiryArea ? [`Area: ${appt.enquiryArea}`] : []),
      ...(meeting.mode === "custom" && meeting.customInstructions ? ["", meeting.customInstructions] : []),
      "",
      `Admin: ${(process.env.SITE_URL ?? "").replace(/\/$/, "")}/admin/appointments/${appt.id}`,
    ];
    const result = await calendar.upsertEvent({
      calendarId: c.bookingCalendarId,
      eventId,
      summary: `[${label}] ${a.type.shortName} — ${a.client.name}`,
      description: lines.join("\n"),
      start: appt.startAt,
      end: appt.endAt,
      timeZone: booking.timeZone,
      attendeeEmail: c.sendInvites ? a.client.email : null,
      attendeeName: a.client.name,
      createMeet: meeting.mode === "google_meet",
      sendUpdates: c.sendInvites,
      privateProps: { bookingReference: appt.reference, appointmentId: appt.id, source: "website" },
    });
    await db
      .update(appointments)
      .set({
        googleEventId: result.eventId,
        meetingLink: result.meetingLink ?? appt.meetingLink,
        calendarSyncStatus: "synced",
        calendarSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, appointmentId));
    return "synced";
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await db
      .update(appointments)
      .set({ calendarSyncStatus: "failed", calendarSyncError: message, updatedAt: new Date() })
      .where(eq(appointments.id, appointmentId));
    await alertAdmin(
      "Calendar sync failed",
      `Booking ${appt.reference} (${a.client.name}) could not be synchronised with Google Calendar: ${message}. The booking itself is safe. It will be retried automatically, or use "Retry calendar sync" in the dashboard.`,
      `sync-failed:${appt.id}:${appt.updatedAt.toISOString()}`,
      appt.id,
    );
    return "failed";
  }
}

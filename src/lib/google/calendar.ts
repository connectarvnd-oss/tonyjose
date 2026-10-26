// Google Calendar integration via the REST API (OAuth 2.0, offline access).
// Tokens are stored encrypted; nothing here is ever sent to the browser.
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { googleAccounts } from "../db/schema";
import { decrypt, encrypt } from "../security/crypto";
import type { TimeRange } from "../availability/engine";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

export class CalendarAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarAuthError";
  }
}
export class CalendarApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CalendarApiError";
  }
}

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new CalendarAuthError("Google OAuth credentials are not configured.");
  return { clientId, clientSecret };
}

export function redirectUri() {
  return `${(process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/google/oauth/callback`;
}

export function buildAuthUrl(state: string) {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCodeAndStore(code: string) {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new CalendarAuthError(body.error_description ?? body.error ?? "Token exchange failed");
  }
  if (!body.refresh_token) {
    throw new CalendarAuthError(
      "Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.",
    );
  }
  let email: string | null = null;
  try {
    const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    if (info.ok) email = ((await info.json()) as { email?: string }).email ?? null;
  } catch {
    // email is informational only
  }
  const values = {
    id: 1,
    email,
    encryptedRefreshToken: encrypt(body.refresh_token),
    encryptedAccessToken: encrypt(body.access_token),
    accessTokenExpiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    scopes: body.scope ?? GOOGLE_SCOPES.join(" "),
    status: "connected" as const,
    lastError: null,
    connectedAt: new Date(),
    updatedAt: new Date(),
  };
  await getDb()
    .insert(googleAccounts)
    .values(values)
    .onConflictDoUpdate({ target: googleAccounts.id, set: values });
  return { email };
}

export async function getGoogleAccount() {
  const [row] = await getDb().select().from(googleAccounts).where(eq(googleAccounts.id, 1));
  return row ?? null;
}

export async function disconnectGoogle() {
  const account = await getGoogleAccount();
  if (account) {
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(decrypt(account.encryptedRefreshToken))}`, {
        method: "POST",
      });
    } catch {
      // Revocation is best effort; local tokens are deleted regardless.
    }
    await getDb().delete(googleAccounts).where(eq(googleAccounts.id, 1));
  }
}

async function markAccount(status: "connected" | "revoked" | "error", lastError: string | null) {
  await getDb()
    .update(googleAccounts)
    .set({
      status,
      lastError,
      updatedAt: new Date(),
      ...(status === "connected" ? { lastSuccessAt: new Date() } : {}),
    })
    .where(eq(googleAccounts.id, 1));
}

async function getAccessToken(): Promise<string> {
  const account = await getGoogleAccount();
  if (!account) throw new CalendarAuthError("Google Calendar is not connected.");
  if (account.status === "revoked") throw new CalendarAuthError("Google access was revoked. Reconnect in Settings.");
  if (
    account.encryptedAccessToken &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() > Date.now() + 60_000
  ) {
    return decrypt(account.encryptedAccessToken);
  }
  const { clientId, clientSecret } = credentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decrypt(account.encryptedRefreshToken),
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      await markAccount("revoked", "Google refused the stored refresh token (access revoked or expired).");
      throw new CalendarAuthError("Google access was revoked or expired. Reconnect in Settings.");
    }
    await markAccount("error", body.error_description ?? body.error ?? `Token refresh failed (${res.status})`);
    throw new CalendarApiError("Could not refresh Google access token", res.status);
  }
  await getDb()
    .update(googleAccounts)
    .set({
      encryptedAccessToken: encrypt(body.access_token),
      accessTokenExpiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.id, 1));
  return body.access_token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls the Calendar API with retries on 429/5xx and network errors. */
async function api<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    if (attempt < 2) {
      await sleep(300 * 2 ** attempt);
      return api<T>(path, init, attempt + 1);
    }
    await markAccount("error", `Network error: ${(err as Error).message}`);
    throw new CalendarApiError(`Google Calendar unreachable: ${(err as Error).message}`, 0);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await sleep(500 * 2 ** attempt);
    return api<T>(path, init, attempt + 1);
  }
  if (res.status === 401 && attempt === 0) {
    // Token may have been revoked mid-flight; force a refresh once.
    await getDb().update(googleAccounts).set({ accessTokenExpiresAt: new Date(0) }).where(eq(googleAccounts.id, 1));
    return api<T>(path, init, attempt + 1);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    const message = (() => {
      try {
        return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
      } catch {
        return text;
      }
    })();
    if (res.status !== 404 && res.status !== 409 && res.status !== 410) await markAccount("error", message);
    throw new CalendarApiError(message, res.status);
  }
  await markAccount("connected", null);
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function listCalendars() {
  const data = await api<{ items: { id: string; summary: string; primary?: boolean; accessRole: string }[] }>(
    "/users/me/calendarList?minAccessRole=reader",
  );
  return data.items.map((c) => ({ id: c.id, summary: c.summary, primary: Boolean(c.primary), accessRole: c.accessRole }));
}

/** Busy periods only. Event titles and descriptions are never requested. */
export async function getBusy(range: TimeRange, calendarIds: string[]): Promise<TimeRange[]> {
  const data = await api<{
    calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }>;
  }>("/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: range.start.toISOString(),
      timeMax: range.end.toISOString(),
      items: calendarIds.map((id) => ({ id })),
    }),
  });
  const busy: TimeRange[] = [];
  for (const [id, cal] of Object.entries(data.calendars ?? {})) {
    if (cal.errors?.length) throw new CalendarApiError(`Calendar ${id}: ${cal.errors[0].reason}`, 400);
    for (const b of cal.busy ?? []) busy.push({ start: new Date(b.start), end: new Date(b.end) });
  }
  return busy;
}

export type CalendarEventInput = {
  calendarId: string;
  /** Deterministic id so retries never create duplicates. */
  eventId: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
  createMeet: boolean;
  sendUpdates: boolean;
  privateProps: Record<string, string>;
};

type GoogleEvent = {
  id: string;
  status?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
};

function meetLink(ev: GoogleEvent) {
  return ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null;
}

/** Google event ids must use base32hex characters [a-v0-9]. A UUID's hex digits qualify. */
export function eventIdFor(appointmentId: string) {
  return `tj${appointmentId.replace(/-/g, "").toLowerCase()}`;
}

function eventBody(input: CalendarEventInput, includeConference: boolean) {
  return {
    id: input.eventId,
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
    attendees: input.attendeeEmail ? [{ email: input.attendeeEmail, displayName: input.attendeeName ?? undefined }] : [],
    status: "confirmed",
    transparency: "opaque",
    reminders: { useDefault: true },
    extendedProperties: { private: input.privateProps },
    ...(includeConference
      ? { conferenceData: { createRequest: { requestId: input.eventId, conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
  };
}

/** Creates the event, or updates it if it already exists (idempotent). */
export async function upsertEvent(input: CalendarEventInput): Promise<{ eventId: string; meetingLink: string | null }> {
  const cal = encodeURIComponent(input.calendarId);
  const qs = `?conferenceDataVersion=1&sendUpdates=${input.sendUpdates ? "all" : "none"}`;
  try {
    const ev = await api<GoogleEvent>(`/calendars/${cal}/events${qs}`, {
      method: "POST",
      body: JSON.stringify(eventBody(input, input.createMeet)),
    });
    return { eventId: ev.id, meetingLink: meetLink(ev) };
  } catch (err) {
    if (!(err instanceof CalendarApiError) || err.status !== 409) throw err;
    // Already exists (retry, reschedule, or previously cancelled): patch it.
    const existing = await api<GoogleEvent>(`/calendars/${cal}/events/${input.eventId}`);
    const needsConference = input.createMeet && !meetLink(existing);
    const ev = await api<GoogleEvent>(`/calendars/${cal}/events/${input.eventId}${qs}`, {
      method: "PATCH",
      body: JSON.stringify(eventBody(input, needsConference)),
    });
    return { eventId: ev.id, meetingLink: meetLink(ev) };
  }
}

export async function cancelEvent(calendarId: string, eventId: string, sendUpdates: boolean) {
  try {
    await api<void>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=${sendUpdates ? "all" : "none"}`,
      { method: "DELETE" },
    );
  } catch (err) {
    if (err instanceof CalendarApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

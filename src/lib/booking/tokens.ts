import { createHmac } from "node:crypto";
import { safeEqual } from "../security/crypto";

function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET must be set (at least 32 characters).");
  return s;
}

/** Unguessable per-booking token for the client's manage link (HMAC, never stored in plain text). */
export function manageTokenFor(appointmentId: string) {
  return createHmac("sha256", secret()).update(`manage:${appointmentId}`).digest("base64url");
}

export function verifyManageToken(appointmentId: string, token: string | null | undefined) {
  if (!token) return false;
  return safeEqual(manageTokenFor(appointmentId), token);
}

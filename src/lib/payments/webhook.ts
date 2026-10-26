import { getDb, pgErrorCode, UNIQUE_VIOLATION } from "../db";
import { webhookEvents } from "../db/schema";
import { handlePaymentEvent } from "../booking/service";
import type { PaymentEvent } from "./types";
import { eq } from "drizzle-orm";

/**
 * Processes a verified provider event exactly once. If processing throws, the
 * dedupe record is removed so the provider's retry is handled again.
 */
export async function processVerifiedPaymentEvent(provider: string, eventId: string, type: string, event: PaymentEvent | null) {
  const id = `${provider}:${eventId}`;
  try {
    await getDb().insert(webhookEvents).values({ id, type });
  } catch (err) {
    if (pgErrorCode(err) === UNIQUE_VIOLATION) return "duplicate";
    throw err;
  }
  if (!event) return "ignored";
  try {
    return await handlePaymentEvent(event);
  } catch (err) {
    await getDb().delete(webhookEvents).where(eq(webhookEvents.id, id));
    throw err;
  }
}

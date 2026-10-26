import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { applyRetention, expireStaleHolds, retryFailedCalendarSyncs } from "@/lib/booking/service";
import { processDueNotifications } from "@/lib/email/notifications";
import { purgeRateLimits } from "@/lib/security/rate-limit";
import { safeEqual } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Run every 5 minutes (see vercel.json or your scheduler):
//   curl -H "Authorization: Bearer $CRON_SECRET" https://site/api/cron
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      result[name] = await fn();
    } catch (err) {
      console.error(`[cron] ${name} failed`, err);
      result[name] = { error: (err as Error).message };
    }
  };
  await step("expiredHolds", () => expireStaleHolds());
  await step("notifications", () => processDueNotifications({ limit: 50 }));
  await step("calendarRetries", () => retryFailedCalendarSyncs());
  // Retention and housekeeping only once an hour.
  if (new Date().getMinutes() < 5) {
    await step("retention", () => applyRetention());
    await step("rateLimits", () => purgeRateLimits());
  }
  await getDb().execute(sql`INSERT INTO settings (key, value) VALUES ('system.cron', ${JSON.stringify({ lastRunAt: new Date().toISOString() })}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;

import { sql } from "drizzle-orm";
import { getDb } from "../db";

/**
 * Fixed-window rate limiter backed by Postgres, so it works across
 * serverless instances. Returns true when the request is allowed.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const res = await getDb().execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart.toISOString()}::timestamptz, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`);
  return (res.rows[0]?.count ?? 0) <= limit;
}

export async function purgeRateLimits() {
  await getDb().execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

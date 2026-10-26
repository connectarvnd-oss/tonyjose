/** Optional Cloudflare Turnstile verification. Skipped when not configured. */
export async function verifyTurnstile(token: string | null | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { success?: boolean };
    return Boolean(body.success);
  } catch {
    return false;
  }
}

/** Honeypot + minimum fill time. Bots fill hidden fields and submit instantly. */
export function looksLikeBot(honeypot: string | null | undefined, startedAt: number | null | undefined) {
  if (honeypot && honeypot.trim() !== "") return true;
  if (startedAt && Date.now() - startedAt < 2500) return true;
  return false;
}

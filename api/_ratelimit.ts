/* ==========================================================================
   On the Road · Fixed-window rate limiter (Upstash REST)
   --------------------------------------------------------------------------
   Cheap per-endpoint throttling so a runaway client (or scraper) can't burn
   through the Google Places quota or DeepSeek/Tavily spend. Uses Upstash's
   REST API directly (INCR + EXPIRE) rather than pulling in the @upstash/redis
   SDK — this is the only thing we need it for.

   Fails OPEN when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN aren't
   set, so local dev works without a Redis instance and a Redis outage never
   takes the app down with it — it just stops limiting.

   Env (server-side ONLY):
     UPSTASH_REDIS_REST_URL
     UPSTASH_REDIS_REST_TOKEN
   ========================================================================== */

export interface RateLimitResult {
  /** True when the request is allowed to proceed. */
  ok: boolean;
  /** Seconds until the caller may retry — only meaningful when !ok. */
  retryAfter: number;
}

const ALLOW: RateLimitResult = { ok: true, retryAfter: 0 };

/**
 * Fixed-window counter: `key` gets INCR'd, and on its first hit in the window
 * an EXPIRE of `windowSec` is set. If the count exceeds `limit`, the caller is
 * throttled until the window resets.
 */
export async function checkRateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return ALLOW; // fail-open: no Redis configured

  try {
    const redisKey = `ratelimit:${key}`;
    // Pipeline INCR + EXPIRE NX (only set the TTL if this key has none yet,
    // i.e. this is the first hit in a fresh window) in one round trip.
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['EXPIRE', redisKey, String(windowSec), 'NX'],
      ]),
    });
    if (!res.ok) return ALLOW; // fail-open on Upstash errors too

    const results = await res.json() as { result: unknown }[];
    const count = Number(results[0]?.result ?? 0);
    if (count > limit) {
      // TTL tells us exactly how long until the window resets.
      const ttlRes = await fetch(`${url}/ttl/${encodeURIComponent(redisKey)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ttl = ttlRes.ok ? Number(((await ttlRes.json()) as { result: number }).result) : windowSec;
      return { ok: false, retryAfter: ttl > 0 ? ttl : windowSec };
    }
    return ALLOW;
  } catch (e) {
    console.error('[ratelimit] check failed, failing open:', e);
    return ALLOW;
  }
}

/** Send a 429 with Retry-After, for endpoints that don't already have a
 *  res.status(...).json(...) helper of their own. */
export function respondRateLimited(
  res: { setHeader(k: string, v: string): void; status(c: number): { json(d: unknown): void } },
  retryAfter: number,
): void {
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({
    error: 'rate_limited',
    message: 'Too many requests — please slow down and try again shortly.',
    retryAfter,
  });
}

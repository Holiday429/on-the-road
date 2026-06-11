/* ==========================================================================
   On the Road · API base resolver
   --------------------------------------------------------------------------
   Single source of truth for where the serverless functions live.

   - Production (Vercel) and local dev (`vite dev` proxies /api) → same origin,
     so an empty base means a relative fetch to `/api/*`.
   - GitHub Pages has no serverless layer, so it points at the Vercel deploy.

   All AI calls go through these endpoints — never call an LLM provider from the
   browser. Provider keys live server-side only (no VITE_ prefix), which is both
   the security boundary and the single choke point for usage metering / paywall.
   ========================================================================== */

const VERCEL_ORIGIN = 'https://easy-on-the-road.vercel.app';

/** Base URL for /api/* calls. Empty string = same-origin relative fetch. */
export function apiBase(): string {
  return window.location.hostname.includes('github.io') ? VERCEL_ORIGIN : '';
}

/** Build a full URL for a serverless endpoint, e.g. apiUrl('/api/guide'). */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

/**
 * POST JSON to a serverless endpoint and parse the JSON response.
 * Throws on non-2xx so callers can fall back to a heuristic/offline path.
 */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

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

import { currentUser } from '../firebase/auth.ts';
import { track } from './analytics.ts';

const VERCEL_ORIGIN = 'https://www.easy-on-the-road.app';

/** Base URL for /api/* calls. Empty string = same-origin relative fetch. */
export function apiBase(): string {
  return window.location.hostname.includes('github.io') ? VERCEL_ORIGIN : '';
}

/** Build a full URL for a serverless endpoint, e.g. apiUrl('/api/guide'). */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

/** Thrown by postJson when the server returns 402 (quota exceeded / not paid). */
export class QuotaError extends Error {
  readonly plan: string;
  readonly upgrade: boolean;
  /** True when the user is out of AI credits and should buy an AI top-up (vs a
   *  free user who hasn't paid at all and should see the plan options). */
  readonly needTopup: boolean;
  constructor(plan: string, upgrade: boolean, message: string, needTopup = false) {
    super(message);
    this.name = 'QuotaError';
    this.plan = plan;
    this.upgrade = upgrade;
    this.needTopup = needTopup;
  }
}

/** Thrown by postJson when the server returns 401 (not authenticated). */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Returns Authorization + Content-Type headers with the current ID token.
 * Use this for manual fetch() calls (e.g. SSE streams) that can't go through postJson.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const user = currentUser();
  if (user) {
    try {
      headers['Authorization'] = `Bearer ${await user.getIdToken()}`;
    } catch { /* guard will return 401 */ }
  }
  return headers;
}

/**
 * POST JSON to a serverless endpoint and parse the JSON response.
 * Attaches the Firebase ID token so the guard can verify the caller.
 * Throws QuotaError on 402, AuthError on 401, generic Error on other failures.
 */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Attach ID token if signed in. Guard will reject unauthenticated requests.
  const user = currentUser();
  if (user) {
    try {
      const token = await user.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch {
      // getIdToken failing is not fatal here — the guard will return 401.
    }
  }

  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    const data = await res.json().catch(() => ({})) as { message?: string };
    throw new AuthError(data.message ?? 'Sign in to use AI features.');
  }

  if (res.status === 402) {
    const data = await res.json().catch(() => ({})) as { plan?: string; upgrade?: boolean; message?: string; needTopup?: boolean };
    throw new QuotaError(
      data.plan ?? 'free',
      data.upgrade ?? true,
      data.message ?? 'AI features require a Trip Pass.',
      data.needTopup ?? false,
    );
  }

  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  track('ai_generate', { feature: path.replace(/^\/api\//, '') });
  return res.json() as Promise<T>;
}

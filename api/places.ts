/* ==========================================================================
   On the Road · /api/places  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Server-side proxy for Google Places so the API key NEVER reaches the browser
   (a client-side key is trivially scraped from the Network tab and abused on
   your bill). The browser calls this endpoint; we call Google with the key.

   GET ?op=autocomplete&q=<text>&session=<token>   (requires Authorization: Bearer <Firebase ID token>)
   GET ?op=details&placeId=<id>&session=<token>    (requires Authorization: Bearer <Firebase ID token>)
   GET ?op=photo-sign&ref=<photo_reference>         (requires Authorization) → { url, exp }
   GET ?op=photo&ref=<photo_reference>&sig=&exp=    → 302 redirect to the photo bytes

   `op=photo` is unauthenticated by necessity (it's loaded as an <img src>,
   which can't carry an Authorization header) — it instead requires a short-
   lived HMAC signature over the ref, minted by op=photo-sign (which DOES
   require a token). This keeps the photo redirect from being an open proxy
   for arbitrary Google Places photo references.

   Keys in .env (server-side ONLY — no VITE_ prefix):
     GOOGLE_PLACES_KEY
     PLACES_PHOTO_SECRET
   ========================================================================== */

import * as crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { verifyFirebaseToken } from './_guard';
import { checkRateLimit, respondRateLimited } from './_ratelimit';

type VercelRequest  = IncomingMessage & { query: Record<string, string | string[] | undefined>; method?: string; headers: Record<string, string | string[] | undefined> };
type VercelResponse = ServerResponse & {
  json(data: unknown): void;
  status(code: number): VercelResponse;
  setHeader(k: string, v: string): void;
  redirect(code: number, url: string): void;
  end(): void;
};

const ALLOWED_ORIGINS = new Set([
  'https://www.easy-on-the-road.app',
  'https://easy-on-the-road.app',
  'http://localhost:5180',
]);

const PHOTO_SIG_TTL_SEC = 15 * 60; // 15 minutes

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function corsOrigin(req: VercelRequest): string | null {
  const origin = str(req.headers['origin'] as string | string[] | undefined);
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function signPhotoRef(ref: string, exp: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${ref}:${exp}`).digest('hex');
}

function verifyPhotoSig(ref: string, exp: number, sig: string, secret: string): boolean {
  if (!Number.isFinite(exp) || Date.now() > exp * 1000) return false;
  const expected = signPhotoRef(ref, exp, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
  } catch {
    return false;
  }
}

async function requireAuth(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const authHeader = req.headers['authorization'];
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  if (!token) { res.status(401).json({ error: 'unauthenticated' }); return null; }
  try {
    return await verifyFirebaseToken(token);
  } catch (e) {
    console.error('[places] Token verification failed:', e);
    res.status(401).json({ error: 'unauthenticated', message: 'Session expired. Please sign in again.' });
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = corsOrigin(req);
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) { res.status(503).json({ error: 'Places not configured' }); return; }

  const op = str(req.query.op);
  const session = str(req.query.session);

  try {
    if (op === 'autocomplete') {
      const uid = await requireAuth(req, res);
      if (!uid) return;
      const q = str(req.query.q);
      if (q.length < 3) { res.status(200).json({ predictions: [] }); return; }
      const limit = await checkRateLimit(`places:${uid}`, 30, 60);
      if (!limit.ok) { respondRateLimited(res, limit.retryAfter); return; }
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json`
        + `?input=${encodeURIComponent(q)}&types=establishment&key=${key}`
        + (session ? `&sessiontoken=${encodeURIComponent(session)}` : '');
      const data = await (await fetch(url)).json() as { predictions?: unknown[] };
      const predictions = (data.predictions ?? []).slice(0, 5).map((p) => {
        const r = p as Record<string, any>;
        return {
          description: r.description,
          mainText: r.structured_formatting?.main_text ?? r.description,
          secondaryText: r.structured_formatting?.secondary_text ?? '',
          placeId: r.place_id,
        };
      });
      res.status(200).json({ predictions });
      return;
    }

    if (op === 'details') {
      const uid = await requireAuth(req, res);
      if (!uid) return;
      const placeId = str(req.query.placeId);
      if (!placeId) { res.status(400).json({ error: 'placeId required' }); return; }
      const limit = await checkRateLimit(`places:${uid}`, 30, 60);
      if (!limit.ok) { respondRateLimited(res, limit.retryAfter); return; }
      const fields = 'formatted_address,geometry,url,photos';
      const url = `https://maps.googleapis.com/maps/api/place/details/json`
        + `?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${key}`
        + (session ? `&sessiontoken=${encodeURIComponent(session)}` : '');
      const data = await (await fetch(url)).json() as { result?: Record<string, any> };
      const r = data.result;
      if (!r) { res.status(200).json({ result: null }); return; }
      res.status(200).json({
        result: {
          address: r.formatted_address ?? '',
          mapsUrl: r.url ?? `https://maps.google.com/?place_id=${placeId}`,
          lat: r.geometry?.location?.lat ?? 0,
          lng: r.geometry?.location?.lng ?? 0,
          photoRef: r.photos?.[0]?.photo_reference,
        },
      });
      return;
    }

    if (op === 'photo-sign') {
      if (!(await requireAuth(req, res))) return;
      const ref = str(req.query.ref);
      if (!ref) { res.status(400).json({ error: 'ref required' }); return; }
      const secret = process.env.PLACES_PHOTO_SECRET;
      if (!secret) { res.status(503).json({ error: 'Photo signing not configured' }); return; }
      const exp = Math.floor(Date.now() / 1000) + PHOTO_SIG_TTL_SEC;
      const sig = signPhotoRef(ref, exp, secret);
      const url = `/api/places?op=photo&ref=${encodeURIComponent(ref)}&exp=${exp}&sig=${sig}`;
      res.status(200).json({ url, exp });
      return;
    }

    if (op === 'photo') {
      const ref = str(req.query.ref);
      const sig = str(req.query.sig);
      const exp = Number(str(req.query.exp));
      if (!ref) { res.status(400).json({ error: 'ref required' }); return; }
      const secret = process.env.PLACES_PHOTO_SECRET;
      if (!secret) { res.status(503).json({ error: 'Photo signing not configured' }); return; }
      if (!sig || !verifyPhotoSig(ref, exp, sig, secret)) {
        res.status(403).json({ error: 'invalid or expired signature' });
        return;
      }
      // Resolve the redirect server-side so the key isn't in the <img> src. The
      // Places photo endpoint 302s to the actual image; forward that location.
      const url = `https://maps.googleapis.com/maps/api/place/photo`
        + `?maxwidth=800&photo_reference=${encodeURIComponent(ref)}&key=${key}`;
      const upstream = await fetch(url, { redirect: 'manual' });
      const loc = upstream.headers.get('location');
      if (loc) { res.redirect(302, loc); return; }
      res.status(502).json({ error: 'No photo location' });
      return;
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (e) {
    console.error('[places] error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
}

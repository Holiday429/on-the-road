/* ==========================================================================
   On the Road · /api/create-checkout  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Creates a Lemon Squeezy checkout session and returns the URL.

   POST body: { plan: 'trip_pass' | 'lifetime' }
   Headers:   Authorization: Bearer <Firebase ID token>

   Keys in .env (server-side only, no VITE_ prefix):
     FIREBASE_SERVICE_ACCOUNT
     LEMON_SQUEEZY_API_KEY
     LEMON_SQUEEZY_STORE_ID
     LEMON_SQUEEZY_VARIANT_TRIP
     LEMON_SQUEEZY_VARIANT_LIFETIME
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined>; method?: string };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse; setHeader(k: string, v: string): void; end(): void };

type Plan = 'trip_pass' | 'lifetime';

const VARIANT_ENV: Record<Plan, string> = {
  trip_pass: 'LEMON_SQUEEZY_VARIANT_TRIP',
  lifetime:  'LEMON_SQUEEZY_VARIANT_LIFETIME',
};

// ── Firebase token verification (same pattern as _guard.ts) ──────────────────

async function verifyFirebaseToken(token: string): Promise<string> {
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  const sa = JSON.parse(raw) as { project_id: string };
  const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/robot/v1/metadata/jwks/securetoken@system.gserviceaccount.com'));
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${sa.project_id}`,
    audience: sa.project_id,
  });
  const uid = payload.sub ?? (payload as Record<string, unknown>).user_id;
  if (!uid || typeof uid !== 'string') throw new Error('No uid in token');
  return uid;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const authHeader = req.headers['authorization'];
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'unauthenticated' }); return; }

  let uid: string;
  try {
    uid = await verifyFirebaseToken(token);
  } catch (e) {
    // Log the real reason so Vercel function logs reveal whether this is an
    // expired/clock-skewed token, a JWKS fetch failure, a bad service-account
    // JSON, or a project_id mismatch — all of which otherwise look identical.
    console.error('[create-checkout] Token verification failed:', e);
    res.status(401).json({ error: 'unauthenticated', message: 'Session expired. Please sign in again.' });
    return;
  }

  const plan = req.body.plan as Plan;
  if (plan !== 'trip_pass' && plan !== 'lifetime') {
    res.status(400).json({ error: 'invalid plan — must be trip_pass or lifetime' });
    return;
  }

  const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
  const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
  const variantId = process.env[VARIANT_ENV[plan]];

  if (!apiKey || !storeId || !variantId) {
    res.status(503).json({ error: 'Payments not configured yet. Contact support.' });
    return;
  }

  try {
    const lsRes = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            // Pass uid + plan through so the webhook (and the future China
            // payment callback) know who bought what without guessing from the
            // variant id. _billing.grantQuota dedupes on the order id.
            checkout_data: { custom: { uid, plan } },
            product_options: {
              redirect_url: `${process.env.APP_URL ?? 'https://easy-on-the-road.vercel.app'}/?payment=success`,
            },
          },
          relationships: {
            store:   { data: { type: 'stores',   id: storeId } },
            variant: { data: { type: 'variants',  id: variantId } },
          },
        },
      }),
    });

    if (!lsRes.ok) {
      const body = await lsRes.text();
      console.error('[create-checkout] LS error', lsRes.status, body);
      res.status(502).json({ error: `Checkout creation failed (${lsRes.status})` });
      return;
    }

    const data = await lsRes.json() as { data: { attributes: { url: string } } };
    const url = data.data?.attributes?.url;
    if (!url) { res.status(502).json({ error: 'No checkout URL in response' }); return; }

    res.status(200).json({ url });
  } catch (e) {
    console.error('[create-checkout] unexpected error:', e);
    res.status(500).json({ error: 'Internal error' });
  }
}

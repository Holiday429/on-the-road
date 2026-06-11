/* ==========================================================================
   On the Road · /api/create-checkout  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Creates a Lemon Squeezy checkout session and returns the URL. The client
   opens this URL in a new tab; after payment LS fires a webhook that writes
   users/{uid}.plan back to Firestore (see billing-webhook.ts).

   POST body: { plan: 'trip_pass' | 'lifetime' }
   Headers:   Authorization: Bearer <Firebase ID token>

   Keys in .env (server-side only, no VITE_ prefix):
     FIREBASE_SERVICE_ACCOUNT      — Firebase Admin SDK JSON
     LEMON_SQUEEZY_API_KEY         — LS API key (Bearer)
     LEMON_SQUEEZY_STORE_ID        — numeric store id
     LEMON_SQUEEZY_VARIANT_TRIP    — product variant id for trip_pass
     LEMON_SQUEEZY_VARIANT_LIFETIME — product variant id for lifetime
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined>; method?: string };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse; setHeader(k: string, v: string): void; end(): void };

type Plan = 'trip_pass' | 'lifetime';

const VARIANT_ENV: Record<Plan, string> = {
  trip_pass: 'LEMON_SQUEEZY_VARIANT_TRIP',
  lifetime:  'LEMON_SQUEEZY_VARIANT_LIFETIME',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // ── Auth: verify ID token, but don't meter (checkout is not an AI call) ──────
  // We re-use the admin init from _guard but call verifyIdToken directly.
  // Simplest approach: call verifyAndMeter with a temporary plan override that
  // always passes. Instead, we do a lighter auth-only check here.

  const authHeader = req.headers['authorization'];
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'unauthenticated' }); return; }

  let uid: string;
  try {
    if (getApps().length === 0) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
      initializeApp({ credential: cert(JSON.parse(raw)) });
    }
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ error: 'unauthenticated', message: 'Session expired.' });
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
            // Embed uid so the webhook can map the purchase back to a user.
            checkout_data: { custom: { uid } },
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

/* ==========================================================================
   On the Road · /api/billing-webhook  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Receives Lemon Squeezy webhook events and updates users/{uid}.plan in
   Firestore. The uid is embedded in checkout custom_data by create-checkout.ts.

   Supported events:
     order_created            → trip_pass (one-time purchase)
     subscription_created     → (reserved for future monthly plans)
     subscription_cancelled   → free
     subscription_expired     → free

   Keys in .env (server-side only, no VITE_ prefix):
     FIREBASE_SERVICE_ACCOUNT         — Firebase Admin SDK JSON
     LEMON_SQUEEZY_WEBHOOK_SECRET     — signing secret from LS dashboard

   Vercel config: set BODY_LIMIT=2mb in vercel.json (raw body needed for HMAC).
   ========================================================================== */

import * as crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

type VercelRequest  = IncomingMessage & { body: Buffer | string; headers: Record<string, string | string[] | undefined>; method?: string };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse };

// ── Plan types ────────────────────────────────────────────────────────────────
type Plan = 'free' | 'trip_pass' | 'lifetime';

const PLAN_ENTITLEMENTS: Record<Plan, string[]> = {
  free:      [],
  trip_pass: ['ai.guide', 'ai.safety', 'ai.story', 'ai.check'],
  lifetime:  ['ai.guide', 'ai.safety', 'ai.story', 'ai.check', 'export.pdf', 'collab.unlimited'],
};

// ── Admin SDK init ────────────────────────────────────────────────────────────
function ensureAdmin(): void {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  initializeApp({ credential: cert(JSON.parse(raw)) });
}

// ── Signature verification ────────────────────────────────────────────────────
function verifySignature(rawBody: Buffer | string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof rawBody === 'string' ? rawBody : rawBody);
  const expected = hmac.digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

// ── LS payload shape ──────────────────────────────────────────────────────────
interface LSPayload {
  meta: {
    event_name: string;
    custom_data?: { uid?: string };
  };
  data: {
    attributes: {
      status?: string;
      first_order_item?: { variant_id?: number };
      custom_data?: { uid?: string };
    };
  };
}

function planFromEvent(event: string): Plan | null {
  if (event === 'order_created') return 'trip_pass';
  if (event === 'subscription_created') return 'trip_pass';
  if (event === 'subscription_cancelled' || event === 'subscription_expired') return 'free';
  return null; // unhandled event
}

function uidFromPayload(payload: LSPayload): string | null {
  return (
    payload.meta.custom_data?.uid ||
    payload.data.attributes.custom_data?.uid ||
    null
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const config = { api: { bodyParser: false } }; // need raw body for HMAC

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) { res.status(500).json({ error: 'Webhook secret not configured' }); return; }

  const signature = (req.headers['x-signature'] as string) ?? '';
  // Vercel passes the raw body as req.body when bodyParser is false.
  const rawBody = req.body as Buffer | string;
  if (!rawBody || !signature) { res.status(400).json({ error: 'Missing body or signature' }); return; }

  if (!verifySignature(rawBody, signature, secret)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let payload: LSPayload;
  try {
    const str = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    payload = JSON.parse(str) as LSPayload;
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const event = payload.meta.event_name;
  const plan = planFromEvent(event);
  if (plan === null) {
    // Acknowledge unhandled events without error.
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  const uid = uidFromPayload(payload);
  if (!uid) {
    console.warn('[billing-webhook] No uid in custom_data for event', event);
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  try {
    ensureAdmin();
    const db = getFirestore();
    const entitlements = PLAN_ENTITLEMENTS[plan];

    const patch: Record<string, unknown> = {
      plan,
      entitlements,
      _updatedAt: FieldValue.serverTimestamp(),
    };
    if (plan === 'trip_pass') {
      patch.tripPassExpiresAt = null; // permanent one-time purchase
    }

    await db.doc(`users/${uid}`).set(patch, { merge: true });
    console.info('[billing-webhook] Updated uid=%s plan=%s event=%s', uid, plan, event);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[billing-webhook] Firestore write failed:', e);
    res.status(500).json({ error: 'Database write failed' });
  }
}

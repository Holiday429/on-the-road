/* ==========================================================================
   On the Road · /api/billing-webhook  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Receives Lemon Squeezy webhook events and updates users/{uid}.plan in
   Firestore via REST API (no firebase-admin — avoids CJS/ESM conflict).

   Supported events:
     order_created            → trip_pass (one-time purchase)
     subscription_cancelled   → free
     subscription_expired     → free

   Keys in .env (server-side only, no VITE_ prefix):
     FIREBASE_SERVICE_ACCOUNT
     LEMON_SQUEEZY_WEBHOOK_SECRET
   ========================================================================== */

import * as crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleAuth } from 'google-auth-library';

type VercelRequest  = IncomingMessage & { body: Buffer | string; headers: Record<string, string | string[] | undefined>; method?: string };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse };

type Plan = 'free' | 'trip_pass' | 'lifetime';

const PLAN_ENTITLEMENTS: Record<Plan, string[]> = {
  free:      [],
  trip_pass: ['ai.guide', 'ai.safety', 'ai.story', 'ai.check'],
  lifetime:  ['ai.guide', 'ai.safety', 'ai.story', 'ai.check', 'export.pdf', 'collab.unlimited'],
};

// ── Google access token ───────────────────────────────────────────────────────

let _auth: GoogleAuth | null = null;
async function getAccessToken(): Promise<{ token: string; projectId: string }> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  const sa = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
  if (!_auth) {
    _auth = new GoogleAuth({
      credentials: { client_email: sa.client_email, private_key: sa.private_key },
      scopes: ['https://www.googleapis.com/auth/datastore'],
    });
  }
  const client = await _auth.getClient();
  const tokenResp = await client.getAccessToken();
  if (!tokenResp.token) throw new Error('Failed to obtain Google access token');
  return { token: tokenResp.token, projectId: sa.project_id };
}

// ── Firestore REST write ──────────────────────────────────────────────────────

async function writeUserPlan(uid: string, plan: Plan): Promise<void> {
  const { token, projectId } = await getAccessToken();
  const entitlements = PLAN_ENTITLEMENTS[plan];
  const now = Date.now();

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}` +
    `?updateMask.fieldPaths=plan&updateMask.fieldPaths=entitlements&updateMask.fieldPaths=_updatedAt` +
    (plan === 'trip_pass' ? '&updateMask.fieldPaths=tripPassExpiresAt' : '');

  const fields: Record<string, unknown> = {
    plan:         { stringValue: plan },
    entitlements: { arrayValue: { values: entitlements.map(e => ({ stringValue: e })) } },
    _updatedAt:   { integerValue: String(now) },
  };
  if (plan === 'trip_pass') {
    fields.tripPassExpiresAt = { nullValue: null };
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) throw new Error(`Firestore REST ${res.status}: ${await res.text()}`);
}

// ── Signature verification ────────────────────────────────────────────────────

function verifySignature(rawBody: Buffer | string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const expected = hmac.digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

// ── LS payload shape ──────────────────────────────────────────────────────────

interface LSPayload {
  meta: { event_name: string; custom_data?: { uid?: string } };
  data: { attributes: { custom_data?: { uid?: string } } };
}

function planFromEvent(event: string): Plan | null {
  if (event === 'order_created' || event === 'subscription_created') return 'trip_pass';
  if (event === 'subscription_cancelled' || event === 'subscription_expired') return 'free';
  return null;
}

function uidFromPayload(payload: LSPayload): string | null {
  return payload.meta.custom_data?.uid ?? payload.data.attributes.custom_data?.uid ?? null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  if (!secret) { res.status(500).json({ error: 'Webhook secret not configured' }); return; }

  const signature = (req.headers['x-signature'] as string) ?? '';
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
  if (plan === null) { res.status(200).json({ ok: true, skipped: true }); return; }

  const uid = uidFromPayload(payload);
  if (!uid) {
    console.warn('[billing-webhook] No uid in custom_data for event', event);
    res.status(200).json({ ok: true, skipped: true });
    return;
  }

  try {
    await writeUserPlan(uid, plan);
    console.info('[billing-webhook] Updated uid=%s plan=%s event=%s', uid, plan, event);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[billing-webhook] Firestore write failed:', e);
    res.status(500).json({ error: 'Database write failed' });
  }
}

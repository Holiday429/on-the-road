/* ==========================================================================
   On the Road · /api/billing-webhook  — Vercel Serverless Function
   --------------------------------------------------------------------------
   Receives Lemon Squeezy webhook events and grants the buyer their trip quota
   via the shared grantQuota() (see _billing.ts), which is idempotent on the
   order id and also reused by the future Alipay/WeChat callback.

   Plan is read from custom_data.plan (set by create-checkout) so we never have
   to guess which product was bought from the variant id — the China payment
   path will set the same field.

   Supported events:
     order_created   → grant trip_pass / lifetime / ai_topup (per custom_data.plan)
     order_refunded  → reverse that grant (revokeGrant; idempotent per order)

   Refund policy: only UNUSED purchases are refunded (enforced manually when
   approving the refund in the Lemon Squeezy dashboard), so the reversal is a
   clean full revoke. See revokeGrant in _billing.ts.

   Keys in .env (server-side only, no VITE_ prefix):
     FIREBASE_SERVICE_ACCOUNT
     LEMON_SQUEEZY_WEBHOOK_SECRET
   ========================================================================== */

import * as crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { grantQuota, revokeGrant, type Sku } from './_billing';

type VercelRequest  = IncomingMessage & { body: Buffer | string; headers: Record<string, string | string[] | undefined>; method?: string };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse };

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

// ── LS payload shape (only the fields we read) ────────────────────────────────

interface LSPayload {
  meta: { event_name: string; custom_data?: { uid?: string; plan?: string } };
  data: {
    id?: string;
    attributes: {
      custom_data?: { uid?: string; plan?: string };
      total?: number;           // order total in cents
      order_number?: number;
      identifier?: string;      // unique order identifier
    };
  };
}

function customData(payload: LSPayload): { uid?: string; plan?: string } {
  return payload.meta.custom_data ?? payload.data.attributes.custom_data ?? {};
}

/** A stable, unique id for this order so grantQuota can dedupe LS retries. */
function orderIdFromPayload(payload: LSPayload): string | null {
  return payload.data.attributes.identifier
    ?? payload.data.id
    ?? (payload.data.attributes.order_number != null ? `ord-${payload.data.attributes.order_number}` : null);
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
  // We act on purchases (order_created) and refunds (order_refunded). Every
  // other event is acked so LS stops retrying.
  if (event !== 'order_created' && event !== 'order_refunded') {
    res.status(200).json({ ok: true, skipped: true, reason: `event ${event}` });
    return;
  }

  // Refunds carry the same custom_data + order identifier as the original order,
  // so uid / plan / orderId resolve identically for grant and revoke.
  const { uid, plan } = customData(payload);
  if (!uid) {
    console.warn('[billing-webhook] No uid in custom_data for event', event);
    res.status(200).json({ ok: true, skipped: true, reason: 'no uid' });
    return;
  }
  if (plan !== 'trip_pass' && plan !== 'lifetime' && plan !== 'ai_topup') {
    console.warn('[billing-webhook] Unexpected plan in custom_data:', plan);
    res.status(200).json({ ok: true, skipped: true, reason: 'unknown plan' });
    return;
  }

  const orderId = orderIdFromPayload(payload);
  if (!orderId) {
    console.warn('[billing-webhook] No order id in payload');
    res.status(400).json({ error: 'No order id' });
    return;
  }

  try {
    if (event === 'order_refunded') {
      const revoked = await revokeGrant(uid, plan as Sku, orderId);
      res.status(200).json({ ok: true, revoked });
    } else {
      const applied = await grantQuota(uid, plan as Sku, orderId, payload.data.attributes.total ?? null);
      res.status(200).json({ ok: true, applied });
    }
  } catch (e) {
    console.error('[billing-webhook] %s failed:', event, e);
    res.status(500).json({ error: `${event} failed` });
  }
}

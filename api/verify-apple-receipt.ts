/* ==========================================================================
   On the Road · Apple IAP receipt verification
   --------------------------------------------------------------------------
   Called by the iOS app after a StoreKit 2 purchase succeeds.

   Flow:
     1. App calls StoreKit 2 → gets a signed JWS transaction string.
     2. App POSTs { transactionJws, sku } to this endpoint with Firebase Bearer.
     3. We verify the Firebase token to get uid.
     4. We verify the Apple JWS using Apple's App Store notification certs
        (or the /verifyReceipt sandbox endpoint for StoreKit 2 signed txns).
        Apple JWS transactions are self-contained: the payload contains
        productId, originalTransactionId, transactionId, purchaseDate.
     5. We call grantQuota(uid, sku, originalTransactionId) — idempotent on the
        originalTransactionId, so double-delivers are safe.
     6. Return 200 { granted: true } so the App knows the Firestore listener
        will fire with the updated plan.

   SKU → product ID mapping (define in App Store Connect):
     app.easyontheroad.trip_pass   → 'trip_pass'
     app.easyontheroad.lifetime    → 'lifetime'
     app.easyontheroad.ai_topup    → 'ai_topup'

   Environment variables needed (already in .env for other endpoints):
     FIREBASE_SERVICE_ACCOUNT   — existing (used by _guard.ts / _billing.ts)
     APPLE_BUNDLE_ID            — com.easyontheroad.app (set in Vercel)
     APPLE_ISSUER_ID            — App Store Connect → Keys → Issuer ID (optional;
                                  only needed if you use server-to-server API;
                                  for JWS self-verification it's read from the cert)
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';
import { verifyFirebaseToken } from './_guard.ts';
import { grantQuota, type Sku } from './_billing.ts';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse };

// Map App Store product IDs → billing SKUs
const PRODUCT_TO_SKU: Record<string, Sku> = {
  'app.easyontheroad.trip_pass': 'trip_pass',
  'app.easyontheroad.lifetime':  'lifetime',
  'app.easyontheroad.ai_topup':  'ai_topup',
};

// ── Apple JWS verification ────────────────────────────────────────────────────
//
// StoreKit 2 signed transactions are JWS (RFC 7515) signed with Apple's
// intermediate cert chain. The payload is base64url-encoded JSON.
// For server-side verification we decode the header to find the cert chain,
// verify the chain against Apple Root CA G3, then verify the JWS signature.
//
// Apple's certificate chain is embedded in the JWS header `x5c` field —
// no network fetch needed after initial validation.
//
// For simplicity (and because we already trust the Firebase token for auth),
// we decode the payload WITHOUT verifying the Apple signature in this first
// version. IMPORTANT: add full chain verification before production launch
// or a malicious client could spoof a purchase.
// TODO: Verify JWS signature + cert chain against Apple Root CA G3.

function decodeJwsPayload(jws: string): Record<string, unknown> {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWS format');
  const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(payloadB64, 'base64').toString('utf-8');
  return JSON.parse(json) as Record<string, unknown>;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // 1. Authenticate the caller
  const authHeader = req.headers['authorization'];
  const firebaseToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!firebaseToken) {
    return res.status(401).json({ error: 'unauthenticated', message: 'Sign in required.' });
  }

  let uid: string;
  try {
    uid = await verifyFirebaseToken(firebaseToken);
  } catch {
    return res.status(401).json({ error: 'unauthenticated', message: 'Session expired.' });
  }

  // 2. Parse request body
  const { transactionJws, productId } = req.body as {
    transactionJws?: string;
    productId?: string;
  };

  if (!transactionJws || !productId) {
    return res.status(400).json({ error: 'bad_request', message: 'transactionJws and productId are required.' });
  }

  // 3. Map productId → SKU
  const sku = PRODUCT_TO_SKU[productId];
  if (!sku) {
    return res.status(400).json({ error: 'bad_request', message: `Unknown productId: ${productId}` });
  }

  // 4. Decode Apple JWS payload
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwsPayload(transactionJws);
  } catch {
    return res.status(400).json({ error: 'bad_request', message: 'Invalid transactionJws.' });
  }

  // Validate bundle ID matches
  const bundleId = process.env.APPLE_BUNDLE_ID ?? 'com.easyontheroad.app';
  if (payload.bundleId && payload.bundleId !== bundleId) {
    console.warn('[apple-receipt] bundle mismatch uid=%s got=%s', uid, payload.bundleId);
    return res.status(400).json({ error: 'bad_request', message: 'Bundle ID mismatch.' });
  }

  // Use originalTransactionId as the idempotency key (stable across renewals)
  const orderId = String(payload.originalTransactionId ?? payload.transactionId ?? '');
  if (!orderId) {
    return res.status(400).json({ error: 'bad_request', message: 'No transactionId in JWS payload.' });
  }

  // 5. Grant quota (idempotent on orderId)
  try {
    const granted = await grantQuota(uid, sku, orderId);
    console.info('[apple-receipt] uid=%s sku=%s order=%s granted=%s', uid, sku, orderId, granted);
    return res.status(200).json({ granted, sku, orderId });
  } catch (e) {
    console.error('[apple-receipt] grantQuota failed uid=%s:', uid, e);
    return res.status(500).json({ error: 'internal', message: 'Failed to grant purchase.' });
  }
}

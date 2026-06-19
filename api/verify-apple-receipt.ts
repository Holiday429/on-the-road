/* ==========================================================================
   On the Road · Apple IAP receipt verification
   --------------------------------------------------------------------------
   Called by the iOS app after a StoreKit 2 purchase succeeds.

   Flow:
     1. App calls StoreKit 2 → gets a signed JWS transaction string.
     2. App POSTs { transactionJws, sku } to this endpoint with Firebase Bearer.
     3. We verify the Firebase token to get uid.
     4. We verify the Apple JWS signature + cert chain (pinned to Apple Root
        CA G3) with Node's built-in crypto, then decode the trustworthy payload
        (productId, bundleId, originalTransactionId, transactionId, purchaseDate)
        and confirm bundleId is ours.
     5. We call grantQuota(uid, sku, originalTransactionId) — idempotent on the
        originalTransactionId, so double-delivers are safe.
     6. Return 200 { granted: true } so the App knows the Firestore listener
        will fire with the updated plan.

   SKU → product ID mapping (define in App Store Connect):
     com.holiday.On-the-Road.trip_pass   → 'trip_pass'
     com.holiday.On-the-Road.lifetime    → 'lifetime'
     com.holiday.On-the-Road.ai_topup    → 'ai_topup'

   Environment variables needed (already in .env for other endpoints):
     FIREBASE_SERVICE_ACCOUNT   — existing (used by _guard.ts / _billing.ts)
     APPLE_BUNDLE_ID            — com.holiday.On-the-Road (set in Vercel)
     APPLE_ISSUER_ID            — App Store Connect → Keys → Issuer ID (optional;
                                  only needed if you use server-to-server API;
                                  for JWS self-verification it's read from the cert)
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';
import { createPublicKey, createVerify, X509Certificate } from 'node:crypto';
import { verifyFirebaseToken } from './_guard.ts';
import { grantQuota, type Sku } from './_billing.ts';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse };

// Map App Store product IDs → billing SKUs.
// Product IDs use the app's reverse-domain bundle ID (com.holiday.On-the-Road),
// matching App Store Connect + PaywallStore.productIDs on the client.
const PRODUCT_TO_SKU: Record<string, Sku> = {
  'com.holiday.On-the-Road.trip_pass': 'trip_pass',
  'com.holiday.On-the-Road.lifetime':  'lifetime',
  'com.holiday.On-the-Road.ai_topup':  'ai_topup',
};

// ── Apple JWS verification ────────────────────────────────────────────────────
//
// StoreKit 2 signed transactions are JWS (RFC 7515, ES256) whose header carries
// the full signing cert chain in `x5c`: [leaf, intermediate, root]. We:
//   1. Rebuild the chain from x5c and verify each cert was issued by the next.
//   2. Pin the chain root to Apple Root CA G3 by SHA-256 fingerprint (the x5c
//      root must equal our embedded copy — we don't trust whatever they send).
//   3. Verify the JWS signature with the leaf cert's public key.
//
// Implemented with Node's built-in `crypto` only — no jose / app-store-server-
// library, because this project deliberately avoids ESM-only crypto deps that
// break Vercel's per-endpoint CJS bundling (see _guard.ts header).

// Apple Root CA G3 — public root, pinned by fingerprint. Source:
// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
const APPLE_ROOT_CA_G3_FINGERPRINT_SHA256 =
  '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79';

const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

const APPLE_ROOT = new X509Certificate(APPLE_ROOT_CA_G3_PEM);

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Build an X509Certificate from a base64 (DER) string out of the x5c array. */
function certFromX5c(b64der: string): X509Certificate {
  return new X509Certificate(Buffer.from(b64der, 'base64'));
}

function fingerprintMatches(cert: X509Certificate): boolean {
  // cert.fingerprint256 is "AA:BB:..." uppercase, same format as our pin.
  return cert.fingerprint256 === APPLE_ROOT_CA_G3_FINGERPRINT_SHA256;
}

/**
 * Verify the JWS signature + cert chain, then return the decoded payload.
 * Throws if anything fails. The returned payload is trustworthy.
 */
function verifyAppleJws(jws: string): Record<string, unknown> {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWS format');
  const [headerB64, payloadB64, sigB64] = parts;

  // 1. Parse header, extract x5c chain.
  const header = JSON.parse(b64urlToBuf(headerB64).toString('utf-8')) as { alg?: string; x5c?: string[] };
  if (header.alg !== 'ES256') throw new Error(`Unexpected alg: ${header.alg}`);
  if (!header.x5c || header.x5c.length < 2) throw new Error('Missing x5c chain');

  const chain = header.x5c.map(certFromX5c);
  const [leaf, ...rest] = chain;
  const root = chain[chain.length - 1];

  // 2. Pin the root to Apple Root CA G3 by fingerprint.
  if (!fingerprintMatches(root)) throw new Error('Chain root is not Apple Root CA G3');

  // 3. Verify each cert was issued by the next one up, and the top by our root.
  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i];
    const issuer = i + 1 < chain.length ? chain[i + 1] : APPLE_ROOT;
    if (!cert.checkIssued(issuer)) throw new Error(`Cert ${i} not issued by next in chain`);
    if (!cert.verify(issuer.publicKey)) throw new Error(`Cert ${i} signature invalid`);
    // Validity window.
    const now = Date.now();
    if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) {
      throw new Error(`Cert ${i} outside validity window`);
    }
  }
  void rest;

  // 4. Verify the JWS signature (ES256) with the leaf public key.
  //    ES256 JWS signatures are raw R||S (64 bytes); Node's verify expects DER,
  //    so convert. createVerify with 'sha256' + dsaEncoding:'ieee-p1363' handles
  //    the raw form directly.
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = b64urlToBuf(sigB64);
  const verifier = createVerify('sha256');
  verifier.update(signingInput);
  verifier.end();
  const ok = verifier.verify(
    { key: createPublicKey(leaf.publicKey), dsaEncoding: 'ieee-p1363' },
    sig,
  );
  if (!ok) throw new Error('JWS signature verification failed');

  // 5. Signature + chain valid → decode payload.
  return JSON.parse(b64urlToBuf(payloadB64).toString('utf-8')) as Record<string, unknown>;
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

  // 4. Verify the Apple JWS (signature + cert chain pinned to Apple Root CA G3)
  //    and decode the trustworthy payload.
  let payload: Record<string, unknown>;
  try {
    payload = verifyAppleJws(transactionJws);
  } catch (e) {
    console.warn('[apple-receipt] JWS verification failed uid=%s:', uid, e);
    return res.status(400).json({ error: 'bad_request', message: 'Invalid or untrusted transaction.' });
  }

  // Validate bundle ID matches OURS — a verified transaction from another
  // Apple app must not be replayed against this account. Required, not optional.
  const expectedBundle = process.env.APPLE_BUNDLE_ID ?? 'com.holiday.On-the-Road';
  if (payload.bundleId !== expectedBundle) {
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

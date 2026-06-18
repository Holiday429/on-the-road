/* ==========================================================================
   On the Road · AI endpoint guard
   --------------------------------------------------------------------------
   Verifies Firebase ID tokens with google-auth-library (CJS-safe) and reads
   Firestore via REST API to avoid firebase-admin's CJS/ESM conflict. We avoid
   jose entirely — it is ESM-only and Vercel's per-endpoint CJS bundling kept
   breaking on it (ERR_REQUIRE_ESM / ERR_MODULE_NOT_FOUND).

   AI credits are metered per generation (see debitAiCredit): a trip's bundled
   allowance, then the account booster pool, then a one-time free trial.
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse };

// ── Service account singleton ─────────────────────────────────────────────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let _sa: ServiceAccount | null = null;
function getServiceAccount(): ServiceAccount {
  if (_sa) return _sa;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');
  _sa = JSON.parse(raw) as ServiceAccount;
  return _sa;
}

// ── Google access token (for Firestore REST) ──────────────────────────────────

let _auth: GoogleAuth | null = null;
async function getAccessToken(): Promise<string> {
  if (!_auth) {
    const sa = getServiceAccount();
    _auth = new GoogleAuth({
      credentials: { client_email: sa.client_email, private_key: sa.private_key },
      scopes: ['https://www.googleapis.com/auth/datastore'],
    });
  }
  const client = await _auth.getClient();
  const tokenResp = await client.getAccessToken();
  if (!tokenResp.token) throw new Error('Failed to obtain Google access token');
  return tokenResp.token;
}

// ── Firebase ID token verification via google-auth-library ─────────────────────
//
// We verify Firebase ID tokens with google-auth-library (already a declared,
// bundled dependency) instead of jose. jose is ESM-only and Vercel's
// per-endpoint CJS bundling kept lowering its dynamic import to require()
// (ERR_REQUIRE_ESM) or losing the package entirely (ERR_MODULE_NOT_FOUND).
//
// Firebase ID tokens are RS256-signed by securetoken@system.gserviceaccount.com.
// Its public X.509 certs (keyed by `kid`) live at the URL below; we fetch and
// cache them, then let OAuth2Client check signature, audience, issuer and expiry.

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let _certs: { certs: Record<string, string>; expires: number } | null = null;

async function getFirebaseCerts(): Promise<Record<string, string>> {
  if (_certs && _certs.expires > Date.now()) return _certs.certs;
  const res = await fetch(FIREBASE_CERTS_URL);
  if (!res.ok) throw new Error(`Firebase certs fetch failed: ${res.status}`);
  const certs = await res.json() as Record<string, string>;
  // Honour Cache-Control max-age so we don't refetch on every request.
  const cc = res.headers.get('cache-control') ?? '';
  const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? 3600);
  _certs = { certs, expires: Date.now() + maxAge * 1000 };
  return certs;
}

const _oauth = new OAuth2Client();

export async function verifyFirebaseToken(token: string): Promise<string> {
  const sa = getServiceAccount();
  const certs = await getFirebaseCerts();
  // Verifies signature against the certs, plus audience, issuer and expiry.
  const login = await _oauth.verifySignedJwtWithCertsAsync(
    token,
    certs,
    sa.project_id,                                      // required audience
    [`https://securetoken.google.com/${sa.project_id}`], // allowed issuers
  );
  const payload = login.getPayload() as { sub?: string; user_id?: string } | undefined;
  const uid = payload?.sub ?? payload?.user_id;
  if (!uid || typeof uid !== 'string') throw new Error('No uid in token');
  return uid;
}

// ── Firestore REST read ───────────────────────────────────────────────────────

type Plan = 'free' | 'trip_pass' | 'lifetime';

interface UserDoc {
  plan?: Plan;
  aiCreditsPool?: number;   // account-wide booster pool (server-written)
  freeAiUsed?: boolean;     // whether the one free-trial AI call was used
  tripPassExpiresAt?: number | null;
}

async function readUserDoc(uid: string): Promise<UserDoc> {
  const sa = getServiceAccount();
  const token = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`Firestore REST ${res.status}: ${await res.text()}`);
  const doc = await res.json() as { fields?: Record<string, unknown> };
  return parseFirestoreFields(doc.fields ?? {});
}

function parseFirestoreValue(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const val = v as Record<string, unknown>;
  if ('stringValue'  in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue'  in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue'    in val) return null;
  if ('timestampValue' in val) return new Date(val.timestampValue as string).getTime();
  if ('arrayValue'   in val) {
    const arr = (val.arrayValue as { values?: unknown[] }).values ?? [];
    return arr.map(parseFirestoreValue);
  }
  if ('mapValue'     in val) {
    return parseFirestoreFields((val.mapValue as { fields?: Record<string, unknown> }).fields ?? {});
  }
  return null;
}

function parseFirestoreFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = parseFirestoreValue(v);
  return out;
}

// ── AI credit model (must match src/data/schema.ts) ──────────────────────────
//
// One chargeable AI generation is debited in this fixed order:
//   1. the trip's bundled allowance  — trips/{tripId}/usage/ai.count vs
//      PER_TRIP_AI_CREDITS (paid trips only: trip_pass / lifetime users)
//   2. the account booster pool       — users/{uid}.aiCreditsPool
//   3. the one free-trial call        — users/{uid}.freeAiUsed (once, ever)
// All three counters are written ONLY here. The client can read them to show
// "credits left" but can never grant itself credits (rules forbid the writes).

const PER_TRIP_AI_CREDITS = 10;

const FS_DOCS = () =>
  `https://firestore.googleapis.com/v1/projects/${getServiceAccount().project_id}/databases/(default)/documents`;

/** Read trips/{tripId}/usage/ai.count (0 if the doc/field is absent). */
async function readTripAiCount(token: string, tripId: string): Promise<number> {
  const url = `${FS_DOCS()}/trips/${tripId}/usage/ai`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`readTripAiCount ${res.status}: ${await res.text()}`);
  const doc = await res.json() as { fields?: Record<string, unknown> };
  const f = parseFirestoreFields(doc.fields ?? {}) as { count?: number };
  return f.count ?? 0;
}

/** Atomically +1 trips/{tripId}/usage/ai.count via a commit field-transform. */
async function bumpTripAiCount(token: string, tripId: string): Promise<void> {
  const name = `projects/${getServiceAccount().project_id}/databases/(default)/documents/trips/${tripId}/usage/ai`;
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${getServiceAccount().project_id}/databases/(default)/documents:commit`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          { transform: { document: name, fieldTransforms: [
            { fieldPath: 'count', increment: { integerValue: '1' } },
          ] } },
          { update: { name, fields: { updatedAt: { integerValue: String(Date.now()) } } },
            updateMask: { fieldPaths: ['updatedAt'] } },
        ],
      }),
    },
  );
  if (!res.ok) throw new Error(`bumpTripAiCount ${res.status}: ${await res.text()}`);
}

/** Decrement users/{uid}.aiCreditsPool by 1 (caller guarantees it's > 0). */
async function spendPool(token: string, uid: string, current: number): Promise<void> {
  const url = `${FS_DOCS()}/users/${uid}?updateMask.fieldPaths=aiCreditsPool&updateMask.fieldPaths=_updatedAt`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      aiCreditsPool: { integerValue: String(Math.max(0, current - 1)) },
      _updatedAt:    { integerValue: String(Date.now()) },
    } }),
  });
  if (!res.ok) throw new Error(`spendPool ${res.status}: ${await res.text()}`);
}

/** Mark the one free-trial AI call as used. */
async function markFreeUsed(token: string, uid: string): Promise<void> {
  const url = `${FS_DOCS()}/users/${uid}?updateMask.fieldPaths=freeAiUsed&updateMask.fieldPaths=_updatedAt`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      freeAiUsed: { booleanValue: true },
      _updatedAt: { integerValue: String(Date.now()) },
    } }),
  });
  if (!res.ok) throw new Error(`markFreeUsed ${res.status}: ${await res.text()}`);
}

/**
 * Try to debit one AI credit for `uid` generating against `tripId`.
 * Returns true if a credit was charged (caller may proceed), false if the user
 * is out of credits (caller returns 402). A paid plan means the trip carries a
 * PER_TRIP_AI_CREDITS allowance; free users have none and fall straight to the
 * pool / free-trial.
 */
async function debitAiCredit(uid: string, plan: Plan, user: UserDoc, tripId: string): Promise<boolean> {
  const token = await getAccessToken();

  // 1. Trip's own bundled allowance (paid trips only).
  const tripAllowance = plan === 'free' ? 0 : PER_TRIP_AI_CREDITS;
  if (tripAllowance > 0 && tripId) {
    const used = await readTripAiCount(token, tripId);
    if (used < tripAllowance) { await bumpTripAiCount(token, tripId); return true; }
  }

  // 2. Account booster pool.
  const pool = user.aiCreditsPool ?? 0;
  if (pool > 0) { await spendPool(token, uid, pool); return true; }

  // 3. One-time free trial (any plan, but in practice only free users reach here).
  if (!user.freeAiUsed) { await markFreeUsed(token, uid); return true; }

  return false;
}

// ── Guard entry point ─────────────────────────────────────────────────────────

export interface MeterOptions {
  /** Trip the generation is for. Required to charge the trip's own allowance. */
  tripId?: string;
  /** When false, only auth is verified and NO credit is debited. Use for cache
   *  hits (already-generated content) and non-AI helper calls (e.g. geocode). */
  chargeable?: boolean;
}

export async function verifyAndMeter(
  req: VercelRequest,
  res: VercelResponse,
  opts: MeterOptions = {},
): Promise<string | null> {

  // 1. Extract + verify ID token
  const authHeader = req.headers['authorization'];
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in to use AI features.' });
    return null;
  }

  let uid: string;
  try {
    uid = await verifyFirebaseToken(token);
  } catch (e) {
    console.error('[guard] Token verification failed:', e);
    res.status(401).json({ error: 'unauthenticated', message: 'Session expired. Please sign in again.' });
    return null;
  }

  // 2. Read plan
  let userDoc: UserDoc = {};
  try {
    userDoc = await readUserDoc(uid) as UserDoc;
  } catch (e) {
    console.error('[guard] Firestore read failed for uid=%s:', uid, e);
    res.status(503).json({ error: 'service_unavailable', message: 'Auth service temporarily unavailable.' });
    return null;
  }

  const plan: Plan = (userDoc.plan as Plan) ?? 'free';

  // 3. Non-chargeable calls (cache hits, geocode helpers) only need a valid
  //    session — they consume no credit.
  if (opts.chargeable === false) return uid;

  // 4. Debit one AI credit in order: trip allowance → booster pool → free trial.
  try {
    const charged = await debitAiCredit(uid, plan, userDoc, opts.tripId ?? '');
    if (!charged) {
      res.status(402).json({
        error: 'quota_exceeded',
        plan,
        upgrade: true,
        needTopup: true,
        message: plan === 'free'
          ? 'You’ve used your free AI generation. Get a Trip Pass or an AI top-up to continue.'
          : 'You’re out of AI credits for this trip. Add an AI top-up to keep generating.',
      });
      return null;
    }
  } catch (e) {
    console.error('[guard] Credit debit failed for uid=%s trip=%s:', uid, opts.tripId, e);
    res.status(503).json({ error: 'service_unavailable', message: 'Usage tracking temporarily unavailable.' });
    return null;
  }

  return uid;
}

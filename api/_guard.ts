/* ==========================================================================
   On the Road · AI endpoint guard
   --------------------------------------------------------------------------
   Verifies Firebase ID tokens via jose (dynamic import, ESM-safe in CJS)
   and reads Firestore via REST API to avoid firebase-admin's CJS/ESM conflict
   (firebase-admin → jwks-rsa → jose ESM-only → ERR_REQUIRE_ESM).

   FREE_MONTHLY_QUOTA = 0 → all free users blocked. Raise to grant free calls.
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleAuth } from 'google-auth-library';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse };

const FREE_MONTHLY_QUOTA = 0;

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

// ── Firebase ID token verification via jose ───────────────────────────────────

const JWKS_URL = 'https://www.googleapis.com/robot/v1/metadata/jwks/securetoken@system.gserviceaccount.com';

async function verifyFirebaseToken(token: string): Promise<string> {
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const sa = getServiceAccount();
  const JWKS = createRemoteJWKSet(new URL(JWKS_URL));
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${sa.project_id}`,
    audience: sa.project_id,
  });
  const uid = payload.sub ?? payload.user_id;
  if (!uid || typeof uid !== 'string') throw new Error('No uid in token');
  return uid;
}

// ── Firestore REST read ───────────────────────────────────────────────────────

type Plan = 'free' | 'trip_pass' | 'lifetime';

interface UserDoc {
  plan?: Plan;
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

// ── Firestore REST write (usage counter) ─────────────────────────────────────

async function incrementUsage(uid: string, period: string): Promise<boolean> {
  const sa = getServiceAccount();
  const token = await getAccessToken();
  const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;

  // Read current usage
  const url = `${base}/users/${uid}/usage/ai`;
  const readRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  let count = 0;
  if (readRes.ok) {
    const doc = await readRes.json() as { fields?: Record<string, unknown> };
    const fields = parseFirestoreFields(doc.fields ?? {}) as { period?: string; count?: number };
    if (fields.period === period) count = fields.count ?? 0;
  }

  if (count >= FREE_MONTHLY_QUOTA) return false;

  // Write incremented value
  const writeUrl = `${url}?updateMask.fieldPaths=period&updateMask.fieldPaths=count&updateMask.fieldPaths=updatedAt`;
  await fetch(writeUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        period:    { stringValue: period },
        count:     { integerValue: String(count + 1) },
        updatedAt: { integerValue: String(Date.now()) },
      },
    }),
  });
  return true;
}

// ── Period key ────────────────────────────────────────────────────────────────

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── Guard entry point ─────────────────────────────────────────────────────────

export async function verifyAndMeter(
  req: VercelRequest,
  res: VercelResponse,
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

  // 3. Plan gate
  if (plan === 'lifetime') return uid;

  if (plan === 'trip_pass') {
    const exp = userDoc.tripPassExpiresAt as number | null | undefined;
    if (exp == null || exp > Date.now()) return uid;
  }

  // 4. Quota check (free / expired trip_pass)
  if (FREE_MONTHLY_QUOTA === 0) {
    res.status(402).json({
      error: 'quota_exceeded',
      plan,
      upgrade: true,
      message: 'AI features require a Trip Pass. Upgrade to unlock.',
    });
    return null;
  }

  const period = currentPeriod();
  try {
    const allowed = await incrementUsage(uid, period);
    if (!allowed) {
      res.status(402).json({
        error: 'quota_exceeded',
        plan,
        upgrade: true,
        used: FREE_MONTHLY_QUOTA,
        limit: FREE_MONTHLY_QUOTA,
        message: `You've used all ${FREE_MONTHLY_QUOTA} free AI calls this month. Upgrade for more.`,
      });
      return null;
    }
  } catch (e) {
    console.error('[guard] Usage write failed for uid=%s:', uid, e);
    res.status(503).json({ error: 'service_unavailable', message: 'Usage tracking temporarily unavailable.' });
    return null;
  }

  return uid;
}

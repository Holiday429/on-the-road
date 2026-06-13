/* ==========================================================================
   On the Road · Shared billing logic
   --------------------------------------------------------------------------
   Single source of truth for "a purchase happened → grant the buyer their
   entitlement". Both the Lemon Squeezy webhook and (later) the Alipay/WeChat
   callback call grantQuota(), so the quota/plan-write logic lives in exactly
   one place.

   Purchase model (no AI at launch — entitlements kept for future use):
     trip_pass  → +1 owned-trip slot   (one-time, stackable)
     lifetime   → unlimited trip slots (one-time)

   Writes go to Firestore via REST (no firebase-admin — avoids the CJS/ESM
   conflict the AI guard documents).
   ========================================================================== */

import { GoogleAuth } from 'google-auth-library';

export type Plan = 'free' | 'trip_pass' | 'lifetime';

// Lifetime "unlimited" is modelled as a large finite quota so the same
// `ownedTrips < tripQuota` check works everywhere without an Infinity branch.
export const LIFETIME_QUOTA = 9999;
export const FREE_QUOTA = 1;

// Entitlements kept in the data model for when AI ships; not surfaced in any
// launch UI. trip_pass grants none today (slots only); lifetime pre-grants the
// future paid features so lifetime buyers are covered when they light up.
const PLAN_ENTITLEMENTS: Record<Plan, string[]> = {
  free:      [],
  trip_pass: [],
  lifetime:  ['ai.guide', 'ai.safety', 'ai.story', 'ai.check', 'export.pdf', 'collab.unlimited'],
};

// ── Google access token (for Firestore REST) ──────────────────────────────────

interface ServiceAccount { project_id: string; client_email: string; private_key: string }

let _auth: GoogleAuth | null = null;
let _sa: ServiceAccount | null = null;

function getServiceAccount(): ServiceAccount {
  if (_sa) return _sa;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  _sa = JSON.parse(raw) as ServiceAccount;
  return _sa;
}

async function getAccessToken(): Promise<{ token: string; projectId: string }> {
  const sa = getServiceAccount();
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

const FS_BASE = (projectId: string) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

// ── Minimal Firestore-value parsing (only what we read here) ──────────────────

function readInt(fields: Record<string, unknown> | undefined, key: string): number | null {
  const v = fields?.[key] as Record<string, unknown> | undefined;
  if (!v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  return null;
}
function readString(fields: Record<string, unknown> | undefined, key: string): string | null {
  const v = fields?.[key] as Record<string, unknown> | undefined;
  return v && 'stringValue' in v ? String(v.stringValue) : null;
}

// ── Idempotency: has this order already been processed? ───────────────────────

/**
 * Records the order under users/{uid}/purchases/{orderId}. Returns false if it
 * already existed (caller must skip — LS retries webhooks). Uses a create-only
 * write (documentId + no overwrite) so two concurrent deliveries can't both win.
 */
async function claimOrder(
  token: string, projectId: string, uid: string, orderId: string,
  plan: Plan, amount: number | null,
): Promise<boolean> {
  // createDocument with a fixed documentId fails with 409 ALREADY_EXISTS if the
  // doc is already there — that's our idempotency guarantee.
  const url = `${FS_BASE(projectId)}/users/${uid}/purchases?documentId=${encodeURIComponent(orderId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        plan:   { stringValue: plan },
        amount: amount != null ? { integerValue: String(amount) } : { nullValue: null },
        at:     { integerValue: String(Date.now()) },
      },
    }),
  });
  if (res.status === 409) return false;          // already processed
  if (!res.ok) throw new Error(`claimOrder ${res.status}: ${await res.text()}`);
  return true;
}

// ── Read current user plan/quota ──────────────────────────────────────────────

async function readUser(
  token: string, projectId: string, uid: string,
): Promise<{ plan: Plan; tripQuota: number }> {
  const url = `${FS_BASE(projectId)}/users/${uid}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return { plan: 'free', tripQuota: FREE_QUOTA };
  if (!res.ok) throw new Error(`readUser ${res.status}: ${await res.text()}`);
  const doc = await res.json() as { fields?: Record<string, unknown> };
  const plan = (readString(doc.fields, 'plan') as Plan | null) ?? 'free';
  const quota = readInt(doc.fields, 'tripQuota');
  return { plan, tripQuota: quota ?? FREE_QUOTA };
}

// ── Grant ──────────────────────────────────────────────────────────────────────

/**
 * Apply a purchase to a user. Idempotent on orderId.
 *   trip_pass → tripQuota += 1   (stackable; buy N passes = N extra trips)
 *   lifetime  → tripQuota = LIFETIME_QUOTA, plan = lifetime, +entitlements
 * Returns true if the grant was applied, false if it was a duplicate delivery.
 */
export async function grantQuota(
  uid: string, plan: Plan, orderId: string, amount: number | null = null,
): Promise<boolean> {
  if (plan !== 'trip_pass' && plan !== 'lifetime') {
    throw new Error(`grantQuota: unsupported plan "${plan}"`);
  }
  const { token, projectId } = await getAccessToken();

  // Idempotency gate first — a duplicate delivery must not bump quota twice.
  const fresh = await claimOrder(token, projectId, uid, orderId, plan, amount);
  if (!fresh) {
    console.info('[billing] duplicate order skipped uid=%s order=%s', uid, orderId);
    return false;
  }

  const current = await readUser(token, projectId, uid);

  let nextPlan: Plan;
  let nextQuota: number;
  if (plan === 'lifetime') {
    nextPlan = 'lifetime';
    nextQuota = LIFETIME_QUOTA;
  } else {
    // trip_pass stacks on top of whatever the user has (but never downgrades a
    // lifetime holder who somehow buys a pass).
    if (current.plan === 'lifetime') { nextPlan = 'lifetime'; nextQuota = LIFETIME_QUOTA; }
    else { nextPlan = 'trip_pass'; nextQuota = current.tripQuota + 1; }
  }

  const entitlements = PLAN_ENTITLEMENTS[nextPlan];
  const url = `${FS_BASE(projectId)}/users/${uid}` +
    `?updateMask.fieldPaths=plan&updateMask.fieldPaths=tripQuota` +
    `&updateMask.fieldPaths=entitlements&updateMask.fieldPaths=_updatedAt`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        plan:         { stringValue: nextPlan },
        tripQuota:    { integerValue: String(nextQuota) },
        entitlements: { arrayValue: { values: entitlements.map(e => ({ stringValue: e })) } },
        _updatedAt:   { integerValue: String(Date.now()) },
      },
    }),
  });
  if (!res.ok) throw new Error(`grantQuota PATCH ${res.status}: ${await res.text()}`);

  console.info('[billing] granted uid=%s plan=%s quota=%d order=%s', uid, nextPlan, nextQuota, orderId);
  return true;
}

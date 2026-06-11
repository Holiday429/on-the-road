/* ==========================================================================
   On the Road · AI endpoint guard
   --------------------------------------------------------------------------
   Call verifyAndMeter(req, res) at the top of every AI handler. It:
     1. Verifies the Firebase ID token from Authorization: Bearer <token>
     2. Reads the user's plan from users/{uid}
     3. Blocks free users (quota = 0 currently) with a 402 response
     4. Passes through trip_pass / lifetime users

   FREE_MONTHLY_QUOTA = 0 → all free users are blocked. Raise this constant
   to e.g. 3 later to enable a free tier without any other code changes.

   Fail-CLOSED: if Admin SDK is unavailable we return 503 rather than letting
   requests through — because quota=0, a fail-open policy would let all users
   bypass the paywall during outages.
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

type VercelRequest  = IncomingMessage & { body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse };

// ── Admin SDK init (lazy singleton) ──────────────────────────────────────────

let _app: App | null = null;
let _adminError: Error | null = null;

function getAdminApp(): App | null {
  if (_app) return _app;
  if (_adminError) return null;
  try {
    const existing = getApps();
    if (existing.length > 0) { _app = existing[0]; return _app; }
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');
    _app = initializeApp({ credential: cert(JSON.parse(raw)) });
    return _app;
  } catch (e) {
    _adminError = e instanceof Error ? e : new Error(String(e));
    console.error('[guard] Admin SDK init failed:', _adminError.message);
    return null;
  }
}

// ── Quota constants ───────────────────────────────────────────────────────────

// Raise this to e.g. 3 to grant free users N AI calls per calendar month.
const FREE_MONTHLY_QUOTA = 0;

// ── Period key ────────────────────────────────────────────────────────────────

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ── Plan types (mirrors src/data/schema.ts — inlined to avoid TS path issues) ─

type Plan = 'free' | 'trip_pass' | 'lifetime';

interface UserDoc {
  plan?: Plan;
  tripPassExpiresAt?: number | null;
}

// ── Guard entry point ─────────────────────────────────────────────────────────

/**
 * Returns the verified uid on success, or sends an error response and returns
 * null. Callers must return immediately when null is returned.
 */
export async function verifyAndMeter(
  req: VercelRequest,
  res: VercelResponse,
): Promise<string | null> {
  const app = getAdminApp();

  if (!app) {
    res.status(503).json({ error: 'service_unavailable', message: 'Auth service temporarily unavailable. Try again shortly.' });
    return null;
  }

  // ── 1. Extract + verify ID token ─────────────────────────────────────────

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
    const decoded = await getAuth(app).verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ error: 'unauthenticated', message: 'Session expired. Please sign in again.' });
    return null;
  }

  // ── 2. Read plan ─────────────────────────────────────────────────────────

  const db = getFirestore(app);
  let userDoc: UserDoc = {};
  try {
    const snap = await db.doc(`users/${uid}`).get();
    if (snap.exists) userDoc = snap.data() as UserDoc;
  } catch (e) {
    console.error('[guard] Firestore read failed for uid=%s:', uid, e);
    res.status(503).json({ error: 'service_unavailable', message: 'Auth service temporarily unavailable.' });
    return null;
  }

  const plan: Plan = userDoc.plan ?? 'free';

  // ── 3. Plan gate ──────────────────────────────────────────────────────────

  if (plan === 'lifetime') return uid;

  if (plan === 'trip_pass') {
    const exp = userDoc.tripPassExpiresAt;
    if (exp == null || exp > Date.now()) return uid;
    // Expired trip_pass falls through to quota check.
  }

  // ── 4. Quota check (free / expired trip_pass) ─────────────────────────────

  if (FREE_MONTHLY_QUOTA === 0) {
    res.status(402).json({
      error: 'quota_exceeded',
      plan,
      upgrade: true,
      message: 'AI features require a Trip Pass. Upgrade to unlock.',
    });
    return null;
  }

  // Monthly quota > 0: read, check, increment atomically.
  const period = currentPeriod();
  const usageRef = db.doc(`users/${uid}/usage/ai`);
  try {
    const allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const data = snap.exists ? (snap.data() as { period?: string; count?: number }) : {};
      const count = data.period === period ? (data.count ?? 0) : 0;

      if (count >= FREE_MONTHLY_QUOTA) return false;

      tx.set(usageRef, { period, count: count + 1, updatedAt: Date.now() }, { merge: true });
      return true;
    });

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
    console.error('[guard] Usage transaction failed for uid=%s:', uid, e);
    res.status(503).json({ error: 'service_unavailable', message: 'Usage tracking temporarily unavailable.' });
    return null;
  }

  return uid;
}

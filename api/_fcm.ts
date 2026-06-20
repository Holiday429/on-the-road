/* ==========================================================================
   On the Road · FCM + Firestore REST helpers (CJS-safe, no firebase-admin)
   --------------------------------------------------------------------------
   The backend deliberately avoids firebase-admin (its CJS/ESM packaging breaks
   Vercel's per-endpoint bundling — see _guard.ts). So we talk to:
     • Firestore via the REST API
     • FCM via the HTTP v1 REST API (POST .../messages:send)
   both authenticated with the same service account, using google-auth-library
   to mint OAuth access tokens.

   Used by send-reminders.ts (the cron that pushes leg/flight reminders).
   ========================================================================== */

import { GoogleAuth } from 'google-auth-library';

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

export function projectId(): string {
  return getServiceAccount().project_id;
}

// ── Access token (Firestore + FCM scopes) ─────────────────────────────────────

let _auth: GoogleAuth | null = null;
export async function getAccessToken(): Promise<string> {
  if (!_auth) {
    const sa = getServiceAccount();
    _auth = new GoogleAuth({
      credentials: { client_email: sa.client_email, private_key: sa.private_key },
      scopes: [
        'https://www.googleapis.com/auth/datastore',
        'https://www.googleapis.com/auth/firebase.messaging',
      ],
    });
  }
  const client = await _auth.getClient();
  const tokenResp = await client.getAccessToken();
  if (!tokenResp.token) throw new Error('Failed to obtain Google access token');
  return tokenResp.token;
}

// ── Firestore typed-value parsing ─────────────────────────────────────────────

function parseValue(val: Record<string, unknown>): unknown {
  if ('stringValue' in val)  return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val)  return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val)    return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('mapValue' in val) {
    return parseFields((val.mapValue as { fields?: Record<string, unknown> }).fields ?? {});
  }
  if ('arrayValue' in val) {
    const arr = (val.arrayValue as { values?: Record<string, unknown>[] }).values ?? [];
    return arr.map(parseValue);
  }
  return undefined;
}

export function parseFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = parseValue(v as Record<string, unknown>);
  }
  return out;
}

const FS_DOCS = () =>
  `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents`;

interface FsDoc { name: string; fields?: Record<string, unknown> }

/** Last path segment of a Firestore document `name`. */
export function docId(name: string): string {
  return name.split('/').pop() ?? '';
}

/** List all documents in a (sub)collection path, following pagination. */
export async function listCollection(
  token: string,
  path: string,            // e.g. "trips" or `trips/${id}/legs`
): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const out: { id: string; data: Record<string, unknown> }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${FS_DOCS()}/${path}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`listCollection ${path} ${res.status}: ${await res.text()}`);
    const json = await res.json() as { documents?: FsDoc[]; nextPageToken?: string };
    for (const d of json.documents ?? []) {
      out.push({ id: docId(d.name), data: parseFields(d.fields ?? {}) });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

/** Read a single document; null if absent. */
export async function readDoc(
  token: string,
  path: string,            // e.g. `users/${uid}`
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${FS_DOCS()}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`readDoc ${path} ${res.status}: ${await res.text()}`);
  const doc = await res.json() as FsDoc;
  return parseFields(doc.fields ?? {});
}

/** Create/overwrite a document at `path` with simple scalar fields. */
export async function setDoc(
  token: string,
  path: string,
  fields: Record<string, string | number | boolean>,
): Promise<void> {
  const encoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string')  encoded[k] = { stringValue: v };
    else if (typeof v === 'boolean') encoded[k] = { booleanValue: v };
    else if (Number.isInteger(v))    encoded[k] = { integerValue: String(v) };
    else encoded[k] = { doubleValue: v };
  }
  const res = await fetch(`${FS_DOCS()}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encoded }),
  });
  if (!res.ok) throw new Error(`setDoc ${path} ${res.status}: ${await res.text()}`);
}

/** Delete a document (used to prune stale FCM tokens). */
export async function deleteDoc(token: string, path: string): Promise<void> {
  const res = await fetch(`${FS_DOCS()}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteDoc ${path} ${res.status}: ${await res.text()}`);
  }
}

// ── FCM HTTP v1 send ──────────────────────────────────────────────────────────

export interface PushResult {
  ok: boolean;
  /** true when the token is permanently invalid and should be deleted. */
  unregistered: boolean;
}

/**
 * Send a notification to one device token via FCM HTTP v1.
 * `data` is an optional string map for deep-linking on the client.
 */
export async function sendPush(
  token: string,
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<PushResult> {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId()}/messages:send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title, body },
        data: data ?? {},
        apns: {
          payload: { aps: { sound: 'default' } },
        },
      },
    }),
  });

  if (res.ok) return { ok: true, unregistered: false };

  const errText = await res.text();
  // FCM returns NOT_FOUND / UNREGISTERED for tokens that are no longer valid.
  const unregistered = res.status === 404
    || /UNREGISTERED|registration-token-not-registered|NOT_FOUND/i.test(errText);
  if (!unregistered) {
    console.error('[fcm] send failed %d: %s', res.status, errText);
  }
  return { ok: false, unregistered };
}

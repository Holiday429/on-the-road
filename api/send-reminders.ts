/* ==========================================================================
   On the Road · /api/send-reminders  — Vercel Cron
   --------------------------------------------------------------------------
   Runs daily (see vercel.json crons). For every trip, finds legs that START
   tomorrow and pushes a reminder to each trip member's registered devices
   (users/{uid}/fcmTokens/*, written by the iOS PushNotificationManager).

   Idempotent: a marker doc trips/{tripId}/sentReminders/{legId}_start is
   written after a successful send, so re-runs (or the cron firing twice) don't
   double-notify. Stale FCM tokens (UNREGISTERED) are pruned.

   Security: protected by CRON_SECRET. Vercel Cron sends
   `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set;
   manual calls must include the same header.

   No new SDKs — reuses the REST helpers in _fcm.ts.
   ========================================================================== */

import type { IncomingMessage, ServerResponse } from 'http';
import {
  getAccessToken, listCollection, readDoc, setDoc, deleteDoc, sendPush,
} from './_fcm.ts';

type VercelRequest  = IncomingMessage & { headers: Record<string, string | string[] | undefined> };
type VercelResponse = ServerResponse & { json(data: unknown): void; status(code: number): VercelResponse };

// ── Date helpers (legs store dateFrom as 'YYYY-MM-DD') ─────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Tomorrow in UTC. Legs are date-only, so UTC day boundaries are fine. */
function tomorrowISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return isoDate(d);
}

// ── Member uids for a trip ─────────────────────────────────────────────────────

function tripMemberUids(trip: Record<string, unknown>): string[] {
  const uids = new Set<string>();
  const owner = trip.ownerUid;
  if (typeof owner === 'string' && owner) uids.add(owner);
  // `members` is a uid→role map; `memberUids` is its denormalised array form.
  const members = trip.members;
  if (members && typeof members === 'object') {
    for (const uid of Object.keys(members as Record<string, unknown>)) uids.add(uid);
  }
  const memberUids = trip.memberUids;
  if (Array.isArray(memberUids)) {
    for (const uid of memberUids) if (typeof uid === 'string') uids.add(uid);
  }
  return [...uids];
}

// ── Send one reminder to all of a user's devices ───────────────────────────────

async function notifyUser(
  token: string,
  uid: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<number> {
  const tokens = await listCollection(token, `users/${uid}/fcmTokens`);
  let sent = 0;
  for (const t of tokens) {
    const deviceToken = (t.data.token as string) ?? t.id;
    if (!deviceToken) continue;
    const result = await sendPush(token, deviceToken, title, body, data);
    if (result.ok) sent++;
    else if (result.unregistered) {
      // Prune a dead token so we stop trying it.
      await deleteDoc(token, `users/${uid}/fcmTokens/${t.id}`).catch(() => {});
    }
  }
  return sent;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth: require the cron secret if configured.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  try {
    const accessToken = await getAccessToken();
    const target = tomorrowISO();

    const trips = await listCollection(accessToken, 'trips');
    let pushes = 0;
    let reminders = 0;

    for (const trip of trips) {
      const legs = await listCollection(accessToken, `trips/${trip.id}/legs`);
      const startingTomorrow = legs.filter((l) => l.data.dateFrom === target);
      if (startingTomorrow.length === 0) continue;

      const uids = tripMemberUids(trip.data);
      if (uids.length === 0) continue;

      for (const leg of startingTomorrow) {
        const markerPath = `trips/${trip.id}/sentReminders/${leg.id}_start`;
        const already = await readDoc(accessToken, markerPath);
        if (already) continue; // already notified for this leg

        const flag = (leg.data.flag as string) ?? '';
        const city = (leg.data.city as string) ?? 'your next stop';
        const title = `${flag} ${city} tomorrow`.trim();
        const transport = leg.data.arrivalTransport as Record<string, unknown> | undefined;
        const time = transport?.time as string | undefined;
        const service = transport?.service as string | undefined;
        const body = time
          ? `Departs ${time}${service ? ` · ${service}` : ''}. Get ready!`
          : `Your stop in ${city} begins tomorrow. Get ready!`;

        const data = { tripId: trip.id, legId: leg.id, kind: 'leg_start' };

        let any = 0;
        for (const uid of uids) {
          any += await notifyUser(accessToken, uid, title, body, data);
        }
        pushes += any;
        reminders++;

        // Mark sent (even if 0 devices — avoids rescanning a tokenless trip daily).
        await setDoc(accessToken, markerPath, {
          legId: leg.id,
          sentAt: Date.now(),
          devices: any,
        });
      }
    }

    return res.status(200).json({ ok: true, date: target, reminders, pushes });
  } catch (e) {
    console.error('[send-reminders] error:', e);
    return res.status(500).json({ error: 'internal' });
  }
}

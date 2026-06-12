/* ==========================================================================
   On the Road · hasPublicView → publicView migration
   --------------------------------------------------------------------------
   Converts trips from the deprecated coarse `hasPublicView: true` flag to the
   page-level `publicView: { enabled, collections }` model. For each trip the
   user OWNS that has a legacy flag or live viewer invites:
     - backfill any viewer invite with empty `pages` to the full shareable set
       (so existing share links keep working at full scope), then
     - recompute publicView from the live viewer invites and clear hasPublicView.

   Idempotent (localStorage flag). Owner-only (rules require owner to write the
   trip + invites). Other members' trips are migrated when the owner next logs
   in; until then the dual-read rules keep legacy links working.
   ========================================================================== */

import {
  collection, getDocs, query, where, updateDoc,
} from 'firebase/firestore';
import { db as firestore } from '../firebase/config.ts';
import { currentUser } from '../firebase/auth.ts';
import { listTrips } from './trip-context.ts';
import { recomputePublicView } from './trip-invites.ts';
import { shareablePages } from './page-collections.ts';
import type { Trip, TripInvite } from './schema.ts';

const FLAG_KEY = 'otr:migrated:publicview:v1';

/** Migrate owned trips to the publicView model. Returns number of trips changed. */
export async function migratePublicView(): Promise<number> {
  if (localStorage.getItem(FLAG_KEY)) return 0;
  const u = currentUser();
  if (!u) return 0;

  let changed = 0;
  let trips: Trip[] = [];
  try { trips = await listTrips(); } catch { return 0; }

  const owned = trips.filter((t) => t.members?.[u.uid] === 'owner');
  for (const trip of owned) {
    try {
      const viewerSnap = await getDocs(
        query(collection(firestore, 'tripInvites'),
          where('tripId', '==', trip.id),
          where('role', '==', 'viewer'),
          where('revoked', '==', false),
        ),
      );
      const liveViewers = viewerSnap.docs.map((d) => ({ ref: d.ref, data: d.data() as TripInvite }));
      const legacyFlag = (trip as { hasPublicView?: boolean }).hasPublicView === true;
      const alreadyNew = (trip as Trip).publicView != null;

      // Nothing to do: no legacy flag, no viewer links, and already converted
      // (or never public). Skip without writing.
      if (!legacyFlag && liveViewers.length === 0 && alreadyNew) continue;

      // Backfill page-less viewer invites to the full shareable set so existing
      // links keep working at full scope under the new page-level model.
      const allPages = shareablePages();
      for (const { ref, data } of liveViewers) {
        if (!data.pages || data.pages.length === 0) {
          await updateDoc(ref, { pages: allPages, updatedAt: Date.now() });
        }
      }

      // Recompute publicView from live viewer invites; this also clears the
      // deprecated hasPublicView flag in the same write.
      await recomputePublicView(trip.id);
      changed++;
    } catch (e) {
      console.warn(`publicView migration skipped for trip ${trip.id}:`, e);
    }
  }

  localStorage.setItem(FLAG_KEY, '1');
  return changed;
}

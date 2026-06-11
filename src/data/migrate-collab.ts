/* ==========================================================================
   On the Road · Collaboration migration (single-user → shared trips)
   --------------------------------------------------------------------------
   Moves data from the old single-user layout to the new top-level, shareable
   layout:

     OLD                                          NEW
     users/{uid}/trips/{tripId}              →    trips/{tripId}
     users/{uid}/trips/{tripId}/{sub}/*      →    trips/{tripId}/{sub}/*
     users/{uid}/legs|journalEntries|        →    trips/{tripId}/{name}/*
       nomadSpots  (flat, tripId-tagged)          grouped by each doc's tripId

   On copy, every trip doc is backfilled with ownerUid / members / memberUids
   so the migrating user becomes its owner.

   SAFETY:
   - Copy-only. The old users/{uid}/** data is never deleted, so reverting to
     the previous app version (which reads the old paths) fully restores it.
   - Idempotent: a localStorage flag plus a "destination already has docs"
     guard prevent duplicate writes.
   ========================================================================== */

import { collection, getDocs, getDoc, doc as fbDoc, setDoc, query } from 'firebase/firestore';
import { db as firestore } from '../firebase/config.ts';
import { currentUser } from '../firebase/auth.ts';

// v2: bumped when `todos` was added to the migrated collections, so accounts
// that already ran v1 re-run once to move their todos to trips/{tripId}/todos.
const FLAG = 'otr:migrated:collab:v2';

// Sub-collections that lived under each trip.
const TRIP_SUBCOLLECTIONS = [
  'cityIntel', 'citySafety', 'compares', 'expenseCategories', 'expenses',
  'journalStories', 'journalTemplates', 'prepTasks', 'stays', 'packLists',
  'checklists',
];

// Flat, tripId-tagged collections (lived at users/{uid}/{name}).
// `todos` was user-scoped but is now trip-scoped (shared with members), so it
// migrates the same way — grouped by each doc's tripId tag.
const TAGGED_COLLECTIONS = ['legs', 'journalEntries', 'nomadSpots', 'todos'];

interface MigrationResult { trips: number; docs: number; }

/** Copy every doc from a source collection to a destination collection. */
async function copyCollection(srcPath: string, dstPath: string): Promise<number> {
  const dstCol = collection(firestore, dstPath);
  // Skip if destination already populated (idempotency / avoid clobbering edits).
  const dstSnap = await getDocs(query(dstCol));
  if (!dstSnap.empty) return 0;

  const srcSnap = await getDocs(query(collection(firestore, srcPath)));
  if (srcSnap.empty) return 0;

  let n = 0;
  for (const d of srcSnap.docs) {
    await setDoc(fbDoc(dstCol, d.id), { ...(d.data() as object), id: d.id });
    n++;
  }
  return n;
}

/**
 * Run the migration for the signed-in user. Returns counts (0/0 if nothing to
 * do or already migrated). Never throws — failures are logged and the flag is
 * left unset so a later boot can retry.
 */
export async function migrateCollab(): Promise<MigrationResult> {
  const u = currentUser();
  if (!u) return { trips: 0, docs: 0 };
  if (localStorage.getItem(FLAG) === '1') return { trips: 0, docs: 0 };

  const uid = u.uid;
  let trips = 0;
  let docs = 0;
  let failures = 0;

  try {
    /* ── 1. Trip docs + their sub-collections ─────────────────────────── */
    const oldTripsSnap = await getDocs(query(collection(firestore, `users/${uid}/trips`)));
    const knownTripIds = new Set(oldTripsSnap.docs.map((d) => d.id));

    for (const tripDoc of oldTripsSnap.docs) {
      const tripId = tripDoc.id;
      try {
        const data = tripDoc.data() as Record<string, unknown>;

        // Backfill collaboration fields (owner = migrating user) unless present.
        const members = (data.members as Record<string, string> | undefined)
          ?? { [uid]: 'owner' };
        const memberUids = (data.memberUids as string[] | undefined)
          ?? Object.keys(members);
        const ownerUid = (data.ownerUid as string | undefined) ?? uid;

        // Only write the trip doc if the destination doesn't exist yet.
        // (Rules allow get on a non-existent trips doc — returns not-found.)
        const dstTripRef = fbDoc(firestore, `trips/${tripId}`);
        const dstExists = await getDoc(dstTripRef);
        if (!dstExists.exists()) {
          await setDoc(dstTripRef, { ...data, id: tripId, ownerUid, members, memberUids });
          trips++;
        }

        // Copy each known sub-collection.
        for (const sub of TRIP_SUBCOLLECTIONS) {
          docs += await copyCollection(
            `users/${uid}/trips/${tripId}/${sub}`,
            `trips/${tripId}/${sub}`,
          );
        }
      } catch (e) {
        // One bad trip must not abort the rest — log and continue.
        failures++;
        console.warn(`Collab migration: trip "${tripId}" failed, continuing:`, e);
      }
    }

    // Fallback trip for untagged docs (e.g. todos created with tripId=null):
    // route them to the user's most recently created trip.
    const ownedTrips = oldTripsSnap.docs
      .map((d) => ({ id: d.id, createdAt: (d.data() as { createdAt?: number }).createdAt ?? 0 }))
      .sort((a, b) => b.createdAt - a.createdAt);
    const fallbackTripId = ownedTrips[0]?.id ?? '';

    /* ── 2. Flat tagged collections → grouped under each tripId ────────── */
    for (const name of TAGGED_COLLECTIONS) {
      const flatSnap = await getDocs(query(collection(firestore, `users/${uid}/${name}`)));
      if (flatSnap.empty) continue;

      // Group docs by their tripId tag; untagged docs fall back to the most
      // recent trip so they aren't orphaned (matters for null-tripId todos).
      const byTrip = new Map<string, { id: string; data: Record<string, unknown> }[]>();
      for (const d of flatSnap.docs) {
        const data = d.data() as Record<string, unknown>;
        const tid = (data.tripId as string | undefined) || fallbackTripId;
        if (!tid) continue; // no tag and no fallback trip — can't place it
        const list = byTrip.get(tid) ?? [];
        // Stamp the resolved tripId onto the doc so it filters correctly.
        list.push({ id: d.id, data: { ...data, tripId: tid } });
        byTrip.set(tid, list);
      }

      for (const [tid, list] of byTrip) {
        // Tags can reference trips that were deleted — only copy into trips we
        // actually migrated (writes to a non-existent trip would be denied).
        if (!knownTripIds.has(tid)) continue;
        try {
          const dstCol = collection(firestore, `trips/${tid}/${name}`);
          const dstSnap = await getDocs(query(dstCol));
          if (!dstSnap.empty) continue; // already migrated
          for (const { id, data } of list) {
            await setDoc(fbDoc(dstCol, id), { ...data, id });
            docs++;
          }
        } catch (e) {
          failures++;
          console.warn(`Collab migration: ${name} for trip "${tid}" failed, continuing:`, e);
        }
      }
    }

    // Only mark done when everything copied cleanly; otherwise retry next boot
    // (copies already done are skipped by the "destination populated" guards).
    if (failures === 0) localStorage.setItem(FLAG, '1');
  } catch (e) {
    console.warn('Collaboration migration skipped (will retry next boot):', e);
  }

  return { trips, docs };
}

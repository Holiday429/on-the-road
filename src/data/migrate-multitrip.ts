/* ==========================================================================
   On the Road · Multi-trip migration
   --------------------------------------------------------------------------
   Legs and journal entries used to live under a single trip
   (users/{uid}/trips/{tripId}/legs · /journalEntries). To support "all
   footprints" / "all memories" views they now live in flat, tripId-tagged
   collections (users/{uid}/legs · /journalEntries).

   This copies any existing per-trip docs into the flat collection, stamping
   tripId = DEFAULT_TRIP_ID. Non-destructive (old subcollections are left in
   place) and idempotent (a localStorage flag + a "flat already has rows"
   guard prevent re-runs).
   ========================================================================== */

import { collection, getDocs, doc as fbDoc, setDoc, query } from 'firebase/firestore';
import { db as firestore } from '../firebase/config.ts';
import { currentUser } from '../firebase/auth.ts';
import { DEFAULT_TRIP_ID } from './trip-context.ts';

const FLAG = 'otr:migrated:multitrip';

/** Copy one legacy per-trip subcollection into the flat tagged collection. */
async function migrateCollection(uid: string, name: string): Promise<number> {
  const flatCol = collection(firestore, `users/${uid}/${name}`);

  // If the flat collection already has docs, assume it's been populated
  // (either by a prior migration or by new writes) and skip — avoids dupes.
  const flatSnap = await getDocs(query(flatCol));
  if (!flatSnap.empty) return 0;

  const legacyCol = collection(firestore, `users/${uid}/trips/${DEFAULT_TRIP_ID}/${name}`);
  const legacySnap = await getDocs(query(legacyCol));
  if (legacySnap.empty) return 0;

  let n = 0;
  for (const d of legacySnap.docs) {
    const data = d.data() as Record<string, unknown>;
    await setDoc(fbDoc(flatCol, d.id), { ...data, id: d.id, tripId: DEFAULT_TRIP_ID });
    n++;
  }
  return n;
}

/** Returns total docs migrated across legs + journalEntries (0 if nothing to do). */
export async function migrateMultiTrip(): Promise<number> {
  const u = currentUser();
  if (!u) return 0;
  if (localStorage.getItem(FLAG) === '1') return 0;

  let total = 0;
  try {
    total += await migrateCollection(u.uid, 'legs');
    total += await migrateCollection(u.uid, 'journalEntries');
    localStorage.setItem(FLAG, '1');
  } catch (e) {
    console.warn('Multi-trip migration skipped:', e);
  }
  return total;
}

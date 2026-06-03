/* ==========================================================================
   On the Road · Re-tag legacy data to a user-created trip
   --------------------------------------------------------------------------
   When a brand-new user creates their first trip via onboarding, any existing
   data that was stamped with the legacy DEFAULT_TRIP_ID ('europe-2025') needs
   to be re-tagged to the new trip id so the itinerary, map, journal, etc. all
   show up under the correct trip.

   Affected flat collections: legs, journalEntries.
   Affected trip sub-collections: checklists, packLists, prepTasks, expenses,
   expenseCategories, stays, citySafety, cityIntel, journalStories,
   journalTemplates.

   The operation is safe to call multiple times — it only rewrites docs that
   still carry the old tripId.
   ========================================================================== */

import {
  collection, getDocs, doc as fbDoc, writeBatch, query,
  where,
} from 'firebase/firestore';
import { db as firestore } from '../firebase/config.ts';
import { currentUser } from '../firebase/auth.ts';
import { DEFAULT_TRIP_ID } from './trip-context.ts';

/** Flat collections that carry a tripId field. */
const FLAT_COLS = ['legs', 'journalEntries'] as const;

/** Sub-collections nested under trips/{tripId}/. */
const TRIP_SUB_COLS = [
  'checklists', 'packLists', 'prepTasks', 'expenses',
  'expenseCategories', 'stays', 'citySafety', 'cityIntel',
  'journalStories', 'journalTemplates',
] as const;

/**
 * Re-tag all documents that still reference the legacy DEFAULT_TRIP_ID so
 * they belong to `newTripId`. This is called once after the user creates
 * their first trip via onboarding.
 *
 * Returns total number of documents rewritten.
 */
export async function retagLegacyData(newTripId: string): Promise<number> {
  const u = currentUser();
  if (!u) return 0;
  if (newTripId === DEFAULT_TRIP_ID) return 0; // nothing to retag

  let total = 0;
  const BATCH_SIZE = 400; // Firestore batch limit is 500

  // 1. Flat collections: update tripId field on matching docs
  for (const colName of FLAT_COLS) {
    const col = collection(firestore, `users/${u.uid}/${colName}`);
    const snap = await getDocs(query(col, where('tripId', '==', DEFAULT_TRIP_ID)));
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(firestore);
      for (const d of docs.slice(i, i + BATCH_SIZE)) {
        batch.update(fbDoc(col, d.id), { tripId: newTripId });
      }
      await batch.commit();
    }
    total += docs.length;
  }

  // 2. Trip sub-collections: copy docs from old trip to new trip, then remove old
  for (const subCol of TRIP_SUB_COLS) {
    const srcCol = collection(firestore, `users/${u.uid}/trips/${DEFAULT_TRIP_ID}/${subCol}`);
    const dstCol = collection(firestore, `users/${u.uid}/trips/${newTripId}/${subCol}`);
    const srcSnap = await getDocs(query(srcCol));
    if (srcSnap.empty) continue;

    for (let i = 0; i < srcSnap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(firestore);
      for (const d of srcSnap.docs.slice(i, i + BATCH_SIZE)) {
        const data = d.data() as Record<string, unknown>;
        batch.set(fbDoc(dstCol, d.id), { ...data, tripId: newTripId });
        batch.delete(fbDoc(srcCol, d.id));
      }
      await batch.commit();
    }
    total += srcSnap.docs.length;
  }

  return total;
}

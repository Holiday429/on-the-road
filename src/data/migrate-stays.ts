/* ==========================================================================
   On the Road · stays → compares migration
   --------------------------------------------------------------------------
   Reads existing `trips/{tripId}/stays` documents (old StaySchema) and
   re-writes them as `trips/{tripId}/compares` documents (new CompareGroupSchema).
   Idempotent: skips if the compares collection already has entries, and marks
   each migrated stay with a `_migrated` flag so a re-run is a no-op.
   ========================================================================== */

import {
  collection, getDocs, setDoc, doc as fbDoc, getFirestore,
} from 'firebase/firestore';
import { currentUser } from '../firebase/auth.ts';
import { currentTripId } from './trip-context.ts';
import { genId } from '../firebase/db.ts';
import { defaultDimensions, PRICE_DIM_ID } from './stores/compare-store.ts';
import { SCHEMA_VERSION } from './schema.ts';
import type { CompareCandidate, CompareDimension } from './schema.ts';

const FLAG_KEY = 'otr:migrated:stays-to-compares';

/** Migrate stays → compares. Idempotent, safe to call on every app boot. */
export async function migrateStaysToCompares(): Promise<number> {
  if (localStorage.getItem(FLAG_KEY)) return 0;

  const user = currentUser();
  if (!user) return 0;

  const tripId = currentTripId();
  if (!tripId) return 0;

  const db = getFirestore();

  // Check if any compares already exist — if so, don't migrate again.
  const comparesSnap = await getDocs(
    collection(db, `users/${user.uid}/trips/${tripId}/compares`)
  );
  if (!comparesSnap.empty) {
    localStorage.setItem(FLAG_KEY, String(Date.now()));
    return 0;
  }

  // Read legacy stays.
  const staysSnap = await getDocs(
    collection(db, `users/${user.uid}/trips/${tripId}/stays`)
  );
  if (staysSnap.empty) {
    localStorage.setItem(FLAG_KEY, String(Date.now()));
    return 0;
  }

  const now = Date.now();
  let count = 0;

  for (const stayDoc of staysSnap.docs) {
    const stay = stayDoc.data() as any;

    // Map old StayDimension[] → CompareDimension[] (shapes are identical).
    const dimensions: CompareDimension[] = Array.isArray(stay.dimensions)
      ? stay.dimensions
      : defaultDimensions('accommodation');

    // Map old StayCandidate[] → CompareCandidate[].
    const candidates: CompareCandidate[] = (stay.candidates ?? []).map((c: any) => {
      const fields: Record<string, string> = {};
      if (c.totalPrice != null) fields['price'] = String(c.totalPrice);
      if (c.nights != null && c.nights !== 1) fields['nights'] = String(c.nights);
      if ((c.extraFees ?? 0) > 0) fields['fees'] = String(c.extraFees);
      if (c.address) fields['address'] = c.address;

      // Remove old price dimension score — price is now read from fields.
      const scores = { ...(c.scores ?? {}) };
      delete scores[PRICE_DIM_ID];

      return {
        id: c.id ?? genId(),
        name: c.name ?? 'Untitled',
        link: c.link,
        fields,
        scores,
        notes: c.notes,
      } satisfies CompareCandidate;
    });

    const compareDoc = {
      id: stay.id ?? genId(),
      tripId,
      legId: stay.legId ?? null,
      title: stay.city ?? '',
      compareType: 'accommodation' as const,
      dimensions,
      candidates,
      createdAt: stay.createdAt ?? now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    };

    await setDoc(
      fbDoc(db, `users/${user.uid}/trips/${tripId}/compares/${compareDoc.id}`),
      compareDoc
    );
    count++;
  }

  localStorage.setItem(FLAG_KEY, String(Date.now()));
  return count;
}

/* ==========================================================================
   On the Road · Trip context
   --------------------------------------------------------------------------
   Resolves "the current trip". In the personal version this is a single
   default trip, auto-created on first sign-in. The public version will swap
   the resolver for a trip picker — every store already takes a tripId, so
   nothing downstream changes.
   ========================================================================== */

import { doc as fbDoc, getDoc, setDoc } from 'firebase/firestore';
import { db as firestore } from '../firebase/config.ts';
import { currentUser } from '../firebase/auth.ts';
import { SCHEMA_VERSION, TripSchema, type Trip } from './schema.ts';

export const DEFAULT_TRIP_ID = 'europe-2025';

const DEFAULT_TRIP: Omit<Trip, 'createdAt' | 'updatedAt' | 'schemaVersion'> = {
  id: DEFAULT_TRIP_ID,
  name: 'Europe Summer 2026',
  startDate: '2026-06-25',
  endDate: '2026-09-06',
  coverColor: '#f9b830',
  status: 'planning',
  baseCurrency: 'EUR',
};

let _currentTripId = DEFAULT_TRIP_ID;

export function currentTripId(): string {
  return _currentTripId;
}

export function setCurrentTripId(id: string) {
  _currentTripId = id;
}

function tripRef(uid: string, tripId: string) {
  return fbDoc(firestore, `users/${uid}/trips/${tripId}`);
}

/** Ensure the default trip document exists. Call once after sign-in. */
export async function ensureDefaultTrip(): Promise<Trip> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  const ref = tripRef(u.uid, DEFAULT_TRIP_ID);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const existing = snap.data() as Trip;
    if (existing.name === 'Europe Summer 2025' || existing.startDate === '2025-06-25') {
      const updated = TripSchema.parse({
        ...existing,
        ...DEFAULT_TRIP,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
        schemaVersion: SCHEMA_VERSION,
      });
      await setDoc(ref, updated);
      return updated;
    }
    return existing;
  }

  const now = Date.now();
  const trip = TripSchema.parse({
    ...DEFAULT_TRIP, createdAt: now, updatedAt: now, schemaVersion: SCHEMA_VERSION,
  });
  await setDoc(ref, trip);
  return trip;
}

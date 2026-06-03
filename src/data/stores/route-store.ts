/* ==========================================================================
   On the Road · Route store — itinerary legs
   ========================================================================== */

import { createTaggedCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { LegSchema, type Leg } from '../schema.ts';

export type StoredLeg = WithMeta<Leg>;

// Legs are flattened to users/{uid}/legs with a tripId tag, so the map can
// either show one trip's itinerary or aggregate every trip's footprints.
// Per-trip consumers (itinerary, stay, expenses, journal) use subscribe(),
// which filters to the current trip; the map uses subscribeAll().
function store() {
  return createTaggedCollectionStore('legs', LegSchema);
}

export const routeStore = {
  /** Legs for the current trip only. */
  subscribe: (cb: (legs: StoredLeg[]) => void) =>
    store().subscribeForTrip(currentTripId(), cb as (rows: WithMeta<Leg>[]) => void),

  /** Legs across all trips (map "all footprints" view). */
  subscribeAll: (cb: (legs: StoredLeg[]) => void) =>
    store().subscribeForTrip(null, cb as (rows: WithMeta<Leg>[]) => void),

  /** Cached legs for the current trip. */
  peek: () => (store().peek() as StoredLeg[]).filter(l => l.tripId === currentTripId()),

  set(leg: Partial<Leg> & { id?: string }) {
    return store().set(leg);
  },

  update(id: string, patch: Partial<Leg>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },

  seed(legs: Omit<Leg, 'createdAt' | 'updatedAt' | 'schemaVersion'>[]) {
    return store().bulkSet(legs);
  },
};

/* ==========================================================================
   On the Road · Route store — itinerary legs
   ========================================================================== */

import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { LegSchema, type Leg } from '../schema.ts';

export type StoredLeg = WithMeta<Leg>;

function store() {
  return createCollectionStore(currentTripId(), 'legs', LegSchema);
}

export const routeStore = {
  subscribe: (cb: (legs: StoredLeg[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredLeg[],

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

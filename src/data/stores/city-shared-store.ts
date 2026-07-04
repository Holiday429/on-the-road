/* ==========================================================================
   On the Road · City-shared store — the per-trip "intent layer"
   --------------------------------------------------------------------------
   One doc per city (keyed by slugId(city)) at trips/{tripId}/cityShared. Holds
   the shared wishlist / clips / notes that carry across every visit to a city
   that repeats within a trip. See CitySharedSchema for the rationale.
   ========================================================================== */

import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { CitySharedSchema, type CityShared } from '../schema.ts';

export type StoredCityShared = WithMeta<CityShared>;

function store() {
  return createCollectionStore(currentTripId(), 'cityShared', CitySharedSchema);
}

export const citySharedStore = {
  subscribe: (cb: (rows: StoredCityShared[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredCityShared[],

  /** The shared doc for one city slug, from the live cache (may be undefined). */
  get(slug: string): StoredCityShared | undefined {
    return (store().peek() as StoredCityShared[]).find(r => r.id === slug);
  },

  /** Upsert. id is the slugged city name so writes from either leg converge. */
  save(shared: Partial<CityShared> & { id: string }) {
    return store().set(shared);
  },

  update(id: string, patch: Partial<CityShared>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },
};

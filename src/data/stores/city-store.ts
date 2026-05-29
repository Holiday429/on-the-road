/* ==========================================================================
   On the Road · City intel store — AI briefing cache
   ========================================================================== */

import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { CityIntelSchema, type CityIntel } from '../schema.ts';

export type StoredCityIntel = WithMeta<CityIntel>;

function store() {
  return createCollectionStore(currentTripId(), 'cityIntel', CityIntelSchema);
}

export const cityStore = {
  subscribe: (cb: (rows: StoredCityIntel[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredCityIntel[],

  /** Upsert a generated briefing. id is the slugged city name so re-gen replaces. */
  save(intel: Partial<CityIntel> & { id: string }) {
    return store().set(intel);
  },

  remove(id: string) {
    return store().remove(id);
  },
};

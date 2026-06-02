/* ==========================================================================
   On the Road · City safety store — per-city emergency intel (AI cache)
   Mirrors city-store: trip-scoped, id = slugged city name so a re-generate
   replaces the same card.
   ========================================================================== */

import { createCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { CitySafetySchema, type CitySafety } from '../schema.ts';

export type StoredCitySafety = WithMeta<CitySafety>;

function store() {
  return createCollectionStore(currentTripId(), 'citySafety', CitySafetySchema);
}

export const safetyStore = {
  subscribe: (cb: (rows: StoredCitySafety[]) => void) => store().subscribe(cb),
  peek: () => store().peek() as StoredCitySafety[],

  /** Upsert a safety card. id is the slugged city name so re-gen replaces. */
  save(card: Partial<CitySafety> & { id: string }) {
    return store().set(card);
  },

  update(id: string, patch: Partial<CitySafety>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },
};

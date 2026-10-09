/* ==========================================================================
   On the Road · Traveler recap store
   ========================================================================== */

import { createTaggedCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import { TravelerRecapSchema, type TravelerRecap } from '../schema.ts';

export type StoredTravelerRecap = WithMeta<TravelerRecap>;

// Stored at trips/{tripId}/travelerRecaps (see colPath in firebase/db.ts), same
// as journalEntries, and covered by the generic trips/{tripId}/{sub} rule.
// Tagged rather than plain so the eventual cross-trip view ("how you've changed
// as a traveller") can read them all at once via subscribeAll.
function store() {
  return createTaggedCollectionStore('travelerRecaps', TravelerRecapSchema);
}

export const travelerRecapStore = {
  /** Portraits for the current trip. */
  subscribe: (cb: (rows: StoredTravelerRecap[]) => void) =>
    store().subscribeForTrip(currentTripId(), cb as (rows: WithMeta<TravelerRecap>[]) => void),

  /** Portraits across every trip (for a future "you over time" view). */
  subscribeAll: (cb: (rows: StoredTravelerRecap[]) => void) =>
    store().subscribeForTrip(null, cb as (rows: WithMeta<TravelerRecap>[]) => void),

  peek: () => (store().peek() as StoredTravelerRecap[]).filter((r) => r.tripId === currentTripId()),

  save(recap: Partial<TravelerRecap> & { id?: string }) {
    return store().set(recap);
  },

  update(id: string, patch: Partial<TravelerRecap>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },

  /** Find a public portrait by share slug (across all trips in cache). */
  bySlug(slug: string): StoredTravelerRecap | undefined {
    return (store().peek() as StoredTravelerRecap[]).find(
      (r) => r.visibility === 'public' && r.slug === slug,
    );
  },
};

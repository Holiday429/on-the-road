/* ==========================================================================
   On the Road · Nomad store — work-friendly spots
   --------------------------------------------------------------------------
   Flat user collection tagged with tripId (see createTaggedCollectionStore):
   the gallery can show one trip or all trips, and filter by country.
   `visibility`/`ownerId` are reserved for a future community layer.
   ========================================================================== */

import { createTaggedCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { NomadSpotSchema, type NomadSpot } from '../schema.ts';

export type StoredNomadSpot = WithMeta<NomadSpot>;

function store() {
  return createTaggedCollectionStore('nomadSpots', NomadSpotSchema);
}

export const nomadStore = {
  peek: () => store().peek() as StoredNomadSpot[],

  /** Subscribe to spots for one trip (tripId) or all trips (null). */
  subscribeForTrip: (tripId: string | null, cb: (rows: StoredNomadSpot[]) => void) =>
    store().subscribeForTrip(tripId, cb as (rows: WithMeta<NomadSpot>[]) => void),

  /** Add a spot. tripId/ownerId/visibility default inside the tagged store/schema. */
  add(input: Omit<NomadSpot, 'id' | 'tripId' | 'createdAt' | 'updatedAt' | 'schemaVersion'> & { tripId?: string | null }) {
    return store().set(input);
  },

  update(id: string, patch: Partial<NomadSpot>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },
};

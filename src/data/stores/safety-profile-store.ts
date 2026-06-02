/* ==========================================================================
   On the Road · Safety profile store — personal + emergency info
   --------------------------------------------------------------------------
   User-scoped (NOT trip-scoped): your blood type, allergies, insurance and
   emergency contacts carry across every trip. Modelled as a single document
   with the fixed id 'me' inside the user's `safetyProfile` collection.
   ========================================================================== */

import { createUserCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { SafetyProfileSchema, type SafetyProfile } from '../schema.ts';

export type StoredSafetyProfile = WithMeta<SafetyProfile>;

const DOC_ID = 'me';

function store() {
  return createUserCollectionStore('safetyProfile', SafetyProfileSchema);
}

export const safetyProfileStore = {
  /** Emits the single profile doc (or null if not created yet). */
  subscribe(cb: (profile: StoredSafetyProfile | null) => void) {
    return store().subscribe((rows) => {
      cb((rows.find((r) => r.id === DOC_ID) as StoredSafetyProfile) ?? null);
    });
  },

  peek(): StoredSafetyProfile | null {
    return (store().peek().find((r) => r.id === DOC_ID) as StoredSafetyProfile) ?? null;
  },

  /** Create or replace the profile. */
  save(profile: Partial<SafetyProfile>) {
    return store().set({ ...profile, id: DOC_ID });
  },
};

/* ==========================================================================
   On the Road · User prefs store — settings that follow the traveller
   --------------------------------------------------------------------------
   User-scoped (NOT trip-scoped). One document with the fixed id 'me' in the
   user's `userPrefs` collection; same shape as the safety profile store.
   ========================================================================== */

import { createUserCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { UserPrefsSchema, type UserPrefs } from '../schema.ts';

export type StoredUserPrefs = WithMeta<UserPrefs>;

const DOC_ID = 'me';

function store() {
  return createUserCollectionStore('userPrefs', UserPrefsSchema);
}

export const userPrefsStore = {
  /** Emits the single prefs doc (or null if not created yet). */
  subscribe(cb: (prefs: StoredUserPrefs | null) => void) {
    return store().subscribe((rows) => {
      cb((rows.find((r) => r.id === DOC_ID) as StoredUserPrefs) ?? null);
    });
  },

  peek(): StoredUserPrefs | null {
    return (store().peek().find((r) => r.id === DOC_ID) as StoredUserPrefs) ?? null;
  },

  /** Create or replace the prefs doc. */
  save(prefs: Partial<UserPrefs>) {
    return store().set({ ...prefs, id: DOC_ID });
  },
};

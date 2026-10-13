/* ==========================================================================
   On the Road · Passport stores — what the traveller did and wrote
   --------------------------------------------------------------------------
   User-scoped (NOT trip-scoped), same shape as the user-prefs store: a single
   document with the fixed id 'me'. `passportStore` holds the nickname, photo,
   signature and how every stamp was pressed; `passportDocStore` holds the
   optional real-document details in a collection of their own so they can be
   kept out of anything that exports or shares the passport.
   ========================================================================== */

import { createUserCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { PassportSchema, PassportDocSchema, type PassportDoc, type PassportDetails, type PlacementRec } from '../schema.ts';

export type StoredPassport = WithMeta<PassportDoc>;
export type StoredPassportDetails = WithMeta<PassportDetails>;

const DOC_ID = 'me';

const store = () => createUserCollectionStore('passport', PassportSchema);
const docStore = () => createUserCollectionStore('passportDocs', PassportDocSchema);

export const passportStore = {
  /** Emits the single doc (null until the traveller has written something). */
  subscribe(cb: (p: StoredPassport | null) => void) {
    return store().subscribe((rows) => cb((rows.find((r) => r.id === DOC_ID) as StoredPassport) ?? null));
  },

  peek(): StoredPassport | null {
    return (store().peek().find((r) => r.id === DOC_ID) as StoredPassport) ?? null;
  },

  /** Merges `patch` into the doc, creating it if needed. */
  async save(patch: Partial<PassportDoc>): Promise<void> {
    const cur = passportStore.peek();
    await store().set({ ...(cur ?? {}), ...patch, id: DOC_ID });
  },

  /** Records pressed stamps (replacing any earlier placement of the same stamp). */
  async place(added: Record<string, PlacementRec>): Promise<void> {
    const cur = passportStore.peek();
    await passportStore.save({ placements: { ...(cur?.placements ?? {}), ...added } });
  },
};

export const passportDocStore = {
  subscribe(cb: (d: StoredPassportDetails | null) => void) {
    return docStore().subscribe((rows) => cb((rows.find((r) => r.id === DOC_ID) as StoredPassportDetails) ?? null));
  },

  peek(): StoredPassportDetails | null {
    return (docStore().peek().find((r) => r.id === DOC_ID) as StoredPassportDetails) ?? null;
  },

  async save(patch: Partial<PassportDetails>): Promise<void> {
    const cur = passportDocStore.peek();
    await docStore().set({ ...(cur ?? {}), ...patch, id: DOC_ID });
  },
};

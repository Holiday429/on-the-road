/* ==========================================================================
   On the Road · Visa store — the traveller's visas
   --------------------------------------------------------------------------
   User-scoped (NOT trip-scoped): a visa belongs to the traveller and outlives
   any one trip. One document per visa in `users/{uid}/visas` (owner-only by
   firestore.rules).
   ========================================================================== */

import { createUserCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { VisaSchema, type Visa } from '../schema.ts';

export type StoredVisa = WithMeta<Visa>;

const store = () => createUserCollectionStore('visas', VisaSchema);

export const visaStore = {
  subscribe: (cb: (rows: StoredVisa[]) => void) => store().subscribe((rows) => cb(rows as StoredVisa[])),
  peek: (): StoredVisa[] => store().peek() as StoredVisa[],
  set: (v: Partial<Visa> & { id?: string }) => store().set(v),
  remove: (id: string) => store().remove(id),
};

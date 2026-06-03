/* ==========================================================================
   On the Road · Core Kit store — user-scoped, cross-trip
   The must-bring gear (laptop, camera, chargers…) that gets locked into every
   new pack list and pre-deducted from the weight budget.
   ========================================================================== */

import { createUserCollectionStore, type WithMeta } from '../../firebase/db.ts';
import { CoreKitItemSchema, type CoreKitItem } from '../schema.ts';

export type StoredCoreKitItem = WithMeta<CoreKitItem>;

function store() {
  return createUserCollectionStore('coreKit', CoreKitItemSchema);
}

export const coreKitStore = {
  peek: (): StoredCoreKitItem[] => store().peek() as StoredCoreKitItem[],
  subscribe: (cb: (rows: StoredCoreKitItem[]) => void) =>
    store().subscribe(cb as (rows: WithMeta<CoreKitItem>[]) => void),

  add(input: { name: string; category?: string; weightG?: number; defaultSlot?: CoreKitItem['defaultSlot'] }) {
    return store().set({
      name: input.name,
      category: input.category ?? 'Tech',
      weightG: input.weightG ?? 0,
      defaultSlot: input.defaultSlot ?? 'carryOn',
    });
  },

  update(id: string, patch: Partial<Pick<CoreKitItem, 'name' | 'category' | 'weightG' | 'defaultSlot'>>) {
    return store().update(id, patch);
  },

  remove(id: string) {
    return store().remove(id);
  },

  seed(items: Pick<CoreKitItem, 'name' | 'category' | 'weightG' | 'defaultSlot'>[]) {
    const existing = store().peek();
    if (existing.length > 0) return Promise.resolve();
    return store().bulkSet(items);
  },
};


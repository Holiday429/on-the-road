/* ==========================================================================
   On the Road · Pack template store — user-scoped, cross-trip
   Snapshot a pack list into a reusable template, and spawn a fresh list from
   one. Core-kit items are stripped on save (they re-attach live), and packed
   state is reset on both save and apply.
   ========================================================================== */

import { createUserCollectionStore, genId, type WithMeta } from '../../firebase/db.ts';
import {
  PackTemplateSchema,
  type PackTemplate,
  type PackList,
  type PackItem,
} from '../schema.ts';

export type StoredPackTemplate = WithMeta<PackTemplate>;

function store() {
  return createUserCollectionStore('packTemplates', PackTemplateSchema);
}

/** Strip core items, reset packed flags, regenerate item ids. */
function snapshotItems(items: PackItem[]): PackItem[] {
  return items
    .filter(i => i.source !== 'core')
    .map((i, idx) => ({ ...i, id: genId(), packed: false, order: idx }));
}

export const packTemplateStore = {
  peek: (): StoredPackTemplate[] => store().peek() as StoredPackTemplate[],
  subscribe: (cb: (rows: StoredPackTemplate[]) => void) =>
    store().subscribe(cb as (rows: WithMeta<PackTemplate>[]) => void),

  get(id: string): StoredPackTemplate | undefined {
    return (store().peek() as StoredPackTemplate[]).find(t => t.id === id);
  },

  /** Save an existing pack list as a reusable template. */
  saveFromList(name: string, list: PackList): Promise<string> {
    return store().set({
      name,
      profile: list.profile,
      containers: list.containers.map(c => ({ ...c })),
      airline: { ...list.airline },
      items: snapshotItems(list.items),
    });
  },

  rename(id: string, name: string) {
    return store().update(id, { name });
  },

  remove(id: string) {
    return store().remove(id);
  },

  /** Materialise the template's stored fields for seeding a new PackList. */
  toListInput(tpl: PackTemplate): Pick<PackList, 'profile' | 'containers' | 'airline' | 'items'> {
    return {
      profile: tpl.profile,
      containers: tpl.containers.map(c => ({ ...c })),
      airline: { ...tpl.airline },
      items: snapshotItems(tpl.items),
    };
  },
};

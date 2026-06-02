/* ==========================================================================
   On the Road · Pack store — trip-scoped packing lists
   One document per packing list, holding containers + airline limits + an
   inline items array (same pattern as checklist groups/items).
   ========================================================================== */

import { createCollectionStore, genId, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';
import {
  PackListSchema,
  type PackList,
  type PackItem,
  type PackContainer,
  type PackProfile,
  type AirlineLimit,
} from '../schema.ts';

export type StoredPackList = WithMeta<PackList>;

function store() {
  return createCollectionStore(currentTripId(), 'packLists', PackListSchema);
}

export const packStore = {
  peek: (): StoredPackList[] => store().peek() as StoredPackList[],
  subscribe: (cb: (rows: StoredPackList[]) => void) =>
    store().subscribe(cb as (rows: WithMeta<PackList>[]) => void),

  get(id: string): StoredPackList | undefined {
    return (store().peek() as StoredPackList[]).find(p => p.id === id);
  },

  create(input: {
    name: string;
    profile?: Partial<PackProfile>;
    containers?: PackContainer[];
    airline?: Partial<AirlineLimit>;
    items?: PackItem[];
  }): Promise<string> {
    return store().set({
      name: input.name,
      profile: { days: 7, climate: 'mild', activities: [], ...input.profile },
      containers: input.containers ?? [],
      airline: { airline: '', carryOnKg: 0, checkedKg: 0, personalKg: 0, ...input.airline },
      items: input.items ?? [],
    });
  },

  rename(id: string, name: string) {
    return store().update(id, { name });
  },

  remove(id: string) {
    return store().remove(id);
  },

  setProfile(id: string, profile: PackProfile) {
    return store().update(id, { profile });
  },

  setAirline(id: string, airline: AirlineLimit) {
    return store().update(id, { airline });
  },

  /* ── Containers ────────────────────────────────────────────────────────── */

  addContainer(id: string, c: Omit<PackContainer, 'id'>): Promise<void> {
    const list = this.get(id);
    if (!list) return Promise.resolve();
    const container: PackContainer = { ...c, id: genId() };
    return store().update(id, { containers: [...list.containers, container] });
  },

  updateContainer(id: string, containerId: string, patch: Partial<Omit<PackContainer, 'id'>>): Promise<void> {
    const list = this.get(id);
    if (!list) return Promise.resolve();
    const containers = list.containers.map(c => c.id === containerId ? { ...c, ...patch } : c);
    return store().update(id, { containers });
  },

  removeContainer(id: string, containerId: string): Promise<void> {
    const list = this.get(id);
    if (!list) return Promise.resolve();
    // Orphan any items that lived in this container.
    const items = list.items.map(it => it.containerId === containerId ? { ...it, containerId: null } : it);
    return store().update(id, { containers: list.containers.filter(c => c.id !== containerId), items });
  },

  /* ── Items ─────────────────────────────────────────────────────────────── */

  setItems(id: string, items: PackItem[]): Promise<void> {
    return store().update(id, { items });
  },

  addItem(id: string, item: Omit<PackItem, 'id' | 'order'>): Promise<void> {
    const list = this.get(id);
    if (!list) return Promise.resolve();
    const full: PackItem = { ...item, id: genId(), order: list.items.length };
    return store().update(id, { items: [...list.items, full] });
  },

  updateItem(id: string, itemId: string, patch: Partial<Omit<PackItem, 'id'>>): Promise<void> {
    const list = this.get(id);
    if (!list) return Promise.resolve();
    const items = list.items.map(it => it.id === itemId ? { ...it, ...patch } : it);
    return store().update(id, { items });
  },

  removeItem(id: string, itemId: string): Promise<void> {
    const list = this.get(id);
    if (!list) return Promise.resolve();
    return store().update(id, { items: list.items.filter(it => it.id !== itemId) });
  },

  moveItem(id: string, itemId: string, containerId: string | null): Promise<void> {
    return this.updateItem(id, itemId, { containerId });
  },

  togglePacked(id: string, itemId: string): Promise<void> {
    const list = this.get(id);
    if (!list) return Promise.resolve();
    const items = list.items.map(it => it.id === itemId ? { ...it, packed: !it.packed } : it);
    return store().update(id, { items });
  },
};

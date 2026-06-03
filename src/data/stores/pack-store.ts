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

/** Reserved tripId for lists not linked to any trip. */
export const STANDALONE_TRIP_ID = 'standalone';

function store(tripId?: string) {
  return createCollectionStore(tripId ?? currentTripId(), 'packLists', PackListSchema);
}

export const packStore = {
  peek: (tripId?: string): StoredPackList[] => store(tripId).peek() as StoredPackList[],
  subscribe: (cb: (rows: StoredPackList[]) => void, tripId?: string) =>
    store(tripId).subscribe(cb as (rows: WithMeta<PackList>[]) => void),

  get(id: string, tripId?: string): StoredPackList | undefined {
    return (store(tripId).peek() as StoredPackList[]).find(p => p.id === id);
  },

  /**
   * Create a new pack list.
   * @param tripId  Pass `STANDALONE_TRIP_ID` to create a list not linked to any trip,
   *                or omit/undefined to link to the current active trip.
   */
  create(input: {
    name: string;
    profile?: Partial<PackProfile>;
    containers?: PackContainer[];
    airline?: Partial<AirlineLimit>;
    items?: PackItem[];
    tripId?: string;
  }): Promise<string> {
    return store(input.tripId).set({
      name: input.name,
      profile: { days: 7, climate: 'mild', activities: [], ...input.profile },
      containers: input.containers ?? [],
      airline: { airline: '', carryOnKg: 0, checkedKg: 0, personalKg: 0, ...input.airline },
      items: input.items ?? [],
    });
  },

  /**
   * Return the store that owns this list id. Checks the current trip first,
   * then the standalone store. Falls back to current-trip store.
   */
  storeFor(id: string) {
    const inTrip = (store().peek() as StoredPackList[]).find(p => p.id === id);
    if (inTrip) return store();
    const inStandalone = (store(STANDALONE_TRIP_ID).peek() as StoredPackList[]).find(p => p.id === id);
    if (inStandalone) return store(STANDALONE_TRIP_ID);
    return store();
  },

  rename(id: string, name: string) {
    return this.storeFor(id).update(id, { name });
  },

  remove(id: string) {
    return this.storeFor(id).remove(id);
  },

  setProfile(id: string, profile: PackProfile) {
    return this.storeFor(id).update(id, { profile });
  },

  setAirline(id: string, airline: AirlineLimit) {
    return this.storeFor(id).update(id, { airline });
  },

  /* ── Containers ────────────────────────────────────────────────────────── */

  addContainer(id: string, c: Omit<PackContainer, 'id'>): Promise<void> {
    const s = this.storeFor(id);
    const list = (s.peek() as StoredPackList[]).find(p => p.id === id);
    if (!list) return Promise.resolve();
    const container: PackContainer = { ...c, id: genId() };
    return s.update(id, { containers: [...list.containers, container] });
  },

  updateContainer(id: string, containerId: string, patch: Partial<Omit<PackContainer, 'id'>>): Promise<void> {
    const s = this.storeFor(id);
    const list = (s.peek() as StoredPackList[]).find(p => p.id === id);
    if (!list) return Promise.resolve();
    const containers = list.containers.map(c => c.id === containerId ? { ...c, ...patch } : c);
    return s.update(id, { containers });
  },

  removeContainer(id: string, containerId: string): Promise<void> {
    const s = this.storeFor(id);
    const list = (s.peek() as StoredPackList[]).find(p => p.id === id);
    if (!list) return Promise.resolve();
    const items = list.items.map(it => it.containerId === containerId ? { ...it, containerId: null } : it);
    return s.update(id, { containers: list.containers.filter(c => c.id !== containerId), items });
  },

  /* ── Items ─────────────────────────────────────────────────────────────── */

  setItems(id: string, items: PackItem[]): Promise<void> {
    return this.storeFor(id).update(id, { items });
  },

  addItem(id: string, item: Omit<PackItem, 'id' | 'order'>): Promise<void> {
    const s = this.storeFor(id);
    const list = (s.peek() as StoredPackList[]).find(p => p.id === id);
    if (!list) return Promise.resolve();
    const full: PackItem = { ...item, id: genId(), order: list.items.length };
    return s.update(id, { items: [...list.items, full] });
  },

  updateItem(id: string, itemId: string, patch: Partial<Omit<PackItem, 'id'>>): Promise<void> {
    const s = this.storeFor(id);
    const list = (s.peek() as StoredPackList[]).find(p => p.id === id);
    if (!list) return Promise.resolve();
    const items = list.items.map(it => it.id === itemId ? { ...it, ...patch } : it);
    return s.update(id, { items });
  },

  removeItem(id: string, itemId: string): Promise<void> {
    const s = this.storeFor(id);
    const list = (s.peek() as StoredPackList[]).find(p => p.id === id);
    if (!list) return Promise.resolve();
    return s.update(id, { items: list.items.filter(it => it.id !== itemId) });
  },

  moveItem(id: string, itemId: string, containerId: string | null): Promise<void> {
    return this.updateItem(id, itemId, { containerId });
  },

  togglePacked(id: string, itemId: string): Promise<void> {
    const s = this.storeFor(id);
    const list = (s.peek() as StoredPackList[]).find(p => p.id === id);
    if (!list) return Promise.resolve();
    const items = list.items.map(it => it.id === itemId ? { ...it, packed: !it.packed } : it);
    return this.storeFor(id).update(id, { items });
  },
};

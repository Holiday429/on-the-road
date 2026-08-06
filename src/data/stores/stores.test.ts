import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ==========================================================================
   Store-level tests for the bespoke (non-factory) stores that carry their own
   logic on top of db.ts: route-store's per-trip peek() filter, and todo-store's
   add()-order computation + toggle(). Runs the real stores + real db.ts against
   the same in-memory Firestore mock used by db.test.ts.
   ========================================================================== */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
vi.stubGlobal('localStorage', new MemoryStorage());

const docs = new Map<string, Record<string, unknown>>();
type Listener = { colPath: string; cb: (snap: unknown) => void };
let listeners: Listener[] = [];

function colDocs(colPath: string) {
  const prefix = colPath + '/';
  return [...docs.entries()]
    .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
    .map(([, data]) => data);
}
function snapFor(colPath: string) {
  return { docs: colDocs(colPath).map((data) => ({ data: () => data })) };
}
function fireListeners(colPath: string) {
  listeners.filter((l) => l.colPath === colPath).forEach((l) => l.cb(snapFor(l.colPath)));
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  doc: (colPath: string, id: string) => `${colPath}/${id}`,
  query: (colPath: string) => colPath,
  getDocs: async (colPath: string) => snapFor(colPath),
  getDoc: async (docPath: string) => {
    const data = docs.get(docPath);
    return { exists: () => data !== undefined, data: () => data };
  },
  setDoc: async (docPath: string, data: Record<string, unknown>) => {
    docs.set(docPath, data);
    fireListeners(docPath.slice(0, docPath.lastIndexOf('/')));
  },
  deleteDoc: async (docPath: string) => {
    docs.delete(docPath);
    fireListeners(docPath.slice(0, docPath.lastIndexOf('/')));
  },
  onSnapshot: (colPath: string, cb: (snap: unknown) => void) => {
    const l: Listener = { colPath, cb };
    listeners.push(l);
    return () => { listeners = listeners.filter((x) => x !== l); };
  },
}));

vi.mock('../../firebase/config.ts', () => ({ db: {} }));
vi.mock('../../firebase/auth.ts', () => ({ currentUser: () => ({ uid: 'alice' }) }));

let _currentTripId = 't1';
vi.mock('../trip-context.ts', () => ({ currentTripId: () => _currentTripId }));

import { routeStore } from './route-store.ts';
import { todoStore } from './todo-store.ts';
import { checklistStore, STANDALONE_TRIP_ID } from './checklist-store.ts';

beforeEach(() => {
  docs.clear();
  listeners = [];
  localStorage.clear();
  _currentTripId = 't1';
});

describe('routeStore.peek', () => {
  it('scopes to the current trip: switching trips changes what peek() returns', async () => {
    // Populate each trip's cache via its own current-trip subscription.
    const unsub1 = routeStore.subscribe(() => {});
    await routeStore.set({ id: 'l1', city: 'Paris', country: 'France', dateFrom: '2026-01-01', dateTo: '2026-01-03', tripId: 't1' });
    unsub1();

    _currentTripId = 't2';
    const unsub2 = routeStore.subscribe(() => {});
    await routeStore.set({ id: 'l2', city: 'Rome', country: 'Italy', dateFrom: '2026-01-04', dateTo: '2026-01-06', tripId: 't2' });
    unsub2();

    expect(routeStore.peek().map((l) => l.id)).toEqual(['l2']);
    _currentTripId = 't1';
    expect(routeStore.peek().map((l) => l.id)).toEqual(['l1']);
  });

  it('filters out a foreign-trip leg even if it leaks into the current cache', () => {
    // Directly seed the t1 cache with a mix of t1 and t2 legs (the shape a stale
    // or migration-era cache could hold). peek()'s tripId filter must drop t2.
    const mixed = [
      { id: 'l1', tripId: 't1', city: 'Paris', country: 'France', flag: '', dateFrom: '2026-01-01', dateTo: '2026-01-03', order: 0, createdAt: 1, updatedAt: 1, schemaVersion: 1 },
      { id: 'l2', tripId: 't2', city: 'Rome', country: 'Italy', flag: '', dateFrom: '2026-01-04', dateTo: '2026-01-06', order: 0, createdAt: 1, updatedAt: 1, schemaVersion: 1 },
    ];
    localStorage.setItem('otr:cache:alice:t1:legs', JSON.stringify(mixed));
    _currentTripId = 't1';
    expect(routeStore.peek().map((l) => l.id)).toEqual(['l1']);
  });
});

describe('todoStore.add', () => {
  it('assigns order by current count and defaults done/dueDate/remindAt', async () => {
    const unsub = todoStore.subscribe(() => {});
    const id1 = await todoStore.add({ text: 'Book train' });
    const id2 = await todoStore.add({ text: 'Pack bags' });
    unsub();

    const first = docs.get(`trips/t1/todos/${id1}`)!;
    const second = docs.get(`trips/t1/todos/${id2}`)!;
    expect(first.order).toBe(0);
    expect(second.order).toBe(1);          // count-based ordering
    expect(first.done).toBe(false);
    expect(first.dueDate).toBe(null);
    expect(first.remindAt).toBe(null);
    expect(first.text).toBe('Book train');
  });

  it('honours caller-provided fields over the defaults', async () => {
    const unsub = todoStore.subscribe(() => {});
    const id = await todoStore.add({ text: 'Visa', dueDate: '2026-02-01', done: true });
    unsub();
    const row = docs.get(`trips/t1/todos/${id}`)!;
    expect(row.dueDate).toBe('2026-02-01');
    expect(row.done).toBe(true);
  });
});

describe('todoStore.toggle', () => {
  it('flips the done flag from the passed-in current value', async () => {
    const unsub = todoStore.subscribe(() => {});
    const id = await todoStore.add({ text: 'Buy adapter' });
    await todoStore.toggle(id, false);
    expect(docs.get(`trips/t1/todos/${id}`)!.done).toBe(true);
    await todoStore.toggle(id, true);
    expect(docs.get(`trips/t1/todos/${id}`)!.done).toBe(false);
    unsub();
  });
});

describe('checklistStore — standalone-checklist routing (regression: removeGroup/toggleItem)', () => {
  it('removeGroup writes to the standalone doc, not the current trip doc', async () => {
    const unsubTrip = checklistStore.subscribe(() => {});
    const unsubStandalone = checklistStore.subscribe(() => {}, STANDALONE_TRIP_ID);

    const id = await checklistStore.create({
      name: 'Solo list', tripId: STANDALONE_TRIP_ID,
      groups: [{ id: 'g1', name: 'Docs', icon: '📋', order: 0, items: [] }],
    });
    await checklistStore.removeGroup(id, 'g1');

    const standaloneDoc = docs.get(`trips/${STANDALONE_TRIP_ID}/checklists/${id}`);
    const tripDoc = docs.get(`trips/t1/checklists/${id}`);
    expect(tripDoc).toBeUndefined(); // must never have been created under the wrong trip
    expect((standaloneDoc!.groups as unknown[]).length).toBe(0);

    unsubTrip(); unsubStandalone();
  });

  it('toggleItem marks the standalone doc done, not the current trip doc', async () => {
    const unsubTrip = checklistStore.subscribe(() => {});
    const unsubStandalone = checklistStore.subscribe(() => {}, STANDALONE_TRIP_ID);

    const id = await checklistStore.create({
      name: 'Solo list', tripId: STANDALONE_TRIP_ID,
      groups: [{ id: 'g1', name: 'Docs', icon: '📋', order: 0, items: [{ id: 'i1', text: 'Passport', done: false, order: 0 }] }],
    });
    const allDone = await checklistStore.toggleItem(id, 'g1', 'i1');
    expect(allDone).toBe(true);

    const standaloneDoc = docs.get(`trips/${STANDALONE_TRIP_ID}/checklists/${id}`);
    const tripDoc = docs.get(`trips/t1/checklists/${id}`);
    expect(tripDoc).toBeUndefined();
    expect(standaloneDoc!.completedAt).not.toBeNull();

    unsubTrip(); unsubStandalone();
  });
});

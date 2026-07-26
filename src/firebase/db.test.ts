import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/* ==========================================================================
   Tests for the collection-store factory (src/firebase/db.ts) — the shared
   engine under 17 of the app's 18 data stores. We exercise the real db.ts
   logic (meta stamping, createdAt preservation, schema validation on write,
   id generation, tagged-store write routing, and cross-trip aggregation)
   against an in-memory Firestore mock, so no emulator is needed.
   ========================================================================== */

/* ── localStorage polyfill (node env has none) ───────────────────────────── */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
vi.stubGlobal('localStorage', new MemoryStorage());

/* ── In-memory Firestore ──────────────────────────────────────────────────
   A doc "ref" is just its full path string ("trips/t1/expenses/e1"); a
   collection "ref" is the collection path ("trips/t1/expenses"). onSnapshot
   registers a listener that re-emits whenever a doc under its collection
   changes, so subscription behaviour is observable.                          */
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
  collection: (_db: unknown, path: string) => path,               // colRef = path string
  doc: (colPath: string, id: string) => `${colPath}/${id}`,        // docRef = full path
  query: (colPath: string) => colPath,                            // query is a passthrough
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

vi.mock('./config.ts', () => ({ db: {} }));

let _user: { uid: string } | null = { uid: 'alice' };
vi.mock('./auth.ts', () => ({ currentUser: () => _user }));

let _currentTripId = 't1';
vi.mock('../data/trip-context.ts', () => ({ currentTripId: () => _currentTripId }));

// Import AFTER the mocks are registered.
import {
  createCollectionStore, createTaggedCollectionStore, setMyTripIdsResolver, genId,
} from './db.ts';

const ThingSchema = z.object({
  id: z.string(),
  name: z.string(),
  tripId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  schemaVersion: z.number().default(1),
});

beforeEach(() => {
  docs.clear();
  listeners = [];
  localStorage.clear();
  _user = { uid: 'alice' };
  _currentTripId = 't1';
});
afterEach(() => { vi.restoreAllMocks(); });

describe('genId', () => {
  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => genId()));
    expect(ids.size).toBe(500);
  });
});

describe('createCollectionStore — write path', () => {
  it('stamps createdAt/updatedAt/schemaVersion and generates an id on set()', async () => {
    const store = createCollectionStore('t1', 'things', ThingSchema);
    const id = await store.set({ name: 'Louvre' });
    expect(typeof id).toBe('string');
    const written = docs.get(`trips/t1/things/${id}`)!;
    expect(written.id).toBe(id);
    expect(written.name).toBe('Louvre');
    expect(written.schemaVersion).toBe(1);
    expect(typeof written.createdAt).toBe('number');
    expect(written.updatedAt).toBe(written.createdAt);
  });

  it('honours a caller-supplied id instead of generating one', async () => {
    const store = createCollectionStore('t1', 'things', ThingSchema);
    const id = await store.set({ id: 'fixed-1', name: 'Eiffel' });
    expect(id).toBe('fixed-1');
    expect(docs.has('trips/t1/things/fixed-1')).toBe(true);
  });

  it('rejects a write that violates the schema, before touching the network', async () => {
    const store = createCollectionStore('t1', 'things', ThingSchema);
    // name is required and must be a string
    await expect(store.set({ name: 123 as unknown as string })).rejects.toThrow();
    expect(docs.size).toBe(0);
  });

  it('throws when no user is signed in', async () => {
    _user = null;
    const store = createCollectionStore('t1', 'things', ThingSchema);
    await expect(store.set({ name: 'x' })).rejects.toThrow(/signed in/i);
  });

  it('writes under the correct trip path', async () => {
    const store = createCollectionStore('t9', 'expenses', ThingSchema);
    await store.set({ id: 'e1', name: 'Hotel' });
    expect(docs.has('trips/t9/expenses/e1')).toBe(true);
  });
});

describe('createCollectionStore — update path', () => {
  it('preserves the original createdAt and bumps updatedAt', async () => {
    const store = createCollectionStore('t1', 'things', ThingSchema);
    const id = await store.set({ id: 'u1', name: 'Old' });
    const created = docs.get(`trips/t1/things/u1`)!.createdAt as number;

    // Force a later clock so updatedAt is strictly greater.
    const later = Date.now() + 5000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await store.update(id, { name: 'New' });

    const after = docs.get(`trips/t1/things/u1`)!;
    expect(after.name).toBe('New');
    expect(after.createdAt).toBe(created);   // unchanged
    expect(after.updatedAt).toBe(later);     // bumped
  });

  it('reads the live doc before merging, so a stale-cache field cannot clobber it', async () => {
    const store = createCollectionStore('t1', 'things', ThingSchema);
    await store.set({ id: 'm1', name: 'A' });

    // Simulate another device having changed the doc in Firestore directly.
    docs.set('trips/t1/things/m1', { ...docs.get('trips/t1/things/m1')!, name: 'B-from-other-device' });

    // A patch that doesn't touch `name` must keep the live value, not resurrect 'A'.
    await store.update('m1', { tripId: 't1' });
    expect(docs.get('trips/t1/things/m1')!.name).toBe('B-from-other-device');
  });

  it('throws a clear error when updating a doc that does not exist', async () => {
    const store = createCollectionStore('t1', 'things', ThingSchema);
    await expect(store.update('ghost', { name: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('createCollectionStore — subscribe / cache', () => {
  it('emits the cached rows synchronously, then live snapshots', async () => {
    const store = createCollectionStore('t1', 'things', ThingSchema);
    const emissions: number[] = [];
    const unsub = store.subscribe((rows) => emissions.push(rows.length));
    // First (synchronous) emission is the empty cache.
    expect(emissions).toEqual([0]);

    await store.set({ id: 's1', name: 'One' });
    // The write fired the snapshot listener → a second emission with 1 row.
    expect(emissions.at(-1)).toBe(1);
    unsub();
  });

  it('peek() reflects the last snapshot written to cache', async () => {
    const store = createCollectionStore('t1', 'things', ThingSchema);
    const unsub = store.subscribe(() => {});
    await store.set({ id: 'p1', name: 'Cached' });
    unsub();
    expect(store.peek().map((r) => r.id)).toEqual(['p1']);
  });

  it('a public (signed-out) viewer can still peek a shared trip cache under the guest namespace', async () => {
    const store = createCollectionStore('t1', 'things', ThingSchema);
    const unsub = store.subscribe(() => {});
    await store.set({ id: 'g1', name: 'Public' }); // written while signed in
    unsub();
    _user = null; // now a guest
    const guestStore = createCollectionStore('t1', 'things', ThingSchema);
    // Guest cache namespace differs, so it starts empty rather than throwing.
    expect(guestStore.peek()).toEqual([]);
  });
});

describe('createTaggedCollectionStore — write routing', () => {
  it('routes a write with an explicit tripId to THAT trip, not the current one', async () => {
    _currentTripId = 't1';
    const store = createTaggedCollectionStore('legs', ThingSchema);
    await store.set({ id: 'leg-x', name: 'Rome', tripId: 't2' });
    expect(docs.has('trips/t2/legs/leg-x')).toBe(true);
    expect(docs.has('trips/t1/legs/leg-x')).toBe(false);
  });

  it('defaults an absent tripId to the current trip and tags the doc', async () => {
    _currentTripId = 't1';
    const store = createTaggedCollectionStore('legs', ThingSchema);
    const id = await store.set({ name: 'Paris' });
    const written = docs.get(`trips/t1/legs/${id}`)!;
    expect(written.tripId).toBe('t1');
  });
});

describe('createTaggedCollectionStore — cross-trip aggregation', () => {
  it('subscribeForTrip(null) merges rows from every trip the user belongs to', async () => {
    setMyTripIdsResolver(() => ['t1', 't2']);
    const tagged = createTaggedCollectionStore('legs', ThingSchema);
    let merged: { id: string }[] = [];
    // Subscribe first, then write: each per-trip snapshot listener re-emits on
    // write and the aggregator re-merges — the live-update path.
    const unsub = tagged.subscribeForTrip(null, (rows) => { merged = rows; });
    await createCollectionStore('t1', 'legs', ThingSchema).set({ id: 'a', name: 'Alpha', tripId: 't1' });
    await createCollectionStore('t2', 'legs', ThingSchema).set({ id: 'b', name: 'Beta', tripId: 't2' });
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b']);
    unsub();
  });

  it('subscribeForTrip(null) emits [] when the user belongs to no trips', () => {
    setMyTripIdsResolver(() => []);
    const tagged = createTaggedCollectionStore('legs', ThingSchema);
    let called: unknown[] | null = null;
    const unsub = tagged.subscribeForTrip(null, (rows) => { called = rows; });
    expect(called).toEqual([]);
    unsub();
  });

  it('subscribeForTrip(tripId) scopes to a single trip', async () => {
    setMyTripIdsResolver(() => ['t1', 't2']);
    const tagged = createTaggedCollectionStore('legs', ThingSchema);
    let rows: { id: string }[] = [];
    const unsub = tagged.subscribeForTrip('t2', (r) => { rows = r; });
    // Writing into t1 must NOT reach a t2-scoped subscription…
    await createCollectionStore('t1', 'legs', ThingSchema).set({ id: 'a', name: 'Alpha', tripId: 't1' });
    // …only the t2 write does.
    await createCollectionStore('t2', 'legs', ThingSchema).set({ id: 'b', name: 'Beta', tripId: 't2' });
    expect(rows.map((r) => r.id)).toEqual(['b']);
    unsub();
  });
});

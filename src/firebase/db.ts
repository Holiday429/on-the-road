/* ==========================================================================
   On the Road · Firestore data layer (base)
   --------------------------------------------------------------------------
   Generic collection store. Per-feature stores (prep-store, expense-store…)
   build their business methods on top of this — see src/data/stores/.

   Design:
   - Firestore is the source of truth; localStorage is an offline cache that
     also paints the UI instantly before the first snapshot arrives.
   - subscribe() emits the cache synchronously, then live snapshots.
   - Writes go to Firestore (which updates the cache via its own snapshot);
     offline writes are queued by the Firestore SDK and replay on reconnect.
   - Every write stamps meta (createdAt/updatedAt/schemaVersion).
   ========================================================================== */

import {
  collection, doc as fbDoc, getDocs, getDoc, onSnapshot,
  setDoc, deleteDoc, query, type Firestore,
} from 'firebase/firestore';
import { db as firestore } from './config.ts';
import { currentUser } from './auth.ts';
import { SCHEMA_VERSION, type Meta } from '../data/schema.ts';
import { currentTripId } from '../data/trip-context.ts';
import type { z } from 'zod';

/** users/{uid}/{name} — for collections that belong to the user, not a trip. */
function userColPath(uid: string, name: string) {
  return `users/${uid}/${name}`;
}

function userCacheKey(uid: string, name: string) {
  return `otr:cache:${uid}:${name}`;
}

/**
 * Like createCollectionStore but scoped to the user (not a trip).
 * Used for e.g. checklist templates that aren't tied to one trip.
 */
export function createUserCollectionStore<S extends z.ZodTypeAny>(
  name: string,
  schema: S,
): CollectionStore<z.infer<S>> {
  type T = z.infer<S>;

  function requireUid(): string {
    const u = currentUser();
    if (!u) throw new Error('Not signed in.');
    return u.uid;
  }

  function ref(uid: string) {
    return collection(firestore as Firestore, userColPath(uid, name));
  }

  return {
    peek() {
      const u = currentUser();
      if (!u) return [];
      return readCache<T>(userCacheKey(u.uid, name));
    },

    async list() {
      const uid = requireUid();
      const snap = await getDocs(query(ref(uid)));
      const rows = snap.docs.map((d) => d.data() as WithMeta<T>);
      writeCache(userCacheKey(uid, name), rows);
      return rows;
    },

    subscribe(cb) {
      const u = currentUser();
      if (!u) { cb([]); return () => {}; }
      const uid = u.uid;
      const key = userCacheKey(uid, name);
      cb(readCache<T>(key));
      return onSnapshot(query(ref(uid)), (snap) => {
        const rows = snap.docs.map((d) => d.data() as WithMeta<T>);
        writeCache(key, rows);
        cb(rows);
      });
    },

    async set(data) {
      const uid = requireUid();
      const id = data.id ?? genId();
      const existing = readCache<T>(userCacheKey(uid, name)).find((r) => r.id === id);
      const meta: Meta = {
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
        schemaVersion: SCHEMA_VERSION,
      };
      const payload = schema.parse({ ...data, id, ...meta });
      await setDoc(fbDoc(ref(uid), id), payload as object);
      return id;
    },

    async update(id, patch) {
      const uid = requireUid();
      const docRef = fbDoc(ref(uid), id);
      const snap = await getDoc(docRef);
      let existing: WithMeta<T> | undefined;
      if (snap.exists()) {
        existing = snap.data() as WithMeta<T>;
      } else {
        existing = readCache<T>(userCacheKey(uid, name)).find((r) => r.id === id);
      }
      if (!existing) throw new Error(`update: doc ${id} not found`);
      const merged = { ...existing, ...patch, id, updatedAt: now() };
      const payload = schema.parse(merged);
      await setDoc(docRef, payload as object);
    },

    async remove(id) {
      const uid = requireUid();
      await deleteDoc(fbDoc(ref(uid), id));
    },

    async bulkSet(rows) {
      for (const row of rows) await this.set(row);
    },
  };
}

/**
 * Resolver that returns the trip ids the signed-in user can see. Injected from
 * trip-context to avoid a circular import. Used by tagged stores when they need
 * to aggregate across all of a user's trips (map "all footprints", journal
 * cross-trip calendar). Returns a snapshot list; callers re-resolve on demand.
 */
let _myTripIdsResolver: () => string[] = () => [];
export function setMyTripIdsResolver(fn: () => string[]) {
  _myTripIdsResolver = fn;
}

/**
 * A trip-scoped store whose docs also carry a `tripId` tag. Each trip's docs
 * live at trips/{tripId}/{name} (so collaborators see them). The `tripId` tag
 * is retained on each doc for convenience and aggregation filtering.
 *
 * - On write, an absent `tripId` defaults to the current trip; the doc is
 *   written under that trip's sub-collection.
 * - `subscribeForTrip(tripId, cb)` subscribes to one trip's sub-collection.
 *   Passing `null` fans out across every trip the user belongs to (resolved via
 *   setMyTripIdsResolver) and merges the results — the map / journal "all" view.
 */
export interface TaggedCollectionStore<T> extends CollectionStore<T> {
  subscribeForTrip(tripId: string | null, cb: (rows: WithMeta<T>[]) => void): () => void;
}

export function createTaggedCollectionStore<S extends z.ZodTypeAny>(
  name: string,
  schema: S,
): TaggedCollectionStore<z.infer<S>> {
  // The "current trip" store handles peek/set/update/remove against the active
  // trip's sub-collection. Writes always target currentTripId().
  const current = () => createCollectionStore(currentTripId(), name, schema);

  return {
    peek: () => current().peek(),
    list: () => current().list(),
    subscribe: (cb) => current().subscribe(cb),
    set(data) {
      const tripId = (data as { tripId?: string | null }).tripId ?? currentTripId();
      const withTrip = { ...data, tripId };
      return createCollectionStore(tripId, name, schema).set(withTrip);
    },
    update: (id, patch) => current().update(id, patch),
    remove: (id) => current().remove(id),
    bulkSet: (rows) => current().bulkSet(rows),

    subscribeForTrip(tripId, cb) {
      if (tripId != null) {
        return createCollectionStore(tripId, name, schema).subscribe(cb);
      }
      // Aggregate across all of the user's trips. Subscribe to each trip's
      // sub-collection and merge; re-emit the combined set on any change.
      const tripIds = _myTripIdsResolver();
      const byTrip = new Map<string, WithMeta<z.infer<S>>[]>();
      const emit = () => cb([...byTrip.values()].flat());
      const unsubs = tripIds.map((tid) =>
        createCollectionStore(tid, name, schema).subscribe((rows) => {
          byTrip.set(tid, rows);
          emit();
        }),
      );
      if (!tripIds.length) cb([]);
      return () => unsubs.forEach((u) => u());
    },
  };
}

export type WithMeta<T> = T & { id: string } & Meta;

function now() { return Date.now(); }

/** trips/{tripId}/{name} — top-level so trips can be shared across users. */
function colPath(tripId: string, name: string) {
  return `trips/${tripId}/${name}`;
}

function cacheKey(uid: string, tripId: string, name: string) {
  return `otr:cache:${uid}:${tripId}:${name}`;
}

function readCache<T>(key: string): WithMeta<T>[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt cache */ }
  return [];
}

function writeCache<T>(key: string, rows: WithMeta<T>[]) {
  try { localStorage.setItem(key, JSON.stringify(rows)); } catch { /* quota */ }
}

export interface CollectionStore<T> {
  /** Read current cached rows synchronously. */
  peek(): WithMeta<T>[];
  /** One-shot fetch from Firestore (also refreshes cache). */
  list(): Promise<WithMeta<T>[]>;
  /** Live subscription. Emits cache immediately, then each snapshot. Returns unsubscribe. */
  subscribe(cb: (rows: WithMeta<T>[]) => void): () => void;
  /** Create/replace a document. Generates an id if absent. Returns the id. */
  set(data: Partial<T> & { id?: string }): Promise<string>;
  /** Shallow-merge a patch into an existing document. */
  update(id: string, patch: Partial<T>): Promise<void>;
  /** Delete a document. */
  remove(id: string): Promise<void>;
  /** Bulk create (used for seeding / migration). */
  bulkSet(rows: (Partial<T> & { id?: string })[]): Promise<void>;
}

export function genId(): string {
  return Math.random().toString(36).slice(2) + now().toString(36);
}

/**
 * Create a typed store bound to the current user + a trip + a sub-collection.
 * `schema` validates writes; bad writes throw before hitting the network.
 */
export function createCollectionStore<S extends z.ZodTypeAny>(
  tripId: string,
  name: string,
  schema: S,
): CollectionStore<z.infer<S>> {
  type T = z.infer<S>;

  function requireUid(): string {
    const u = currentUser();
    if (!u) throw new Error('Not signed in.');
    return u.uid;
  }

  // Path no longer depends on uid — trips/{tripId}/{name} is shared. The cache
  // is still keyed by uid (it's a local per-account cache, not the source).
  function ref() {
    return collection(firestore as Firestore, colPath(tripId, name));
  }

  // Public (unauthenticated) viewers have no uid; they read shared trips that
  // carry hasPublicView. Reads still work — Firestore rules permit them — so
  // these methods proceed with a 'guest' cache namespace instead of bailing.
  function cacheUid(): string {
    return currentUser()?.uid ?? 'guest';
  }

  return {
    peek() {
      return readCache<T>(cacheKey(cacheUid(), tripId, name));
    },

    async list() {
      const snap = await getDocs(query(ref()));
      const rows = snap.docs.map((d) => d.data() as WithMeta<T>);
      writeCache(cacheKey(cacheUid(), tripId, name), rows);
      return rows;
    },

    subscribe(cb) {
      const key = cacheKey(cacheUid(), tripId, name);
      cb(readCache<T>(key)); // instant paint from cache
      return onSnapshot(query(ref()), (snap) => {
        const rows = snap.docs.map((d) => d.data() as WithMeta<T>);
        writeCache(key, rows);
        cb(rows);
      });
    },

    async set(data) {
      const uid = requireUid();
      const id = data.id ?? genId();
      const existing = readCache<T>(cacheKey(uid, tripId, name)).find((r) => r.id === id);
      const meta: Meta = {
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
        schemaVersion: SCHEMA_VERSION,
      };
      const payload = schema.parse({ ...data, id, ...meta });
      await setDoc(fbDoc(ref(), id), payload as object);
      return id;
    },

    async update(id, patch) {
      const uid = requireUid();
      // Always read the live Firestore doc before merging so stale cache
      // cannot overwrite changes made from another device or tab.
      const docRef = fbDoc(ref(), id);
      const snap = await getDoc(docRef);
      let existing: WithMeta<T> | undefined;
      if (snap.exists()) {
        existing = snap.data() as WithMeta<T>;
      } else {
        // Doc not in Firestore yet — fall back to cache (just-created doc race).
        existing = readCache<T>(cacheKey(uid, tripId, name)).find((r) => r.id === id);
      }
      if (!existing) throw new Error(`update: doc ${id} not found`);
      const merged = { ...existing, ...patch, id, updatedAt: now() };
      const payload = schema.parse(merged);
      await setDoc(docRef, payload as object);
    },

    async remove(id) {
      requireUid();
      await deleteDoc(fbDoc(ref(), id));
    },

    async bulkSet(rows) {
      // Sequential keeps it simple and well under any batch limits for our scale.
      for (const row of rows) await this.set(row);
    },
  };
}

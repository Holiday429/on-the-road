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
  collection, doc as fbDoc, getDocs, onSnapshot,
  setDoc, deleteDoc, query, type Firestore,
} from 'firebase/firestore';
import { db as firestore } from './config.ts';
import { currentUser } from './auth.ts';
import { SCHEMA_VERSION, type Meta } from '../data/schema.ts';
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
      const uid = requireUid();
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
      let existing = readCache<T>(userCacheKey(uid, name)).find((r) => r.id === id);
      if (!existing) {
        const snap = await getDocs(query(ref(uid)));
        const rows = snap.docs.map((d) => d.data() as WithMeta<T>);
        writeCache(userCacheKey(uid, name), rows);
        existing = rows.find((r) => r.id === id);
      }
      if (!existing) throw new Error(`update: doc ${id} not found`);
      const merged = { ...existing, ...patch, id, updatedAt: now() };
      const payload = schema.parse(merged);
      await setDoc(fbDoc(ref(uid), id), payload as object);
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

export type WithMeta<T> = T & { id: string } & Meta;

function now() { return Date.now(); }

/** users/{uid}/trips/{tripId}/{name} */
function colPath(uid: string, tripId: string, name: string) {
  return `users/${uid}/trips/${tripId}/${name}`;
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

  function ref(uid: string) {
    return collection(firestore as Firestore, colPath(uid, tripId, name));
  }

  return {
    peek() {
      const u = currentUser();
      if (!u) return [];
      return readCache<T>(cacheKey(u.uid, tripId, name));
    },

    async list() {
      const uid = requireUid();
      const snap = await getDocs(query(ref(uid)));
      const rows = snap.docs.map((d) => d.data() as WithMeta<T>);
      writeCache(cacheKey(uid, tripId, name), rows);
      return rows;
    },

    subscribe(cb) {
      const uid = requireUid();
      const key = cacheKey(uid, tripId, name);
      cb(readCache<T>(key)); // instant paint from cache
      return onSnapshot(query(ref(uid)), (snap) => {
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
      await setDoc(fbDoc(ref(uid), id), payload as object);
      return id;
    },

    async update(id, patch) {
      const uid = requireUid();
      // Fall back to a Firestore fetch if the local cache doesn't have the doc yet
      // (race: doc was just created but the snapshot callback hasn't fired yet).
      let existing = readCache<T>(cacheKey(uid, tripId, name)).find((r) => r.id === id);
      if (!existing) {
        const snap = await getDocs(query(ref(uid)));
        const rows = snap.docs.map((d) => d.data() as WithMeta<T>);
        writeCache(cacheKey(uid, tripId, name), rows);
        existing = rows.find((r) => r.id === id);
      }
      if (!existing) throw new Error(`update: doc ${id} not found`);
      const merged = { ...existing, ...patch, id, updatedAt: now() };
      const payload = schema.parse(merged);
      await setDoc(fbDoc(ref(uid), id), payload as object);
    },

    async remove(id) {
      const uid = requireUid();
      await deleteDoc(fbDoc(ref(uid), id));
    },

    async bulkSet(rows) {
      // Sequential keeps it simple and well under any batch limits for our scale.
      for (const row of rows) await this.set(row);
    },
  };
}

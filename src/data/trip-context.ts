/* ==========================================================================
   On the Road · Trip context
   --------------------------------------------------------------------------
   Resolves "the current trip". In the personal version this is a single
   default trip, auto-created on first sign-in. The public version will swap
   the resolver for a trip picker — every store already takes a tripId, so
   nothing downstream changes.
   ========================================================================== */

import {
  collection, doc as fbDoc, getDoc, getDocs, setDoc, deleteDoc, query,
} from 'firebase/firestore';
import { db as firestore } from '../firebase/config.ts';
import { currentUser } from '../firebase/auth.ts';
import { SCHEMA_VERSION, TripSchema, type Trip, type TravelStyle } from './schema.ts';

export const DEFAULT_TRIP_ID = 'europe-2025'; // kept for migrate-retag reference only

export type StoredTrip = Trip;

let _currentTripId = DEFAULT_TRIP_ID;
let _baseCurrency = 'EUR';
let _currentTrip: Trip | null = null;

export function currentTripId(): string {
  return _currentTripId;
}

/** The full doc for the active trip, if we've loaded it (name, dates, status…). */
export function currentTrip(): Trip | null {
  return _currentTrip;
}

/* ── Trip-change bus ─────────────────────────────────────────────────────── */
// Views and the shell subscribe here; switchTrip() fires it so they can tear
// down stale store subscriptions and re-subscribe under the new tripId.
type TripChangeListener = (tripId: string) => void;
const _tripListeners = new Set<TripChangeListener>();

export function onTripChange(cb: TripChangeListener): () => void {
  _tripListeners.add(cb);
  return () => _tripListeners.delete(cb);
}

function emitTripChange() {
  for (const cb of _tripListeners) {
    try { cb(_currentTripId); } catch (e) { console.warn('onTripChange listener failed:', e); }
  }
}

/** Set the active trip without broadcasting (boot/seed path). */
export function setCurrentTripId(id: string) {
  _currentTripId = id;
}

/**
 * Switch the active trip: update local state, cache its metadata + base
 * currency, persist the choice to the user profile, and broadcast so views
 * re-subscribe. No page reload.
 */
export async function switchTrip(id: string): Promise<void> {
  if (id === _currentTripId && _currentTrip) return;
  _currentTripId = id;
  const trip = await getTrip(id);
  if (trip) {
    _currentTrip = trip;
    _baseCurrency = trip.baseCurrency ?? _baseCurrency;
  }
  await persistDefaultTripId(id);
  emitTripChange();
}

/** The trip's base/settlement currency (what totals are shown in). */
export function baseCurrency(): string {
  return _baseCurrency;
}

/** Persist a new base currency on the current trip. Existing expenses keep
 *  their snapshotted rate/baseAmount, so historical books don't re-value. */
export async function setBaseCurrency(code: string): Promise<void> {
  _baseCurrency = code;
  const u = currentUser();
  if (!u) return;
  const ref = tripRef(u.uid, _currentTripId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const existing = snap.data() as Trip;
  const updated = TripSchema.parse({
    ...existing,
    baseCurrency: code,
    updatedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  });
  await setDoc(ref, stripUndefined(updated));
}

function tripRef(uid: string, tripId: string) {
  return fbDoc(firestore, `users/${uid}/trips/${tripId}`);
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

function tripsCol(uid: string) {
  return collection(firestore, `users/${uid}/trips`);
}

/* ── Trip CRUD ───────────────────────────────────────────────────────────── */

/** All trips for the signed-in user, newest start date first. */
export async function listTrips(): Promise<Trip[]> {
  const u = currentUser();
  if (!u) return [];
  const snap = await getDocs(query(tripsCol(u.uid)));
  return snap.docs
    .map((d) => d.data() as Trip)
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
}

export async function getTrip(id: string): Promise<Trip | null> {
  const u = currentUser();
  if (!u) return null;
  const snap = await getDoc(tripRef(u.uid, id));
  return snap.exists() ? (snap.data() as Trip) : null;
}

/** Slugify a trip name into a stable, collision-resistant doc id. */
function slugId(name: string): string {
  const base = name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'trip';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface NewTripInput {
  name: string;
  startDate: string;
  endDate: string;
  baseCurrency?: string;
  coverColor?: string;
  travelStyle?: TravelStyle;
  destinations?: string[];
  notes?: string;
  homeCity?: string;
  returnCity?: string;
}

/** Create a blank trip (metadata only — no seeded checklist/route). Returns id. */
export async function createTrip(input: NewTripInput): Promise<string> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  const id = slugId(input.name);
  const now = Date.now();
  const trip = TripSchema.parse({
    id,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    baseCurrency: input.baseCurrency ?? 'EUR',
    coverColor: input.coverColor ?? '#f9b830',
    status: 'planning',
    travelStyle: input.travelStyle,
    destinations: input.destinations,
    notes: input.notes,
    homeCity: input.homeCity,
    returnCity: input.returnCity,
    userCreated: true,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  });
  await setDoc(tripRef(u.uid, id), stripUndefined(trip));
  return id;
}

/** Shallow-patch a trip document (name, dates, coverColor, etc.). */
export async function updateTrip(id: string, patch: Partial<Omit<Trip, 'id' | 'createdAt' | 'schemaVersion'>>): Promise<void> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  const ref = tripRef(u.uid, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Trip not found.');
  const existing = snap.data() as Trip;
  const updated = TripSchema.parse({ ...existing, ...patch, id, updatedAt: Date.now(), schemaVersion: SCHEMA_VERSION });
  await setDoc(ref, stripUndefined(updated));
  if (id === _currentTripId) {
    _currentTrip = updated;
    if (patch.baseCurrency) _baseCurrency = patch.baseCurrency;
  }
}

/** Delete a trip document. Sub-collection data is left in place (cheap, and a
 *  safety net); a future cleanup pass can prune orphaned docs. */
export async function removeTrip(id: string): Promise<void> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  await deleteDoc(tripRef(u.uid, id));
}

/** Persist the active trip choice onto the user profile so refreshes restore it. */
async function persistDefaultTripId(id: string): Promise<void> {
  const u = currentUser();
  if (!u) return;
  const ref = fbDoc(firestore, `users/${u.uid}`);
  try {
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};
    await setDoc(ref, { ...existing, defaultTripId: id, updatedAt: Date.now() }, { merge: true });
  } catch (e) {
    console.warn('Could not persist defaultTripId:', e);
  }
}

/** Read the persisted default trip id from the profile, if any. */
export async function readDefaultTripId(): Promise<string | null> {
  const u = currentUser();
  if (!u) return null;
  try {
    const snap = await getDoc(fbDoc(firestore, `users/${u.uid}`));
    const id = snap.exists() ? (snap.data() as { defaultTripId?: string | null }).defaultTripId : null;
    return id ?? null;
  } catch { return null; }
}

/**
 * On boot, check whether the user already has trips. If the legacy default
 * trip (europe-2025) exists, migrate its name/dates to the canonical values
 * and return it. If no trips exist at all, return null — the caller must
 * show the onboarding dialog so the user creates their first trip.
 */
export async function ensureDefaultTrip(): Promise<Trip | null> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');

  // --- Check all trips first; if any are user-created, use the most recent ---
  const allTrips = await listTrips();
  const userTrips = allTrips.filter(t => t.userCreated === true);
  if (userTrips.length > 0) {
    const first = userTrips[0];
    _currentTripId = first.id;
    _currentTrip = first;
    _baseCurrency = first.baseCurrency ?? _baseCurrency;
    return first;
  }

  // --- No user-created trips → trigger onboarding regardless of legacy data ---
  return null;
}

/**
 * Restore the previously-selected trip from the profile, falling back to the
 * default. Sets the active trip + caches its metadata. Call once after
 * ensureDefaultTrip() on boot. Does not broadcast (nothing is mounted yet).
 */
export async function restoreActiveTrip(): Promise<void> {
  const saved = await readDefaultTripId();
  if (saved && saved !== _currentTripId) {
    const trip = await getTrip(saved);
    if (trip) {
      _currentTripId = saved;
      _currentTrip = trip;
      _baseCurrency = trip.baseCurrency ?? _baseCurrency;
    }
  }
}

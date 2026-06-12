/* ==========================================================================
   On the Road · Trip context
   --------------------------------------------------------------------------
   Resolves "the current trip". Trips are top-level documents (trips/{tripId})
   shared via a members map, so the same resolver serves both the owner and any
   collaborators. Every store takes a tripId, so nothing downstream changes when
   the active trip switches.
   ========================================================================== */

import {
  collection, doc as fbDoc, getDoc, getDocs, setDoc, deleteDoc, query, where,
} from 'firebase/firestore';
import { db as firestore } from '../firebase/config.ts';
import { currentUser } from '../firebase/auth.ts';
import { setMyTripIdsResolver } from '../firebase/db.ts';
import { SCHEMA_VERSION, TripSchema, type Trip, type TravelStyle, type TripRole } from './schema.ts';

export const DEFAULT_TRIP_ID = 'europe-2025'; // kept for migrate-retag reference only

export type StoredTrip = Trip;

let _currentTripId = DEFAULT_TRIP_ID;
let _baseCurrency = 'EUR';
let _currentTrip: Trip | null = null;

// Snapshot of the trip ids the user belongs to, refreshed by listTrips().
// Powers the cross-trip aggregation fan-out in db.ts (map/journal "all" view).
let _myTripIds: string[] = [];
setMyTripIdsResolver(() => _myTripIds);

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

/** The trip's total budget in baseCurrency, or null if not set. */
export function tripBudget(): number | null {
  return _currentTrip?.totalBudget ?? null;
}

/** Persist a new total budget on the current trip (null = remove). */
export async function setTripBudget(amount: number | null): Promise<void> {
  if (!_currentTripId) return;
  const patch: Partial<Trip> = amount != null && amount > 0
    ? { totalBudget: amount }
    : { totalBudget: undefined };
  await updateTrip(_currentTripId, patch);
  if (_currentTrip) _currentTrip = { ..._currentTrip, ...patch };
}

/** Per-category budget caps for the current trip (id → amount), or {} if none. */
export function categoryBudgets(): Record<string, number> {
  return _currentTrip?.categoryBudgets ?? {};
}

/** Set/clear one category's budget cap (amount <= 0 or null removes it). */
export async function setCategoryBudget(categoryId: string, amount: number | null): Promise<void> {
  if (!_currentTripId) return;
  const next = { ...(_currentTrip?.categoryBudgets ?? {}) };
  if (amount != null && amount > 0) next[categoryId] = amount;
  else delete next[categoryId];
  const patch: Partial<Trip> = {
    categoryBudgets: Object.keys(next).length ? next : undefined,
  };
  await updateTrip(_currentTripId, patch);
  if (_currentTrip) _currentTrip = { ..._currentTrip, ...patch };
}

/** Per-country budget caps for the current trip (country → amount), or {} if none. */
export function countryBudgets(): Record<string, number> {
  return _currentTrip?.countryBudgets ?? {};
}

/** Set/clear one country's budget cap (amount <= 0 or null removes it). */
export async function setCountryBudget(country: string, amount: number | null): Promise<void> {
  if (!_currentTripId) return;
  const next = { ...(_currentTrip?.countryBudgets ?? {}) };
  if (amount != null && amount > 0) next[country] = amount;
  else delete next[country];
  const patch: Partial<Trip> = {
    countryBudgets: Object.keys(next).length ? next : undefined,
  };
  await updateTrip(_currentTripId, patch);
  if (_currentTrip) _currentTrip = { ..._currentTrip, ...patch };
}

/** Persist a new base currency on the current trip. Existing expenses keep
 *  their snapshotted rate/baseAmount, so historical books don't re-value. */
export async function setBaseCurrency(code: string): Promise<void> {
  _baseCurrency = code;
  const u = currentUser();
  if (!u) return;
  const ref = tripRef(_currentTripId);
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

function tripRef(tripId: string) {
  return fbDoc(firestore, `trips/${tripId}`);
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

function tripsCol() {
  return collection(firestore, 'trips');
}

/* ── Trip CRUD ───────────────────────────────────────────────────────────── */

/** All trips the signed-in user is a member of, newest start date first. */
export async function listTrips(): Promise<Trip[]> {
  const u = currentUser();
  if (!u) return [];
  const snap = await getDocs(query(tripsCol(), where('memberUids', 'array-contains', u.uid)));
  const trips = snap.docs
    .map((d) => d.data() as Trip)
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
  _myTripIds = trips.map((t) => t.id);
  return trips;
}

export async function getTrip(id: string): Promise<Trip | null> {
  const u = currentUser();
  // Allow unauthenticated reads for trips with public view enabled (viewer
  // links). Dual-read during the publicView migration: accept either the new
  // publicView.enabled or the legacy hasPublicView flag.
  if (!u && id !== DEFAULT_TRIP_ID) {
    try {
      const snap = await getDoc(tripRef(id));
      if (snap.exists()) {
        const data = snap.data() as Trip;
        if (data.publicView?.enabled || data.hasPublicView) return data;
      }
    } catch { /* rules denied — not a public trip */ }
    return null;
  }
  if (!u) return null;
  const snap = await getDoc(tripRef(id));
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
    // Collaboration: creator is the sole owner; memberUids mirrors members'
    // keys for the array-contains membership query and security rules.
    ownerUid: u.uid,
    members: { [u.uid]: 'owner' as TripRole },
    memberUids: [u.uid],
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  });
  await setDoc(tripRef(id), stripUndefined(trip));
  _myTripIds = [...new Set([..._myTripIds, id])];
  return id;
}

/** Shallow-patch a trip document (name, dates, coverColor, etc.). */
export async function updateTrip(id: string, patch: Partial<Omit<Trip, 'id' | 'createdAt' | 'schemaVersion'>>): Promise<void> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  const ref = tripRef(id);
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
  await deleteDoc(tripRef(id));
  _myTripIds = _myTripIds.filter((t) => t !== id);
}

/* ── Collaboration ───────────────────────────────────────────────────────── */

/** The signed-in user's role on the current trip, or null if not a member. */
export function currentRole(): TripRole | null {
  const u = currentUser();
  if (!u || !_currentTrip) return null;
  return _currentTrip.members?.[u.uid] ?? null;
}

/** Members of a trip as [uid, role] pairs. */
export async function tripMembers(id: string): Promise<Array<{ uid: string; role: TripRole }>> {
  const trip = await getTrip(id);
  if (!trip?.members) return [];
  return Object.entries(trip.members).map(([uid, role]) => ({ uid, role }));
}

/** Remove a member from a trip (owner only). Owner cannot be removed. */
export async function removeMember(tripId: string, uid: string): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip?.members) return;
  if (trip.members[uid] === 'owner') throw new Error('Cannot remove the owner.');
  const members = { ...trip.members };
  delete members[uid];
  const memberUids = [...new Set(Object.keys(members))];
  await updateTrip(tripId, { members, memberUids });
}

/**
 * Leave a trip you collaborate on (self-removal). The owner can't leave their
 * own trip — they delete it instead. Rules permit a member to remove only
 * themselves. Clears local active-trip state if it was the one left.
 */
export async function leaveTrip(tripId: string): Promise<void> {
  const u = currentUser();
  if (!u) throw new Error('Not signed in.');
  const trip = await getTrip(tripId);
  if (!trip?.members) return;
  if (trip.members[u.uid] === 'owner') throw new Error('Owners cannot leave their own trip.');

  const members = { ...trip.members };
  delete members[u.uid];
  const memberUids = Object.keys(members);
  await updateTrip(tripId, { members, memberUids });

  _myTripIds = _myTripIds.filter((t) => t !== tripId);
  if (tripId === _currentTripId) {
    _currentTrip = null;
    _currentTripId = DEFAULT_TRIP_ID;
  }
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

/**
 * Check all of the signed-in user's trips for email-based editor invites that
 * match their email address, and auto-accept them. Call once after boot.
 * Returns the number of trips joined via email invite.
 */
export async function checkAndAcceptEmailInvites(): Promise<number> {
  const u = currentUser();
  if (!u?.email) return 0;
  const { acceptEmailInvite } = await import('./trip-invites.ts');
  const trips = await listTrips();
  let joined = 0;
  // Also check any pending-join trip id stored in sessionStorage by the share flow.
  const pendingTripId = sessionStorage.getItem('otr_pending_email_trip');
  const tripIds = new Set([...trips.map((t) => t.id), ...(pendingTripId ? [pendingTripId] : [])]);
  for (const id of tripIds) {
    try {
      const accepted = await acceptEmailInvite(id);
      if (accepted) joined++;
    } catch { /* trip not readable or no invite */ }
  }
  if (pendingTripId) sessionStorage.removeItem('otr_pending_email_trip');
  return joined;
}

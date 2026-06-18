/* ==========================================================================
   On the Road · Trip-quota store
   --------------------------------------------------------------------------
   Tracks how many owned-trip slots the user has (tripQuota, written by the
   billing webhook) vs how many they've used. Drives the "+ New trip" gate and
   the paywall.

   - tripQuota comes live from users/{uid} via onSnapshot, so a purchase unlocks
     a new slot the instant the webhook writes (no refresh).
   - usedSlots = trips where the user is owner. Shared-in trips don't count
     (you're a collaborator, not the owner), matching the "quota = trips you
     create" model. Refreshed from listTrips() on demand and on trip changes.
   ========================================================================== */

import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config.ts';
import { onAuth, currentUser } from '../firebase/auth.ts';
import { FREE_QUOTA, LIFETIME_QUOTA, PER_TRIP_AI_CREDITS } from './schema.ts';
import { listTrips, onTripChange } from './trip-context.ts';

interface QuotaState {
  tripQuota: number;   // total owned-trip slots the user is entitled to
  usedSlots: number;   // trips the user currently owns
  aiCreditsPool: number; // account-wide booster pool (server-written)
  freeAiUsed: boolean;   // whether the one free AI trial has been used
  plan: 'free' | 'trip_pass' | 'lifetime';
  ready: boolean;
}

const state: QuotaState = { tripQuota: FREE_QUOTA, usedSlots: 0, aiCreditsPool: 0, freeAiUsed: false, plan: 'free', ready: false };

type Listener = () => void;
const listeners = new Set<Listener>();
function emit() { listeners.forEach((fn) => fn()); }

let _unsubSnapshot: (() => void) | null = null;

/** Recount owned trips from the trip list. Owner role only. */
async function refreshUsedSlots(): Promise<void> {
  const u = currentUser();
  if (!u) { state.usedSlots = 0; emit(); return; }
  try {
    const trips = await listTrips();
    state.usedSlots = trips.filter((t) => {
      // Legacy trips with no members map are treated as owned by the reader.
      const members = (t as { members?: Record<string, string> }).members;
      return !members || members[u.uid] === 'owner';
    }).length;
    emit();
  } catch (e) {
    console.warn('[quota-store] refreshUsedSlots failed:', e);
  }
}

function subscribeForUser(uid: string) {
  const ref = doc(db, `users/${uid}`);
  _unsubSnapshot = onSnapshot(
    ref,
    (snap) => {
      const data = snap.data() as { tripQuota?: number; aiCreditsPool?: number; freeAiUsed?: boolean; plan?: string } | undefined;
      state.tripQuota = typeof data?.tripQuota === 'number' ? data.tripQuota : FREE_QUOTA;
      state.aiCreditsPool = typeof data?.aiCreditsPool === 'number' ? data.aiCreditsPool : 0;
      state.freeAiUsed = data?.freeAiUsed === true;
      state.plan = (data?.plan === 'trip_pass' || data?.plan === 'lifetime') ? data.plan : 'free';
      state.ready = true;
      emit();
    },
    (err) => console.warn('[quota-store] snapshot error:', err),
  );
  void refreshUsedSlots();
}

function reset() {
  _unsubSnapshot?.();
  _unsubSnapshot = null;
  state.tripQuota = FREE_QUOTA;
  state.usedSlots = 0;
  state.aiCreditsPool = 0;
  state.freeAiUsed = false;
  state.plan = 'free';
  state.ready = false;
  emit();
}

onAuth(({ user }) => {
  if (!user) { reset(); return; }
  _unsubSnapshot?.();
  _unsubSnapshot = null;
  subscribeForUser(user.uid);
});

// A trip created/deleted/left changes the used-slot count.
onTripChange(() => { void refreshUsedSlots(); });

export const quotaStore = {
  get tripQuota(): number { return state.tripQuota; },
  get usedSlots(): number { return state.usedSlots; },
  get aiCreditsPool(): number { return state.aiCreditsPool; },
  get freeAiUsed(): boolean { return state.freeAiUsed; },
  get plan(): 'free' | 'trip_pass' | 'lifetime' { return state.plan; },
  get ready(): boolean { return state.ready; },

  /** Slots left to create new owned trips (never negative). */
  get remaining(): number { return Math.max(0, state.tripQuota - state.usedSlots); },

  /** Whether the user may create another owned trip right now. */
  canCreateTrip(): boolean { return this.remaining > 0; },

  /**
   * Estimated AI credits remaining for this trip.
   * Returns null when the user is lifetime (unlimited).
   * For paid trips: per-trip bundle (server-tracked) + pool + free trial.
   * We approximate the trip bundle as PER_TRIP_AI_CREDITS since we don't
   * read trips/{id}/usage/ai on the client — the server is authoritative.
   */
  estimatedAiCredits(): number | null {
    if (state.tripQuota >= LIFETIME_QUOTA) return null; // unlimited
    if (state.plan === 'free') return state.freeAiUsed ? 0 : 1;
    // paid: bundle + pool (trip usage not tracked client-side, show pool + 1 bundle approx)
    return PER_TRIP_AI_CREDITS + state.aiCreditsPool;
  },

  /** Force a recount of owned trips (e.g. right after createTrip succeeds). */
  refresh(): Promise<void> { return refreshUsedSlots(); },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

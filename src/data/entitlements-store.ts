/* ==========================================================================
   On the Road · Entitlements store
   --------------------------------------------------------------------------
   DORMANT at launch. AI features aren't shipping yet, so nothing imports this
   store and its onAuth subscription never wires. It's kept (not deleted) for
   when ai.* entitlements light up — at which point AI button handlers will gate
   on entitlementsStore.has('ai.guide') etc. The trip-creation paywall uses
   quota-store.ts instead; see PLAN_ENTITLEMENTS / tripQuota in schema.ts.

   Note: the tripPassExpiresAt branch below is the legacy AI-era expiry model and
   is unused by the current trip-quota system; revisit before re-enabling.

   Usage (future):
     import { entitlementsStore } from '../data/entitlements-store.ts';
     if (entitlementsStore.has('ai.guide')) { ... }
     const unsub = entitlementsStore.subscribe(() => rerender());
   ========================================================================== */

import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config.ts';
import { onAuth } from '../firebase/auth.ts';
import { PLAN_ENTITLEMENTS, type Entitlement, type Plan } from './schema.ts';

interface EntitlementsState {
  plan: Plan;
  entitlements: Entitlement[];
  ready: boolean;
}

const state: EntitlementsState = {
  plan: 'free',
  entitlements: [],
  ready: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((fn) => fn());
}

let _unsubSnapshot: (() => void) | null = null;

function subscribeForUser(uid: string) {
  const ref = doc(db, `users/${uid}`);
  _unsubSnapshot = onSnapshot(
    ref,
    async (snap) => {
      const data = snap.data() as Record<string, unknown> | undefined;

      let plan: Plan = 'free';
      if (data?.plan === 'trip_pass' || data?.plan === 'lifetime') {
        // trip_pass: check expiry
        if (data.plan === 'trip_pass' && data.tripPassExpiresAt != null) {
          plan = (data.tripPassExpiresAt as number) > Date.now() ? 'trip_pass' : 'free';
        } else {
          plan = data.plan as Plan;
        }
      }

      const entitlements = PLAN_ENTITLEMENTS[plan];

      // Backfill plan + entitlements on first sign-in or missing fields.
      // ⚠️ plan/entitlements are now SERVER-ONLY (firestore.rules blocks client
      // writes to them — see billingFieldsUnchanged). This client write will be
      // REJECTED. Before re-enabling this store, move any seeding server-side
      // (the guard/billing already default absent docs to 'free', so seeding is
      // usually unnecessary). Left intact only because the store is dormant.
      if (!data?.plan || !data?.entitlements) {
        await setDoc(ref, { plan, entitlements }, { merge: true });
      }

      state.plan = plan;
      state.entitlements = entitlements;
      state.ready = true;
      emit();
    },
    (err) => {
      console.warn('[entitlements-store] snapshot error:', err);
    },
  );
}

function reset() {
  _unsubSnapshot?.();
  _unsubSnapshot = null;
  state.plan = 'free';
  state.entitlements = [];
  state.ready = false;
  emit();
}

// Wire to auth lifecycle.
onAuth(({ user }) => {
  if (!user) { reset(); return; }
  // Cancel stale listener before starting fresh (e.g. account switch).
  _unsubSnapshot?.();
  _unsubSnapshot = null;
  subscribeForUser(user.uid);
});

export const entitlementsStore = {
  has(id: Entitlement): boolean {
    return state.entitlements.includes(id);
  },

  get plan(): Plan {
    return state.plan;
  },

  get ready(): boolean {
    return state.ready;
  },

  /** Subscribe to plan/entitlement changes. Returns unsubscribe. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

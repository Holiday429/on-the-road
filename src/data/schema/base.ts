/* ==========================================================================
   On the Road · Data schemas (zod)
   --------------------------------------------------------------------------
   Single source of truth for the shape of every stored document.
   Firestore layout (collaboration-ready — trips are top-level so they can be
   shared across users):

   users/{uid}                      profile + settings (private to that user)
   tripInvites/{token}              active share links

   trips/{tripId}                   a single trip (members[] grants access)
     legs/{legId}                   itinerary stops      (route)
     prepTasks/{taskId}             pre-departure tasks  (prep)
     expenses/{expenseId}           spend log            (expenses)
     cityIntel/{cityId}             AI city briefings    (cities)
     journalEntries/{entryId}       travel notes         (journal)
     journalStories/{storyId}       AI trip recaps       (journal)

   Every document carries meta (createdAt/updatedAt/schemaVersion) so we can
   migrate shapes later without guessing a document's age or version.
   ========================================================================== */

import { z } from 'zod';

export const SCHEMA_VERSION = 1;

/* ── Shared meta ─────────────────────────────────────────────────────────── */
// Timestamps are epoch ms. We avoid Firestore Timestamp objects so the same
// shape round-trips cleanly through localStorage (offline cache) and JSON.
export const MetaSchema = z.object({
  createdAt: z.number(),
  updatedAt: z.number(),
  schemaVersion: z.number().default(SCHEMA_VERSION),
});
export type Meta = z.infer<typeof MetaSchema>;

/** Wrap an entity schema with id + meta to get the stored-document shape. */
export function doc<T extends z.ZodRawShape>(shape: T) {
  return z.object({ id: z.string(), ...shape }).merge(MetaSchema);
}

/* ── Entitlements ────────────────────────────────────────────────────────── */
// Single source of truth for what each plan unlocks. Add new entitlements here
// and update PLAN_ENTITLEMENTS; the guard and UI both read from this type.
export type Entitlement =
  | 'ai.guide'      // City guide + guide-more
  | 'ai.safety'     // AI safety briefing
  | 'ai.story'      // Journal recap
  | 'ai.check'      // Checklist gap analysis
  | 'export.pdf'    // Trip PDF export (B3)
  | 'collab.unlimited'; // Unlimited collaborators (future)

export type Plan = 'free' | 'trip_pass' | 'lifetime';

// Trip-quota model (must match api/_billing.ts).
// At launch the paywall gates *trip creation*, not AI — a free account owns 1
// trip, each trip_pass adds one slot, lifetime is effectively unlimited.
export const FREE_QUOTA = 1;
export const LIFETIME_QUOTA = 9999;

// AI-credit model (must match api/_guard.ts and api/_billing.ts).
// Credits are spent server-side per AI guide generation in this order:
//   1. the trip's own bundled allowance  (PER_TRIP_AI_CREDITS, paid trips only)
//   2. the account-wide booster pool      (users/{uid}.aiCreditsPool)
//   3. the one-time free trial            (users/{uid}.freeAiUsed)
// All three counters are written ONLY by the server (guard + billing). The
// client reads them to show "X left" but can never grant itself credits.
export const PER_TRIP_AI_CREDITS = 10;   // bundled with each trip_pass / lifetime trip
export const AI_TOPUP_CREDITS = 10;      // credits one booster ("AI 加油包") adds to the pool
export const FREE_TRIAL_AI_CREDITS = 1;  // one free AI guide per account, ever

// Entitlements are kept in the data model for when AI ships, but no plan grants
// the ai.* set at launch (those endpoints aren't surfaced in any UI). lifetime
// pre-grants the future paid features so lifetime buyers are covered when they
// light up; trip_pass grants slots only.
const FREE_ENTITLEMENTS: Entitlement[] = [];

const TRIP_PASS_ENTITLEMENTS: Entitlement[] = [];

const LIFETIME_ENTITLEMENTS: Entitlement[] = [
  'ai.guide', 'ai.safety', 'ai.story', 'ai.check',
  'export.pdf',
  'collab.unlimited',
];

export const PLAN_ENTITLEMENTS: Record<Plan, Entitlement[]> = {
  free:       FREE_ENTITLEMENTS,
  trip_pass:  TRIP_PASS_ENTITLEMENTS,
  lifetime:   LIFETIME_ENTITLEMENTS,
};

/** Owned-trip slots a plan grants on its own (before stacked trip_pass buys). */
export const PLAN_BASE_QUOTA: Record<Plan, number> = {
  free:      FREE_QUOTA,
  trip_pass: FREE_QUOTA + 1, // floor; real quota is stored per-user and stacks
  lifetime:  LIFETIME_QUOTA,
};

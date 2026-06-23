import { z } from 'zod';
import { doc, FREE_QUOTA } from './base.ts';

/* ── User & Trip ─────────────────────────────────────────────────────────── */
export const UserProfileSchema = doc({
  displayName: z.string().default(''),
  email: z.string().default(''),
  photoURL: z.string().default(''),
  plan: z.enum(['free', 'trip_pass', 'lifetime']).default('free'),
  entitlements: z.array(z.string()).default([]),
  // Owned-trip slots. free = 1; each trip_pass purchase adds 1; lifetime = many.
  // Written server-side by api/_billing.grantQuota; the client only reads it.
  tripQuota: z.number().default(FREE_QUOTA),
  tripPassExpiresAt: z.number().nullable().optional(), // legacy AI-era field; unused by quota model
  defaultTripId: z.string().nullable().default(null),
  // ── AI credits (all server-written; client read-only) ───────────────────
  // Account-wide booster pool, spent after a trip's own allowance runs out.
  // Each "AI 加油包" purchase adds AI_TOPUP_CREDITS via grantQuota.
  aiCreditsPool: z.number().default(0),
  // Whether this account has used its one free trial AI generation. Flipped by
  // the guard on the first non-cached AI call a free user makes.
  freeAiUsed: z.boolean().default(false),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const TRAVEL_STYLES = ['solo', 'couple', 'family', 'friends', 'group'] as const;
export type TravelStyle = typeof TRAVEL_STYLES[number];

export const TripSchema = doc({
  name: z.string(),
  startDate: z.string(),          // ISO date 'YYYY-MM-DD'
  endDate: z.string(),
  coverColor: z.string().default('#f9b830'),
  status: z.enum(['planning', 'active', 'past']).default('planning'),
  baseCurrency: z.string().default('EUR'),
  // Extended profile fields (optional for backwards-compat)
  travelStyle: z.enum(TRAVEL_STYLES).optional(),
  destinations: z.array(z.string()).optional(), // e.g. ['France', 'Italy', 'Spain']
  notes: z.string().optional(),                 // free-text trip notes/motivation
  userCreated: z.boolean().optional(),          // false/absent = legacy hardcoded seed
  // Home/return anchors for the /map flight arcs. homeCity = where the traveller
  // departs from (outbound origin). returnCity = where they fly back to at the
  // end (may differ from home — e.g. out of Paris, back into Berlin). Both
  // optional; absent = no derived home flight. Outbound still falls back to the
  // first leg's arrivalTransport.from when homeCity is blank.
  homeCity: z.string().optional(),
  returnCity: z.string().optional(),
  totalBudget: z.number().optional(), // overall trip budget in baseCurrency
  // Per-category budget caps in baseCurrency, keyed by category id (e.g.
  // 'food', 'accommodation', or a custom category id). Absent keys = no cap.
  categoryBudgets: z.record(z.string(), z.number()).optional(),
  // Per-country budget caps in baseCurrency, keyed by country name (as stored
  // on legs/expenses, e.g. 'Germany'). Absent keys = no cap.
  countryBudgets: z.record(z.string(), z.number()).optional(),

  /* ── Collaboration ──────────────────────────────────────────────────────
     A trip lives at the top level (trips/{tripId}) so multiple users can
     share it. `ownerUid` is the creator; `members` maps each member's uid to
     their role. `memberUids` is a denormalised array of the same keys so
     Firestore security rules and "trips I belong to" queries can use a single
     array-contains filter (rules can't iterate a map's keys cheaply).
     Absent on legacy single-user trips — the migration backfills them. */
  ownerUid: z.string().optional(),
  members: z.record(z.string(), z.enum(['owner', 'editor', 'viewer'])).optional(),
  memberUids: z.array(z.string()).optional(),
  // Per-member page restriction (ViewIds), for the CLIENT nav filter. An entry
  // limits that member to only those pages; absent = full access. Owners are
  // never restricted. Mirrors the page-level model used by view links.
  memberPages: z.record(z.string(), z.array(z.string())).optional(),
  // Per-member allowed sub-collection names, derived from memberPages, for the
  // RULES write gate (rules can't map pages→collections). Kept in lockstep with
  // memberPages. Absent = full write access.
  memberCollections: z.record(z.string(), z.array(z.string())).optional(),
  // Transient: set only on a self-join write so security rules can verify the
  // invite token grants the role being claimed. Persisted but inert afterwards.
  joinToken: z.string().optional(),
  // Email-based editor invites: { "email@example.com": "editor" }.
  // On sign-in, if the user's email matches a key here they are auto-joined
  // as an editor and the key is removed.
  emailInvites: z.record(z.string(), z.literal('editor')).optional(),
  // Per-email page restriction for pending email invites, copied into
  // memberPages on accept. Absent / empty = full access. Keyed by email.
  emailInvitePages: z.record(z.string(), z.array(z.string())).optional(),
  // Page-level public read. `collections` is the union of Firestore
  // sub-collection names exposed by every live viewer invite's pages,
  // recomputed on each viewer-invite create/revoke. Security rules allow
  // unauthenticated reads of the trip doc (when enabled) and of any
  // sub-collection whose name is in `collections`.
  publicView: z.object({
    enabled: z.boolean().default(false),
    collections: z.array(z.string()).default([]),
  }).optional(),
  // DEPRECATED — coarse all-or-nothing public read. Kept readable so the
  // publicView migration can detect and convert legacy trips. Never written
  // going forward (see migrate-publicview.ts).
  hasPublicView: z.boolean().optional(),
});
export type Trip = z.infer<typeof TripSchema>;
export type TripRole = 'owner' | 'editor' | 'viewer';

/* ── Trip invites ───────────────────────────────────────────────────────────
   One doc per active invite link, at tripInvites/{token}. The token is the
   doc id (also the URL code). Anyone signed in can read an invite by its
   token (to learn which trip + role it grants) and, on accept, add themselves
   to the trip's members — enforced by rules. */
export const TripInviteSchema = doc({
  tripId: z.string(),
  tripName: z.string().default(''),       // shown on the join screen before accepting
  role: z.enum(['editor', 'viewer']).default('editor'),
  createdByUid: z.string(),
  expiresAt: z.number().nullable().default(null), // epoch ms; null = no expiry
  revoked: z.boolean().default(false),
  // Viewer invites only: the page ids (ViewId) this link exposes. The client
  // filters the nav to these pages; the trip's publicView.collections is the
  // union of all live viewer invites' page-derived collections. Empty for
  // editor invites; empty on a legacy viewer invite means "all pages".
  pages: z.array(z.string()).default([]),
});
export type TripInvite = z.infer<typeof TripInviteSchema>;

/* ── Trip access requests ────────────────────────────────────────────────────
   One doc per pending edit-access request, at tripAccessRequests/{id}. A
   signed-in non-member who opens an editor link submits a request; the trip
   owner approves it in-app, which adds them to the trip's members. The
   requester sees nothing about the trip until approved. */
export const TripAccessRequestSchema = doc({
  tripId: z.string(),
  tripName: z.string().default(''),
  requesterUid: z.string(),
  requesterEmail: z.string().default(''),
  requesterName: z.string().default(''),
  status: z.enum(['pending', 'approved', 'denied']).default('pending'),
  // Page restriction requested via the editor link (from the invite's pages).
  // Copied into the trip's memberPages on approval. Empty = full access.
  pages: z.array(z.string()).default([]),
});
export type TripAccessRequest = z.infer<typeof TripAccessRequestSchema>;

/* ── AI usage (per-trip, server-written) ─────────────────────────────────────
   One doc per trip at trips/{tripId}/usage/ai. The guard increments `count`
   each time a chargeable (non-cached) AI generation runs against this trip, and
   compares it to the plan-derived allowance (PER_TRIP_AI_CREDITS for paid
   trips). Written ONLY by the server (api/_guard.ts via Firestore REST). The
   client may read it to display remaining credits but never writes it. */
export const TripAiUsageSchema = doc({
  count: z.number().default(0),   // chargeable AI generations run on this trip
});
export type TripAiUsage = z.infer<typeof TripAiUsageSchema>;

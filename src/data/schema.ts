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

/* ── Prep (legacy — kept for migration) ──────────────────────────────────── */
export const PrepTaskSchema = doc({
  text: z.string(),
  note: z.string().optional(),
  done: z.boolean().default(false),
  category: z.string(),
  phase: z.enum(['60d', '30d', '14d', '7d', '1d']),
  order: z.number().default(0),
});
export type PrepTask = z.infer<typeof PrepTaskSchema>;

/* ── Checklist (new) ─────────────────────────────────────────────────────── */

export const ChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  note: z.string().optional(),
  done: z.boolean().default(false),
  order: z.number().default(0),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ChecklistGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().default('📋'),
  order: z.number().default(0),
  items: z.array(ChecklistItemSchema).default([]),
});
export type ChecklistGroup = z.infer<typeof ChecklistGroupSchema>;

// Tags for quick filtering when selecting templates
export const ChecklistTagSchema = z.object({
  type: z.enum(['season', 'duration', 'region', 'custom']),
  value: z.string(),
});
export type ChecklistTag = z.infer<typeof ChecklistTagSchema>;

export const ChecklistTemplateSchema = doc({
  name: z.string(),
  description: z.string().default(''),
  tags: z.array(ChecklistTagSchema).default([]),
  groups: z.array(ChecklistGroupSchema).default([]),
});
export type ChecklistTemplate = z.infer<typeof ChecklistTemplateSchema>;

// A live checklist instance, either from a template or created from scratch
export const ChecklistSchema = doc({
  name: z.string(),
  templateId: z.string().nullable().default(null),
  tags: z.array(ChecklistTagSchema).default([]),
  groups: z.array(ChecklistGroupSchema).default([]),
  completedAt: z.number().nullable().default(null),
});
export type Checklist = z.infer<typeof ChecklistSchema>;

/* ── Pack (simple weight-aware packing list) ─────────────────────────────────
   Mental model: a pack list holds physical containers (a backpack, a suitcase),
   each with its own weight limit. Items live inside a container (or sit in the
   virtual "Unassigned" area when containerId is null — weight uncounted until
   you commit them to a bag). Core Kit is the user's reusable must-bring gear,
   maintained once on the Pack home and copied into any new list.
   ──────────────────────────────────────────────────────────────────────────── */

// A reusable piece of must-bring gear (user-scoped, cross-trip). The Core Kit on
// the Pack home is the template — new pack lists can copy these in with one click.
export const CoreKitItemSchema = doc({
  name: z.string(),
  category: z.string().default('Tech'),
  weightG: z.number().default(0),
});
export type CoreKitItem = z.infer<typeof CoreKitItemSchema>;

// A physical bag the user is taking. Each container has its own weight budget;
// selfWeightG (the empty bag) counts toward that limit. limitG of 0 = no limit.
export const PackContainerSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['suitcase', 'backpack', 'personal']).default('backpack'),
  limitG: z.number().default(0),
  selfWeightG: z.number().default(0),
});
export type PackContainer = z.infer<typeof PackContainerSchema>;

// essential = must bring · nice = good to have · optional = drop first if over.
export const PackPriority = z.enum(['essential', 'nice', 'optional']);
export type PackPriority = z.infer<typeof PackPriority>;

export const PackItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().default('Other'),
  qty: z.number().default(1),
  unitWeightG: z.number().default(0),
  containerId: z.string().nullable().default(null),  // null = Unassigned area
  priority: PackPriority.default('essential'),
  locked: z.boolean().default(false),       // core-kit items can't be renamed/reweighted
  packed: z.boolean().default(false),       // checked off during pack-check
  source: z.enum(['core', 'manual']).default('manual'),
  order: z.number().default(0),
  acquiredLegId: z.string().nullable().default(null), // leg where item was acquired; null = brought from home
  droppedLegId:  z.string().nullable().default(null), // leg where item was discarded; null = still carrying
  consumable:    z.boolean().default(false),           // qty can be decremented in-trip (toiletries, etc.)
});
export type PackItem = z.infer<typeof PackItemSchema>;

export const PackListSchema = doc({
  name: z.string(),
  containers: z.array(PackContainerSchema).default([]),
  items: z.array(PackItemSchema).default([]),
});
export type PackList = z.infer<typeof PackListSchema>;

/* ── Route / Itinerary ───────────────────────────────────────────────────── */
const TransportSchema = z.object({
  type: z.enum(['flight', 'train', 'bus', 'ferry']),
  from: z.string(),
  to: z.string(),
  // Connecting-flight / multi-segment legs (联程). Ordered list of intermediate
  // stopover cities between `from` and `to`, e.g. Harbin →[Beijing]→ Copenhagen.
  // The map animates through these as waypoints; empty/absent = direct.
  via: z.array(z.string()).optional(),
  date: z.string(),
  time: z.string().optional(),
  arrivalTime: z.string().optional(),   // arrival clock time
  duration: z.string().optional(),
  price: z.string().optional(),            // legacy free-text price; kept in sync with priceAmount
  // Structured price — drives the one-click sync to Expenses (mirrors Accommodation).
  priceAmount: z.number().optional(),      // amount, in priceCurrency
  priceCurrency: z.string().optional(),    // ISO code; defaults from the leg's country at edit time
  // Service identifier — flight number, train number, etc.
  service: z.string().optional(),
  // Departure / arrival stations or terminals (more specific than from/to city).
  depPlace: z.string().optional(),
  arrPlace: z.string().optional(),
  bookingRef: z.string().optional(),
  confirmed: z.boolean().default(false),
  notes: z.string().optional(),
  // Baggage allowance, split by piece type — allowances differ per flight, so
  // each leg carries its own. Grams (e.g. 10000 = 10 kg). Not synced to Pack:
  // a packing list spans the whole trip while these are per-flight limits.
  // `baggageAllowanceG` is the legacy single value, read as carry-on for back-compat.
  baggageAllowanceG: z.number().optional(),
  baggagePersonalG: z.number().optional(),
  baggageCarryOnG: z.number().optional(),
  baggageCheckedG: z.number().optional(),
  // Links this transport to the Expense it was synced into (see Accommodation.expenseId).
  expenseId: z.string().optional(),
});

const AccommodationSchema = z.object({
  id: z.string().optional(),            // present on multi-stay arrays
  name: z.string(),
  address: z.string().optional(),
  price: z.string().optional(),         // legacy free-text per-night price (e.g. "€40"); kept in sync with priceAmount
  // Structured per-night price — drives the one-click sync to Expenses. Absent
  // on legacy stays that only have the free-text `price`.
  priceAmount: z.number().optional(),   // per-night amount, in priceCurrency
  priceCurrency: z.string().optional(), // ISO code; defaults from the leg's country at edit time
  // Where the stay was booked (e.g. "Airbnb", "Booking.com") + the deep link to
  // that platform's order page, so the user can jump back to find the booking.
  platform: z.string().optional(),
  bookingUrl: z.string().optional(),
  confirmed: z.boolean().default(false),
  link: z.string().optional(),
  mapUrl: z.string().optional(),        // pasted Google Maps link (overrides name-based search)
  checkIn: z.string().optional(),       // ISO date
  checkOut: z.string().optional(),
  phone: z.string().optional(),
  order: z.number().optional(),
  // Links this stay to the Expense it was synced into. Set once on first sync so
  // re-syncing updates that expense rather than creating a duplicate. The stay
  // is keyed by check-in date but the expense by payment date — they diverge by
  // design, so we track the relationship explicitly rather than matching on date.
  expenseId: z.string().optional(),
});

// One "thing I want to do". Can be assigned to a plan day (dayId) or left in
// the unassigned pool. category mirrors ClipCategory for cross-filtering.
const PlanItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string().optional(),          // user's notes / remarks on this item
  tag: z.string().optional(),           // legacy free-text tag (kept for back-compat)
  category: z.string().default(''),     // matches a ClipCategory id ('food', 'museum', …)
  dayId: z.string().nullable().default(null), // null = unassigned pool
  mapUrl: z.string().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),           // cached geocode result
  lng: z.number().optional(),
  duration: z.string().optional(),      // estimated time, e.g. "2h"
  cost: z.string().optional(),          // estimated cost, e.g. "€15"
  done: z.boolean().default(false),
  order: z.number().default(0),
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

// A user-defined category for clips and plan items. Color chosen from a palette.
export const ClipCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),    // hex, e.g. '#fde8ef'
  order: z.number().default(0),
});
export type ClipCategory = z.infer<typeof ClipCategorySchema>;

// A sticky note card on the leg detail page — title + freeform body.
export const NoteCardSchema = z.object({
  id: z.string(),
  title: z.string().default(''),
  body: z.string().default(''),
  color: z.string().default('#fef9c3'), // pastel hex
  order: z.number().default(0),
});
export type NoteCard = z.infer<typeof NoteCardSchema>;

// A plan day container — dates are derived from leg.dateFrom + index.
export const PlanDaySchema = z.object({
  id: z.string(),
  date: z.string(),       // ISO date 'YYYY-MM-DD', auto-derived from leg dates
  label: z.string().default(''),  // optional user override label, e.g. "Arrival"
  notes: z.string().default(''),  // per-day notes
  order: z.number().default(0),
});
export type PlanDay = z.infer<typeof PlanDaySchema>;

// A collected piece of research — link or note — with a user-defined category.
const ClipSchema = z.object({
  id: z.string(),
  kind: z.enum(['link', 'note', 'image']).default('link'),
  title: z.string().optional(),
  url: z.string().optional(),
  body: z.string().optional(),
  category: z.string().default(''),   // ClipCategory id
  order: z.number().default(0),
});
export type Clip = z.infer<typeof ClipSchema>;

export const LegSchema = doc({
  // Which trip this leg belongs to. null = unclassified (legacy/global).
  // Set on flattened legs (users/{uid}/legs) so the map can filter per-trip
  // or aggregate across all trips. See createTaggedCollectionStore.
  tripId: z.string().nullable().default(null),
  city: z.string(),
  country: z.string(),
  flag: z.string().default(''),
  dateFrom: z.string(),
  dateTo: z.string(),
  accommodation: AccommodationSchema.optional(),       // legacy single stay — still read for back-compat
  accommodations: z.array(AccommodationSchema).optional(), // ordered, one city can have several
  arrivalTransport: TransportSchema.optional(),
  plans: z.array(PlanItemSchema).optional(),
  planDays: z.array(PlanDaySchema).optional(),         // day containers (auto-seeded from dates)
  clips: z.array(ClipSchema).optional(),
  clipCategories: z.array(ClipCategorySchema).optional(), // user-defined clip/plan categories
  notes: z.string().optional(),                        // legacy single-text notes (back-compat)
  noteCards: z.array(NoteCardSchema).optional(),       // multi-card sticky notes
  order: z.number().default(0),
  // Reserved for the /map globe — lets us plot legs without re-geocoding.
  lat: z.number().optional(),
  lng: z.number().optional(),
});
export type Leg = z.infer<typeof LegSchema>;

/* ── Stay (accommodation comparison) — legacy, kept for migration ─────────── */
export const StayDimensionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['number', 'rating', 'boolean']),
  weight: z.number().default(1),
  higherIsBetter: z.boolean().default(true),
  builtin: z.boolean().default(false),
});
export type StayDimension = z.infer<typeof StayDimensionSchema>;

export const StayCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['hotel', 'airbnb', 'hostel', 'other']).default('hotel'),
  link: z.string().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  totalPrice: z.number().optional(),
  extraFees: z.number().default(0),
  nights: z.number().default(1),
  scores: z.record(z.string(), z.number()).default({}),
  notes: z.string().optional(),
});
export type StayCandidate = z.infer<typeof StayCandidateSchema>;

export const StaySchema = doc({
  legId: z.string(),
  city: z.string().default(''),
  dimensions: z.array(StayDimensionSchema).default([]),
  candidates: z.array(StayCandidateSchema).default([]),
});
export type Stay = z.infer<typeof StaySchema>;

/* ── Compare (universal multi-criteria comparison) ───────────────────────── */
// One comparison group. compareType determines the default dimension template
// and the add-candidate form fields. Groups can be attached to a leg (legId)
// or be free-standing (legId: null).

export const COMPARE_TYPES = ['accommodation', 'flight', 'train', 'shopping', 'other'] as const;
export type CompareType = typeof COMPARE_TYPES[number];

// A scoring dimension (one row in the matrix).
// type='number': raw numeric (min-max normalised); 'rating': 1–5 stars (/5);
// 'boolean': yes/no toggle (0|1). higherIsBetter=false flips normalisation.
// builtin=true means the row cannot be deleted, only reweighted.
export const CompareDimensionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['number', 'rating', 'boolean']),
  weight: z.number().default(1),           // 0–5 priority slider; 0 = off
  higherIsBetter: z.boolean().default(true),
  builtin: z.boolean().default(false),
});
export type CompareDimension = z.infer<typeof CompareDimensionSchema>;

// A candidate option (one column in the matrix).
// `fields` holds type-specific display values (e.g. price, departure time)
// that are shown in the column header but scored through `scores` like any
// other dimension. The price dimension is special: its score is auto-derived
// from fields.price rather than manually entered.
export const CompareCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  link: z.string().optional(),
  // Flexible key-value bag for type-specific attributes (price, airline, etc.)
  // displayed in the column header. Keys are defined per CompareType.
  fields: z.record(z.string(), z.string()).default({}),
  // Per-dimension raw scores, keyed by dimension id.
  // rating: 1–5, boolean: 0|1, number: arbitrary numeric.
  scores: z.record(z.string(), z.number()).default({}),
  notes: z.string().optional(),
});
export type CompareCandidate = z.infer<typeof CompareCandidateSchema>;

export const CompareGroupSchema = doc({
  // Which trip this group belongs to.
  tripId: z.string().nullable().default(null),
  // Optional: pin to a specific leg (e.g. "flights to Rome on May 3").
  legId: z.string().nullable().default(null),
  title: z.string().default(''),           // user-editable group label
  compareType: z.enum(COMPARE_TYPES).default('accommodation'),
  dimensions: z.array(CompareDimensionSchema).default([]),
  candidates: z.array(CompareCandidateSchema).default([]),
});
export type CompareGroup = z.infer<typeof CompareGroupSchema>;

/* ── Expenses ────────────────────────────────────────────────────────────── */
// We keep the user's raw input (amount + currency) forever, and store a
// snapshot of the conversion to the trip's base currency at record time:
// `rate` is the original→base rate then, `baseAmount` the converted figure.
// Snapshotting means a June expense never silently re-values when rates drift
// or when the user changes the trip's base currency — historical books stay put.
// `category` may be '' = "unclassified" (quick-capture, sorted out later).
export const ExpenseSchema = doc({
  amount: z.number(),                       // raw amount, in `currency`
  currency: z.string(),                     // ISO code the user typed in
  rate: z.number().default(1),              // original→base rate at record time
  baseAmount: z.number(),                   // amount converted to base currency
  baseCurrency: z.string().default('EUR'),  // trip base at record time (for the snapshot)
  description: z.string(),
  category: z.string().default(''),         // '' = unclassified
  tags: z.array(z.string()).default([]),    // free-text fine labels (#ramen …)
  city: z.string().default(''),
  country: z.string().default(''),          // denormalized from the leg, for by-country analysis
  date: z.string(),                         // ISO date
});
export type Expense = z.infer<typeof ExpenseSchema>;

// User-defined spend categories. The seven built-ins live in the view code and
// are not stored; this collection only holds the user's own additions. `id` is
// what an expense's `category` field references, so it must be stable and not
// collide with a built-in id.
export const ExpenseCategorySchema = doc({
  label: z.string(),
  icon: z.string().default('🏷️'),
  color: z.string().default('#e5e7eb'),
  order: z.number().default(0),
});
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

/* ── City intel (AI cache) ───────────────────────────────────────────────── */

// A single actionable "Do" card — attraction, restaurant, café, experience, city walk.
export const GuideCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  highlight: z.string(),           // one-liner shown on card front
  detail: z.string(),              // full description shown in the detail modal
  background: z.string().default(''),  // cultural/historical context
  searchUrl: z.string().default(''),   // auto-built Google search URL, never AI-generated
  address: z.string().default(''),
  duration: z.string().default(''),    // e.g. "2–3h"
  cost: z.string().default(''),        // e.g. "€10–15"
  category: z.string().default(''),    // matches ClipCategory id in itinerary
  // Unsplash photo for landmark-ish cards (attractions/experiences). Restaurants
  // and cafés intentionally have no image — they use a colour-block + emoji.
  imageUrl: z.string().default(''),
  photographer: z.string().default(''),  // Unsplash attribution name
  photographerUrl: z.string().default(''),
  saved: z.boolean().default(false),   // user bookmark
});
export type GuideCard = z.infer<typeof GuideCardSchema>;

// City walk is a route — waypoints go in the detail field, overall is still one PlanItem.
// One ordered stop on a walk. lat/lng are filled in client-side by geocoding
// (Nominatim) so the route can be drawn on a map and exported to Google Maps.
export const WaypointSchema = z.object({
  name: z.string(),
  note: z.string().default(''),    // why stop here / what to see
  lat: z.number().optional(),      // cached geocode result
  lng: z.number().optional(),
});
export type Waypoint = z.infer<typeof WaypointSchema>;

export const CityWalkSchema = z.object({
  id: z.string(),
  title: z.string(),
  highlight: z.string(),
  detail: z.string(),              // overall prose description of the route
  waypoints: z.array(WaypointSchema).default([]),  // ordered stops
  background: z.string().default(''),
  searchUrl: z.string().default(''),
  duration: z.string().default(''),
  distance: z.string().default(''),  // e.g. "3 km"
  imageUrl: z.string().default(''),
  photographer: z.string().default(''),
  photographerUrl: z.string().default(''),
  saved: z.boolean().default(false),
});
export type CityWalk = z.infer<typeof CityWalkSchema>;

// A "Know" tip — money saving, transport, cultural background. Read-only, no itinerary link.
export const GuideTipSchema = z.object({
  id: z.string(),
  text: z.string(),
  saved: z.boolean().default(false),
});
export type GuideTip = z.infer<typeof GuideTipSchema>;

export const CityIntelSchema = doc({
  city: z.string(),
  country: z.string(),
  flag: z.string().default(''),
  bannerColor: z.string().default('#f9b830'),
  // ── Know (cultural background) ──────────────────────────────────────────
  intro: z.string().default(''),                    // 3-4 sentence city portrait
  funFacts: z.array(z.string()).default([]),         // 3-5 short punchy facts
  // Multi-dimensional overview cards: history, geography, when-to-visit, etc.
  overviewSections: z.array(z.object({
    icon: z.string().default('📌'),
    title: z.string(),
    body: z.string(),
  })).default([]),
  greetings: z.array(z.object({
    phrase: z.string(), pronunciation: z.string(), meaning: z.string(),
  })).default([]),
  customs: z.array(z.string()).default([]),
  taboos: z.array(z.string()).default([]),
  neighborhoods: z.array(z.object({ name: z.string(), vibe: z.string() })).default([]),
  safetyTips: z.array(z.string()).default([]),
  transport: z.array(z.string()).default([]),
  moneyTips: z.array(GuideTipSchema).default([]),
  // ── Do (actionable cards) ────────────────────────────────────────────────
  attractions: z.array(GuideCardSchema).default([]),
  cityWalks: z.array(CityWalkSchema).default([]),
  restaurants: z.array(GuideCardSchema).default([]),
  cafes: z.array(GuideCardSchema).default([]),
  experiences: z.array(GuideCardSchema).default([]),
  // ── Meta ─────────────────────────────────────────────────────────────────
  generatedQuery: z.string().default(''),   // the free-text query used for this generation
});
export type CityIntel = z.infer<typeof CityIntelSchema>;

/* ── Safety ──────────────────────────────────────────────────────────────── */
// Two halves, mirroring the Stay/Guide split:
//   SafetyProfile — one user-scoped doc (id: 'me'). Personal + emergency info
//     the traveller fills in once and carries across every trip. Stored under
//     users/{uid}/safetyProfile so it is NOT tied to a single trip. Everything
//     defaults to '' — the form starts empty and the user populates it.
//   CitySafety — one doc per city (id = slugged city), trip-scoped, AI-seeded
//     but hand-correctable. `source` flips to 'edited' the moment the user
//     changes a field, so a re-generate can skip cards they've curated.

export const EmergencyContactSchema = z.object({
  name: z.string().default(''),
  relation: z.string().default(''),
  dialCode: z.string().default(''),   // e.g. '+86' — stored separately for the split input
  phone: z.string().default(''),      // local number without country code
  isPrimary: z.boolean().default(false),
});
export type EmergencyContact = z.infer<typeof EmergencyContactSchema>;

export const SafetyProfileSchema = doc({
  nationality: z.string().default(''),          // ISO code → drives embassy lookup
  emergencyContacts: z.array(EmergencyContactSchema).default([]),
  bloodType: z.string().default(''),
  allergies: z.string().default(''),
  medications: z.string().default(''),
  conditions: z.string().default(''),           // chronic conditions worth flagging to medics
  insuranceProvider: z.string().default(''),
  insurancePolicy: z.string().default(''),
  insuranceHotline: z.string().default(''),     // hotline stored as single string (often intl already)
  insurancePdfUrl: z.string().default(''),      // Firebase Storage download URL
  insurancePdfName: z.string().default(''),     // original filename for display
  medicalDocUrl: z.string().default(''),        // medical card / summary doc
  medicalDocName: z.string().default(''),
  notes: z.string().default(''),
});
export type SafetyProfile = z.infer<typeof SafetyProfileSchema>;

/* ── Safety content (remote-controlled, app-global) ─────────────────────────
   Essentials checklists and any app-wide safety content editable via Firestore
   without a code redeploy. Each doc id = group slug (e.g. 'accommodation').   */

export const EssentialItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  sortOrder: z.number().default(0),
});
export type EssentialItem = z.infer<typeof EssentialItemSchema>;

export const EssentialGroupSchema = doc({
  icon: z.string().default('📋'),
  title: z.string(),
  sortOrder: z.number().default(0),
  items: z.array(EssentialItemSchema).default([]),
});
export type EssentialGroup = z.infer<typeof EssentialGroupSchema>;

// One labelled emergency number (Police / Ambulance / Fire / Women's helpline).
export const SafetyNumberSchema = z.object({
  label: z.string().default(''),
  number: z.string().default(''),
});
export type SafetyNumber = z.infer<typeof SafetyNumberSchema>;

export const SafetyHospitalSchema = z.object({
  name: z.string().default(''),
  address: z.string().default(''),
  phone: z.string().default(''),
  is24h: z.boolean().default(false),
});
export type SafetyHospital = z.infer<typeof SafetyHospitalSchema>;

export const SafetyPhraseSchema = z.object({
  en: z.string().default(''),            // "Call the police"
  local: z.string().default(''),         // local-language equivalent
  pronunciation: z.string().default(''),
});
export type SafetyPhrase = z.infer<typeof SafetyPhraseSchema>;

export const SafetyEmbassySchema = z.object({
  nationality: z.string().default(''),   // which country's embassy this is
  name: z.string().default(''),
  address: z.string().default(''),
  phone: z.string().default(''),
  website: z.string().default(''),
});
export type SafetyEmbassy = z.infer<typeof SafetyEmbassySchema>;

export const CitySafetySchema = doc({
  city: z.string(),
  country: z.string().default(''),
  flag: z.string().default(''),
  generalEmergency: z.string().default('112'),       // pan-EU default
  emergencyNumbers: z.array(SafetyNumberSchema).default([]),
  embassy: SafetyEmbassySchema.default({ nationality: '', name: '', address: '', phone: '', website: '' }),
  hospitals: z.array(SafetyHospitalSchema).default([]),
  trustedTransport: z.array(z.string()).default([]),  // ride apps + night-travel advice
  areasToAvoid: z.array(z.string()).default([]),       // zone + time-of-day
  commonScams: z.array(z.string()).default([]),
  phrases: z.array(SafetyPhraseSchema).default([]),
  womenTips: z.array(z.string()).default([]),
  source: z.enum(['ai', 'edited']).default('ai'),      // 'edited' = curated, don't overwrite
});
export type CitySafety = z.infer<typeof CitySafetySchema>;

/* ── Journal ─────────────────────────────────────────────────────────────── */
// `template` is the card preset (see src/views/journal/templates.ts) and is the
// primary discriminator going forward. It's a plain string — not an enum — so
// new templates can ship without a schema migration; the UI validates against
// the known registry and falls back gracefully for anything it doesn't know.
// `mood` is optional because only some templates surface it.
export const JournalEntrySchema = doc({
  // Which trip this entry belongs to. null = unclassified (legacy/global).
  // Flattened to users/{uid}/journalEntries so the calendar can show one trip
  // or scroll across all trips. See createTaggedCollectionStore.
  tripId: z.string().nullable().default(null),
  title: z.string().default(''),
  body: z.string(),
  template: z.string().default('moment'),
  destination: z.string().default(''),
  tags: z.array(z.string()).default([]),
  mood: z.string().optional(),
  happenedOn: z.string(), // ISO date
  favorite: z.boolean().default(false),
  // Sharing — a public entry is readable via /#/s/{slug} without auth.
  visibility: z.enum(['private', 'public']).default('private'),
  slug: z.string().default(''),
  coverImage: z.string().optional(), // data URL or remote URL
  imageRatio: z.number().optional(),  // width / height, e.g. 1.5 for 3:2
  linkedPlaces: z.array(z.string()).optional(), // Guide card ids saved for this entry
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const JournalTemplateKindSchema = z.enum(['moment', 'place', 'note', 'interesting']);
export type JournalTemplateKind = z.infer<typeof JournalTemplateKindSchema>;

export const JournalTemplateSchema = doc({
  label: z.string(),
  emoji: z.string().default('✨'),
  kind: JournalTemplateKindSchema.default('moment'),
  placeholder: z.string().default(''),
  prompts: z.array(z.string()).default([]),
  tint: z.string().default(''),
});
export type JournalTemplate = z.infer<typeof JournalTemplateSchema>;

export const JournalStoryModuleSchema = z.object({
  id: z.string(),
  type: z.string().default('module'),
  title: z.string(),
  summary: z.string(),
  entryIds: z.array(z.string()).default([]),
});
export type JournalStoryModule = z.infer<typeof JournalStoryModuleSchema>;

export const JournalStoryQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  answer: z.string().default(''),
  entryId: z.string().nullable().default(null),
});
export type JournalStoryQuestion = z.infer<typeof JournalStoryQuestionSchema>;

export const JournalStorySchema = doc({
  title: z.string(),
  subtitle: z.string().default(''),
  recapLine: z.string().default(''),
  travelerMode: z.string().default(''),
  scopeLabel: z.string().default('Whole trip'),
  entryIds: z.array(z.string()).default([]),
  modules: z.array(JournalStoryModuleSchema).default([]),
  questions: z.array(JournalStoryQuestionSchema).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  visibility: z.enum(['private', 'public']).default('private'),
  slug: z.string().default(''),
});
export type JournalStory = z.infer<typeof JournalStorySchema>;

/* ── Nomad (work-friendly spots) ─────────────────────────────────────────── */
// Flattened to users/{uid}/nomadSpots with a tripId tag so the gallery can
// show one trip or all trips, and filter by country. `visibility`/`ownerId`
// are reserved for a future community/sharing layer (not queried yet).
export const NomadRatingsSchema = z.object({
  wifi: z.number().default(0),
  power: z.number().default(0),
  restroom: z.number().default(0),
  coffee: z.number().default(0),
  service: z.number().default(0),
});
export type NomadRatings = z.infer<typeof NomadRatingsSchema>;

/* ── To-Do ───────────────────────────────────────────────────────────────── */
// User-scoped reminders / tasks. tripId null = global (cross-trip); set to
// a trip id to scope to that trip. dueDate is ISO date; remindAt is epoch ms.
export const TodoSchema = doc({
  tripId:   z.string().nullable().default(null),
  text:     z.string(),
  done:     z.boolean().default(false),
  dueDate:  z.string().nullable().default(null),   // ISO date 'YYYY-MM-DD'
  remindAt: z.number().nullable().default(null),   // epoch ms
  order:    z.number().default(0),
});
export type Todo = z.infer<typeof TodoSchema>;

/* ── Nomad (work-friendly spots) ─────────────────────────────────────────── */
// Flattened to users/{uid}/nomadSpots with a tripId tag so the gallery can
// show one trip or all trips, and filter by country. `visibility`/`ownerId`
// are reserved for a future community/sharing layer (not queried yet).
export const NomadSpotSchema = doc({
  tripId: z.string().nullable().default(null),
  name: z.string(),
  city: z.string().default(''),
  country: z.string().default(''),
  type: z.enum(['Café', 'Co-working', 'Library', 'Hotel lobby']).default('Café'),
  ratings: NomadRatingsSchema,
  comment: z.string().optional(),
  photos: z.array(z.string()).default([]),
  placeId: z.string().optional(),
  mapsUrl: z.string().optional(),
  address: z.string().optional(),
  placePhotoUrl: z.string().optional(),
  // Reserved for a future cross-user community layer — not queried yet.
  visibility: z.enum(['private', 'public']).default('private'),
  ownerId: z.string().default(''),
});
export type NomadSpot = z.infer<typeof NomadSpotSchema>;

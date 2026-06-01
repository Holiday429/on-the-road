/* ==========================================================================
   On the Road · Data schemas (zod)
   --------------------------------------------------------------------------
   Single source of truth for the shape of every stored document.
   Firestore layout (public-version ready):

   users/{uid}                      profile + settings
     trips/{tripId}                 a single trip
       legs/{legId}                 itinerary stops      (route)
       prepTasks/{taskId}           pre-departure tasks  (prep)
       expenses/{expenseId}         spend log            (expenses)
        cityIntel/{cityId}           AI city briefings    (cities)
        journalEntries/{entryId}    travel notes         (journal)

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

/* ── User & Trip ─────────────────────────────────────────────────────────── */
export const UserProfileSchema = doc({
  displayName: z.string().default(''),
  email: z.string().default(''),
  photoURL: z.string().default(''),
  // Reserved for the public version — defaults keep the single-user case free.
  plan: z.enum(['free', 'pro']).default('free'),
  defaultTripId: z.string().nullable().default(null),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const TripSchema = doc({
  name: z.string(),
  startDate: z.string(),          // ISO date 'YYYY-MM-DD'
  endDate: z.string(),
  coverColor: z.string().default('#f9b830'),
  status: z.enum(['planning', 'active', 'past']).default('planning'),
  baseCurrency: z.string().default('EUR'),
});
export type Trip = z.infer<typeof TripSchema>;

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

/* ── Route / Itinerary ───────────────────────────────────────────────────── */
const TransportSchema = z.object({
  type: z.enum(['flight', 'train', 'bus', 'ferry']),
  from: z.string(),
  to: z.string(),
  date: z.string(),
  time: z.string().optional(),
  duration: z.string().optional(),
  price: z.string().optional(),
  confirmed: z.boolean().default(false),
  notes: z.string().optional(),
});

const AccommodationSchema = z.object({
  name: z.string(),
  address: z.string().optional(),
  price: z.string().optional(),
  confirmed: z.boolean().default(false),
  link: z.string().optional(),
});

export const LegSchema = doc({
  city: z.string(),
  country: z.string(),
  flag: z.string().default(''),
  dateFrom: z.string(),
  dateTo: z.string(),
  accommodation: AccommodationSchema.optional(),
  arrivalTransport: TransportSchema.optional(),
  notes: z.string().optional(),
  order: z.number().default(0),
  // Reserved for the /map globe — lets us plot legs without re-geocoding.
  lat: z.number().optional(),
  lng: z.number().optional(),
});
export type Leg = z.infer<typeof LegSchema>;

/* ── Stay (accommodation comparison) ─────────────────────────────────────── */
// A Stay is one comparison group, attached to a Leg (one per leg). Candidates
// are the columns, dimensions the rows. We embed both arrays in the doc (like
// ChecklistSchema's groups/items) — a group is only a handful of each, so a
// single read/write per group is the simplest correct model.

// A scoring dimension (one row). `type` decides how the raw value is read and
// normalized; `higherIsBetter=false` flips it (e.g. price, "need to relocate").
export const StayDimensionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['number', 'rating', 'boolean']),
  weight: z.number().default(1),          // 0–5 priority slider
  higherIsBetter: z.boolean().default(true),
  builtin: z.boolean().default(false),    // built-ins can't be deleted, only reweighted
});
export type StayDimension = z.infer<typeof StayDimensionSchema>;

// A candidate accommodation (one column).
export const StayCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['hotel', 'airbnb', 'hostel', 'other']).default('hotel'),
  link: z.string().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  // Price is split so we can compute a comparable per-night figure and surface
  // hidden costs. The 'price' built-in dimension reads from these, not scores.
  totalPrice: z.number().optional(),      // room cost over the whole stay
  extraFees: z.number().default(0),       // cleaning / service fees etc.
  nights: z.number().default(1),
  // Per-dimension raw values, keyed by dimension id. rating: 0–5, boolean: 0|1.
  scores: z.record(z.string(), z.number()).default({}),
  notes: z.string().optional(),
});
export type StayCandidate = z.infer<typeof StayCandidateSchema>;

export const StaySchema = doc({
  legId: z.string(),
  city: z.string().default(''),           // denormalized for list display
  dimensions: z.array(StayDimensionSchema).default([]),
  candidates: z.array(StayCandidateSchema).default([]),
});
export type Stay = z.infer<typeof StaySchema>;

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
export const CityIntelSchema = doc({
  city: z.string(),
  country: z.string(),
  flag: z.string().default(''),
  bannerColor: z.string().default('#f9b830'),
  greetings: z.array(z.object({
    phrase: z.string(), pronunciation: z.string(), meaning: z.string(),
  })).default([]),
  customs: z.array(z.string()).default([]),
  taboos: z.array(z.string()).default([]),
  neighborhoods: z.array(z.object({ name: z.string(), vibe: z.string() })).default([]),
  localFood: z.array(z.string()).default([]),
  hiddenGems: z.array(z.string()).default([]),
  safetyTips: z.array(z.string()).default([]),
  transport: z.array(z.string()).default([]),
});
export type CityIntel = z.infer<typeof CityIntelSchema>;

/* ── Journal ─────────────────────────────────────────────────────────────── */
// `template` is the card preset (see src/views/journal/templates.ts) and is the
// primary discriminator going forward. It's a plain string — not an enum — so
// new templates can ship without a schema migration; the UI validates against
// the known registry and falls back gracefully for anything it doesn't know.
// `mood` is optional because only some templates surface it.
export const JournalEntrySchema = doc({
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
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

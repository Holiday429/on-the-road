import { z } from 'zod';
import { doc } from './base.ts';


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
  imageUrl: z.string().optional(),   // legacy single — kept for migration reads
  imageUrls: z.array(z.string()).optional(),
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

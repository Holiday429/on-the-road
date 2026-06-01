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

/* ── Expenses ────────────────────────────────────────────────────────────── */
export const ExpenseSchema = doc({
  amount: z.number(),
  currency: z.string(),
  amountEur: z.number(),
  description: z.string(),
  category: z.string(),
  city: z.string().default(''),
  date: z.string(),               // ISO date
});
export type Expense = z.infer<typeof ExpenseSchema>;

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

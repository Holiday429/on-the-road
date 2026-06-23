import { z } from 'zod';
import { doc } from './base.ts';


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

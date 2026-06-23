/* ==========================================================================
   On the Road · Itinerary · shared types & category helpers
   --------------------------------------------------------------------------
   Pure, stateless pieces shared between itinerary.ts and the plan-view
   renderers. Kept in their own module so both can import them without a
   circular dependency.
   ========================================================================== */

import type {
  Leg as SchemaLeg, ClipCategory,
} from '../../data/schema.ts';

export type Transport = NonNullable<SchemaLeg['arrivalTransport']>;
export type Accommodation = NonNullable<SchemaLeg['accommodations']>[number];
export type Leg = SchemaLeg & { id: string };

// Built-in clip/plan categories — user can add their own on top.
export const BUILTIN_CATEGORIES: ClipCategory[] = [
  { id: 'official',  label: 'Tourism',  color: '#e2edf3', order: 0 },
  { id: 'social',    label: 'Social',   color: '#fde8ef', order: 1 },
  { id: 'food',      label: 'Food',     color: '#fef3e2', order: 2 },
  { id: 'museum',    label: 'Museum',   color: '#ece2f3', order: 3 },
  { id: 'nature',    label: 'Nature',   color: '#e6f3e6', order: 4 },
  { id: 'daytrip',   label: 'Day trip', color: '#e2f3ec', order: 5 },
  { id: 'shopping',  label: 'Shopping', color: '#f3e2e8', order: 6 },
  { id: 'other',     label: 'Other',           color: '#ebebeb', order: 7 },
];

// 10 palette colours the user can pick when creating a custom category.
export const CATEGORY_PALETTE = [
  '#fde8ef','#fef3e2','#ece2f3','#e2edf3','#e6f3e6',
  '#e2f3ec','#f3e2e8','#f3f0e2','#f0e2f3','#ebebeb',
];

export function allCategories(leg: Leg): ClipCategory[] {
  const custom = leg.clipCategories ?? [];
  const customIds = new Set(custom.map(c => c.id));
  return [
    ...BUILTIN_CATEGORIES.filter(b => !customIds.has(b.id)),
    ...custom,
  ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function categoryById(leg: Leg, id: string): ClipCategory | undefined {
  return allCategories(leg).find(c => c.id === id);
}

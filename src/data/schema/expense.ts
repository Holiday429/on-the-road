import { z } from 'zod';
import { doc } from './base.ts';


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

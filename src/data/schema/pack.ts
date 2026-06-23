import { z } from 'zod';
import { doc } from './base.ts';


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

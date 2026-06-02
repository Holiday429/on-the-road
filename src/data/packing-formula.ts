/* ==========================================================================
   On the Road · Packing formula
   --------------------------------------------------------------------------
   Turns a trip profile (days / climate / activities) into a recommended,
   weight-aware packing list. The whole point of the Pack page: pack light by
   driving item counts from a formula instead of stacking a wishlist.

   Two ideas encoded here:
   1. Clothing counts cap with a laundry cycle — past ~7 days you re-wash, you
      don't keep adding shirts.
   2. Every item carries a reference weight so a total can be shown before the
      user ever steps on a scale.
   ========================================================================== */

import type { PackItem, PackProfile, PackPriority } from './schema.ts';

export type Climate = PackProfile['climate'];

export const CLIMATES: { value: Climate; label: string }[] = [
  { value: 'cold', label: '❄️ Cold' },
  { value: 'cool', label: '🍂 Cool' },
  { value: 'mild', label: '⛅ Mild' },
  { value: 'warm', label: '☀️ Warm' },
  { value: 'hot', label: '🔥 Hot' },
];

export const ACTIVITIES: { value: string; label: string }[] = [
  { value: 'city', label: '🏙 City' },
  { value: 'hiking', label: '🥾 Hiking' },
  { value: 'beach', label: '🏖 Beach' },
  { value: 'business', label: '💼 Business' },
  { value: 'cold-weather', label: '🧤 Snow' },
];

// Item category order, used for grouping in the UI.
export const CATEGORY_ORDER = ['Tech', 'Docs', 'Clothing', 'Layers', 'Footwear', 'Toiletries', 'Activity', 'Other'];

/* ── Reference weights (grams, per single item) ──────────────────────────── */

const W = {
  tshirt: 150, longSleeve: 220, underwear: 40, socks: 50, pants: 400, shorts: 200,
  midLayer: 350, shell: 350, baseLayer: 200, sleepwear: 250,
  walkingShoes: 700, sandals: 250, hikingBoots: 900,
  toiletryKit: 600, sunscreen: 150, swimwear: 120,
  dressShirt: 250, blazer: 600, hikingDaypack: 500,
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

// Laundry-capped count: scales with days but stops at `cap` (then you re-wash).
function cycle(days: number, perDay: number, cap: number, min = 1): number {
  return Math.max(min, Math.min(cap, Math.ceil(days * perDay)));
}

type Spec = {
  name: string; category: string; qty: number; unitWeightG: number;
  priority: PackPriority;
};

/* ── Formula ─────────────────────────────────────────────────────────────── */

export function buildFormulaItems(profile: PackProfile): Spec[] {
  const { days, climate, activities } = profile;
  const warm = climate === 'warm' || climate === 'hot';
  const cold = climate === 'cold' || climate === 'cool';
  const has = (a: string) => activities.includes(a);

  const specs: Spec[] = [];
  const add = (s: Spec) => { if (s.qty > 0) specs.push(s); };

  /* Base clothing — laundry-capped */
  add({ name: warm ? 'T-shirt' : 'Top (t-shirt / long-sleeve)', category: 'Clothing',
        qty: cycle(days, 1, 7), unitWeightG: warm ? W.tshirt : W.longSleeve, priority: 'essential' });
  add({ name: 'Underwear', category: 'Clothing',
        qty: cycle(days + 1, 1, 8), unitWeightG: W.underwear, priority: 'essential' });
  add({ name: 'Socks (pairs)', category: 'Clothing',
        qty: cycle(days + 1, 1, 8), unitWeightG: W.socks, priority: 'essential' });
  add({ name: 'Pants / trousers', category: 'Clothing',
        qty: cycle(days, 0.25, 3, 1), unitWeightG: W.pants, priority: 'essential' });
  add({ name: 'Shorts', category: 'Clothing',
        qty: warm ? cycle(days, 0.3, 3, 1) : 0, unitWeightG: W.shorts, priority: 'nice' });
  add({ name: 'Sleepwear', category: 'Clothing', qty: 1, unitWeightG: W.sleepwear, priority: 'nice' });

  /* Layering — three-layer system, avoid doubling up */
  add({ name: 'Base layer (thermal)', category: 'Layers',
        qty: cold ? 2 : 0, unitWeightG: W.baseLayer, priority: 'essential' });
  add({ name: 'Mid layer (fleece / sweater)', category: 'Layers',
        qty: cold ? 1 : (climate === 'mild' ? 1 : 0), unitWeightG: W.midLayer, priority: 'essential' });
  add({ name: 'Shell (rain / wind jacket)', category: 'Layers',
        qty: warm ? (has('hiking') ? 1 : 0) : 1, unitWeightG: W.shell, priority: 'essential' });

  /* Footwear */
  add({ name: 'Walking shoes', category: 'Footwear', qty: 1, unitWeightG: W.walkingShoes, priority: 'essential' });
  add({ name: 'Sandals / flip-flops', category: 'Footwear',
        qty: warm || has('beach') ? 1 : 0, unitWeightG: W.sandals, priority: 'nice' });
  add({ name: 'Hiking boots', category: 'Footwear',
        qty: has('hiking') ? 1 : 0, unitWeightG: W.hikingBoots, priority: 'nice' });

  /* Toiletries */
  add({ name: 'Toiletry kit', category: 'Toiletries', qty: 1, unitWeightG: W.toiletryKit, priority: 'essential' });
  add({ name: 'Sunscreen', category: 'Toiletries',
        qty: warm || has('beach') ? 1 : 0, unitWeightG: W.sunscreen, priority: 'essential' });

  /* Activity-specific */
  add({ name: 'Swimwear', category: 'Activity',
        qty: has('beach') ? 1 : 0, unitWeightG: W.swimwear, priority: 'nice' });
  add({ name: 'Daypack', category: 'Activity',
        qty: has('hiking') || has('city') ? 1 : 0, unitWeightG: W.hikingDaypack, priority: 'nice' });
  add({ name: 'Dress shirt', category: 'Clothing',
        qty: has('business') ? 2 : 0, unitWeightG: W.dressShirt, priority: 'nice' });
  add({ name: 'Blazer', category: 'Clothing',
        qty: has('business') ? 1 : 0, unitWeightG: W.blazer, priority: 'luxury' });

  return specs;
}

/** Convert formula specs into PackItems assigned to a default container. */
export function specsToItems(specs: Spec[], containerId: string | null, startOrder = 0): Omit<PackItem, 'id'>[] {
  return specs.map((s, i) => ({
    name: s.name,
    category: s.category,
    qty: s.qty,
    unitWeightG: s.unitWeightG,
    containerId,
    priority: s.priority,
    locked: false,
    packed: false,
    source: 'formula' as const,
    order: startOrder + i,
  }));
}

/* ── Weight math ─────────────────────────────────────────────────────────── */

export function itemWeightG(it: { qty: number; unitWeightG: number }): number {
  return it.qty * it.unitWeightG;
}

export function formatKg(grams: number): string {
  return (grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 1) + 'kg';
}

/* ── Three-layer system advisory ─────────────────────────────────────────── */
/* Pack warmth by layering, not by stacking thick single garments. We check the
   list against the climate and surface what's missing or doubled-up. */

export type LayerStatus = 'ok' | 'missing' | 'excess' | 'na';
export interface LayerAdvice {
  layer: 'base' | 'mid' | 'shell';
  label: string;
  status: LayerStatus;
  message: string;
}

// Substrings that identify each layer among item names.
const LAYER_MATCH: Record<'base' | 'mid' | 'shell', RegExp> = {
  base: /base layer|thermal/i,
  mid: /mid layer|fleece|sweater|jumper/i,
  shell: /shell|rain|wind|jacket/i,
};

export function layerAdvice(
  profile: PackProfile,
  items: { name: string; qty: number }[],
): LayerAdvice[] {
  const cold = profile.climate === 'cold' || profile.climate === 'cool';
  const mild = profile.climate === 'mild';
  const count = (l: keyof typeof LAYER_MATCH) =>
    items.filter(i => LAYER_MATCH[l].test(i.name)).reduce((s, i) => s + i.qty, 0);

  // Expected count per layer for this climate (0 = not needed).
  const want: Record<'base' | 'mid' | 'shell', number> = {
    base: cold ? 2 : 0,
    mid: cold || mild ? 1 : 0,
    shell: profile.climate === 'warm' || profile.climate === 'hot' ? 0 : 1,
  };
  const labels = { base: 'Base layer', mid: 'Mid layer', shell: 'Shell' };

  return (['base', 'mid', 'shell'] as const).map(layer => {
    const have = count(layer);
    const need = want[layer];
    if (need === 0) {
      return { layer, label: labels[layer], status: 'na' as const,
        message: have > 0 ? `Not needed for this climate — ${have} packed.` : 'Not needed for this climate.' };
    }
    if (have === 0) return { layer, label: labels[layer], status: 'missing' as const, message: `Missing — add ${need}.` };
    if (have > need + 1) return { layer, label: labels[layer], status: 'excess' as const, message: `${have} packed — ${need} is enough, trim to save weight.` };
    return { layer, label: labels[layer], status: 'ok' as const, message: `${have} packed.` };
  });
}

/* ── Auto-trim to a weight budget ────────────────────────────────────────── */
/* When the formula output blows past the budget, shave quantities from the
   least-important items first. Core/locked items are never touched. */

export interface TrimResult<T> {
  items: T[];
  trimmed: { name: string; from: number; to: number }[];
  removedG: number;
}

const PRIORITY_RANK: Record<PackItem['priority'], number> = { luxury: 0, nice: 1, essential: 2, core: 3 };

export function trimToBudget<T extends Pick<PackItem, 'name' | 'qty' | 'unitWeightG' | 'priority' | 'locked'>>(
  items: T[],
  budgetG: number,
): TrimResult<T> {
  if (budgetG <= 0) return { items, trimmed: [], removedG: 0 };

  const working = items.map(it => ({ ...it }));
  const total = () => working.reduce((s, it) => s + it.qty * it.unitWeightG, 0);
  const trimmedMap = new Map<string, { name: string; from: number; to: number }>();
  let removedG = 0;

  // Trim candidates: not locked/core, qty > 1 (keep at least one of anything kept).
  // Sort by priority (luxury first), then heaviest single unit first.
  const order = () => working
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => !it.locked && it.priority !== 'core' && it.qty > 1)
    .sort((a, b) =>
      PRIORITY_RANK[a.it.priority] - PRIORITY_RANK[b.it.priority] ||
      b.it.unitWeightG - a.it.unitWeightG);

  let guard = 0;
  while (total() > budgetG && guard++ < 500) {
    const cands = order();
    if (cands.length === 0) break;
    const { it, idx } = cands[0];
    const before = trimmedMap.get(it.name)?.from ?? it.qty;
    working[idx].qty -= 1;
    removedG += it.unitWeightG;
    trimmedMap.set(it.name, { name: it.name, from: before, to: working[idx].qty });
  }

  return { items: working, trimmed: [...trimmedMap.values()], removedG };
}

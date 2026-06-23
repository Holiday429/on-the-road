/* ==========================================================================
   On the Road · Pack · pure helpers
   --------------------------------------------------------------------------
   Stateless constants and functions extracted from pack.ts: item categories,
   weight-unit conversion, container kinds/priorities, and weight math. Nothing
   here reads module state, so it's safe to import anywhere.
   ========================================================================== */

import { itemWeightG } from '../../data/packing-formula.ts';
import type { PackList, PackItem, PackContainer, PackPriority } from '../../data/schema.ts';

/* ── Item categories ─────────────────────────────────────────────────────── */
// Colors: NOTE_PALETTE tones extended with a few extra muted hues.
// Each category gets a fixed pastel background so tags are instantly readable.
export const PACK_CATEGORIES: { label: string; value: string; color: string; icon: string }[] = [
  { value: 'electronics', label: 'Electronics',  color: '#e2edf3', icon: '💻' },
  { value: 'clothing',    label: 'Clothing',      color: '#ece2f3', icon: '👕' },
  { value: 'toiletries',  label: 'Toiletries',    color: '#e2f3ec', icon: '🧴' },
  { value: 'documents',   label: 'Documents',     color: '#f3ede2', icon: '📄' },
  { value: 'health',      label: 'Health & Med',  color: '#f3e6e6', icon: '💊' },
  { value: 'feminine',    label: 'Feminine',      color: '#f0e2f3', icon: '🌸' },
  { value: 'consumables', label: 'Consumables',   color: '#e6f3e6', icon: '🧹' },
  { value: 'food',        label: 'Food',          color: '#f3f0e2', icon: '🍜' },
  { value: 'gifts',       label: 'Gifts',         color: '#f3e2e8', icon: '🎁' },
  { value: 'other',       label: 'Other',         color: '#ebebeb', icon: '📦' },
];

export const DEFAULT_CATEGORY = 'other';

export function categoryColor(value: string): string {
  return PACK_CATEGORIES.find(c => c.value === value)?.color ?? '#ebebeb';
}

export function categoryLabel(value: string): string {
  return PACK_CATEGORIES.find(c => c.value === value)?.label ?? value;
}

export function categoryOptions(selected = DEFAULT_CATEGORY): string {
  return PACK_CATEGORIES.map(c =>
    `<option value="${c.value}" ${c.value === selected ? 'selected' : ''}>${c.icon} ${c.label}</option>`
  ).join('');
}

/* ── Weight unit support ─────────────────────────────────────────────────── */

export type WeightUnit = 'kg' | 'g' | 'lb' | 'jin';

export const WEIGHT_UNITS: { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'g',  label: 'g' },
  { value: 'lb', label: 'lb' },
  { value: 'jin', label: '斤 (jin)' },
];

// Converts a value in the given unit to grams.
export function toGrams(val: number, unit: WeightUnit): number {
  if (unit === 'g')   return val;
  if (unit === 'lb')  return val * 453.592;
  if (unit === 'jin') return val * 500;
  return val * 1000; // kg
}

// Displays grams in the user's preferred unit.
export function displayWeight(g: number, unit: WeightUnit): string {
  if (unit === 'g')   return `${Math.round(g)}g`;
  if (unit === 'lb')  return `${(g / 453.592).toFixed(1)}lb`;
  if (unit === 'jin') return `${(g / 500).toFixed(2)}斤`;
  return `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 1)}kg`;
}

/* ── Container kinds & priorities ────────────────────────────────────────── */

export const KINDS: { value: PackContainer['kind']; label: string }[] = [
  { value: 'backpack', label: 'Backpack' },
  { value: 'suitcase', label: 'Suitcase' },
  { value: 'personal', label: 'Personal' },
];

export const PRIORITIES: { value: PackPriority; label: string }[] = [
  { value: 'essential', label: 'Essential' },
  { value: 'nice', label: 'Nice' },
  { value: 'optional', label: 'Optional' },
];

// Lower rank = drop first when over weight. Falls back gracefully for any
// legacy/unknown priority value read off an old document.
const PRIORITY_RANK: Record<PackPriority, number> = { optional: 0, nice: 1, essential: 2 };
export function priRank(p: PackItem['priority']): number {
  return PRIORITY_RANK[p as PackPriority] ?? 1;
}

export function kindLabel(kind: PackContainer['kind']): string {
  return KINDS.find(k => k.value === kind)?.label ?? kind;
}

/* ── Misc ────────────────────────────────────────────────────────────────── */

export function num(v: string, fallback = 0): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function genLocalId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ── Weight math ─────────────────────────────────────────────────────────── */

/** Total weight inside a container = its items + the empty bag's own weight. */
export function containerWeight(list: PackList, c: PackContainer): number {
  const items = list.items
    .filter(it => it.containerId === c.id)
    .reduce((sum, it) => sum + itemWeightG(it), 0);
  return items + c.selfWeightG;
}

/** Whole-list weight = every item + every bag's self-weight (Unassigned counts items only). */
export function listTotalWeight(list: PackList): number {
  const items = list.items.reduce((s, it) => s + itemWeightG(it), 0);
  const bags = list.containers.reduce((s, c) => s + c.selfWeightG, 0);
  return items + bags;
}

export function isOver(list: PackList, c: PackContainer): boolean {
  return c.limitG > 0 && containerWeight(list, c) > c.limitG;
}

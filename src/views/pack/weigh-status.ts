/* ==========================================================================
   On the Road · Pack · weigh-in status
   --------------------------------------------------------------------------
   Remembers what the scale last said, so the Weigh button can report instead of
   just asking: never weighed / weight changed since / all within limits / a bag
   is over. Display-only bookkeeping — it never touches pack data, and it lives
   in this browser (localStorage) until the iOS contract settles where a weigh-in
   should sync (see docs/pack-scene-ios.md).
   ========================================================================== */

import type { BagWeighIn, Verdict } from './weigh-in.ts';

export type WeighState = 'none' | 'stale' | 'ok' | 'over';

export interface BagRecord { g: number; limitG: number; at: number }
export interface WeighRecord { bags: Record<string, BagRecord> }

export interface WeighStatus {
  state: WeighState;
  /** Bags in the list. */
  bags: number;
  /** Bags never weighed, or whose weight has changed since. */
  pending: number;
  /** Bags currently over their limit. */
  over: number;
  /** When the most recent bag was weighed (ms), if any. */
  at: number | null;
}

/** Pure: compares what the bags weigh now against what the scale last recorded. */
export function weighStatus(rows: BagWeighIn[], rec: WeighRecord | null): WeighStatus {
  const bags = rows.length;
  const known = rec?.bags ?? {};
  const weighed = rows.filter((r) => known[r.id]);
  const pending = rows.filter((r) => !known[r.id] || Math.round(known[r.id].g) !== Math.round(r.weightG)).length;
  const over = rows.filter((r) => r.verdict === 'over').length;
  const at = weighed.length ? Math.max(...weighed.map((r) => known[r.id].at)) : null;
  let state: WeighState;
  if (!bags || !weighed.length) state = 'none';
  else if (pending) state = 'stale';
  else state = over ? 'over' : 'ok';
  return { state, bags, pending, over, at };
}

/** Folds fresh results into the record (other bags' earlier results stay). */
export function mergeRecord(rec: WeighRecord | null, rows: BagWeighIn[], now: number): WeighRecord {
  const bags = { ...(rec?.bags ?? {}) };
  for (const r of rows) bags[r.id] = { g: r.weightG, limitG: r.limitG, at: now };
  return { bags };
}

/** "just now" / "12 min ago" / "3 h ago" / "2 d ago" — as parts, so the caller can localise. */
export function ago(at: number, now: number): { unit: 'now' | 'min' | 'h' | 'd'; n: number } {
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return { unit: 'now', n: 0 };
  if (mins < 60) return { unit: 'min', n: mins };
  if (mins < 60 * 24) return { unit: 'h', n: Math.round(mins / 60) };
  return { unit: 'd', n: Math.round(mins / 1440) };
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

const recKey = (listId: string) => `otr:pack:weigh:${listId}`;
const slipKey = (listId: string) => `otr:pack:slips:${listId}`;

function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota: status just won't persist */ }
}

export function loadRecord(listId: string): WeighRecord | null {
  const r = read<WeighRecord>(recKey(listId));
  return r && typeof r === 'object' && r.bags ? r : null;
}

export function recordWeighIn(listId: string, rows: BagWeighIn[], now = Date.now()): void {
  write(recKey(listId), mergeRecord(loadRecord(listId), rows, now));
}

/* ── Weigh-in slips (the saved receipts) ─────────────────────────────────── */

export interface SlipRow { label: string; g: number; limitG: number; verdict: Verdict }
export interface WeighSlip {
  id: string;
  at: number;
  rows: SlipRow[];
  totalG: number;
  /** True when any bag was over. */
  over: boolean;
}

export function makeSlip(rows: BagWeighIn[], now = Date.now()): WeighSlip {
  return {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: now,
    rows: rows.map((r) => ({ label: r.label, g: r.weightG, limitG: r.limitG, verdict: r.verdict })),
    totalG: rows.reduce((s, r) => s + r.weightG, 0),
    over: rows.some((r) => r.verdict === 'over'),
  };
}

const MAX_SLIPS = 20;

export function loadSlips(listId: string): WeighSlip[] {
  const v = read<WeighSlip[]>(slipKey(listId));
  return Array.isArray(v) ? v : [];
}

export function saveSlip(listId: string, slip: WeighSlip): WeighSlip[] {
  const next = [slip, ...loadSlips(listId).filter((s) => s.id !== slip.id)].slice(0, MAX_SLIPS);
  write(slipKey(listId), next);
  return next;
}

/** A short, printable-looking code for the slip footer. */
export function slipCode(slip: WeighSlip): string {
  let h = 0;
  for (let i = 0; i < slip.id.length; i++) h = (h * 33 + slip.id.charCodeAt(i)) >>> 0;
  return `OTR ${String(h % 1_000_000).padStart(6, '0')}`;
}

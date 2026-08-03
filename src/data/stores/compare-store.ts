/* ==========================================================================
   On the Road · Compare store — universal multi-criteria comparison
   trips/{tripId}/compares/{groupId}
   --------------------------------------------------------------------------
   Each CompareGroup holds candidates (columns) and dimensions (rows) embedded
   in the document. Scoring logic (pure functions) lives here too so the view
   stays presentational.
   ========================================================================== */

import {
  CompareGroupSchema,
  type CompareGroup, type CompareCandidate, type CompareDimension, type CompareType,
} from '../schema.ts';
import { createCollectionStore, genId, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';

export type StoredGroup = WithMeta<CompareGroup>;

// Special dimension id for price — its score is derived from fields.price
// (parsed as a number) rather than manually entered via the star/toggle UI.
export const PRICE_DIM_ID = 'price';
// Same deal for duration on flight/train candidates — auto-scored from
// fields.duration ("2h45m" / "3:30" / "165") rather than a manual star rating.
export const DURATION_DIM_ID = 'duration';

function store() {
  return createCollectionStore(currentTripId(), 'compares', CompareGroupSchema);
}

/* ── Default dimensions per type ────────────────────────────────────────── */

export function defaultDimensions(type: CompareType): CompareDimension[] {
  switch (type) {
    case 'accommodation':
      return [
        { id: PRICE_DIM_ID, label: 'Price / night',   type: 'number',  weight: 3, higherIsBetter: false, builtin: true },
        { id: genId(),      label: 'Transport',        type: 'rating',  weight: 3, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Surroundings',     type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Room & comfort',   type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Service',          type: 'rating',  weight: 1, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Must relocate',    type: 'boolean', weight: 2, higherIsBetter: false, builtin: true },
      ];
    case 'flight':
      return [
        { id: PRICE_DIM_ID, label: 'Price',            type: 'number',  weight: 3, higherIsBetter: false, builtin: true },
        { id: genId(),      label: 'Direct flight',    type: 'boolean', weight: 3, higherIsBetter: true,  builtin: true },
        { id: genId(),        label: 'Departure time', type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),        label: 'Arrival time',   type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: DURATION_DIM_ID,label: 'Flight duration',type: 'number',  weight: 2, higherIsBetter: false, builtin: true },
        { id: genId(),        label: 'Baggage included', type: 'boolean', weight: 2, higherIsBetter: true, builtin: true },
        { id: genId(),      label: 'Airline quality',  type: 'rating',  weight: 1, higherIsBetter: true,  builtin: true },
      ];
    case 'train':
      return [
        { id: PRICE_DIM_ID, label: 'Price',            type: 'number',  weight: 3, higherIsBetter: false, builtin: true },
        { id: genId(),        label: 'Departure time', type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),        label: 'Arrival time',   type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: DURATION_DIM_ID,label: 'Journey duration',type: 'number', weight: 2, higherIsBetter: false, builtin: true },
        { id: genId(),        label: 'Direct route',   type: 'boolean', weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Seat comfort',     type: 'rating',  weight: 1, higherIsBetter: true,  builtin: true },
      ];
    case 'shopping':
      return [
        { id: PRICE_DIM_ID, label: 'Price',            type: 'number',  weight: 3, higherIsBetter: false, builtin: true },
        { id: genId(),      label: 'Quality',          type: 'rating',  weight: 3, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Value for money',  type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Authenticity',     type: 'rating',  weight: 1, higherIsBetter: true,  builtin: true },
      ];
    default: // 'other'
      return [
        { id: PRICE_DIM_ID, label: 'Price',            type: 'number',  weight: 2, higherIsBetter: false, builtin: true },
        { id: genId(),      label: 'Overall rating',   type: 'rating',  weight: 3, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Convenience',      type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
      ];
  }
}

/* ── Scoring helpers (pure) ──────────────────────────────────────────────── */

/** Strip thousands separators, keeping only the final . or , as the decimal
 *  point (whichever appears last) — handles both "1,200.50" and "1.200,50". */
function parseLocaleNumber(raw: string): number {
  const cleaned = raw.replace(/[^0-9.,]/g, '');
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const decimalAt = Math.max(lastDot, lastComma);
  if (decimalAt === -1) return parseFloat(cleaned);
  const intPart = cleaned.slice(0, decimalAt).replace(/[.,]/g, '');
  const fracPart = cleaned.slice(decimalAt + 1).replace(/[.,]/g, '');
  return parseFloat(`${intPart}.${fracPart}`);
}

/** Numeric price from fields.price string, or null if absent/unparseable.
 *  A leading minus is treated as an invalid entry (not silently made
 *  positive) — a stray "-5" almost certainly means "unset", not "€5". */
export function fieldPrice(c: CompareCandidate): number | null {
  const raw = c.fields['price'];
  if (!raw || raw.trim().startsWith('-')) return null;
  const n = parseLocaleNumber(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Minutes from fields.duration — accepts "2h45m", "2h", "45m", "3:30" (h:mm),
 *  or a bare number of minutes. Returns null if absent/unparseable. */
export function fieldDurationMin(c: CompareCandidate): number | null {
  const raw = c.fields['duration']?.trim();
  if (!raw) return null;

  const hm = raw.match(/^(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in)?)?$/i);
  if (hm) return parseInt(hm[1], 10) * 60 + (hm[2] ? parseInt(hm[2], 10) : 0);

  const mOnly = raw.match(/^(\d+)\s*m(?:in)?$/i);
  if (mOnly) return parseInt(mOnly[1], 10);

  const colon = raw.match(/^(\d+):(\d{2})$/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);

  const bare = Number(raw);
  return Number.isFinite(bare) && bare > 0 ? bare : null;
}

/** Raw value for a candidate on a dimension. */
export function rawValue(c: CompareCandidate, dim: CompareDimension): number | null {
  if (dim.id === PRICE_DIM_ID) return fieldPrice(c);
  if (dim.id === DURATION_DIM_ID) return fieldDurationMin(c);
  const v = c.scores[dim.id];
  return v == null ? null : v;
}

// Neutral score for a candidate with no value on a dimension. Excluding blank
// cells from the denominator let a sparsely-filled candidate outscore a fully
// scored one on the dimensions it *did* answer; a flat midpoint keeps missing
// data from being a free ride without needing a "did they even try" penalty.
const UNFILLED_NORM = 0.5;

export interface DimResult {
  norm: number | null;
  isWinner: boolean;
  /** False when this cell had no value and fell back to the neutral score. */
  filled: boolean;
}

export interface ScoreResult {
  totals: Record<string, number>;
  cells: Record<string, Record<string, DimResult>>;
  dimWinners: Record<string, string | null>;
  ranking: string[];
}

/** Normalize one dimension's raw values to 0–1, "better" always meaning higher.
 *  Numbers use a ratio to the best value rather than min-max, so a €5 gap
 *  between two hotels doesn't score identically to a €500 gap — magnitude
 *  survives the normalization instead of collapsing to 1.0/0.0. */
function normalizeDimension(
  dim: CompareDimension,
  present: { id: string; v: number }[],
): Record<string, number> {
  const norms: Record<string, number> = {};

  if (dim.type === 'number') {
    const nums = present.map((x) => x.v);
    if (dim.higherIsBetter) {
      const best = Math.max(...nums);
      for (const x of present) norms[x.id] = best > 0 ? x.v / best : 1;
    } else {
      const best = Math.min(...nums);
      for (const x of present) norms[x.id] = x.v > 0 ? best / x.v : 1;
    }
    return norms; // direction already applied — skip the flip below
  }

  if (dim.type === 'rating') {
    for (const x of present) norms[x.id] = Math.max(0, Math.min(1, x.v / 5));
  } else {
    for (const x of present) norms[x.id] = x.v ? 1 : 0;
  }
  if (!dim.higherIsBetter) {
    for (const id of Object.keys(norms)) norms[id] = 1 - norms[id];
  }
  return norms;
}

export function scoreGroup(group: CompareGroup): ScoreResult {
  const { candidates, dimensions } = group;
  const cells: ScoreResult['cells'] = {};
  const dimWinners: ScoreResult['dimWinners'] = {};
  const weightSum: Record<string, number> = {};
  const weightedAcc: Record<string, number> = {};

  for (const c of candidates) { cells[c.id] = {}; weightSum[c.id] = 0; weightedAcc[c.id] = 0; }

  for (const dim of dimensions) {
    const vals = candidates.map((c) => ({ id: c.id, v: rawValue(c, dim) }));
    const present = vals.filter((x) => x.v != null) as { id: string; v: number }[];
    const norms = normalizeDimension(dim, present);

    let bestId: string | null = null, best = -Infinity;
    for (const id of Object.keys(norms)) {
      if (norms[id] > best) { best = norms[id]; bestId = id; }
    }
    dimWinners[dim.id] = present.length >= 2 && bestId != null ? bestId : null;

    for (const c of candidates) {
      const filled = norms[c.id] != null;
      const n = filled ? norms[c.id] : UNFILLED_NORM;
      cells[c.id][dim.id] = {
        norm: n,
        isWinner: filled && dimWinners[dim.id] === c.id && best > 0,
        filled,
      };
      if (dim.weight > 0) {
        weightSum[c.id] += dim.weight;
        weightedAcc[c.id] += n * dim.weight;
      }
    }
  }

  const totals: Record<string, number> = {};
  for (const c of candidates) {
    totals[c.id] = weightSum[c.id] > 0 ? weightedAcc[c.id] / weightSum[c.id] : 0;
  }
  const ranking = [...candidates]
    .sort((a, b) => totals[b.id] - totals[a.id])
    .map((c) => c.id);

  return { totals, cells, dimWinners, ranking };
}

/* ── CRUD ────────────────────────────────────────────────────────────────── */

export const compareStore = {
  peek: (): StoredGroup[] => store().peek() as StoredGroup[],
  subscribe: (cb: (rows: StoredGroup[]) => void) =>
    store().subscribe(cb as (rows: WithMeta<CompareGroup>[]) => void),

  create(type: CompareType, title: string, legId: string | null = null): Promise<string> {
    return store().set({
      tripId: currentTripId(),
      legId,
      title,
      compareType: type,
      dimensions: defaultDimensions(type),
      candidates: [],
    });
  },

  remove(id: string): Promise<void> {
    return store().remove(id);
  },

  async updateTitle(groupId: string, title: string): Promise<void> {
    await store().update(groupId, { title });
  },

  /* ── Candidate ops ──────────────────────────────────────────────────────── */

  async addCandidate(groupId: string, input: Partial<CompareCandidate> = {}): Promise<void> {
    const group = await resolve(groupId);
    if (!group) return;
    const candidate: CompareCandidate = {
      id: genId(),
      name: input.name ?? 'New option',
      link: input.link,
      fields: input.fields ?? {},
      scores: input.scores ?? {},
      notes: input.notes,
    };
    await store().update(groupId, { candidates: [...group.candidates, candidate] });
  },

  async updateCandidate(groupId: string, candidateId: string, patch: Partial<CompareCandidate>): Promise<void> {
    const group = await resolve(groupId);
    if (!group) return;
    const candidates = group.candidates.map((c) =>
      c.id === candidateId ? { ...c, ...patch } : c);
    await store().update(groupId, { candidates });
  },

  async setScore(groupId: string, candidateId: string, dimId: string, value: number | null): Promise<void> {
    const group = await resolve(groupId);
    if (!group) return;
    const candidates = group.candidates.map((c) => {
      if (c.id !== candidateId) return c;
      const scores = { ...c.scores };
      if (value == null) delete scores[dimId];
      else scores[dimId] = value;
      return { ...c, scores };
    });
    await store().update(groupId, { candidates });
  },

  async setField(groupId: string, candidateId: string, key: string, value: string): Promise<void> {
    const group = await resolve(groupId);
    if (!group) return;
    const candidates = group.candidates.map((c) => {
      if (c.id !== candidateId) return c;
      const fields = { ...c.fields };
      if (value === '') delete fields[key];
      else fields[key] = value;
      return { ...c, fields };
    });
    await store().update(groupId, { candidates });
  },

  async removeCandidate(groupId: string, candidateId: string): Promise<void> {
    const group = await resolve(groupId);
    if (!group) return;
    await store().update(groupId, {
      candidates: group.candidates.filter((c) => c.id !== candidateId),
    });
  },

  /* ── Dimension ops ──────────────────────────────────────────────────────── */

  async setWeight(groupId: string, dimId: string, weight: number): Promise<void> {
    const group = await resolve(groupId);
    if (!group) return;
    const dimensions = group.dimensions.map((d) =>
      d.id === dimId ? { ...d, weight } : d);
    await store().update(groupId, { dimensions });
  },

  async addDimension(groupId: string, label: string, type: CompareDimension['type'], higherIsBetter: boolean): Promise<void> {
    const group = await resolve(groupId);
    if (!group) return;
    const dim: CompareDimension = {
      id: genId(), label, type, weight: 1, higherIsBetter, builtin: false,
    };
    await store().update(groupId, { dimensions: [...group.dimensions, dim] });
  },

  async removeDimension(groupId: string, dimId: string): Promise<void> {
    if (dimId === PRICE_DIM_ID) return;
    const group = await resolve(groupId);
    if (!group) return;
    const candidates = group.candidates.map((c) => {
      if (!(dimId in c.scores)) return c;
      const scores = { ...c.scores }; delete scores[dimId];
      return { ...c, scores };
    });
    await store().update(groupId, {
      dimensions: group.dimensions.filter((d) => d.id !== dimId),
      candidates,
    });
  },
};

async function resolve(groupId: string): Promise<StoredGroup | undefined> {
  const cached = (store().peek() as StoredGroup[]).find((g) => g.id === groupId);
  if (cached) return cached;
  const rows = await store().list();
  return (rows as StoredGroup[]).find((g) => g.id === groupId);
}

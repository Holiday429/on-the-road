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
        { id: genId(),      label: 'Departure time',   type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Arrival time',     type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Flight duration',  type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Baggage included', type: 'boolean', weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Airline quality',  type: 'rating',  weight: 1, higherIsBetter: true,  builtin: true },
      ];
    case 'train':
      return [
        { id: PRICE_DIM_ID, label: 'Price',            type: 'number',  weight: 3, higherIsBetter: false, builtin: true },
        { id: genId(),      label: 'Departure time',   type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Arrival time',     type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Journey duration', type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
        { id: genId(),      label: 'Direct route',     type: 'boolean', weight: 2, higherIsBetter: true,  builtin: true },
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

/** Numeric price from fields.price string, or null if absent/unparseable. */
export function fieldPrice(c: CompareCandidate): number | null {
  const raw = c.fields['price'];
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Raw value for a candidate on a dimension. */
export function rawValue(c: CompareCandidate, dim: CompareDimension): number | null {
  if (dim.id === PRICE_DIM_ID) return fieldPrice(c);
  const v = c.scores[dim.id];
  return v == null ? null : v;
}

export interface DimResult {
  norm: number | null;
  isWinner: boolean;
}

export interface ScoreResult {
  totals: Record<string, number>;
  cells: Record<string, Record<string, DimResult>>;
  dimWinners: Record<string, string | null>;
  ranking: string[];
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

    let norms: Record<string, number> = {};
    if (dim.type === 'number') {
      const nums = present.map((x) => x.v);
      const min = Math.min(...nums), max = Math.max(...nums);
      for (const x of present) {
        norms[x.id] = max === min ? 1 : (x.v - min) / (max - min);
      }
    } else if (dim.type === 'rating') {
      for (const x of present) norms[x.id] = Math.max(0, Math.min(1, x.v / 5));
    } else {
      for (const x of present) norms[x.id] = x.v ? 1 : 0;
    }
    if (!dim.higherIsBetter) {
      for (const id of Object.keys(norms)) norms[id] = 1 - norms[id];
    }

    let bestId: string | null = null, best = -Infinity;
    for (const id of Object.keys(norms)) {
      if (norms[id] > best) { best = norms[id]; bestId = id; }
    }
    dimWinners[dim.id] = present.length >= 2 && bestId != null ? bestId : null;

    for (const c of candidates) {
      const n = norms[c.id];
      const has = n != null;
      cells[c.id][dim.id] = {
        norm: has ? n : null,
        isWinner: has && dimWinners[dim.id] === c.id && best > 0,
      };
      if (has && dim.weight > 0) {
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

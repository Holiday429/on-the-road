/* ==========================================================================
   On the Road · Stay store — accommodation comparison (one Stay per Leg)
   users/{uid}/trips/{tripId}/stays/{stayId}
   --------------------------------------------------------------------------
   Candidates (columns) and dimensions (rows) are embedded in the Stay doc.
   Pure scoring helpers (PRICE_DIM_ID, perNight, scoreStay) live here too so
   the view stays presentational.
   ========================================================================== */

import { StaySchema, type Stay, type StayCandidate, type StayDimension } from '../schema.ts';
import { createCollectionStore, genId, type WithMeta } from '../../firebase/db.ts';
import { currentTripId } from '../trip-context.ts';

export type StoredStay = WithMeta<Stay>;

// Synthetic id for the always-present price dimension. Its value isn't stored in
// candidate.scores — it's derived from totalPrice/extraFees/nights (perNight).
export const PRICE_DIM_ID = 'price';

function store() {
  return createCollectionStore(currentTripId(), 'stays', StaySchema);
}

/* ── Defaults ────────────────────────────────────────────────────────────── */

export function defaultDimensions(): StayDimension[] {
  return [
    { id: PRICE_DIM_ID, label: 'Price / night', type: 'number',  weight: 3, higherIsBetter: false, builtin: true },
    { id: genId(),      label: 'Transport',     type: 'rating',  weight: 3, higherIsBetter: true,  builtin: true },
    { id: genId(),      label: 'Surroundings',  type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
    { id: genId(),      label: 'Room & comfort',type: 'rating',  weight: 2, higherIsBetter: true,  builtin: true },
    { id: genId(),      label: 'Service',       type: 'rating',  weight: 1, higherIsBetter: true,  builtin: true },
    { id: genId(),      label: 'Must relocate', type: 'boolean', weight: 2, higherIsBetter: false, builtin: true },
  ];
}

/* ── Scoring (pure) ──────────────────────────────────────────────────────── */

/** Per-night price including extra fees, or null if no price entered. */
export function perNight(c: StayCandidate): number | null {
  if (c.totalPrice == null) return null;
  const nights = c.nights && c.nights > 0 ? c.nights : 1;
  return (c.totalPrice + (c.extraFees ?? 0)) / nights;
}

/** Raw value for a candidate on a dimension (price reads from perNight). */
export function rawValue(c: StayCandidate, dim: StayDimension): number | null {
  if (dim.id === PRICE_DIM_ID) return perNight(c);
  const v = c.scores[dim.id];
  return v == null ? null : v;
}

export interface DimResult {
  /** 0–1 normalized score (already flipped for higherIsBetter=false). */
  norm: number | null;
  /** True if this candidate is the (possibly tied) best on this dimension. */
  isWinner: boolean;
}

export interface ScoreResult {
  /** candidateId → weighted total (0–1 scale, undefined dims skipped). */
  totals: Record<string, number>;
  /** candidateId → dimId → DimResult */
  cells: Record<string, Record<string, DimResult>>;
  /** dimId → winning candidateId (null if no comparable values). */
  dimWinners: Record<string, string | null>;
  /** candidateIds sorted best-first by weighted total. */
  ranking: string[];
}

/**
 * Normalize every dimension across candidates, then weight-sum into a total.
 * number: min–max within the group. rating: value/5. boolean: 0|1.
 * higherIsBetter=false flips the normalized value. Missing values are skipped
 * (they neither help nor hurt) and their weight is dropped from that
 * candidate's denominator so totals stay on a 0–1 scale.
 */
export function scoreStay(stay: Stay): ScoreResult {
  const { candidates, dimensions } = stay;
  const cells: ScoreResult['cells'] = {};
  const dimWinners: ScoreResult['dimWinners'] = {};
  const weightSum: Record<string, number> = {};
  const weightedAcc: Record<string, number> = {};

  for (const c of candidates) { cells[c.id] = {}; weightSum[c.id] = 0; weightedAcc[c.id] = 0; }

  for (const dim of dimensions) {
    const vals = candidates.map((c) => ({ id: c.id, v: rawValue(c, dim) }));
    const present = vals.filter((x) => x.v != null) as { id: string; v: number }[];

    // Compute normalized score per candidate for this dimension.
    let norms: Record<string, number> = {};
    if (dim.type === 'number') {
      const nums = present.map((x) => x.v);
      const min = Math.min(...nums), max = Math.max(...nums);
      for (const x of present) {
        // All equal → everyone gets full marks (no spread to discriminate on).
        norms[x.id] = max === min ? 1 : (x.v - min) / (max - min);
      }
    } else if (dim.type === 'rating') {
      for (const x of present) norms[x.id] = Math.max(0, Math.min(1, x.v / 5));
    } else { // boolean
      for (const x of present) norms[x.id] = x.v ? 1 : 0;
    }
    if (!dim.higherIsBetter) {
      for (const id of Object.keys(norms)) norms[id] = 1 - norms[id];
    }

    // Winner = max normalized score on this dimension (needs 2+ values to mean anything).
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

export const stayStore = {
  peek: (): StoredStay[] => store().peek() as StoredStay[],
  subscribe: (cb: (rows: StoredStay[]) => void) =>
    store().subscribe(cb as (rows: WithMeta<Stay>[]) => void),

  /** The comparison group for a leg, if one exists. */
  forLeg(legId: string): StoredStay | undefined {
    return (store().peek() as StoredStay[]).find((s) => s.legId === legId);
  },

  /** Create the (single) comparison group for a leg with default dimensions. */
  create(legId: string, city: string): Promise<string> {
    return store().set({
      legId,
      city,
      dimensions: defaultDimensions(),
      candidates: [],
    });
  },

  remove(id: string): Promise<void> {
    return store().remove(id);
  },

  /* ── Candidate ops ──────────────────────────────────────────────────────── */

  async addCandidate(stayId: string, input: Partial<StayCandidate> = {}): Promise<void> {
    const stay = await resolve(stayId);
    if (!stay) return;
    const candidate: StayCandidate = {
      id: genId(),
      name: input.name ?? 'New option',
      kind: input.kind ?? 'hotel',
      link: input.link,
      address: input.address,
      totalPrice: input.totalPrice,
      extraFees: input.extraFees ?? 0,
      nights: input.nights ?? 1,
      scores: input.scores ?? {},
      notes: input.notes,
    };
    await store().update(stayId, { candidates: [...stay.candidates, candidate] });
  },

  async updateCandidate(stayId: string, candidateId: string, patch: Partial<StayCandidate>): Promise<void> {
    const stay = await resolve(stayId);
    if (!stay) return;
    const candidates = stay.candidates.map((c) =>
      c.id === candidateId ? { ...c, ...patch } : c);
    await store().update(stayId, { candidates });
  },

  /** Set one dimension's raw score on one candidate. */
  async setScore(stayId: string, candidateId: string, dimId: string, value: number | null): Promise<void> {
    const stay = await resolve(stayId);
    if (!stay) return;
    const candidates = stay.candidates.map((c) => {
      if (c.id !== candidateId) return c;
      const scores = { ...c.scores };
      if (value == null) delete scores[dimId];
      else scores[dimId] = value;
      return { ...c, scores };
    });
    await store().update(stayId, { candidates });
  },

  async removeCandidate(stayId: string, candidateId: string): Promise<void> {
    const stay = await resolve(stayId);
    if (!stay) return;
    await store().update(stayId, {
      candidates: stay.candidates.filter((c) => c.id !== candidateId),
    });
  },

  /* ── Dimension ops ──────────────────────────────────────────────────────── */

  async setWeight(stayId: string, dimId: string, weight: number): Promise<void> {
    const stay = await resolve(stayId);
    if (!stay) return;
    const dimensions = stay.dimensions.map((d) =>
      d.id === dimId ? { ...d, weight } : d);
    await store().update(stayId, { dimensions });
  },

  async addDimension(stayId: string, label: string, type: StayDimension['type'], higherIsBetter: boolean): Promise<void> {
    const stay = await resolve(stayId);
    if (!stay) return;
    const dim: StayDimension = {
      id: genId(), label, type, weight: 1, higherIsBetter, builtin: false,
    };
    await store().update(stayId, { dimensions: [...stay.dimensions, dim] });
  },

  async removeDimension(stayId: string, dimId: string): Promise<void> {
    if (dimId === PRICE_DIM_ID) return;
    const stay = await resolve(stayId);
    if (!stay) return;
    // Drop the dimension and any scores keyed to it.
    const candidates = stay.candidates.map((c) => {
      if (!(dimId in c.scores)) return c;
      const scores = { ...c.scores }; delete scores[dimId];
      return { ...c, scores };
    });
    await store().update(stayId, {
      dimensions: stay.dimensions.filter((d) => d.id !== dimId),
      candidates,
    });
  },
};

/**
 * Resolve a stay by id, preferring the synchronous cache but falling back to a
 * one-shot Firestore fetch when the cache hasn't caught up (e.g. a candidate is
 * added moments after the stay doc was created). Mirrors db.update()'s own
 * race-handling so mutations never silently no-op on a fresh stay.
 */
async function resolve(stayId: string): Promise<StoredStay | undefined> {
  const cached = (store().peek() as StoredStay[]).find((s) => s.id === stayId);
  if (cached) return cached;
  const rows = await store().list();
  return (rows as StoredStay[]).find((s) => s.id === stayId);
}

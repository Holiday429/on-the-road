import { describe, expect, it, vi } from 'vitest';
import type { CompareCandidate, CompareDimension, CompareGroup } from '../schema.ts';

// This file only exercises compare-store's pure scoring/parsing functions —
// stub out its Firebase-backed dependencies so importing it doesn't require
// the full db.ts mock harness (see stores.test.ts) that the CRUD half needs.
vi.mock('../../firebase/db.ts', () => ({
  createCollectionStore: () => ({}),
  genId: () => Math.random().toString(36).slice(2),
}));
vi.mock('../trip-context.ts', () => ({ currentTripId: () => 'trip1' }));

const {
  scoreGroup, fieldPrice, fieldDurationMin, PRICE_DIM_ID, DURATION_DIM_ID,
} = await import('./compare-store.ts');

function candidate(id: string, fields: Record<string, string> = {}, scores: Record<string, number> = {}): CompareCandidate {
  return { id, name: id, fields, scores };
}

function dim(id: string, type: CompareDimension['type'], weight = 1, higherIsBetter = true): CompareDimension {
  return { id, label: id, type, weight, higherIsBetter, builtin: true };
}

function group(dimensions: CompareDimension[], candidates: CompareCandidate[]): CompareGroup {
  return {
    id: 'g1', tripId: null, legId: null, title: '', compareType: 'flight',
    dimensions, candidates,
  } as CompareGroup;
}

describe('fieldPrice', () => {
  it('parses a plain number', () => {
    expect(fieldPrice(candidate('a', { price: '89' }))).toBe(89);
  });
  it('handles US-style thousands separators', () => {
    expect(fieldPrice(candidate('a', { price: '1,200.50' }))).toBeCloseTo(1200.5);
  });
  it('handles EU-style thousands separators', () => {
    expect(fieldPrice(candidate('a', { price: '1.200,50' }))).toBeCloseTo(1200.5);
  });
  it('strips a currency symbol', () => {
    expect(fieldPrice(candidate('a', { price: '€360' }))).toBe(360);
  });
  it('returns null for missing or zero/negative values', () => {
    expect(fieldPrice(candidate('a', {}))).toBeNull();
    expect(fieldPrice(candidate('a', { price: '0' }))).toBeNull();
    expect(fieldPrice(candidate('a', { price: '-5' }))).toBeNull();
  });
});

describe('fieldDurationMin', () => {
  it('parses "2h45m"', () => {
    expect(fieldDurationMin(candidate('a', { duration: '2h45m' }))).toBe(165);
  });
  it('parses hours only', () => {
    expect(fieldDurationMin(candidate('a', { duration: '3h' }))).toBe(180);
  });
  it('parses minutes only', () => {
    expect(fieldDurationMin(candidate('a', { duration: '45m' }))).toBe(45);
  });
  it('parses h:mm', () => {
    expect(fieldDurationMin(candidate('a', { duration: '2:45' }))).toBe(165);
  });
  it('parses a bare number as minutes', () => {
    expect(fieldDurationMin(candidate('a', { duration: '165' }))).toBe(165);
  });
  it('returns null for missing or unparseable values', () => {
    expect(fieldDurationMin(candidate('a', {}))).toBeNull();
    expect(fieldDurationMin(candidate('a', { duration: 'soon' }))).toBeNull();
  });
});

describe('scoreGroup — number normalization', () => {
  it('keeps magnitude for a two-candidate price gap (ratio, not min-max)', () => {
    // Old min-max normalization made ANY two-candidate gap score 1.0 / 0.0 —
    // a €5 difference looked identical to a €500 difference. Ratio-based
    // scoring should make a huge gap score more decisively than a tiny one.
    const g = group(
      [dim(PRICE_DIM_ID, 'number', 1, false)],
      [candidate('cheap', { price: '100' }), candidate('pricey', { price: '105' })],
    );
    const bigGap = group(
      [dim(PRICE_DIM_ID, 'number', 1, false)],
      [candidate('cheap', { price: '100' }), candidate('pricey', { price: '1000' })],
    );
    const small = scoreGroup(g).totals['pricey'];
    const big = scoreGroup(bigGap).totals['pricey'];
    expect(small).toBeGreaterThan(big);
    expect(small).toBeCloseTo(100 / 105, 2);
    expect(big).toBeCloseTo(100 / 1000, 2);
  });

  it('gives the higher-is-better candidate a ratio score, not a flat 1.0', () => {
    const g = group(
      [dim('rating-ish', 'number', 1, true)],
      [candidate('a', {}, { 'rating-ish': 50 }), candidate('b', {}, { 'rating-ish': 100 })],
    );
    const result = scoreGroup(g);
    expect(result.totals['b']).toBeCloseTo(1);
    expect(result.totals['a']).toBeCloseTo(0.5);
  });

  it('scores a lone candidate at 1 (nothing to compare against)', () => {
    const g = group([dim(PRICE_DIM_ID, 'number', 1, false)], [candidate('solo', { price: '250' })]);
    expect(scoreGroup(g).totals['solo']).toBeCloseTo(1);
  });
});

describe('scoreGroup — missing values', () => {
  it('scores a missing cell as neutral (0.5) rather than excluding it', () => {
    const g = group(
      [dim('d1', 'rating', 1), dim('d2', 'rating', 1)],
      [
        candidate('complete', {}, { d1: 5, d2: 5 }),
        candidate('sparse', {}, { d1: 5 }), // d2 left blank
      ],
    );
    const result = scoreGroup(g);
    // sparse: (1*1 + 0.5*1) / 2 = 0.75 — not equal to complete's 1.0, and not
    // artificially inflated by excluding the blank dimension from the average.
    expect(result.totals['sparse']).toBeCloseTo(0.75);
    expect(result.totals['complete']).toBeCloseTo(1);
    expect(result.cells['sparse']['d2'].filled).toBe(false);
    expect(result.cells['sparse']['d2'].norm).toBeCloseTo(0.5);
  });

  it('never marks an unfilled cell as the dimension winner', () => {
    // Three candidates so at least 2 are "present" (dimWinners requires ≥2
    // real values before declaring a winner at all) while one stays blank.
    const g = group(
      [dim('d1', 'rating', 1)],
      [candidate('a', {}, {}), candidate('b', {}, { d1: 3 }), candidate('c', {}, { d1: 1 })],
    );
    const result = scoreGroup(g);
    expect(result.dimWinners['d1']).toBe('b');
    expect(result.cells['a']['d1'].isWinner).toBe(false);
    expect(result.cells['a']['d1'].filled).toBe(false);
  });
});

describe('scoreGroup — weights', () => {
  it('excludes a zero-weight dimension from the total', () => {
    const g = group(
      [dim('d1', 'rating', 1), dim('d2', 'rating', 0)],
      [candidate('a', {}, { d1: 5, d2: 1 }), candidate('b', {}, { d1: 1, d2: 5 })],
    );
    const result = scoreGroup(g);
    expect(result.totals['a']).toBeCloseTo(1);
    expect(result.totals['b']).toBeCloseTo(0.2);
  });

  it('ranks candidates by descending total', () => {
    const g = group(
      [dim('d1', 'rating', 1)],
      [candidate('low', {}, { d1: 1 }), candidate('high', {}, { d1: 5 })],
    );
    expect(scoreGroup(g).ranking).toEqual(['high', 'low']);
  });
});

describe('scoreGroup — duration auto-scoring', () => {
  it('scores a shorter flight higher via fields.duration', () => {
    const g = group(
      [dim(DURATION_DIM_ID, 'number', 1, false)],
      [candidate('direct', { duration: '2h00m' }), candidate('layover', { duration: '5h30m' })],
    );
    const result = scoreGroup(g);
    expect(result.totals['direct']).toBeCloseTo(1);
    expect(result.totals['layover']).toBeCloseTo(120 / 330, 2);
    expect(result.ranking[0]).toBe('direct');
  });
});

import { describe, expect, it } from 'vitest';
import { ago, makeSlip, mergeRecord, slipCode, weighStatus } from './weigh-status.ts';
import type { BagWeighIn } from './weigh-in.ts';

const bag = (id: string, weightG: number, limitG = 7000): BagWeighIn => ({
  id, label: id, kind: 'suitcase', weightG, limitG,
  verdict: !limitG ? 'nolimit' : weightG > limitG ? 'over' : 'pass', diffG: limitG ? limitG - weightG : 0,
});

describe('weigh status', () => {
  it('never weighed → none (and an empty list too)', () => {
    expect(weighStatus([bag('a', 3000)], null).state).toBe('none');
    expect(weighStatus([], null).state).toBe('none');
  });

  it('weighed and unchanged → ok; over limit → over', () => {
    const rows = [bag('a', 3000), bag('b', 5000)];
    const rec = mergeRecord(null, rows, 1000);
    expect(weighStatus(rows, rec)).toMatchObject({ state: 'ok', pending: 0, over: 0, at: 1000 });
    const heavy = [bag('a', 3000), bag('b', 8000)];
    expect(weighStatus(heavy, mergeRecord(null, heavy, 1000)).state).toBe('over');
  });

  it('a bag whose weight moved, or a new bag, makes it stale', () => {
    const rec = mergeRecord(null, [bag('a', 3000)], 1000);
    expect(weighStatus([bag('a', 3400)], rec)).toMatchObject({ state: 'stale', pending: 1 });
    expect(weighStatus([bag('a', 3000), bag('b', 100)], rec)).toMatchObject({ state: 'stale', pending: 1 });
  });

  it('merging keeps earlier bags and stamps the new ones', () => {
    const rec = mergeRecord(mergeRecord(null, [bag('a', 1)], 10), [bag('b', 2)], 20);
    expect(Object.keys(rec.bags).sort()).toEqual(['a', 'b']);
    expect(rec.bags.a.at).toBe(10);
    expect(rec.bags.b.at).toBe(20);
  });

  it('ago buckets', () => {
    const now = 10_000_000;
    expect(ago(now - 20_000, now).unit).toBe('now');
    expect(ago(now - 12 * 60_000, now)).toEqual({ unit: 'min', n: 12 });
    expect(ago(now - 3 * 3_600_000, now)).toEqual({ unit: 'h', n: 3 });
    expect(ago(now - 2 * 86_400_000, now)).toEqual({ unit: 'd', n: 2 });
  });

  it('a slip totals the bags, flags overweight and has a stable code', () => {
    const s = makeSlip([bag('a', 3000), bag('b', 8000)], 5);
    expect(s.totalG).toBe(11000);
    expect(s.over).toBe(true);
    expect(slipCode(s)).toBe(slipCode(s));
    expect(slipCode(s)).toMatch(/^OTR \d{6}$/);
  });
});

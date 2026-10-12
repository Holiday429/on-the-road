import { describe, expect, it } from 'vitest';
import type { PackList } from '../../data/schema.ts';
import { weighIn, weighSummary } from './weigh-in.ts';

const list = (containers: unknown[], items: unknown[]) =>
  ({ id: 'l', name: 'x', containers, items }) as unknown as PackList;
const bag = (id: string, limitG: number, selfWeightG = 0, kind = 'suitcase') => ({ id, label: id, kind, limitG, selfWeightG });
const item = (id: string, containerId: string | null, kg: number, qty = 1) =>
  ({ id, name: id, qty, unitWeightG: kg * 1000, containerId });

describe('weighIn', () => {
  const l = list(
    [bag('big', 23000, 3800), bag('pack', 10000, 1200, 'backpack'), bag('tote', 0, 400, 'personal')],
    [item('a', 'big', 10), item('b', 'big', 8, 2), item('c', 'pack', 4), item('d', 'tote', 1), item('loose', null, 5)],
  );

  it('weight = items inside + empty bag; unassigned items are not on any bag', () => {
    const rows = weighIn(l);
    expect(rows.map((r) => r.weightG)).toEqual([29800, 5200, 1400]);
  });

  it('pass / over / nolimit per bag, with the gap to the limit', () => {
    const [big, pack, tote] = weighIn(l);
    expect(big).toMatchObject({ verdict: 'over', diffG: -6800 });
    expect(pack).toMatchObject({ verdict: 'pass', diffG: 4800 });
    expect(tote).toMatchObject({ verdict: 'nolimit', diffG: 0 });
  });

  it('exactly at the limit is a pass', () => {
    const r = weighIn(list([bag('b', 5000, 1000)], [item('x', 'b', 4)]));
    expect(r[0]).toMatchObject({ verdict: 'pass', diffG: 0, weightG: 5000 });
  });

  it('onlyId narrows to one bag', () => {
    expect(weighIn(l, 'pack').map((r) => r.id)).toEqual(['pack']);
    expect(weighIn(l, 'nope')).toEqual([]);
  });

  it('an empty list has nothing to weigh', () => {
    expect(weighIn(list([], []))).toEqual([]);
  });
});

describe('weighSummary', () => {
  it('counts each verdict', () => {
    const rows = weighIn(list([bag('a', 1000, 0), bag('b', 1000, 2000), bag('c', 0, 0)], []));
    expect(weighSummary(rows)).toEqual({ total: 3, pass: 1, over: 1, nolimit: 1 });
  });
});

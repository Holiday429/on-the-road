import { describe, expect, it } from 'vitest';
import { slipFigures } from './slip-figures.ts';

describe('slipFigures', () => {
  const existing = [
    { date: '2026-07-06', base: 100 },
    { date: '2026-07-06', base: 50 },
    { date: '2026-07-05', base: 300 },
  ];

  it('day total = that day so far + the new item; trip total = everything + the new item', () => {
    expect(slipFigures(existing, 40, '2026-07-06', null)).toMatchObject({ itemBase: 40, dayTotal: 190, tripTotal: 490, left: null });
  });

  it('left is budget minus trip total, negative once over', () => {
    expect(slipFigures(existing, 40, '2026-07-06', 1000).left).toBe(510);
    expect(slipFigures(existing, 40, '2026-07-06', 400).left).toBe(-90);
  });

  it('a first-ever expense on a day is just itself', () => {
    expect(slipFigures([], 25, '2026-07-06', null)).toMatchObject({ dayTotal: 25, tripTotal: 25 });
  });
});

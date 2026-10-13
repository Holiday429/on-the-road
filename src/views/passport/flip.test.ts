import { describe, expect, it } from 'vitest';
import { leafZ, shouldCommit, turnProgress } from './flip.ts';

describe('turnProgress', () => {
  it('grows with the drag and is clamped to a full turn', () => {
    expect(turnProgress(0, 400)).toBe(0);
    expect(turnProgress(-180, 400)).toBeCloseTo(0.5);
    expect(turnProgress(900, 400)).toBe(1);
    expect(turnProgress(10, 0)).toBe(0);
  });
});

describe('shouldCommit', () => {
  it('completes past a third of the way, or on a flick, else springs back', () => {
    expect(shouldCommit(0.5, 0)).toBe(true);
    expect(shouldCommit(0.1, 0.8)).toBe(true);
    expect(shouldCommit(0.1, 0.1)).toBe(false);
  });
});

describe('leafZ', () => {
  it('first unturned leaf is on top of the right pile, last turned leaf on top of the left', () => {
    const total = 4;
    const z = (turned: number) => [0, 1, 2, 3].map((i) => leafZ(i, turned, total));
    expect(z(0)).toEqual([4, 3, 2, 1]);
    expect(z(2)).toEqual([1, 2, 2, 1]);
    expect(z(4)).toEqual([1, 2, 3, 4]);
  });
});

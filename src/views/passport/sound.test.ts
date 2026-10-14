import { describe, expect, it } from 'vitest';
import { flipPlan } from './sound.ts';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };

describe('flipPlan', () => {
  it('is a swish that rises then falls, with fibre crackle inside it and a landing near its end', () => {
    for (let s = 1; s <= 20; s++) {
      const p = flipPlan(seeded(s));
      expect(p.dur).toBeGreaterThan(0.3);
      expect(p.dur).toBeLessThan(0.6);
      expect(p.sweep[1]).toBeGreaterThan(p.sweep[0]);
      expect(p.sweep[2]).toBeLessThan(p.sweep[1]);
      expect(p.ticks.length).toBeGreaterThanOrEqual(5);
      for (const k of p.ticks) { expect(k.at).toBeGreaterThan(0); expect(k.at).toBeLessThan(p.dur); expect(k.gain).toBeLessThan(0.05); }
      expect(p.land).toBeGreaterThan(p.dur * 0.8);
      expect(p.land).toBeLessThan(p.dur);
    }
  });

  it('is not the same twice', () => {
    expect(flipPlan(seeded(1))).not.toEqual(flipPlan(seeded(2)));
  });
});

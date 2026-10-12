import { describe, expect, it } from 'vitest';
import { flingDistance, pickArrival } from './world-motion.ts';
import type { StampSpec } from '../../../core/paper/stamp.ts';

describe('flingDistance', () => {
  const drag = (speedDegPerMs: number, ms = 100, end = 1000) =>
    Array.from({ length: 6 }, (_, i) => ({ t: end - ms + (i * ms) / 5, x: i * ((speedDegPerMs * ms) / 5) }));

  it('keeps turning in the direction of a quick flick', () => {
    expect(flingDistance(drag(0.2), 1000)).toBeGreaterThan(20);
    expect(flingDistance(drag(-0.2), 1000)).toBeLessThan(-20);
  });
  it('travels further for a faster flick, but never more than a third of a turn', () => {
    expect(flingDistance(drag(0.3), 1000)).toBeGreaterThan(flingDistance(drag(0.1), 1000));
    expect(flingDistance(drag(5), 1000)).toBe(120);
    expect(flingDistance(drag(-5), 1000)).toBe(-120);
  });
  it('stops dead after a slow drag or a pause before release', () => {
    expect(flingDistance(drag(0.001), 1000)).toBe(0);
    expect(flingDistance(drag(0.3), 1200)).toBe(0);      // released 200 ms after the last move
  });
  it('needs at least two readings', () => {
    expect(flingDistance([], 1000)).toBe(0);
    expect(flingDistance([{ t: 990, x: 5 }], 1000)).toBe(0);
  });
  it('ignores readings from earlier in the drag', () => {
    const slowThenStill = [{ t: 0, x: 0 }, { t: 100, x: 80 }, { t: 900, x: 80 }, { t: 1000, x: 80 }];
    expect(flingDistance(slowThenStill, 1000)).toBe(0);
  });
});

describe('pickArrival', () => {
  const stamp = (id: string, kind: 'country' | 'city', iso: string, date: string, earned = true): StampSpec => ({
    id, kind, city: 'X', country: iso, iso, date, nights: 1, shape: 'entry', rotation: 0, ink: 'rgb(0,0,0)', earned,
  });
  const all = [
    stamp('country:DK', 'country', 'DK', '2026-06-01'),
    stamp('city:1', 'city', 'DK', '2026-06-01'),
    stamp('country:DE', 'country', 'DE', '2026-06-05'),
    stamp('country:IT', 'country', 'IT', '2026-12-01', false),
  ];
  it('welcomes the most recently entered new country', () => {
    expect(pickArrival(all, ['country:DK', 'country:DE'])!.iso).toBe('DE');
  });
  it('skips countries already seen, unearned ones, and city stamps', () => {
    expect(pickArrival(all, ['country:DK'])!.iso).toBe('DK');
    expect(pickArrival(all, ['country:IT'])).toBeNull();     // not earned yet
    expect(pickArrival(all, ['city:1'])).toBeNull();          // a city stamp is not an arrival
    expect(pickArrival(all, [])).toBeNull();
  });
});

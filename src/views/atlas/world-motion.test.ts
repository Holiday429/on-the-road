import { describe, expect, it } from 'vitest';
import { flingDistance } from './world-motion.ts';

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

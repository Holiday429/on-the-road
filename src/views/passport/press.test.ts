import { describe, expect, it } from 'vitest';
import { FULL_PRESS_MS, pressureFor } from './press.ts';

describe('pressureFor', () => {
  it('a tap is light, a long hold is full, in between grows with the hold', () => {
    expect(pressureFor(0)).toBe(0.3);
    expect(pressureFor(100)).toBe(0.3);
    expect(pressureFor(FULL_PRESS_MS / 2)).toBe(0.5);
    expect(pressureFor(FULL_PRESS_MS)).toBe(1);
    expect(pressureFor(60_000)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { isSafePath, signaturePath, SIG_H, SIG_W, type Pt } from './signature.ts';

const wave = (n: number): Pt[] => Array.from({ length: n }, (_, i) => [i * 3, 40 + Math.sin(i / 5) * 25] as Pt);

describe('signaturePath', () => {
  it('nothing drawn, nothing stored', () => {
    expect(signaturePath([])).toBe('');
    expect(signaturePath([[]])).toBe('');
  });

  it('fits the 300 × 100 box whatever size it was drawn at', () => {
    for (const scale of [0.2, 1, 7]) {
      const d = signaturePath([wave(200).map(([x, y]) => [x * scale + 900, y * scale - 50] as Pt)]);
      const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(SIG_W);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(SIG_H);
    }
  });

  it('stays short however long the scribble, and keeps each stroke', () => {
    const d = signaturePath([wave(5000), wave(5000).map(([x, y]) => [x, y + 3] as Pt)]);
    expect(d.length).toBeLessThanOrEqual(4000);
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it('a single tap is a dot', () => {
    expect(signaturePath([[[10, 10]]])).toMatch(/^M[\d. ]+l\.1 0$/);
  });

  it('what it makes is safe to paint', () => {
    expect(isSafePath(signaturePath([wave(80)]))).toBe(true);
  });
});

describe('isSafePath', () => {
  it('rejects anything that is not plain path data', () => {
    expect(isSafePath('M0 0L10 10')).toBe(true);
    expect(isSafePath('M0 0"><script>')).toBe(false);
    expect(isSafePath('M0 0'.repeat(2000))).toBe(false);
  });
});

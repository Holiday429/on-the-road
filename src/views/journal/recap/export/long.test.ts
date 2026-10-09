import { describe, it, expect } from 'vitest';
import { COLUMNS, LONG_W, MAX_PIXELS, planLong } from './long.ts';

describe('planLong', () => {
  it('lays cards out three to a row with even gaps, head and foot around them', () => {
    const p = planLong(9);
    expect(p.width).toBe(LONG_W);
    expect(COLUMNS).toBe(3);
    expect(p.cardRects).toHaveLength(9);
    expect(p.rows).toBe(3);

    // Three distinct columns and three distinct rows.
    expect(new Set(p.cardRects.map((r) => r.x)).size).toBe(3);
    expect(new Set(p.cardRects.map((r) => r.y)).size).toBe(3);
    // Same step between columns and between rows.
    const xs = [...new Set(p.cardRects.map((r) => r.x))];
    expect(xs[1] - xs[0]).toBe(xs[2] - xs[1]);
    expect(p.cardRects[0].y).toBe(p.headerH);
    expect(p.footerTop).toBeGreaterThan(p.cardRects[8].y + p.cardH);
    expect(p.height).toBeGreaterThan(p.footerTop);
  });

  it('keeps cards inside the canvas and 3:4', () => {
    const p = planLong(9);
    for (const r of p.cardRects) {
      expect(r.x).toBeGreaterThan(0);
      expect(r.x + p.cardW).toBeLessThan(p.width);
    }
    expect(p.cardH).toBe(Math.round((p.cardW * 4) / 3));
  });

  it('makes a full deck a poster shape, between 2:3 and 9:16', () => {
    const p = planLong(9);
    const ratio = p.height / p.width;
    expect(ratio).toBeGreaterThanOrEqual(1.5);
    expect(ratio).toBeLessThanOrEqual(16 / 9);
  });

  it('centres a short last row', () => {
    const p = planLong(8);                       // 3 + 3 + 2
    const last = p.cardRects.slice(6);
    expect(last).toHaveLength(2);
    const left = last[0].x;
    const right = p.width - (last[1].x + p.cardW);
    expect(left).toBeCloseTo(right, 5);
    expect(left).toBeGreaterThan(p.cardRects[0].x);

    const one = planLong(7).cardRects[6];        // 3 + 3 + 1
    expect(one.x + p.cardW / 2).toBeCloseTo(p.width / 2, 5);
  });

  it('stays inside the canvas-area limit for a full deck without shrinking', () => {
    const p = planLong(9);
    expect(p.width * p.height).toBeLessThan(MAX_PIXELS);
    expect(p.scale).toBe(1);
  });

  it('shrinks an unusually long deck to stay inside the limit', () => {
    const p = planLong(90);
    expect(p.scale).toBeLessThan(1);
    expect(p.width * p.scale * (p.height * p.scale)).toBeLessThanOrEqual(MAX_PIXELS * 1.001);
  });

  it('is shorter for fewer cards, and a row holds three', () => {
    expect(planLong(3).height).toBeLessThan(planLong(9).height);
    expect(planLong(3).rows).toBe(1);
    expect(planLong(4).rows).toBe(2);
  });

  it('handles a single card', () => {
    const p = planLong(1);
    expect(p.cardRects).toHaveLength(1);
    expect(p.height).toBeGreaterThan(p.footerTop);
  });
});

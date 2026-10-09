import { describe, it, expect } from 'vitest';
import { SITE_URL, displayUrl, drawQr, qrMatrix } from './qr.ts';

describe('QR', () => {
  it('points at the whole site, not one portrait', () => {
    expect(SITE_URL).toBe('https://easy-on-the-road.vercel.app/');
  });

  it('prints the address without scheme or trailing slash', () => {
    expect(displayUrl()).toBe('easy-on-the-road.vercel.app');
    expect(displayUrl('http://a.b/')).toBe('a.b');
  });

  it('builds a square matrix with the three finder patterns in the corners', () => {
    const m = qrMatrix(SITE_URL);
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    // Each finder pattern is a 7x7 ring with a solid 3x3 centre.
    const n = m.length;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      expect(m[r][c]).toBe(true);
      expect(m[r + 3][c + 3]).toBe(true);
      expect(m[r + 1][c + 1]).toBe(false);
    }
  });

  it('is deterministic', () => {
    expect(qrMatrix(SITE_URL)).toEqual(qrMatrix(SITE_URL));
  });

  it('draws a white tile with a quiet zone, then only dark modules', () => {
    const rects: Array<[number, number, number, number, string]> = [];
    let fill = '';
    const ctx = {
      set fillStyle(v: string) { fill = v; },
      get fillStyle() { return fill; },
      fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h, fill]),
    } as unknown as CanvasRenderingContext2D;

    drawQr(ctx, SITE_URL, 100, 200, 260, '#1c1917');
    expect(rects[0]).toEqual([100, 200, 260, 260, '#ffffff']);
    const dark = rects.slice(1);
    expect(dark.length).toBe(qrMatrix(SITE_URL).flat().filter(Boolean).length);
    // Nothing is drawn inside the 2-module quiet zone.
    const cell = 260 / (qrMatrix(SITE_URL).length + 4);
    expect(dark.every(([x, y]) => x >= 100 + cell * 2 - 0.01 && y >= 200 + cell * 2 - 0.01)).toBe(true);
    expect(dark.every((r) => r[4] === '#1c1917')).toBe(true);
  });
});

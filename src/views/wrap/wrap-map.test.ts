import { describe, expect, it } from 'vitest';
import { sketchRoute, sketchSvg, unwrapLng, SKETCH_H, SKETCH_W } from './wrap-map.ts';

const stop = (city: string, lat: number, lng: number, legId = city) => ({ legId, city, lat, lng });

describe('sketchRoute', () => {
  const sk = sketchRoute([stop('Copenhagen', 55.7, 12.6), stop('Berlin', 52.5, 13.4), stop('Lisbon', 38.7, -9.1)]);

  it('keeps every point inside the frame', () => {
    for (const p of sk.points) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(SKETCH_W);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(SKETCH_H);
    }
  });
  it('north is up and east is right', () => {
    const [cph, ber, lis] = sk.points;
    expect(cph.y).toBeLessThan(ber.y);
    expect(lis.y).toBeGreaterThan(ber.y);
    expect(lis.x).toBeLessThan(cph.x);
  });
  it('draws a curve through the stops in order', () => {
    expect(sk.path.startsWith('M')).toBe(true);
    expect((sk.path.match(/Q/g) ?? []).length).toBe(2);
  });
  it('marks only the first visit to a city for labelling', () => {
    const again = sketchRoute([stop('A', 10, 10), stop('B', 20, 20), stop('A', 10, 10, 'a2')]);
    expect(again.points.map((p) => p.first)).toEqual([true, true, false]);
  });
  it('a single place sits in the middle with no path', () => {
    const one = sketchRoute([stop('A', 10, 10), stop('A', 10, 10, 'a2')]);
    expect(one.path).toBe('');
    expect(one.points[0]).toMatchObject({ x: SKETCH_W / 2, y: SKETCH_H / 2 });
  });
  it('nothing in, nothing out', () => {
    expect(sketchRoute([])).toMatchObject({ points: [], path: '' });
    expect(sketchSvg(sketchRoute([]), 'x')).toBe('');
  });
});

describe('unwrapLng', () => {
  it('keeps a route across the date line in one piece', () => {
    expect(unwrapLng([170, -170])).toEqual([170, 190]);
    expect(unwrapLng([10, 20])).toEqual([10, 20]);
  });
});

describe('sketchSvg', () => {
  it('escapes city names and the label', () => {
    const svg = sketchSvg(sketchRoute([stop('<b>X</b>', 1, 1), stop('Y', 2, 2)]), 'a"b');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;');
    expect(svg).toContain('aria-label="a&quot;b"');
  });
});

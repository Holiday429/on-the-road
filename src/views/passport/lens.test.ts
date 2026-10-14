import { describe, expect, it } from 'vitest';
import { lensMapSvg, placeLabels } from './lens.ts';

const SHAPES = { IT: 'M1 1L2 1L2 2Z', FR: 'M0 0L1 0L1 1Z', DE: 'M3 3L4 3L4 4Z' };

describe('lensMapSvg', () => {
  it('outlines the visited countries in the accent layer and the rest as faint land', () => {
    const svg = lensMapSvg(['IT'], SHAPES);
    const lit = svg.slice(svg.indexOf('pp-lens-lit'), svg.indexOf('<g class="pp-dot is-lit">'));
    expect(lit).toContain('d="M1 1L2 1L2 2Z"');
    expect(lit).not.toContain('M0 0L1 0L1 1Z');
    const land = svg.slice(svg.indexOf('pp-lens-land'), svg.indexOf('<g class="pp-dot">'));
    expect(land).toContain('M0 0L1 0L1 1Z');
    expect(land).toContain('M3 3L4 3L4 4Z');
    expect(land).not.toContain('M1 1L2 1L2 2Z');
  });

  it('shows the dots alone while the outlines have not loaded', () => {
    const svg = lensMapSvg(['IT'], null);
    expect(svg).not.toContain('<path');
    expect(svg).toContain('pp-dot is-lit');
  });

  it('ignores a country it has no outline for', () => {
    expect(() => lensMapSvg(['ZZ', ''], SHAPES)).not.toThrow();
    expect(lensMapSvg(['ZZ'], SHAPES)).not.toContain('pp-lens-lit"><path');
  });

  it('shares the dotted map\'s own viewBox, so the two line up', () => {
    expect(lensMapSvg([], null)).toContain('viewBox="0 0 384 152"');
  });
});

describe('placeLabels', () => {
  // [x, y, width] in grid units
  const CENTRES = { FR: [48, 10, 3.4], DE: [52, 9, 2.8], BE: [49.2, 8.9, 1], NL: [49.6, 8.6, 1.1], IT: [51, 11, 3] } as const;
  const name = (iso: string) => ({ FR: 'France', DE: 'Germany', BE: 'Belgium', NL: 'Netherlands', IT: 'Italy' }[iso] ?? iso);

  it('writes each visited country\'s name at the middle of it, as a share of the map', () => {
    const [l] = placeLabels(['FR'], CENTRES, name, 2688, 1064);
    expect(l.name).toBe('France');
    expect(l.left).toBeCloseTo((48 / 96) * 100, 3);
    expect(l.top).toBeCloseTo(((10 * 2688) / 96 / 1064) * 100, 3);
  });

  it('skips a country that was not visited or has no place', () => {
    expect(placeLabels(['ZZ'], CENTRES, name, 2688, 1064)).toEqual([]);
    expect(placeLabels([], CENTRES, name, 2688, 1064)).toEqual([]);
  });

  it('when two names would overlap, the bigger country keeps its name', () => {
    const out = placeLabels(['BE', 'NL', 'FR'], CENTRES, name, 2688, 1064);
    expect(out.map((l) => l.iso)).toContain('FR');
    expect(out.filter((l) => l.iso !== 'FR')).toHaveLength(out.length - 1);
    const close = placeLabels(['BE', 'NL'], CENTRES, name, 2688, 1064);
    expect(close.map((l) => l.iso)).toEqual(['NL']);        // NL is the wider of the two; BE sits on top of it
  });

  it('the same country twice is named once', () => {
    expect(placeLabels(['FR', 'FR'], CENTRES, name, 2688, 1064)).toHaveLength(1);
  });
});

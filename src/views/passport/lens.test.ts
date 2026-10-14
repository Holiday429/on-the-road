import { describe, expect, it } from 'vitest';
import { lensMapSvg } from './lens.ts';

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

import { describe, expect, it } from 'vitest';
import { dotMapSvg, litCells } from './dot-map.ts';

describe('dotted world', () => {
  it('lights the cells of a visited country', () => {
    expect(litCells(['FR', 'ES']).size).toBeGreaterThan(2);
    expect(litCells([]).size).toBe(0);
  });

  it('a country too small for a cell of its own is still lit, by the nearest land', () => {
    expect(litCells(['BE']).size).toBeGreaterThanOrEqual(1);
    expect(litCells(['SG']).size).toBeGreaterThanOrEqual(1);
  });

  it('an unknown code lights nothing', () => {
    expect(litCells(['ZZ', '']).size).toBe(0);
  });

  it('draws land dim and visited countries lit, as inline SVG', () => {
    const svg = dotMapSvg(['IT']);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('class="pp-dot is-lit"');
    expect((svg.match(/<circle/g) ?? []).length).toBeGreaterThan(500);
  });
});

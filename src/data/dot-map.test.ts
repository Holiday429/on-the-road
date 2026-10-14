import { describe, expect, it } from 'vitest';
import { DOT_COLS, DOT_ROWS, dotMapSvg, isoNear, litCells } from './dot-map.ts';

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

  describe('isoNear', () => {
    const at = (lat: number, lng: number) => [(lng + 180) / 3.75, (84 - lat) / 3.75] as const;

    it('names the country at a point of the map, and nothing for open sea', () => {
      expect(isoNear(...at(46, 2))).toBe('FR');
      expect(isoNear(...at(40, -3.5))).toBe('ES');
      expect(isoNear(...at(-40, -140))).toBe('');         // the South Pacific
      expect(isoNear(0, 0)).toBe('');                       // the far corner, outside the land
      expect(DOT_COLS).toBeGreaterThan(0);
      expect(DOT_ROWS).toBeGreaterThan(0);
    });

    it('lets a visited country win a near tie over its neighbour', () => {
      // On the German–Danish border: ask for each in turn.
      const p = at(54, 9.5);
      const plain = isoNear(...p);
      expect(['DE', 'DK']).toContain(plain);
      expect(isoNear(p[0], p[1], new Set(['DK']))).toBe('DK');
      expect(isoNear(p[0], p[1], new Set(['DE']))).toBe('DE');
    });
  });
});

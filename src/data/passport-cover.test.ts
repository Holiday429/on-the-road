import { describe, expect, it } from 'vitest';
import { COVER_SWATCHES, DEFAULT_COVER, coverStyle, coverVars, normalizeCover, sameCover } from './passport-cover.ts';

describe('normalizeCover', () => {
  it('starts everybody on the same neutral cover, and repairs whatever was stored', () => {
    expect(normalizeCover(null)).toEqual(DEFAULT_COVER);
    expect(normalizeCover({ color: 'red', material: 'gold' as never, foil: 'neon' as never, emblem: 'flag' as never, title: 5 as never })).toEqual(DEFAULT_COVER);
  });

  it('keeps a valid choice, lower-cases the colour, trims and caps the title', () => {
    const c = normalizeCover({ color: '#6B2733', material: 'leather', foil: 'silver', emblem: 'route', title: `  ${'X'.repeat(40)}  ` });
    expect(c).toMatchObject({ color: '#6b2733', material: 'leather', foil: 'silver', emblem: 'route' });
    expect(c.title).toHaveLength(22);
  });

  it('offers no national emblem and a spread of colours', () => {
    expect(new Set(COVER_SWATCHES.map((s) => s.color)).size).toBe(COVER_SWATCHES.length);
    expect(COVER_SWATCHES.length).toBeGreaterThanOrEqual(8);
  });
});

describe('coverVars', () => {
  it('paints the cloth, the foil and the texture, and nothing else', () => {
    const v = coverVars(normalizeCover({ color: '#28402f', material: 'vinyl', foil: 'blind' }));
    expect(Object.keys(v).sort()).toEqual(['--pp-cloth', '--pp-cloth-2', '--pp-foil-edge', '--pp-gold', '--pp-texture']);
    expect(v['--pp-cloth']).toBe('#28402f');
    expect(coverStyle(DEFAULT_COVER)).toContain('--pp-cloth:#34465e');
  });

  it('sameCover compares every choice', () => {
    expect(sameCover(DEFAULT_COVER, { ...DEFAULT_COVER })).toBe(true);
    expect(sameCover(DEFAULT_COVER, { ...DEFAULT_COVER, foil: 'white' })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { fastenerFor, hashKey, renderFastener, renderFastenerFor } from './fastener.ts';

describe('fastenerFor', () => {
  it('gives the same id the same fastener every time', () => {
    expect(fastenerFor('entry-7')).toBe(fastenerFor('entry-7'));
  });

  it('varies across ids rather than giving everything tape', () => {
    const kinds = new Set(Array.from({ length: 40 }, (_, i) => fastenerFor(`entry-${i}`)));
    expect(kinds.size).toBeGreaterThan(2);
  });

  it('survives an empty id', () => {
    expect(() => fastenerFor('')).not.toThrow();
    expect(hashKey('')).toBe(0);
  });
});

describe('renderFastener', () => {
  it('marks itself decorative, so a screen reader skips the hardware', () => {
    expect(renderFastener('tape')).toContain('aria-hidden="true"');
  });

  it('draws the wire kinds as SVG and the tape kinds in CSS alone', () => {
    for (const kind of ['safety', 'clip', 'bulldog'] as const) {
      expect(renderFastener(kind), kind).toContain('<svg');
    }
    for (const kind of ['tape', 'corner', 'pin'] as const) {
      expect(renderFastener(kind), kind).not.toContain('<svg');
    }
  });

  it('passes placement through as custom properties, and omits the style when it has none', () => {
    const styled = renderFastener('tape', { at: 0.25, tilt: -3, colour: 'var(--sky-500)' });
    expect(styled).toContain('--fst-at:25%');
    expect(styled).toContain('--fst-tilt:-3deg');
    expect(styled).toContain('--fst-colour:var(--sky-500)');
    expect(renderFastener('tape')).not.toContain('style=');
  });

  it('only ever uses colour tokens, never a literal hex', () => {
    const all = Array.from({ length: 30 }, (_, i) => renderFastenerFor(`e${i}`)).join('');
    expect(all).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});

describe('renderFastenerFor', () => {
  it('is stable for an id, and keeps an explicit override', () => {
    expect(renderFastenerFor('abc')).toBe(renderFastenerFor('abc'));
    expect(renderFastenerFor('abc', { colour: 'var(--sage-500)' })).toContain('--fst-colour:var(--sage-500)');
  });
});

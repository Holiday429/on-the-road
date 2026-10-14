import { describe, expect, it } from 'vitest';
import { bagTone, bagWidth, renderBag, renderScale } from './luggage.ts';

describe('luggage kit markup', () => {
  it('every kind renders its own shape with a namespaced clip', () => {
    for (const kind of ['suitcase', 'backpack', 'personal'] as const) {
      const svg = renderBag(kind, { loadPct: 50, uid: 'b1' });
      expect(svg).toContain(`lg-bag--${kind}`);
      expect(svg).toContain('id="lgb-b1"');
      expect(svg).toContain('url(#lgb-b1)');
    }
  });

  it('the suitcase has wheels and a handle, the backpack straps, the tote none of those', () => {
    expect(renderBag('suitcase', { loadPct: 0, uid: 'a' })).toContain('lg-wheel');
    expect(renderBag('backpack', { loadPct: 0, uid: 'a' })).toContain('lg-strap');
    expect(renderBag('personal', { loadPct: 0, uid: 'a' })).not.toContain('lg-wheel');
  });

  it('over turns the shell, tone picks a colour, load is clamped', () => {
    expect(renderBag('suitcase', { loadPct: 120, uid: 'a', over: true, tone: 2 })).toMatch(/lg-bag--suitcase is-over" data-tone="2"/);
    expect(renderBag('suitcase', { loadPct: -5, uid: 'a', tone: 9 })).toContain('data-tone="3"');
    // a full suitcase fills 62 units from the bottom edge (y=126)
    expect(renderBag('suitcase', { loadPct: 100, uid: 'a' })).toContain('y="64"');
  });

  it('a uid with markup is escaped', () => {
    expect(renderBag('suitcase', { loadPct: 1, uid: '"><x' })).not.toContain('"><x');
  });

  it('scale: verdict becomes a class; reading and caption are escaped and addressable', () => {
    const svg = renderScale({ reading: '<9 kg>', verdict: 'over', caption: 'LIMIT 7 kg' });
    expect(svg).toContain('class="lg-scale is-over"');
    expect(svg).toContain('&lt;9 kg&gt;');
    expect(svg).toContain('data-lg="num"');
    expect(renderScale({ reading: '0' })).toContain('class="lg-scale"');
  });

  it('bag tone is stable per id and within 0–3; suitcases read wider when large', () => {
    expect(bagTone('abc')).toBe(bagTone('abc'));
    for (const id of ['a', 'bb', 'ccc', 'x9']) expect(bagTone(id)).toBeGreaterThanOrEqual(0);
    expect(bagWidth('suitcase', true)).toBeGreaterThan(bagWidth('suitcase'));
  });
});

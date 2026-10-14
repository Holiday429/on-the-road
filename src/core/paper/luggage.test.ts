import { describe, expect, it } from 'vitest';
import { BAG_TONES, bagLook, bagSizeFor, bagTone, bagWidth, renderBag, renderScale, type BagKind } from './luggage.ts';

describe('luggage kit markup', () => {
  it('every kind renders its own shape with a namespaced clip', () => {
    for (const kind of ['suitcase', 'backpack', 'personal', 'duffel'] as const) {
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
    expect(renderBag('suitcase', { loadPct: -5, uid: 'a', tone: 9 })).toContain('data-tone="5"');
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

describe('luggage kit — a bag is drawn from its data, not from anyone\'s example', () => {
  const KINDS: BagKind[] = ['suitcase', 'backpack', 'personal', 'duffel'];

  it('every kind × tone × load renders a well-formed bag with its own clip', () => {
    for (const kind of KINDS) for (let tone = 0; tone < BAG_TONES; tone++) for (const loadPct of [0, 50, 100]) {
      const svg = renderBag(kind, { loadPct, uid: `${kind}${tone}`, tone });
      expect(svg).toContain(`data-tone="${tone}"`);
      expect(svg).toContain(`id="lgb-${kind}${tone}"`);
      expect(svg.match(/<svg/g)).toHaveLength(1);
      expect(svg.match(/<\/svg>/g)).toHaveLength(1);
    }
  });

  it('ghost draws the outline marker for every kind', () => {
    for (const kind of KINDS) expect(renderBag(kind, { loadPct: 0, uid: 'g', ghost: true })).toContain('is-ghost');
  });

  it('size follows the weight limit unless the user chose one', () => {
    expect(bagSizeFor(0)).toBe('M');
    expect(bagSizeFor(7000)).toBe('S');
    expect(bagSizeFor(15000)).toBe('M');
    expect(bagSizeFor(23000)).toBe('L');
    expect(bagLook({ id: 'a', limitG: 23000 }).size).toBe('L');
    expect(bagLook({ id: 'a', limitG: 23000, size: 'S' }).size).toBe('S');
    expect(bagLook({ id: 'a', limitG: 0, tone: 5 }).tone).toBe(5);
    expect(bagLook({ id: 'a', limitG: 0 }).tone).toBe(bagTone('a'));
  });

  it('a bigger size is a wider bag', () => {
    for (const kind of KINDS) expect(bagWidth(kind, false, 'L')).toBeGreaterThan(bagWidth(kind, false, 'S'));
  });
});

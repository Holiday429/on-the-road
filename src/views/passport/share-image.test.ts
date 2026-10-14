/**
 * @vitest-environment jsdom
 *
 * The picture is tested against a recording fake of the canvas context — no canvas, no browser. What matters
 * is WHAT is drawn and WHERE it goes, not pixels.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SHARE_STAMPS, SHARE_H, SHARE_W, drawPassportShare, stampSlots, type ShareInput } from './share-image.ts';
import { stampsForImage } from './share.ts';
import type { PassportStamp } from '../../data/passport.ts';

interface Rec { texts: string[]; images: number; arcs: number; multiplied: number }

function fakeCtx(): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { texts: [], images: 0, arcs: 0, multiplied: 0 };
  const state: Record<string, unknown> = { font: '400 20px sans-serif' };
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop in state) return state[prop];
      switch (prop) {
        case 'measureText': return (text: string) => ({ width: [...text].length * 30 });
        case 'fillText': return (text: string) => { rec.texts.push(text); };
        case 'drawImage': return () => { rec.images += 1; if (state.globalCompositeOperation === 'multiply') rec.multiplied += 1; };
        case 'arc': return () => { rec.arcs += 1; };
        default: return () => {};
      }
    },
    set(_t, prop: string, value) { state[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

const words = {
  title: 'Passport', issued: 'Issued', countries: 'Countries', cities: 'Cities', nights: 'Nights', trips: 'Trips',
  visited: 'Places you have been', more: '', invite: 'Make your own passport',
};
const input = (over: Partial<ShareInput> = {}): ShareInput => ({
  nickname: 'Holiday', passportNo: '1655033', issued: '2026-06-25', level: 'Wanderer',
  stats: { countries: 9, cities: 15, nights: 73, trips: 1 }, words, isos: ['ES', 'FR'],
  stamps: [{ image: {} as CanvasImageSource, rotation: 4 }, { image: {} as CanvasImageSource, rotation: -6 }],
  logo: null, url: 'https://example.test/', ...over,
});

describe('stampSlots', () => {
  it('rows of up to four, never more than eight, each inside the page', () => {
    expect(stampSlots(0)).toEqual([]);
    expect(stampSlots(3)).toHaveLength(3);
    expect(stampSlots(30)).toHaveLength(MAX_SHARE_STAMPS);
    for (const n of [1, 4, 5, 8]) for (const s of stampSlots(n)) {
      expect(s.cx - s.size / 2).toBeGreaterThanOrEqual(0);
      expect(s.cx + s.size / 2).toBeLessThanOrEqual(SHARE_W);
      expect(s.cy + s.size / 2).toBeLessThanOrEqual(SHARE_H);
    }
  });

  it('a lone stamp sits in the middle; a second row sits below the first', () => {
    const [one] = stampSlots(1);
    expect(Math.abs(one.cx - SHARE_W / 2)).toBeLessThan(12);
    const two = stampSlots(8);
    expect(two[4].cy).toBeGreaterThan(two[0].cy + 100);
  });
});

describe('drawPassportShare', () => {
  it('writes the name, number, issue date, title and all four totals', () => {
    const { ctx, rec } = fakeCtx();
    drawPassportShare(ctx, input());
    const text = rec.texts.join('\n');
    for (const want of ['PASSPORT', 'N° 1655033', 'Holiday', 'Issued 2026-06-25', 'Wanderer', '9', '15', '73', '1', 'COUNTRIES', 'Make your own passport']) {
      expect(text).toContain(want);
    }
  });

  it('draws the dotted world, with the lit countries as their own dots', () => {
    const { ctx, rec } = fakeCtx();
    drawPassportShare(ctx, input());
    expect(rec.arcs).toBeGreaterThan(500);
  });

  it('presses each stamp it was given, as ink (multiply), and leaves out one that could not be drawn', () => {
    const { ctx, rec } = fakeCtx();
    drawPassportShare(ctx, input({ stamps: [{ image: {} as CanvasImageSource, rotation: 0 }, { image: null, rotation: 0 }, { image: {} as CanvasImageSource, rotation: 3 }] }));
    expect(rec.images).toBe(2);
    expect(rec.multiplied).toBe(2);
  });

  it('says how many stamps did not fit, only when some did not', () => {
    const none = fakeCtx(); drawPassportShare(none.ctx, input());
    expect(none.rec.texts.join('\n')).not.toContain('more');
    const some = fakeCtx(); drawPassportShare(some.ctx, input({ words: { ...words, more: '…and 4 more' } }));
    expect(some.rec.texts).toContain('…and 4 more');
  });

  it('a very long name still gets drawn, and the logo only when there is one', () => {
    const { ctx, rec } = fakeCtx();
    drawPassportShare(ctx, input({ nickname: 'A'.repeat(60) }));
    expect(rec.texts).toContain('A'.repeat(60));
    const withLogo = fakeCtx();
    drawPassportShare(withLogo.ctx, input({ logo: {} as HTMLImageElement }));
    expect(withLogo.rec.images).toBe(rec.images + 1);
  });
});

describe('stampsForImage', () => {
  const stamp = (id: string, date: string) => ({ id, date }) as PassportStamp;
  it('shows the latest eight, oldest first, and counts the rest', () => {
    const pressed = Array.from({ length: 11 }, (_, i) => stamp(`s${i}`, `2026-01-${String(i + 1).padStart(2, '0')}`)).reverse();
    const { shown, extra } = stampsForImage(pressed);
    expect(extra).toBe(3);
    expect(shown.map((s) => s.id)).toEqual(['s3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']);
  });

  it('a short passport is shown whole', () => {
    expect(stampsForImage([stamp('a', '2026-02-01'), stamp('b', '2026-01-01')])).toEqual({ shown: [stamp('b', '2026-01-01'), stamp('a', '2026-02-01')], extra: 0 });
  });
});

/**
 * @vitest-environment jsdom
 *
 * The picture is tested against a recording fake of the canvas context — no canvas, no browser. What matters
 * is WHAT is drawn and WHERE it goes, not pixels.
 */
import { describe, expect, it } from 'vitest';
import { SHARE_H, SHARE_W, drawPassportShare, pageBox, shareHeight, stampGrid, stampSlots, type ShareInput } from './share-image.ts';
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
        case 'createLinearGradient': return () => ({ addColorStop: () => {} });
        default: return () => {};
      }
    },
    set(_t, prop: string, value) { state[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

const words = {
  title: 'Passport', issued: 'Date of issue', countries: 'Countries', cities: 'Cities', nights: 'Nights', trips: 'Trips',
  visited: 'Places you have been', more: '', invite: 'Make your own passport',
  nickname: 'Nickname', nationality: 'Nationality', level: 'Travel level', stamps: 'Stamps',
};
const input = (over: Partial<ShareInput> = {}): ShareInput => ({
  nickname: 'Holiday', passportNo: '1655033', issued: '2026-06-25', level: 'Wanderer', nationalityLabel: 'China',
  mrz: ['P<OTRHOLIDAY<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<', '1655033<CN260625<<TRAVELLER<<<<<<<<<<<<<<<<<'],
  stats: { countries: 9, cities: 15, nights: 73, trips: 1 }, words, isos: ['ES', 'FR'],
  stamps: [{ image: {} as CanvasImageSource, rotation: 4 }, { image: {} as CanvasImageSource, rotation: -6 }],
  logo: null, url: 'https://example.test/', ...over,
});

describe('stampSlots', () => {
  it('every stamp gets a slot, however many there are — none is dropped', () => {
    expect(stampSlots(0)).toEqual([]);
    for (const n of [1, 3, 8, 9, 17, 40, 95]) expect(stampSlots(n)).toHaveLength(n);
  });

  it('each stamp stays on the right-hand page, inside the picture', () => {
    const page = pageBox(1);
    for (const n of [1, 4, 5, 8, 13, 26, 60, 120]) {
      for (const s of stampSlots(n)) {
        expect(s.cx - s.size / 2).toBeGreaterThanOrEqual(page.x - 1);
        expect(s.cx + s.size / 2).toBeLessThanOrEqual(page.x + page.w + 1);
        expect(s.cy - s.size / 2).toBeGreaterThanOrEqual(page.y);
        expect(s.cy + s.size / 2).toBeLessThanOrEqual(page.y + page.h);
        expect(s.cx + s.size / 2).toBeLessThanOrEqual(SHARE_W);
        expect(s.cy + s.size / 2).toBeLessThanOrEqual(SHARE_H);
      }
    }
  });

  it('the stamps page is the right half of the book, the data page the left', () => {
    expect(pageBox(0).x + pageBox(0).w).toBeLessThan(pageBox(1).x);
    expect(pageBox(1).x).toBeGreaterThan(SHARE_W / 2 - 20);
  });

  it('a fuller passport means smaller stamps and a wider grid — never a taller picture', () => {
    expect(stampGrid(8).size).toBeGreaterThan(stampGrid(40).size);
    expect(stampGrid(8).cols).toBeLessThanOrEqual(stampGrid(40).cols);
    expect(stampGrid(40).size).toBeGreaterThan(40);
    expect(shareHeight(0)).toBe(SHARE_H);
    expect(shareHeight(200)).toBe(SHARE_H);
  });

  it('the picture is a landscape spread, like an open passport', () => {
    expect(SHARE_W).toBeGreaterThan(SHARE_H);
    expect(SHARE_W / SHARE_H).toBeGreaterThan(1.3);
  });
});

describe('drawPassportShare', () => {
  it('writes the name, number, issue date, title and all four totals', () => {
    const { ctx, rec } = fakeCtx();
    drawPassportShare(ctx, input());
    const text = rec.texts.join('\n');
    for (const want of ['PASSPORT', 'N° 1655033', 'Holiday', '2026-06-25', 'WANDERER', 'CHINA', '9', '15', '73', '1', 'COUNTRIES', 'Make your own passport']) {
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

  it('presses every stamp it is given, however many — a shared passport shows them all', () => {
    const many = Array.from({ length: 37 }, (_, i) => ({ image: {} as CanvasImageSource, rotation: i }));
    const { ctx, rec } = fakeCtx();
    drawPassportShare(ctx, input({ stamps: many }));
    expect(rec.images).toBe(37);
    expect(rec.multiplied).toBe(37);
  });

  it('carries no legal name, document number or birth date — only the nickname, the made-up serial and the decoration lines', () => {
    const { ctx, rec } = fakeCtx();
    drawPassportShare(ctx, input());
    const text = rec.texts.join('\n');
    expect(text).not.toMatch(/Xiao|E12345678|1992/);
    expect(text).toContain('P<OTRHOLIDAY');
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
  it('keeps every stamp, oldest first — none is left out of the picture', () => {
    const pressed = Array.from({ length: 11 }, (_, i) => stamp(`s${i}`, `2026-01-${String(i + 1).padStart(2, '0')}`)).reverse();
    const { shown, extra } = stampsForImage(pressed);
    expect(extra).toBe(0);
    expect(shown).toHaveLength(11);
    expect(shown.map((s) => s.id)).toEqual(Array.from({ length: 11 }, (_, i) => `s${i}`));
  });

  it('a short passport is shown whole', () => {
    expect(stampsForImage([stamp('a', '2026-02-01'), stamp('b', '2026-01-01')])).toEqual({ shown: [stamp('b', '2026-01-01'), stamp('a', '2026-02-01')], extra: 0 });
  });
});

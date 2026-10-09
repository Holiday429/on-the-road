/**
 * @vitest-environment jsdom
 *
 * Drawing is tested against a recording fake of the canvas context — no canvas,
 * no browser. What matters is not pixels but WHAT gets drawn: the export must
 * only ever put public wording on an image that leaves the app.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setLocale } from '../../../../core/i18n.ts';
import { buildDeck } from '../render.ts';
import { CARD_H, CARD_W, drawCardBack, type DrawInput } from './draw.ts';
import { europeEn, europeZh, flagged, signalsOnly } from '../preview/fixture.ts';

beforeEach(() => setLocale('zh'));

interface Recorded { texts: string[]; ops: number; fills: string[]; }

/** A context that records what is drawn. Text is `size/2` px per UTF-16 unit wide. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; rec: Recorded } {
  const rec: Recorded = { texts: [], ops: 0, fills: [] };
  const state: Record<string, unknown> = { font: '400 20px sans-serif' };
  const sizeOf = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 20);
  const noop = () => { rec.ops += 1; };

  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop in state) return state[prop];
      switch (prop) {
        case 'measureText': return (text: string) => ({ width: [...text].length * sizeOf() * 0.55 });
        case 'fillText': return (text: string) => { rec.texts.push(text); rec.ops += 1; };
        case 'createLinearGradient': return () => ({ addColorStop: noop });
        case 'fillRect': return () => { rec.fills.push(String(state.fillStyle)); rec.ops += 1; };
        default: return noop;
      }
    },
    set(_t, prop: string, value) { state[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

function paint(recap: typeof europeZh, index: number, page = index + 1, total = 9) {
  const deck = buildDeck(recap);
  const { ctx, rec } = fakeCtx();
  const card = deck[index];
  const key = card.kind === 'chapter' ? card.chapter.id : card.kind;
  drawCardBack(ctx, { card, key, page, total } satisfies DrawInput);
  return { text: rec.texts.join('\n'), rec };
}

describe('every card can be drawn', () => {
  it('draws all nine without throwing, and draws something on each', () => {
    for (let i = 0; i < 9; i += 1) expect(paint(europeZh, i).rec.ops).toBeGreaterThan(20);
  });

  it('draws the numbers-only deck', () => {
    expect(paint(signalsOnly, 0, 1, 1).text).toContain('53 / 74');
  });

  it('draws a card with no radar fourth axis gracefully', () => {
    const three = { ...europeZh, traits: europeZh.traits.slice(0, 3) };
    expect(buildDeck(three).some((c) => c.kind === 'traits')).toBe(false);
  });
});

describe('only public wording is drawn', () => {
  it('draws the public text of a chapter, never the private reading', () => {
    for (let i = 2; i <= 7; i += 1) {
      const chapter = (buildDeck(europeZh)[i] as { chapter: typeof europeZh.chapters[0] }).chapter;
      const { text } = paint(europeZh, i);
      const pub = chapter.bodyPublic.replace(/\*\*/g, '');
      const priv = chapter.body.replace(/\*\*/g, '');
      // The public text is on the image. A run from the END of the private reading
      // is not — its opening can legitimately match the public text's, so compare
      // the part only the private version has.
      expect(text.replace(/\n/g, '')).toContain(pub.slice(0, 8));
      expect(text.replace(/\n/g, '')).not.toContain(priv.slice(-14));
    }
  });

  it('never draws the emphasis marker', () => {
    for (let i = 0; i < 9; i += 1) expect(paint(europeZh, i).text).not.toContain('*');
  });

  it('draws what a flagged card says when the owner chose to share it', () => {
    expect(paint(flagged, 4).text.replace(/\n/g, '')).toContain('伴侣');
  });
});

describe('frame', () => {
  it('writes the topic question atop and the position at the bottom', () => {
    const { text } = paint(europeZh, 3, 4, 9);
    expect(text).toContain('你怎么得出结论');
    expect(text).toContain('METHOD');
    expect(text).toContain('4/9');
    expect(text).toContain('On the Road');
    expect(text).toContain('04');
  });

  it('numbers by the position given, so a chosen subset reads 1…n', () => {
    // Card 7 of the deck, exported as the 2nd of 3.
    expect(paint(europeZh, 6, 2, 3).text).toContain('2/3');
    expect(paint(europeZh, 6, 2, 3).text).not.toContain('7/9');
  });

  it('draws at the size the share image is', () => {
    expect([CARD_W, CARD_H]).toEqual([1080, 1440]);
  });
});

describe('cards', () => {
  it('draws the archetype and every figure on the cover', () => {
    const { text } = paint(europeZh, 0);
    expect(text).toContain('系统的旁观者');
    for (const v of ['53 / 74', '23', '22,044', '287', '1,987', '29%']) expect(text).toContain(v);
    expect(text).toContain('记录天数');
  });

  it('draws all four traits with their scores and notes', () => {
    const { text } = paint(europeZh, 1);
    for (const t of europeZh.traits) { expect(text).toContain(t.key); expect(text).toContain(String(t.score)); }
  });

  it('draws the one-liner and all three questions on the closing card', () => {
    const { text } = paint(europeZh, 8).text.replace(/\n/g, '') ? paint(europeZh, 8) : { text: '' };
    const flat = text.replace(/\n/g, '');
    expect(flat).toContain('旅行者');
    for (const q of europeZh.questions) expect(flat).toContain(q.slice(0, 10));
  });

  it('draws English content too', () => {
    setLocale('en');
    const { text } = paint(europeEn, 0);
    expect(text).toContain('System Watcher');
    expect(text).toContain('Based on 82 notes');
  });
});

describe('text that does not fit', () => {
  it('truncates with an ellipsis instead of drawing past the base bar', () => {
    const long = { ...europeZh, chapters: europeZh.chapters.map((c, i) => (i === 0 ? { ...c, bodyPublic: '字'.repeat(900) } : c)) };
    const { text } = paint(long, 2);
    expect(text).toContain('…');
  });
});

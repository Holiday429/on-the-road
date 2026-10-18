/* ==========================================================================
   On the Road · Journal letter — the numbers behind the scene (pure)
   --------------------------------------------------------------------------
   An entry is read as a letter with postcards: the words on the paper, each
   photo a card beside it. Everything here is arithmetic and string-making, so
   it can be tested without a DOM: which of the two card sizes a photo gets,
   how the pile of cards is fanned, how the date line reads, and the small
   stable "randomness" (lean, offset) that comes from the entry id and never
   from Math.random(), so a re-render never reshuffles the desk.

   Markup: scenes/letter.ts, scenes/postcard.ts.  Styles: styles/letter.css.
   ========================================================================== */

import { hashId } from '../scenes/feed-plan.ts';
import { orientationOf } from './photo-ratio.ts';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** How far a taped-down photo leans, in degrees — small, alternating, and stable per photo. */
export function photoLean(key: string, index: number): number {
  const h = hashId(`${key}:${index}`);
  const size = 1.2 + (h % 180) / 100;          // 1.2° – 3.0°
  return index % 2 === 0 ? -size : size;
}

/** The date as a rubber stamp prints it: day, month, year on three lines. */
export function stampParts(iso: string): { day: string; month: string; year: string } {
  const [y, m, d] = iso.split('-');
  const mi = Number(m) - 1;
  return { day: d ?? '', month: mi >= 0 && mi < 12 ? MONTHS[mi] : (m ?? ''), year: y ?? '' };
}

/* ── Postcards ───────────────────────────────────────────────────────────── */

/**
 * Which postcard is on top of the pile, which are turned over, and whether the
 * pile has been spread out into a column. One entry's worth: reset when
 * another is opened.
 */
export interface CardFocus { entryId: string; picked: number; flipped: number[]; spread?: boolean }

/** A card's lean in the pile: 2°–5°, alternating sides, fixed by entry id + position. */
export function postcardTilt(key: string, index: number): number {
  const size = 2 + (hashId(`${key}#${index}`) % 300) / 100;      // 2.0° – 4.99°
  return Math.round(size * 10) / 10 * (index % 2 === 0 ? -1 : 1);
}

export interface CardFrame {
  /** Width ÷ height of the card's picture area: always LANDSCAPE or PORTRAIT. */
  ratio: number;
  orientation: 'landscape' | 'portrait';
}

/**
 * A postcard comes in two sizes, one wide and one tall, like the real thing.
 * Photos that are not exactly that shape are cropped to it (centred); the whole
 * photograph is in the Gallery. Wide = 3:2, tall = 2:3, so the common 4:3 / 3:2 /
 * 16:9 and 3:4 / 2:3 photos lose little or a modest slice.
 */
export const LANDSCAPE_RATIO = 3 / 2;
export const PORTRAIT_RATIO = 2 / 3;

/** Which of the two sizes a photo gets. Square, and a photo not measured yet, are wide. */
export function postcardFrame(measured: number | undefined): CardFrame {
  const tall = typeof measured === 'number' && Number.isFinite(measured) && measured > 0 && orientationOf(measured) === 'portrait';
  return tall ? { ratio: PORTRAIT_RATIO, orientation: 'portrait' } : { ratio: LANDSCAPE_RATIO, orientation: 'landscape' };
}

/** White margin around the picture, px. */
export const CARD_BORDER = 12;
/** Outer width of each size, px. */
const CARD_W = { landscape: 340, portrait: 240 } as const;

/** Outer width of a card, px. */
export function cardWidth(frame: CardFrame): number {
  return CARD_W[frame.orientation];
}

export interface PileCard {
  /** Outer size, px. */
  w: number;
  h: number;
  /** Position inside the pile, px from its top-left. */
  top: number;
  left: number;
  tilt: number;
  frame: CardFrame;
}

export interface Pile {
  width: number;
  height: number;
  cards: PileCard[];
}

/** The pile is a column this wide; cards sit in it, nudged left and right. */
export const PILE_WIDTH = 400;
/** The pile never grows taller than this, however many cards: they fan more tightly instead. */
const PILE_MAX_HEIGHT = 1180;
/**
 * The least of a card that must stay uncovered, as a share of its height.
 *
 * Cards used to be stacked a fixed 76px apart, which left only the top third of
 * a 239px card showing — and the top of a photograph is sky, not its subject.
 * The step is now a share of the card under it, so most of every picture is
 * there to be seen without touching anything, and the pile grows downwards
 * instead of hiding its contents.
 */
const MIN_SHOWN = 0.62;
const PILE_MIN_STEP = 28;

/**
 * Fan `ratios` (one per photo) into a pile: each card sits low enough on the one
 * before that most of that one is still visible, and is nudged to alternate
 * sides. Size is wide or tall by the photo's orientation; nothing is random.
 *
 * `spread` lays the same cards out in a plain column with a small gap — every
 * photograph wholly visible, nothing overlapping — for the "spread them out"
 * toggle in the letter.
 */
export function pilePlan(key: string, ratios: Array<number | undefined>, spread = false): Pile {
  const frames = ratios.map(postcardFrame);
  const sizes = frames.map((f) => {
    const w = cardWidth(f);
    return { w, h: Math.round((w - 2 * CARD_BORDER) / f.ratio + 2 * CARD_BORDER) };
  });

  // Each card's own top, from the heights of the ones above it: a card may only
  // cover the top (1 - MIN_SHOWN) of the card it lands on, never more.
  const tops: number[] = [];
  let y = 0;
  sizes.forEach((size, i) => {
    tops.push(Math.round(y));
    const gap = spread ? size.h + 18 : Math.max(PILE_MIN_STEP, Math.round(size.h * MIN_SHOWN));
    y += gap;
    if (i === sizes.length - 1) y = Math.round(y - gap + size.h);
  });

  // However many cards there are, the fanned pile is kept within reach: if it
  // runs past PILE_MAX_HEIGHT the steps are squeezed evenly rather than each
  // card being cut by a different amount.
  const full = Math.max(0, ...tops.map((top, i) => top + sizes[i].h));
  const squeeze = !spread && full > PILE_MAX_HEIGHT && tops.length > 1
    ? (PILE_MAX_HEIGHT - sizes[sizes.length - 1].h) / Math.max(1, tops[tops.length - 1])
    : 1;

  const cards = frames.map((frame, i): PileCard => {
    const { w, h } = sizes[i];
    // Spread out, the cards line up; fanned, they lean and sit off to either side.
    const nudge = spread ? 0 : (4 + (hashId(`${key}>${i}`) % 22)) * (i % 2 === 0 ? -1 : 1);   // 4 – 25px
    const left = Math.round((PILE_WIDTH - w) / 2 + nudge);
    return {
      w, h,
      top: Math.round(tops[i] * squeeze),
      left: Math.max(0, Math.min(PILE_WIDTH - w, left)),
      tilt: spread ? 0 : postcardTilt(key, i),
      frame,
    };
  });
  return { width: PILE_WIDTH, height: Math.max(0, ...cards.map((c) => c.top + c.h)), cards };
}

/* ── The letter ──────────────────────────────────────────────────────────── */

/**
 * Whether the entry has a letter. Photos with no words are just postcards; a
 * title alone with photos is the envelope's address line, not a page. An entry
 * with nothing at all still gets a (blank) page rather than an empty desk.
 */
export function hasLetter(entry: { body: string; images?: string[]; coverImage?: string }): boolean {
  if (entry.body.trim()) return true;
  return !(entry.images?.length || entry.coverImage);
}

/** The line written on the envelope: the title, else the opening of the body, else the place. */
export function envelopeTitle(entry: { title: string; body: string; destination: string }, max = 36): string {
  const pick = entry.title.trim()
    || entry.body.trim().split(/\r?\n/)[0].trim()
    || entry.destination.trim();
  return pick.length > max ? `${pick.slice(0, max - 1).trimEnd()}…` : pick;
}

const SEP: Record<string, string> = { zh: '，', ja: '、' };

/** What goes between the date and the place on the dateline. */
export function datelineSep(locale: string): string {
  return SEP[locale] ?? ', ';
}

/** "2026年9月6日，Copenhagen" / "6 September 2026, Copenhagen" — the line at the top right of the page. */
export function letterDate(iso: string, place: string, locale = 'en'): string {
  const [y, m, d] = iso.split('-').map(Number);
  const when = new Date(y, (m || 1) - 1, d || 1);
  let date = iso;
  if (y && m && d && !Number.isNaN(when.getTime())) {
    try {
      date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(when);
    } catch { /* unknown locale: keep the ISO date */ }
  }
  const where = place.trim();
  return where ? `${date}${datelineSep(locale)}${where}` : date;
}

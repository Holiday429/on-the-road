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

/** Which postcard is on top of the pile and which are turned over. One entry's worth: reset when another is opened. */
export interface CardFocus { entryId: string; picked: number; flipped: number[] }

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
const PILE_MAX_HEIGHT = 680;
const PILE_MIN_STEP = 18;
const PILE_MAX_STEP = 76;

/**
 * Fan `ratios` (one per photo) into a pile: each card a step lower than the one
 * before and nudged to alternate sides, so the corner of every card stays within
 * reach of a click. Size is wide or tall by the photo's orientation; nothing is random.
 */
export function pilePlan(key: string, ratios: Array<number | undefined>): Pile {
  const frames = ratios.map(postcardFrame);
  const sizes = frames.map((f) => {
    const w = cardWidth(f);
    return { w, h: Math.round((w - 2 * CARD_BORDER) / f.ratio + 2 * CARD_BORDER) };
  });
  const tallest = Math.max(0, ...sizes.map((s) => s.h));
  const step = frames.length > 1
    ? Math.min(PILE_MAX_STEP, Math.max(PILE_MIN_STEP, Math.floor((PILE_MAX_HEIGHT - tallest) / (frames.length - 1))))
    : 0;

  const cards = frames.map((frame, i): PileCard => {
    const { w, h } = sizes[i];
    const nudge = (4 + (hashId(`${key}>${i}`) % 22)) * (i % 2 === 0 ? -1 : 1);   // 4 – 25px
    const left = Math.round((PILE_WIDTH - w) / 2 + nudge);
    return { w, h, top: i * step, left: Math.max(0, Math.min(PILE_WIDTH - w, left)), tilt: postcardTilt(key, i), frame };
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
  return where ? `${date}${SEP[locale] ?? ', '}${where}` : date;
}

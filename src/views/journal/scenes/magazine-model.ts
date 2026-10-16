/* ==========================================================================
   On the Road · Journal magazine — what the book is made of (pure)
   --------------------------------------------------------------------------
   An album opens as a magazine. This file holds the vocabulary the rest shares:
   the fixed page (600 × 800 — everything is laid out in these units and scaled
   to the screen afterwards, so the pagination is the same on every device), the
   article an entry becomes, and the order the physical leaves are bound in:

       cover (alone, on the right)
       contents | first article page
       page | page … (articles run on continuously)
       (colophon, when it is needed to make the last spread whole) | back cover

   The back cover is always a right-hand page with a page facing it, as on a real
   magazine, so the last spread is never half empty.

   Page numbers are folios: the cover is page 1, the first contents page 2, and
   so on; the contents list is written after the articles have been paginated,
   which is why it can quote true page numbers.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { entryImages } from '../shared/utils.ts';
import { orientationOf, ratioValue, snapRatio, type Orientation, type RatioClass } from '../shared/photo-ratio.ts';
import { stampParts } from '../shared/letter-model.ts';

/** A page, in layout units (CSS px before scaling). A spread is two of these. */
export const PAGE_W = 600;
export const PAGE_H = 800;
/** White margins, outer / inner (gutter side) / top / bottom. */
export const MARGIN = { outer: 48, inner: 56, top: 56, bottom: 64 } as const;
/** The area text and photos may use. The same size on every page; only its x offset depends on the side. */
export const BODY_W = PAGE_W - MARGIN.outer - MARGIN.inner;     // 496
export const BODY_H = PAGE_H - MARGIN.top - MARGIN.bottom;      // 680

/** Where the body box sits on a page: the gutter side has the wider margin. */
export function bodyLeft(side: 'verso' | 'recto'): number {
  return side === 'verso' ? MARGIN.outer : MARGIN.inner;
}

export interface PhotoRef {
  src: string;
  ratio: RatioClass;
  orient: Orientation;
}

export interface Article {
  id: string;
  /** "06 SEP · COPENHAGEN" */
  kicker: string;
  headline: string;
  mood?: string;
  paragraphs: string[];
  photos: PhotoRef[];
  /** Under each photograph: "Brussels · 14 JUL 2026". */
  caption: string;
  /** A sentence worth setting large, taken from the text — or null when none suits. */
  quote: string | null;
}

/** The line above a headline: the day and the place. */
export function kickerOf(entry: Pick<StoredJournalEntry, 'happenedOn' | 'destination'>): string {
  const { day, month } = stampParts(entry.happenedOn);
  const where = entry.destination.trim();
  return `${day} ${month}${where ? ` · ${where}` : ''}`.toUpperCase();
}

/** The line under a photograph: the place and the day. */
export function captionOf(entry: Pick<StoredJournalEntry, 'happenedOn' | 'destination'>): string {
  const { day, month, year } = stampParts(entry.happenedOn);
  const when = `${day} ${month} ${year}`;
  const where = entry.destination.trim();
  return where ? `${where} · ${when}` : when;
}

/** Sentence-ending marks, Chinese and Latin. */
const SENTENCE_END = /(?<=[。！？!?]|\.(?=\s))/;
export const QUOTE_MIN = 20;
export const QUOTE_MAX = 60;

/** Every opening quote or bracket has its closing one — a pulled line must not begin or end inside a quotation. */
function balanced(s: string): boolean {
  const count = (c: string) => s.split(c).length - 1;
  return count('“') === count('”') && count('「') === count('」') && count('（') === count('）') && count('(') === count(')') && count('"') % 2 === 0;
}

/**
 * A line to pull out and set large: a whole sentence of 20–60 characters ending in
 * a full stop, question or exclamation mark, from the middle of the piece rather
 * than its opening (the opening is already on the page). The sentence nearest the
 * middle of the text wins, so the same article always pulls the same line.
 */
export function pickQuote(paragraphs: string[]): string | null {
  const text = paragraphs.join('\n');
  if (text.length < 400) return null;
  const sentences: Array<{ s: string; at: number }> = [];
  let at = 0;
  for (const para of paragraphs) {
    let offset = 0;
    for (const piece of para.split(SENTENCE_END)) {
      const s = piece.trim();
      if (s.length >= QUOTE_MIN && s.length <= QUOTE_MAX && /[。！？!?.]$/.test(s) && balanced(s) && at + offset > text.length * 0.2) {
        sentences.push({ s, at: at + offset });
      }
      offset += piece.length;
    }
    at += para.length + 1;
  }
  if (!sentences.length) return null;
  const mid = text.length * 0.45;
  return sentences.reduce((best, c) => (Math.abs(c.at - mid) < Math.abs(best.at - mid) ? c : best)).s;
}

/** The headline: the title, else the opening line of the body, else the place. (Not titleFor: that splits on spaces, and Chinese has none.) */
export function headlineOf(entry: Pick<StoredJournalEntry, 'title' | 'body' | 'destination'>, max = 30): string {
  const pick = entry.title.trim()
    || entry.body.trim().split(/\r?\n/)[0].trim()
    || entry.destination.trim()
    || 'Untitled';
  return pick.length > max ? `${pick.slice(0, max - 1).trimEnd()}…` : pick;
}

/** Width ÷ height assumed for a photo that has not been measured: wide, the common case. */
const UNMEASURED = 3 / 2;

/**
 * One entry as an article. `ratios` is each photo's measured width ÷ height
 * (shared/ratio-cache), undefined where it has not been.
 */
export function toArticle(entry: StoredJournalEntry, ratios: Array<number | undefined>): Article {
  const photos = entryImages(entry).map((src, i): PhotoRef => {
    const r = ratios[i] && ratios[i]! > 0 ? ratios[i]! : UNMEASURED;
    return { src, ratio: snapRatio(r), orient: orientationOf(r) };
  });
  const paragraphs = entry.body.split(/\r?\n+/).map((p) => p.trim()).filter(Boolean);
  return {
    id: entry.id,
    kicker: kickerOf(entry),
    headline: headlineOf(entry),
    mood: entry.mood,
    paragraphs,
    photos,
    caption: captionOf(entry),
    quote: pickQuote(paragraphs),
  };
}

/** The article's words as one string, paragraphs separated by a newline. Pages cut it by character. */
export function articleText(a: Pick<Article, 'paragraphs'>): string {
  return a.paragraphs.join('\n');
}

/** The exact width ÷ height a photo is laid out at. */
export function photoRatio(p: PhotoRef): number {
  return ratioValue(p.ratio);
}

/* ── Binding ─────────────────────────────────────────────────────────────── */

/** How many articles one contents page lists. */
export const TOC_PER_PAGE = 12;

export function tocPageCount(articles: number): number {
  return Math.max(1, Math.ceil(articles / TOC_PER_PAGE));
}

export type Leaf =
  | { kind: 'cover' }
  | { kind: 'toc'; part: number }
  | { kind: 'page'; page: number }
  | { kind: 'colophon' }
  | { kind: 'back' };

/**
 * The leaves of the book in binding order: cover, contents, article pages, back cover.
 * The back cover must land on a right-hand page (an even index, the cover being 0), so
 * when the pages before it would leave it on the left, the inside back cover — a
 * colophon — is bound in to face it.
 */
export function bindLeaves(pageCount: number, articleCount: number): Leaf[] {
  const leaves: Leaf[] = [{ kind: 'cover' }];
  for (let part = 0; part < tocPageCount(articleCount); part++) leaves.push({ kind: 'toc', part });
  for (let page = 0; page < pageCount; page++) leaves.push({ kind: 'page', page });
  if (leaves.length % 2 === 1) leaves.push({ kind: 'colophon' });
  leaves.push({ kind: 'back' });
  return leaves;
}

/** The folio (printed page number) of the leaf at `index`: the cover is page 1. */
export const folioOf = (index: number): number => index + 1;

/** Which side of a spread a leaf sits on. The cover is a right-hand page, then they alternate. */
export function sideOf(index: number): 'verso' | 'recto' {
  return index % 2 === 0 ? 'recto' : 'verso';
}

/** Leaf indices of each spread. */
export type SpreadIdx = [number | null, number | null];

/**
 * The spreads a reader turns through, as leaf indices. The cover is alone on the
 * right; after it the leaves are paired verso | recto, and because the back cover
 * is bound onto a right-hand page (see bindLeaves) the last spread is whole.
 */
export function spreadIdx(leafCount: number): SpreadIdx[] {
  if (leafCount <= 0) return [];
  const out: SpreadIdx[] = [[null, 0]];
  for (let i = 1; i < leafCount; i += 2) out.push([i, i + 1 < leafCount ? i + 1 : null]);
  return out;
}

/** The spread a leaf is in. */
export function spreadIndexOf(leafIndex: number, leafCount: number): number {
  const at = spreadIdx(leafCount).findIndex(([l, r]) => l === leafIndex || r === leafIndex);
  return Math.max(0, at);
}

export type ViewMode = 'spread' | 'single';

/**
 * Where ‹ › goes from leaf `at`. Two pages showing: a whole spread at a time,
 * landing on its first leaf. One page showing (a phone): one leaf at a time.
 * Clamped to the book.
 */
export function turnTo(at: number, delta: 1 | -1, leafCount: number, mode: ViewMode): number {
  if (leafCount <= 0) return 0;
  if (mode === 'single') return Math.max(0, Math.min(leafCount - 1, at + delta));
  const spreads = spreadIdx(leafCount);
  const target = Math.max(0, Math.min(spreads.length - 1, spreadIndexOf(at, leafCount) + delta));
  const [l, r] = spreads[target];
  return l ?? r ?? 0;
}

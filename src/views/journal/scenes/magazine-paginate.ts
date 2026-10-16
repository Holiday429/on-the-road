/* ==========================================================================
   On the Road · Journal magazine — paginating (pure)
   --------------------------------------------------------------------------
   Articles in, pages out. The one thing that needs a browser — "how many
   characters of this fit in a box that size?" — is behind the `Measurer`
   interface, so everything else (which template, where the photos go, where a
   line is allowed to break, what the contents page quotes) is plain code with a
   fake measurer under test.

   An article starts on a new page. Its first page is an opener, chosen by the
   shape of its first photo. After that the words run on, page after page, and
   the remaining photographs are set between them: picture pages and word pages
   alternate (album-layout.ts's two rules), and every photograph is placed —
   if the words run out first, picture pages finish the job. Nothing is cut off
   and nothing needs opening to read.
   ========================================================================== */

import { articleText, BODY_H, tocPageCount, type Article, type PhotoRef } from './magazine-model.ts';
import { openerFor, TEMPLATES, type Box, type CaptionSlot, type TemplateId } from './magazine-templates.ts';
import { pickLayout } from './album-layout.ts';

export interface FrameSpec {
  w: number;
  h: number;
  cols: 1 | 2;
  /** A very short note, set larger. */
  lead?: boolean;
}

/** What only the browser can tell us. */
export interface Measurer {
  /** How many characters from the start of `text` fit in a frame like this. */
  fit(text: string, frame: FrameSpec): number;
  /** The height of the kicker + headline when set `w` wide. */
  head(a: { kicker: string; headline: string }, w: number, size: 'm' | 'l'): number;
  /** The height of a pulled quotation when set `w` wide. */
  quote(text: string, w: number): number;
}

export interface PlacedPhoto extends Box { photo: PhotoRef; bleed?: boolean }
export interface PlacedFrame extends Box {
  cols: 1 | 2;
  /** Character range of the article's text, [from, to). */
  from: number;
  to: number;
  lead: boolean;
}
export interface PlacedHead extends Box { size: 'm' | 'l' }

export interface Page {
  articleId: string;
  template: TemplateId;
  /** First page of its article. */
  first: boolean;
  photos: PlacedPhoto[];
  /** Under each photograph (or group of them): the place and the day. */
  captions: CaptionSlot[];
  head?: PlacedHead;
  frames: PlacedFrame[];
  /** A pulled sentence of the article, set between the frames. */
  quote?: Box;
  /** A dark page whose picture is all there is. */
  plate?: boolean;
  /** The words go on over the page. */
  continues: boolean;
}

/* ── Where a line may end ────────────────────────────────────────────────── */

/** Punctuation that must not start a line (or a page). */
const NO_START = new Set('，。、；：？！）】」』”’》〉…·,.;:?!)]}%'.split(''));
/** Punctuation that must not end one. */
const NO_END = new Set('（【「『“‘《〈([{'.split(''));
const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9À-ɏ]/.test(c);

/** Fewer characters than this left over for the next page are pulled back so it is not a stray line or two. */
export const TAIL_MIN = 36;

/**
 * Move a cut so it falls somewhere a typesetter would put it.
 *
 * `cut` is how many characters of `text` fit. It is moved back (never forward,
 * so it always still fits) off punctuation that cannot start a line, away from
 * the middle of a Latin word, and — when `guardTail` — so that the next page
 * gets at least TAIL_MIN characters rather than a one-line widow.
 */
export function adjustCut(text: string, cut: number, guardTail: boolean): number {
  const len = text.length;
  if (cut >= len) return len;
  let c = Math.max(1, cut);

  const settle = () => {
    // Latin: do not split a word, if there is a space to fall back to within a short way.
    if (isWordChar(text[c - 1]) && isWordChar(text[c])) {
      const sp = text.lastIndexOf(' ', c - 1);
      if (sp > 0 && c - sp <= 24) c = sp + 1;
    }
    // Kinsoku: nothing that cannot start a line starts one; nothing that cannot end one ends one.
    while (c > 1 && (NO_START.has(text[c]) || NO_END.has(text[c - 1]))) c--;
  };

  settle();
  if (guardTail && len - c < TAIL_MIN && len - c > 0) {
    c = Math.max(1, len - TAIL_MIN);
    settle();
  }
  return c;
}

/* ── One article ─────────────────────────────────────────────────────────── */

/** Skip the newline(s) a cut may have stopped in front of. */
function skipBreaks(text: string, at: number): number {
  while (text[at] === '\n') at++;
  return at;
}

/** The ids of the templates that can follow words with pictures still to place, in the order they are offered. */
/** A note shorter than this, with no picture, is set large. */
export const SHORT_NOTE = 420;

const OFFERED: TemplateId[] = ['photo-pair', 'photo-side-text', 'grid', 'full-bleed', 'text-2col', 'pull-quote'];

/** Flow `text` from `pos` through a page's frames. Returns the frames placed and the new position. */
function flow(text: string, pos: number, slots: Array<Box & { cols: 1 | 2; lead?: boolean }>, m: Measurer): { frames: PlacedFrame[]; pos: number } {
  const frames: PlacedFrame[] = [];
  slots.forEach((slot, i) => {
    if (pos >= text.length) return;
    const rest = text.slice(pos);
    const lead = !!slot.lead;
    let n = m.fit(rest, { w: slot.w, h: slot.h, cols: slot.cols, lead });
    const lastFrame = i === slots.length - 1;
    if (n < rest.length) n = adjustCut(rest, n, lastFrame);
    else n = rest.length;
    if (n <= 0) return;
    frames.push({ x: slot.x, y: slot.y, w: slot.w, h: slot.h, cols: slot.cols, from: pos, to: pos + n, lead });
    pos = skipBreaks(text, pos + n);
  });
  return { frames, pos };
}

/**
 * Paginate one article. It always begins on a page of its own: two notes never
 * share a page, however much of the last one was left empty.
 */
export function paginateArticle(article: Article, m: Measurer, albumId = ''): Page[] {
  const text = articleText(article);
  const photos = [...article.photos];
  const pages: Page[] = [];
  let pos = 0;
  let prev: TemplateId | null = null;
  let quoteUsed = false;
  const shortNote = !photos.length && text.length < SHORT_NOTE;

  for (let guard = 0; guard < 400; guard++) {
    const first = pages.length === 0;
    const textRemains = pos < text.length;

    let tpl;
    if (first) tpl = openerFor(photos[0]);
    else {
      const canQuote = !!article.quote && !quoteUsed && text.length - pos > 700;
      const options = OFFERED.filter((id) => {
        if (id === 'pull-quote') return canQuote;
        if (!photos.length && TEMPLATES[id].pictureLed) return false;
        return TEMPLATES[id].applies(photos, textRemains);
      });
      if (!options.length) options.push('photo-pair');
      tpl = TEMPLATES[pickLayout(options, prev, (id) => TEMPLATES[id].pictureLed, albumId + article.id, pages.length)];
    }
    if (tpl.id === 'pull-quote') quoteUsed = true;

    const took = photos.splice(0, tpl.take(photos, textRemains));
    const geo = tpl.layout({
      photos: took, textRemains, shortNote,
      parity: (pages.length % 2) as 0 | 1,
      headHeight: (w, size) => m.head(article, w, size),
      quoteHeight: (w) => (article.quote ? m.quote(article.quote, w) : 0),
    });

    const placed = flow(text, pos, geo.frames, m);
    pos = placed.pos;
    const frames = placed.frames;

    // A page that placed nothing would never end. (A frame too small for one character: print it anyway.)
    if (!took.length && !frames.length && !geo.head && pos < text.length) {
      const slot = geo.frames[0] ?? { x: 0, y: 0, w: 496, h: BODY_H, cols: 1 as const };
      frames.push({ x: slot.x, y: slot.y, w: slot.w, h: slot.h, cols: slot.cols, from: pos, to: pos + 1, lead: false });
      pos = skipBreaks(text, pos + 1);
    }

    pages.push({
      articleId: article.id, template: tpl.id, first,
      photos: took.map((photo, i) => ({ ...geo.photos[i], photo })),
      captions: geo.captions, head: geo.head, frames, quote: geo.quote, plate: geo.plate,
      continues: pos < text.length,
    });
    prev = tpl.id;
    if (pos >= text.length && !photos.length) break;
  }
  return pages;
}

/* ── The whole book ──────────────────────────────────────────────────────── */

export interface Paginated {
  pages: Page[];
  /** Index (into `pages`) of each article's first page, in article order. */
  firstPage: number[];
}

export function paginateBook(articles: Article[], m: Measurer, albumId = ''): Paginated {
  const pages: Page[] = [];
  const firstPage: number[] = [];
  for (const a of articles) {
    firstPage.push(pages.length);
    pages.push(...paginateArticle(a, m, albumId));
  }
  return { pages, firstPage };
}

/** One line of the contents page. */
export interface TocRow { articleId: string; kicker: string; headline: string; folio: number }

/**
 * The contents, written after the articles are paginated so it can quote true
 * page numbers. The cover is page 1, the contents pages follow, then the first
 * article page: folio = 1 + contents pages + index + 1.
 */
export function contentsOf(articles: Article[], firstPage: number[]): TocRow[] {
  const offset = 1 + tocPageCount(articles.length);
  return articles.map((a, i) => ({ articleId: a.id, kicker: a.kicker, headline: a.headline, folio: offset + firstPage[i] + 1 }));
}

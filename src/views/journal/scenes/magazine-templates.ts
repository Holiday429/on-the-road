/* ==========================================================================
   On the Road · Journal magazine — page templates (pure)
   --------------------------------------------------------------------------
   A template says where the photographs and the words go on a 496 × 680 body
   box. Two rules do most of the work:

     · A photo SLOT fixes only a width. Its height is the photo's own
       (width ÷ its shape), so a landscape stays landscape and a portrait stays
       portrait: no photo is ever cut into another orientation. (A page cap on
       height can trim a picture a few percent; that is as far as cropping goes.
       Where a page cannot give a picture its height — four tall portraits — the
       template sets them in a row, not cropped into squares.)
     · A text FRAME is whatever the photos, the heading and the captions leave.

   The heading's and the quotation's heights depend on their words, which only
   the browser can say, so a template asks for them (`headHeight`,
   `quoteHeight`) rather than assuming.

   Nine page shapes — the five that open or fill an article:
     opener-land · opener-port · opener-text · text-2col · photo-pair
   and the four that give the book its pace:
     photo-side-text   a tall picture takes a column, the words the other
     full-bleed        one wide picture across the whole page, a caption, nothing else
     grid              three or four of one orientation, set above the words
     pull-quote        a sentence from the piece, set large between two blocks of text

   An article always begins on a page of its own — two notes never share a page.
   Pictures with no words left to set are laid out together as rows (`justify`),
   as many as fill the page well, so the end of an article is not a lone small
   photograph on a blank page.
   ========================================================================== */

import { BODY_H, BODY_W, PAGE_W, photoRatio, type PhotoRef } from './magazine-model.ts';

export type TemplateId =
  | 'opener-land' | 'opener-port' | 'opener-text' | 'text-2col' | 'photo-pair'
  | 'photo-side-text' | 'full-bleed' | 'grid' | 'pull-quote';

export interface Box { x: number; y: number; w: number; h: number }
/** `bleed`: x and w are page coordinates (0–600), not body coordinates — it runs to the edges. */
export interface PhotoBox extends Box { bleed?: boolean }
export interface FrameSlot extends Box { cols: 1 | 2; lead?: boolean }
export interface HeadSlot extends Box { size: 'm' | 'l' }
/** A caption line: where it sits and how wide. */
export interface CaptionSlot { x: number; y: number; w: number }

export interface Geometry {
  photos: PhotoBox[];
  head?: HeadSlot;
  captions: CaptionSlot[];
  /** In reading order. */
  frames: FrameSlot[];
  /** A pulled sentence, set between two frames. */
  quote?: Box;
  /** The page is a dark plate: the picture is all there is. */
  plate?: boolean;
}

export interface TemplateCtx {
  /** The photos this page takes (see `take`). */
  photos: PhotoRef[];
  /** Height of the heading when set at `w` px wide, in the given size. */
  headHeight: (w: number, size: 'm' | 'l') => number;
  /** Height of the pulled quotation when set `w` px wide. */
  quoteHeight: (w: number) => number;
  /** More words follow on this or a later page. */
  textRemains: boolean;
  /** 0 or 1, from the page's place in the article: which side a picture takes. */
  parity: 0 | 1;
  /** The whole article is a few lines with no picture: its opener sets them large. */
  shortNote?: boolean;
}

export interface Template {
  id: TemplateId;
  /** Starts an article (carries the heading). */
  opener: boolean;
  /** Led by a picture rather than by words — for the alternation rule. */
  pictureLed: boolean;
  /** Can this template be the page, given the photos still to place and whether words remain? */
  applies: (next: PhotoRef[], textRemains: boolean) => boolean;
  /** How many of the next photos it places. */
  take: (next: PhotoRef[], textRemains: boolean) => number;
  layout: (c: TemplateCtx) => Geometry;
}

/** The room a caption takes under a picture, and the gap before the words that follow. */
export const CAP = 18;
export const GAP = 20;
export const AFTER_CAP = 14;
export const PHOTO_GAP = 16;
export const COL_GAP = 24;
/** The smallest text frame worth printing. */
const MIN_FRAME_H = 70;
const MIN_FRAME_W = 150;
const COL_W = (BODY_W - COL_GAP) / 2;      // 236

const h = (w: number, p: PhotoRef) => Math.round(w / photoRatio(p));
/** Where text may start under a picture with a caption. */
const under = (y: number, ph: number) => y + ph + CAP + AFTER_CAP;
const frame = (x: number, y: number, w: number, hh: number, cols: 1 | 2, lead = false): FrameSlot[] =>
  hh >= MIN_FRAME_H && w >= MIN_FRAME_W ? [{ x, y, w, h: Math.floor(hh), cols, lead }] : [];
const centred = (w: number) => Math.round((BODY_W - w) / 2);

/** Wide first picture, set across the top; heading under it; two columns. */
const openerLand: Template = {
  id: 'opener-land', opener: true, pictureLed: true,
  applies: () => true, take: () => 1,
  layout: ({ photos, headHeight }) => {
    const photoH = Math.min(h(BODY_W, photos[0]), 330);
    const head: HeadSlot = { x: 0, y: photoH + CAP + GAP, w: BODY_W, h: headHeight(BODY_W, 'm'), size: 'm' };
    const top = head.y + head.h + AFTER_CAP;
    return {
      photos: [{ x: 0, y: 0, w: BODY_W, h: photoH }], head,
      captions: [{ x: 0, y: photoH + 5, w: BODY_W }],
      frames: frame(0, top, BODY_W, BODY_H - top, 2),
    };
  },
};

/**
 * Tall first picture at the head of the left column, the heading beside it in
 * the right one; the words then fill the left column under the picture and the
 * right column under the heading.
 *
 * The page is two real columns, each a frame of its own, LEFT FIRST — so the
 * text reads down the left column and then down the right, the way a page is
 * read. (It used to set a narrow frame beside the picture and then one
 * full-width two-column frame underneath, which made the eye start at the top
 * right, jump to the bottom left, and cross back again.)
 */
const openerPort: Template = {
  id: 'opener-port', opener: true, pictureLed: true,
  applies: () => true, take: () => 1,
  layout: ({ photos, headHeight }) => {
    const photoH = Math.min(h(COL_W, photos[0]), 390);
    const rightX = COL_W + COL_GAP;
    const head: HeadSlot = { x: rightX, y: 0, w: COL_W, h: headHeight(COL_W, 'm'), size: 'm' };
    const leftTop = under(0, photoH);
    const rightTop = head.h + AFTER_CAP;
    return {
      photos: [{ x: 0, y: 0, w: COL_W, h: photoH }], head,
      captions: [{ x: 0, y: photoH + 5, w: COL_W }],
      frames: [
        ...frame(0, leftTop, COL_W, BODY_H - leftTop, 1),
        ...frame(rightX, rightTop, COL_W, BODY_H - rightTop, 1),
      ],
    };
  },
};

/** No picture: a large heading, then two columns. */
const openerText: Template = {
  id: 'opener-text', opener: true, pictureLed: false,
  applies: () => true, take: () => 0,
  layout: ({ headHeight, shortNote }) => {
    const head: HeadSlot = { x: 0, y: 0, w: BODY_W, h: headHeight(BODY_W, 'l'), size: 'l' };
    const top = head.h + GAP;
    // A short note is set large in a single column: a few big lines, not a thin strip of small ones.
    return { photos: [], head, captions: [], frames: frame(0, top, BODY_W, BODY_H - top, shortNote ? 1 : 2, !!shortNote) };
  },
};

/** Nothing but words, in two columns. */
const text2col: Template = {
  id: 'text-2col', opener: false, pictureLed: false,
  applies: (_next, textRemains) => textRemains, take: () => 0,
  layout: () => ({ photos: [], captions: [], frames: frame(0, 0, BODY_W, BODY_H, 2) }),
};

/* ── Pictures set together as rows ───────────────────────────────────────── */

/** The smallest a picture may be set on a page of pictures, px on its short side. */
const MIN_SIDE = 150;
/** A page of pictures is worth printing when the pictures reach this far down the body. */
const MIN_FILL = 0.55;

export interface Justified { boxes: Box[]; /** Height of the whole group. */ height: number; rows: number }

/**
 * Set `photos` (in order) as rows that fill `width`: each row is one height,
 * every picture in it keeps its own shape, and the rows are stacked. All the
 * ways of cutting the list into consecutive rows are tried and the one that
 * lets the pictures be largest wins; if the stack is taller than `maxH` it is
 * scaled down (still every picture its own shape) and centred.
 */
export function justify(photos: PhotoRef[], width: number, maxH: number, gap = PHOTO_GAP): Justified {
  const n = photos.length;
  let best: Justified = { boxes: [], height: 0, rows: 0 };
  let bestArea = -1;
  for (let mask = 0; mask < 1 << Math.max(0, n - 1); mask++) {
    // bit i set: a new row starts before photo i+1
    const rows: PhotoRef[][] = [[photos[0]]];
    for (let i = 1; i < n; i++) {
      if (mask & (1 << (i - 1))) rows.push([photos[i]]); else rows[rows.length - 1].push(photos[i]);
    }
    const heights = rows.map((r) => (width - gap * (r.length - 1)) / r.reduce((sum, p) => sum + photoRatio(p), 0));
    const total = heights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
    const k = Math.min(1, maxH / total);
    const boxes: Box[] = [];
    let y = 0;
    rows.forEach((r, ri) => {
      const rowH = heights[ri] * k;
      const rowW = (width - gap * (r.length - 1)) * k + gap * (r.length - 1);
      let x = (width - rowW) / 2;
      for (const p of r) {
        const w = rowH * photoRatio(p);
        boxes.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(rowH) });
        x += w + gap;
      }
      y += rowH + gap;
    });
    const area = boxes.reduce((sum, b) => sum + b.w * b.h, 0);
    if (area > bestArea) { bestArea = area; best = { boxes, height: Math.round(total * k), rows: rows.length }; }
  }
  return best;
}

/**
 * How many of the next pictures to put together on a page of pictures alone:
 * as many as still fill the page well (up to four), without leaving a single
 * picture to sit alone on the next one if it can be helped.
 */
export function pictureCount(next: PhotoRef[]): number {
  const maxH = BODY_H - CAP;
  const ok = (n: number) => {
    const j = justify(next.slice(0, n), BODY_W, maxH);
    return j.height >= maxH * MIN_FILL && j.boxes.every((b) => Math.min(b.w, b.h) >= MIN_SIDE);
  };
  let n = Math.min(4, next.length);
  while (n > 1 && !ok(n)) n--;
  if (n > 2 && next.length - n === 1) n--;
  return n;
}

/**
 * One or two photographs, then whatever words are left. With words to follow,
 * two are only taken together when they are the same shape, so they line up:
 * portraits side by side, landscapes one above the other. With none left the
 * pictures are the page: several are set together as rows, centred (`justify`).
 */
const photoPair: Template = {
  id: 'photo-pair', opener: false, pictureLed: true,
  applies: (next) => next.length > 0,
  take: (next, textRemains) => (!textRemains ? pictureCount(next) : next.length >= 2 && next[0].ratio === next[1].ratio ? 2 : 1),
  layout: ({ photos, textRemains }) => {
    if (!textRemains) {
      const maxH = BODY_H - CAP;
      const j = justify(photos, BODY_W, maxH);
      const top = Math.max(0, Math.round((maxH - j.height) / 2));
      return {
        photos: j.boxes.map((b) => ({ ...b, y: b.y + top })),
        captions: [{ x: 0, y: top + j.height + 5, w: BODY_W }],
        frames: [],
      };
    }
    const budget = 400;
    const [a, b] = photos;
    const portrait = a.orient === 'portrait';

    if (b && portrait) {
      const w = (BODY_W - PHOTO_GAP) / 2;
      const ph = Math.min(h(w, a), budget);
      return {
        photos: [{ x: 0, y: 0, w, h: ph }, { x: w + PHOTO_GAP, y: 0, w, h: ph }],
        captions: [{ x: 0, y: ph + 5, w: BODY_W }],
        frames: frame(0, under(0, ph), BODY_W, BODY_H - under(0, ph), 2),
      };
    }
    if (b) {
      // one above the other, as wide as the budget lets them be
      const wide = Math.min(BODY_W, Math.floor(((budget - PHOTO_GAP) * photoRatio(a)) / 2));
      const ph = h(wide, a);
      const x = centred(wide);
      const end = 2 * ph + PHOTO_GAP;
      return {
        photos: [{ x, y: 0, w: wide, h: ph }, { x, y: ph + PHOTO_GAP, w: wide, h: ph }],
        captions: [{ x, y: end + 5, w: wide }],
        frames: frame(0, under(0, end), BODY_W, BODY_H - under(0, end), 2),
      };
    }
    // a single photograph, as large as the page allows
    const w = Math.min(BODY_W, Math.floor(budget * photoRatio(a)));
    const ph = h(w, a);
    return {
      photos: [{ x: centred(w), y: 0, w, h: ph }],
      captions: [{ x: centred(w), y: ph + 5, w }],
      frames: frame(0, under(0, ph), BODY_W, BODY_H - under(0, ph), 2),
    };
  },
};

/** A tall picture takes one column; the words fill the other and the space under it. Alternates sides. */
const photoSideText: Template = {
  id: 'photo-side-text', opener: false, pictureLed: true,
  applies: (next, textRemains) => textRemains && next[0]?.orient === 'portrait',
  take: () => 1,
  layout: ({ photos, parity }) => {
    const ph = Math.min(h(COL_W, photos[0]), 380);
    const photoX = parity === 0 ? 0 : COL_W + COL_GAP;
    const otherX = parity === 0 ? COL_W + COL_GAP : 0;
    const below = under(0, ph);
    const beside = frame(photoX, below, COL_W, BODY_H - below, 1);
    const full = frame(otherX, 0, COL_W, BODY_H, 1);
    return {
      photos: [{ x: photoX, y: 0, w: COL_W, h: ph }],
      captions: [{ x: photoX, y: ph + 5, w: COL_W }],
      // left column first, as it reads
      frames: parity === 0 ? [...beside, ...full] : [...full, ...beside],
    };
  },
};

/** One wide picture across the whole page, to the edges, a caption under it. Dark plate. Only for the last picture or two. */
const fullBleed: Template = {
  id: 'full-bleed', opener: false, pictureLed: true,
  applies: (next, textRemains) => !textRemains && next.length <= 2 && !!next[0] && next[0].orient !== 'portrait',
  take: () => 1,
  layout: ({ photos }) => {
    const ph = Math.min(h(PAGE_W, photos[0]), 540);
    const y = Math.round((BODY_H - ph - CAP) / 2);
    return {
      photos: [{ x: 0, y, w: PAGE_W, h: ph, bleed: true }],
      captions: [{ x: 0, y: y + ph + 8, w: BODY_W }],
      frames: [], plate: true,
    };
  },
};

const sameOrientation = (next: PhotoRef[]) => {
  let n = 1;
  while (n < Math.min(4, next.length) && next[n].orient === next[0].orient) n++;
  return n;
};

/**
 * Three or four pictures of one orientation, set together in a compact block
 * above the words that follow.
 */
const grid: Template = {
  id: 'grid', opener: false, pictureLed: true,
  applies: (next, textRemains) => textRemains && next.length >= 3 && sameOrientation(next) >= 3,
  take: (next) => sameOrientation(next),
  layout: ({ photos }) => {
    const budget = 400;
    const n = photos.length;
    const boxes: PhotoBox[] = [];
    let bottom: number;

    if (photos[0].orient === 'portrait') {
      // tall pictures in a row: each as wide as the row allows, none cropped into a wider shape
      const w = Math.floor((BODY_W - (n - 1) * 12) / n);
      const ph = Math.min(Math.max(...photos.map((p) => h(w, p))), budget);
      photos.forEach((_, i) => boxes.push({ x: i * (w + 12), y: 0, w, h: ph }));
      bottom = ph;
    } else if (n === 4) {
      const w = (BODY_W - PHOTO_GAP) / 2;
      const rowH = Math.min(Math.max(...photos.map((p) => h(w, p))), Math.floor((budget - PHOTO_GAP) / 2));
      photos.forEach((_, i) => boxes.push({ x: (i % 2) * (w + PHOTO_GAP), y: Math.floor(i / 2) * (rowH + PHOTO_GAP), w, h: rowH }));
      bottom = 2 * rowH + PHOTO_GAP;
    } else {
      // one large picture across the top, the rest in a row under it
      const rest = photos.slice(1);
      const w = (BODY_W - (rest.length - 1) * PHOTO_GAP) / rest.length;
      const lowH = Math.max(...rest.map((p) => h(w, p)));
      const topH = Math.max(160, Math.min(h(BODY_W, photos[0]), budget - lowH - PHOTO_GAP));
      boxes.push({ x: 0, y: 0, w: BODY_W, h: topH });
      rest.forEach((_, i) => boxes.push({ x: i * (w + PHOTO_GAP), y: topH + PHOTO_GAP, w, h: lowH }));
      bottom = topH + PHOTO_GAP + lowH;
    }
    return {
      photos: boxes,
      captions: [{ x: 0, y: bottom + 5, w: BODY_W }],
      frames: frame(0, under(0, bottom), BODY_W, BODY_H - under(0, bottom), 2),
    };
  },
};

/** A sentence from the piece, set large between two blocks of its text. */
const pullQuote: Template = {
  id: 'pull-quote', opener: false, pictureLed: false,
  applies: (_next, textRemains) => textRemains, take: () => 0,
  layout: ({ quoteHeight }) => {
    const qh = quoteHeight(BODY_W);
    const above = Math.floor((BODY_H - qh - 2 * GAP) / 2);
    const qy = above + GAP;
    const below = qy + qh + GAP;
    return {
      photos: [], captions: [],
      frames: [...frame(0, 0, BODY_W, above, 2), ...frame(0, below, BODY_W, BODY_H - below, 2)],
      quote: { x: 0, y: qy, w: BODY_W, h: qh },
    };
  },
};

export const TEMPLATES: Record<TemplateId, Template> = {
  'opener-land': openerLand,
  'opener-port': openerPort,
  'opener-text': openerText,
  'text-2col': text2col,
  'photo-pair': photoPair,
  'photo-side-text': photoSideText,
  'full-bleed': fullBleed,
  'grid': grid,
  'pull-quote': pullQuote,
};

/** The opener for an article, by the shape of its first picture. */
export function openerFor(first: PhotoRef | undefined): Template {
  if (!first) return openerText;
  return first.orient === 'portrait' ? openerPort : openerLand;
}

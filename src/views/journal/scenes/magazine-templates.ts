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

   Ten page shapes — the five that open or fill an article:
     opener-land · opener-port · opener-text · text-2col · photo-pair
   and the five that give the book its pace:
     photo-side-text   a tall picture takes a column, the words the other
     full-bleed        one wide picture across the whole page, a caption, nothing else
     grid              three or four of one orientation, set together
     pull-quote        a sentence from the piece, set large between two blocks of text
   (the tenth, article-break, is not a whole page: see breakTail.)
   ========================================================================== */

import { BODY_H, BODY_W, PAGE_W, photoRatio, type PhotoRef } from './magazine-model.ts';

export type TemplateId =
  | 'opener-land' | 'opener-port' | 'opener-text' | 'text-2col' | 'photo-pair'
  | 'photo-side-text' | 'full-bleed' | 'grid' | 'pull-quote';

export interface Box { x: number; y: number; w: number; h: number }
/** `bleed`: x and w are page coordinates (0–600), not body coordinates — it runs to the edges. */
export interface PhotoBox extends Box { bleed?: boolean }
export interface FrameSlot extends Box { cols: 1 | 2; dropcap?: boolean }
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
const frame = (x: number, y: number, w: number, hh: number, cols: 1 | 2, dropcap = false): FrameSlot[] =>
  hh >= MIN_FRAME_H && w >= MIN_FRAME_W ? [{ x, y, w, h: Math.floor(hh), cols, dropcap }] : [];
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
      frames: frame(0, top, BODY_W, BODY_H - top, 2, true),
    };
  },
};

/** Tall first picture on the left, the heading beside it, words under and beside. */
const openerPort: Template = {
  id: 'opener-port', opener: true, pictureLed: true,
  applies: () => true, take: () => 1,
  layout: ({ photos, headHeight }) => {
    const photoW = 250;
    const photoH = Math.min(h(photoW, photos[0]), 390);
    const sideX = photoW + GAP;
    const sideW = BODY_W - sideX;
    const head: HeadSlot = { x: sideX, y: 0, w: sideW, h: headHeight(sideW, 'm'), size: 'm' };
    const besideTop = head.h + 12;
    const below = under(0, photoH);
    return {
      photos: [{ x: 0, y: 0, w: photoW, h: photoH }], head,
      captions: [{ x: 0, y: photoH + 5, w: photoW }],
      frames: [
        ...frame(sideX, besideTop, sideW, photoH + CAP - besideTop, 1, true),
        ...frame(0, below, BODY_W, BODY_H - below, 2),
      ],
    };
  },
};

/** No picture: a large heading, then two columns. */
const openerText: Template = {
  id: 'opener-text', opener: true, pictureLed: false,
  applies: () => true, take: () => 0,
  layout: ({ headHeight }) => {
    const head: HeadSlot = { x: 0, y: 0, w: BODY_W, h: headHeight(BODY_W, 'l'), size: 'l' };
    const top = head.h + GAP;
    return { photos: [], head, captions: [], frames: frame(0, top, BODY_W, BODY_H - top, 2, true) };
  },
};

/** Nothing but words, in two columns. */
const text2col: Template = {
  id: 'text-2col', opener: false, pictureLed: false,
  applies: (_next, textRemains) => textRemains, take: () => 0,
  layout: () => ({ photos: [], captions: [], frames: frame(0, 0, BODY_W, BODY_H, 2) }),
};

/**
 * One or two photographs, then whatever words are left. With words to follow,
 * two are only taken together when they are the same shape, so they line up:
 * portraits side by side, landscapes one above the other. With none left the
 * pictures are the page, and any two go together.
 */
const photoPair: Template = {
  id: 'photo-pair', opener: false, pictureLed: true,
  applies: (next) => next.length > 0,
  take: (next, textRemains) => (next.length >= 2 && (!textRemains || next[0].ratio === next[1].ratio) ? 2 : 1),
  layout: ({ photos, textRemains }) => {
    const budget = textRemains ? 400 : BODY_H - CAP;
    const [a, b] = photos;
    const portrait = a.orient === 'portrait';

    if (b && !textRemains && a.ratio !== b.ratio) {
      // two different shapes and nothing else on the page: one above the other, each as tall as half the page
      const each = (BODY_H - CAP - PHOTO_GAP) / 2;
      const wa = Math.min(BODY_W, Math.floor(each * photoRatio(a)));
      const wb = Math.min(BODY_W, Math.floor(each * photoRatio(b)));
      const ha = h(wa, a);
      const hb = h(wb, b);
      return {
        photos: [{ x: centred(wa), y: 0, w: wa, h: ha }, { x: centred(wb), y: ha + PHOTO_GAP, w: wb, h: hb }],
        captions: [{ x: centred(wb), y: ha + PHOTO_GAP + hb + 5, w: wb }],
        frames: [],
      };
    }
    if (b && portrait) {
      const w = (BODY_W - PHOTO_GAP) / 2;
      const ph = Math.min(h(w, a), budget);
      return {
        photos: [{ x: 0, y: 0, w, h: ph }, { x: w + PHOTO_GAP, y: 0, w, h: ph }],
        captions: [{ x: 0, y: ph + 5, w: BODY_W }],
        frames: textRemains ? frame(0, under(0, ph), BODY_W, BODY_H - under(0, ph), 2) : [],
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
        frames: textRemains ? frame(0, under(0, end), BODY_W, BODY_H - under(0, end), 2) : [],
      };
    }
    // a single photograph, as large as the page allows
    const w = Math.min(BODY_W, Math.floor(budget * photoRatio(a)));
    const ph = h(w, a);
    return {
      photos: [{ x: centred(w), y: 0, w, h: ph }],
      captions: [{ x: centred(w), y: ph + 5, w }],
      frames: textRemains ? frame(0, under(0, ph), BODY_W, BODY_H - under(0, ph), 2) : [],
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

/** One wide picture across the whole page, to the edges, a caption under it. Dark plate. */
const fullBleed: Template = {
  id: 'full-bleed', opener: false, pictureLed: true,
  applies: (next, textRemains) => !textRemains && !!next[0] && next[0].orient !== 'portrait',
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
 * Three or four pictures of one orientation, set together as a single piece.
 * With words to follow it is a compact block above them; with none it is the
 * page, so it is set as large as the page allows.
 */
const grid: Template = {
  id: 'grid', opener: false, pictureLed: true,
  // Four tall pictures can fill a page alone (two by two); three cannot, and are paired off instead.
  applies: (next, textRemains) => {
    const n = next.length >= 3 ? sameOrientation(next) : 0;
    if (n < 3) return false;
    return textRemains || next[0].orient !== 'portrait' || n === 4;
  },
  take: (next) => sameOrientation(next),
  layout: ({ photos, textRemains }) => {
    const budget = textRemains ? 400 : BODY_H - CAP;
    const n = photos.length;
    const boxes: PhotoBox[] = [];
    let bottom: number;

    if (photos[0].orient === 'portrait' && textRemains) {
      // tall pictures in a row: each as wide as the row allows, none cropped into a wider shape
      const w = Math.floor((BODY_W - (n - 1) * 12) / n);
      const ph = Math.min(Math.max(...photos.map((p) => h(w, p))), budget);
      photos.forEach((_, i) => boxes.push({ x: i * (w + 12), y: 0, w, h: ph }));
      bottom = ph;
    } else if (photos[0].orient === 'portrait') {
      // four tall pictures and nothing else: two by two, each as tall as half the page allows, shape kept
      const rowH = Math.floor((budget - PHOTO_GAP) / 2);
      const w = Math.min(Math.floor((BODY_W - PHOTO_GAP) / 2), Math.floor(rowH * photoRatio(photos[0])));
      const left = Math.round((BODY_W - (2 * w + PHOTO_GAP)) / 2);
      photos.forEach((p, i) => boxes.push({ x: left + (i % 2) * (w + PHOTO_GAP), y: Math.floor(i / 2) * (h(w, p) + PHOTO_GAP), w, h: h(w, p) }));
      bottom = 2 * h(w, photos[0]) + PHOTO_GAP;
    } else if (textRemains && n === 4) {
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
      frames: textRemains ? frame(0, under(0, bottom), BODY_W, BODY_H - under(0, bottom), 2) : [],
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

/* ── article-break ───────────────────────────────────────────────────────── */

/** The least free height on a page at which the next article may begin on it. */
export const BREAK_MIN_FREE = 300;

export interface Tail {
  /** A thin rule across the page, then the next article's heading, then its words. */
  rule: { x: number; y: number; w: number };
  head: HeadSlot;
  frames: FrameSlot[];
}

/**
 * The lower part of a page that the previous article left empty, given to the
 * next one: a rule, its heading, its words in two columns. `usedBottom` is how
 * far down the page the previous article got.
 */
export function breakTail(usedBottom: number, headHeight: (w: number, size: 'm' | 'l') => number): Tail | null {
  const ruleY = Math.round(usedBottom + GAP + 6);
  const head: HeadSlot = { x: 0, y: ruleY + 18, w: BODY_W, h: headHeight(BODY_W, 'm'), size: 'm' };
  const top = head.y + head.h + AFTER_CAP;
  const frames = frame(0, top, BODY_W, BODY_H - top, 2, true);
  if (!frames.length) return null;
  return { rule: { x: 0, y: ruleY, w: BODY_W }, head, frames };
}

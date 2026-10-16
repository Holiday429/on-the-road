/* ==========================================================================
   On the Road · Journal magazine — page templates (pure)
   --------------------------------------------------------------------------
   A template says where the photographs and the words go on a 496 × 680 body
   box. Two rules do most of the work:

     · A photo SLOT fixes only a width. Its height is the photo's own
       (width ÷ its shape), so a landscape stays landscape and a portrait stays
       portrait: no photo is ever cut into another orientation. (A page cap on
       height can trim a very tall one by a few percent; that is as far as
       cropping goes.)
     · A text FRAME is whatever the photos and the heading leave over.

   The heading's height depends on its words, which only the browser can say,
   so a template asks for it (`headHeight`) rather than assuming one.

   M1 has five: opener-land, opener-port, opener-text, text-2col, photo-pair.
   ========================================================================== */

import { BODY_H, BODY_W, photoRatio, type PhotoRef } from './magazine-model.ts';

export type TemplateId = 'opener-land' | 'opener-port' | 'opener-text' | 'text-2col' | 'photo-pair';

export interface Box { x: number; y: number; w: number; h: number }
export interface FrameSlot extends Box { cols: 1 | 2; dropcap?: boolean }
export interface HeadSlot extends Box { size: 'm' | 'l' }

export interface Geometry {
  photos: Box[];
  head?: HeadSlot;
  /** In reading order. */
  frames: FrameSlot[];
}

export interface TemplateCtx {
  /** The photos this page takes (see `take`). */
  photos: PhotoRef[];
  /** Height of the heading when set at `w` px wide, in the given size. */
  headHeight: (w: number, size: 'm' | 'l') => number;
  /** More words follow on this or a later page. */
  textRemains: boolean;
}

export interface Template {
  id: TemplateId;
  /** Starts an article (carries the heading). */
  opener: boolean;
  /** Led by a picture rather than by words — for the alternation rule. */
  pictureLed: boolean;
  /** How many of the next photos this template places. `textRemains`: more words follow, so the page must leave room for them. */
  take: (next: PhotoRef[], textRemains: boolean) => number;
  layout: (c: TemplateCtx) => Geometry;
}

/** Gap between a photo and the words, between two photos, and between the two columns. */
export const GAP = 20;
export const PHOTO_GAP = 16;
export const COL_GAP = 24;
/** The smallest text frame worth printing. */
const MIN_FRAME_H = 70;
const MIN_FRAME_W = 150;

const h = (w: number, p: PhotoRef) => Math.round(w / photoRatio(p));
const frame = (x: number, y: number, w: number, hh: number, cols: 1 | 2, dropcap = false): FrameSlot[] =>
  hh >= MIN_FRAME_H && w >= MIN_FRAME_W ? [{ x, y, w, h: hh, cols, dropcap }] : [];

/** Wide first picture, set across the top; heading under it; two columns. */
const openerLand: Template = {
  id: 'opener-land', opener: true, pictureLed: true,
  take: () => 1,
  layout: ({ photos, headHeight }) => {
    const photoH = Math.min(h(BODY_W, photos[0]), 340);
    const head: HeadSlot = { x: 0, y: photoH + GAP, w: BODY_W, h: headHeight(BODY_W, 'm'), size: 'm' };
    const top = head.y + head.h + 14;
    return {
      photos: [{ x: 0, y: 0, w: BODY_W, h: photoH }], head,
      frames: frame(0, top, BODY_W, BODY_H - top, 2, true),
    };
  },
};

/** Tall first picture on the left, the heading beside it, words under and beside. */
const openerPort: Template = {
  id: 'opener-port', opener: true, pictureLed: true,
  take: () => 1,
  layout: ({ photos, headHeight }) => {
    const photoW = 250;
    const photoH = Math.min(h(photoW, photos[0]), 400);
    const sideX = photoW + GAP;
    const sideW = BODY_W - sideX;
    const head: HeadSlot = { x: sideX, y: 0, w: sideW, h: headHeight(sideW, 'm'), size: 'm' };
    const besideTop = head.h + 12;
    const below = photoH + GAP;
    return {
      photos: [{ x: 0, y: 0, w: photoW, h: photoH }], head,
      frames: [
        ...frame(sideX, besideTop, sideW, photoH - besideTop, 1, true),
        ...frame(0, below, BODY_W, BODY_H - below, 2),
      ],
    };
  },
};

/** No picture: a large heading, then two columns. */
const openerText: Template = {
  id: 'opener-text', opener: true, pictureLed: false,
  take: () => 0,
  layout: ({ headHeight }) => {
    const head: HeadSlot = { x: 0, y: 0, w: BODY_W, h: headHeight(BODY_W, 'l'), size: 'l' };
    const top = head.h + GAP;
    return { photos: [], head, frames: frame(0, top, BODY_W, BODY_H - top, 2, true) };
  },
};

/** Nothing but words, in two columns. */
const text2col: Template = {
  id: 'text-2col', opener: false, pictureLed: false,
  take: () => 0,
  layout: () => ({ photos: [], frames: frame(0, 0, BODY_W, BODY_H, 2) }),
};

/**
 * One or two photographs, then whatever words are left. Two are only taken
 * together when they are the same shape, so they line up: portraits side by
 * side, landscapes one above the other.
 */
const photoPair: Template = {
  id: 'photo-pair', opener: false, pictureLed: true,
  // With words to follow, two are taken only if they are the same shape, so they line up.
  // With none the pictures are the page, and any two go together, one above the other.
  take: (next, textRemains) => (next.length >= 2 && (!textRemains || next[0].ratio === next[1].ratio) ? 2 : 1),
  layout: ({ photos, textRemains }) => {
    // With words to follow the photographs leave room for them; with none they take the page.
    const budget = textRemains ? 400 : BODY_H;
    const [a, b] = photos;
    const portrait = a.orient === 'portrait';

    if (b && !textRemains && a.ratio !== b.ratio) {
      // two different shapes and nothing else on the page: one above the other, each as tall as half the page
      const each = (BODY_H - PHOTO_GAP) / 2;
      const wa = Math.min(BODY_W, Math.floor(each * photoRatio(a)));
      const wb = Math.min(BODY_W, Math.floor(each * photoRatio(b)));
      const ha = h(wa, a);
      return {
        photos: [{ x: Math.round((BODY_W - wa) / 2), y: 0, w: wa, h: ha }, { x: Math.round((BODY_W - wb) / 2), y: ha + PHOTO_GAP, w: wb, h: h(wb, b) }],
        frames: [],
      };
    }
    if (b && portrait) {
      const w = (BODY_W - PHOTO_GAP) / 2;
      const ph = Math.min(h(w, a), budget);
      return {
        photos: [{ x: 0, y: 0, w, h: ph }, { x: w + PHOTO_GAP, y: 0, w, h: ph }],
        frames: textRemains ? frame(0, ph + GAP, BODY_W, BODY_H - ph - GAP, 2) : [],
      };
    }
    if (b) {
      // one above the other, as wide as the budget lets them be
      const wide = Math.min(BODY_W, Math.floor(((budget - PHOTO_GAP) * photoRatio(a)) / 2));
      const ph = h(wide, a);
      const x = Math.round((BODY_W - wide) / 2);
      return {
        photos: [{ x, y: 0, w: wide, h: ph }, { x, y: ph + PHOTO_GAP, w: wide, h: ph }],
        frames: textRemains ? frame(0, 2 * ph + PHOTO_GAP + GAP, BODY_W, BODY_H - (2 * ph + PHOTO_GAP + GAP), 2) : [],
      };
    }
    if (portrait && textRemains) {
      // a tall one with words beside it and under it, as the opener does
      const w = 250;
      const ph = Math.min(h(w, a), budget);
      const sideX = w + GAP;
      return {
        photos: [{ x: 0, y: 0, w, h: ph }],
        frames: [...frame(sideX, 0, BODY_W - sideX, ph, 1), ...frame(0, ph + GAP, BODY_W, BODY_H - ph - GAP, 2)],
      };
    }
    // a single photograph, as large as the page allows
    const w = Math.min(BODY_W, Math.floor(budget * photoRatio(a)));
    const ph = h(w, a);
    return {
      photos: [{ x: Math.round((BODY_W - w) / 2), y: 0, w, h: ph }],
      frames: textRemains ? frame(0, ph + GAP, BODY_W, BODY_H - ph - GAP, 2) : [],
    };
  },
};

export const TEMPLATES: Record<TemplateId, Template> = {
  'opener-land': openerLand,
  'opener-port': openerPort,
  'opener-text': openerText,
  'text-2col': text2col,
  'photo-pair': photoPair,
};

/** The opener for an article, by the shape of its first picture. */
export function openerFor(first: PhotoRef | undefined): Template {
  if (!first) return openerText;
  return first.orient === 'portrait' ? openerPort : openerLand;
}

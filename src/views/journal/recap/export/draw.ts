/* ==========================================================================
   On the Road · Recap export — drawing a card's back on a canvas
   --------------------------------------------------------------------------
   Paints the BACK of a card (the answer, never the face-down question) onto a
   1080×1440 canvas. This is what a friend sees: public wording only.

   Every dimension is the on-screen card's `cqw` value × 10.8, because a card is
   styled in cqw (1% of its own width) and 1080px wide makes 1cqw = 10.8px. So
   the saved image is the card on screen, just bigger — change a size in
   recap.css and the matching line here changes by the same ratio.

   Drawn light-theme regardless of the app's theme: an image leaves the app and
   must look the same wherever it lands.

   The context is passed in rather than created, so the drawing is tested against
   a recording fake with no canvas at all.
   ========================================================================== */

import { t } from '../../../../core/i18n.ts';
import { COLORS, FONTS, hexToRgb, tintInk, tintMix } from '../../card/card-spec.ts';
import { splitEmphasis } from '../emphasis.ts';
import { bodySize, cardQuestion, CHAPTER_KICKERS, type Card } from '../render.ts';
import { toneFor } from '../tones.ts';
import { fitRuns, wrapRuns, type Line, type Measure, type Run } from './layout.ts';

export const CARD_W = 1080;
export const CARD_H = 1440;
/** 1cqw at export size. */
export const U = CARD_W / 100;

/** Same families as the app, with CJK fallbacks so Chinese is drawn in a real face. */
export const FONT = {
  ui: `${FONTS.ui.replace(', system-ui, sans-serif', '')}, "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", system-ui, sans-serif`,
  body: `${FONTS.body.replace(', system-ui, sans-serif', '')}, "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", system-ui, sans-serif`,
};

/** The brand amber, for the key-sentence highlight and the dot. */
const AMBER = '#f9b830';

type Ctx = CanvasRenderingContext2D;

export interface DrawInput {
  card: Card;
  /** The card's identity — picks its colour. */
  key: string;
  /** Position within what is being exported (1-based) and how many there are. */
  page: number;
  total: number;
}

/* ── Small helpers ────────────────────────────────────────────────────────── */

const weightFont = (weight: number, size: number, family: string) => `${weight} ${size}px ${family}`;

function setLetterSpacing(ctx: Ctx, px: number): void {
  // Not every engine has it; without it the kicker is simply a little tighter.
  (ctx as unknown as { letterSpacing?: string }).letterSpacing = `${px}px`;
}

function rgba(color: string, alpha: number): string {
  const { r, g, b } = hexToRgb(color.startsWith('rgb') ? '#000000' : color);
  return color.startsWith('rgb')
    ? color.replace(/^rgb\(([^)]*)\)$/, `rgba($1,${alpha})`)
    : `rgba(${r},${g},${b},${alpha})`;
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** A measure for a given face and size, closing over the context. */
function measurer(ctx: Ctx, weight: number, emWeight: number, size: number, family: string): Measure {
  return (text, em) => {
    ctx.font = weightFont(em ? emWeight : weight, size, family);
    return ctx.measureText(text).width;
  };
}

/** Shorten `text` until it fits `maxWidth` at the current font. */
function ellipsize(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

interface LineStyle {
  size: number;
  lineHeight: number;
  weight: number;
  emWeight: number;
  family: string;
  color: string;
  emColor: string;
  align?: 'left' | 'center';
  width?: number;
}

/**
 * Draw wrapped lines top-down from `y`. The key sentence gets the amber
 * highlight behind it, drawn first so the text sits on top. Returns the y after
 * the last line.
 */
function drawLines(ctx: Ctx, lines: Line[], x: number, y: number, s: LineStyle): number {
  ctx.textBaseline = 'middle';
  const lh = s.size * s.lineHeight;

  for (const line of lines) {
    const mid = y + lh / 2;
    let cx = s.align === 'center' && s.width ? x + (s.width - line.width) / 2 : x;

    for (const seg of line.segments) {
      ctx.font = weightFont(seg.em ? s.emWeight : s.weight, s.size, s.family);
      if (seg.em) {
        // The lower ~half of the text's box, like the screen's gradient underline.
        ctx.fillStyle = rgba(AMBER, 0.52);
        ctx.fillRect(cx - s.size * 0.04, mid + s.size * 0.02, seg.width + s.size * 0.08, s.size * 0.58);
      }
      ctx.fillStyle = seg.em ? s.emColor : s.color;
      ctx.fillText(seg.text, cx, mid);
      cx += seg.width;
    }
    y += lh;
  }
  return y;
}

function runsOf(text: string): Run[] {
  return splitEmphasis(text).map((s) => ({ text: s.text, em: s.em }));
}

/** Underline the phrase inside quotation marks (the closing card's one-liner). */
function quotedRuns(text: string): Run[] {
  return text
    .split(/([“「][^”」]+[”」])/)
    .filter(Boolean)
    .map((part) => ({ text: part, em: /^[“「]/.test(part) }));
}

/* ── Frame: background, topic bar, base bar ───────────────────────────────── */

const PAD = 7.4 * U;
const BASE_H = 11 * U;

function paintBackground(ctx: Ctx, tone: string): void {
  // The wash is strongest at the top and fades to paper, as on screen, so body
  // text always sits on a near-white ground.
  const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
  g.addColorStop(0, tone);
  g.addColorStop(0.26, tintMix(tone, 38));
  g.addColorStop(0.56, COLORS.white);
  g.addColorStop(1, COLORS.white);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

/** The bar atop the card: the question it answers. Returns the y of its bottom rule. */
function paintTopic(ctx: Ctx, input: DrawInput, toneInk: string): number {
  const { card, key, page } = input;
  const idx = String(page).padStart(2, '0');
  const rowH = 3 * U + 1.6 * U;
  const mid = PAD + rowH / 2;

  // Index pill.
  ctx.font = weightFont(700, 3 * U, FONT.ui);
  const pillW = ctx.measureText(idx).width + 4.8 * U;
  ctx.fillStyle = toneInk;
  roundRectPath(ctx, PAD, PAD, pillW, rowH, rowH / 2);
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.textBaseline = 'middle';
  ctx.fillText(idx, PAD + 2.4 * U, mid);

  // Kicker, right-aligned, letter-spaced.
  const kicker = (CHAPTER_KICKERS[key] ?? '').toUpperCase();
  ctx.font = weightFont(600, 2.7 * U, FONT.ui);
  setLetterSpacing(ctx, 0.18 * 2.7 * U);
  const kickerW = ctx.measureText(kicker).width;
  ctx.fillStyle = toneInk;
  ctx.fillText(kicker, CARD_W - PAD - kickerW, mid);
  setLetterSpacing(ctx, 0);

  // The question, in what is left.
  const qX = PAD + pillW + 2.4 * U;
  const qW = CARD_W - PAD - kickerW - 2.4 * U - qX;
  ctx.font = weightFont(600, 3.5 * U, FONT.ui);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(ellipsize(ctx, cardQuestion(card), qW), qX, mid);

  const ruleY = PAD + rowH + 3 * U;
  ctx.strokeStyle = rgba(toneInk, 0.22);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, ruleY);
  ctx.lineTo(CARD_W - PAD, ruleY);
  ctx.stroke();
  return ruleY;
}

/** The bar along the bottom: a note on the left, brand and position on the right. */
function paintBase(ctx: Ctx, input: DrawInput, toneInk: string, left: string): number {
  const top = CARD_H - PAD - BASE_H;
  ctx.strokeStyle = rgba(toneInk, 0.22);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, top);
  ctx.lineTo(CARD_W - PAD, top);
  ctx.stroke();

  const rowTop = top + 3 * U;
  const mid = rowTop + (CARD_H - PAD - rowTop) / 2;
  const size = 2.9 * U;
  ctx.textBaseline = 'middle';

  // Right group, laid out from the right edge inward.
  const pageText = `${input.page}/${input.total}`;
  ctx.font = weightFont(500, size, FONT.ui);
  const pageW = ctx.measureText(pageText).width;
  ctx.font = weightFont(600, size, FONT.ui);
  const nameW = ctx.measureText('On the Road').width;
  const dot = 2.8 * U;
  const gap = 1.6 * U;
  const rightW = dot + gap + nameW + gap + 1 * U + pageW;
  let x = CARD_W - PAD - rightW;

  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(x + dot / 2, mid, dot / 2, 0, Math.PI * 2);
  ctx.fill();
  x += dot + gap;
  ctx.font = weightFont(600, size, FONT.ui);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('On the Road', x, mid);
  x += nameW + gap + 1 * U;
  ctx.font = weightFont(500, size, FONT.ui);
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(pageText, x, mid);

  if (left) {
    ctx.font = weightFont(400, size, FONT.body);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(ellipsize(ctx, left, CARD_W - 2 * PAD - rightW - 3 * U), PAD, mid);
  }
  return top;
}

/* ── Per-card content ─────────────────────────────────────────────────────── */

function drawChapter(ctx: Ctx, card: Extract<Card, { kind: 'chapter' }>, top: number, bottom: number): void {
  const w = CARD_W - 2 * PAD;
  const runs = runsOf(card.chapter.bodyPublic);
  const plain = runs.map((r) => r.text).join('');

  const headSize = 6.2 * U;
  const headLH = 1.32;
  const headLines = wrapRuns([{ text: card.chapter.heading, em: false }], measurer(ctx, 600, 600, headSize, FONT.ui), w);
  const headH = headLines.length * headSize * headLH;
  const gap = 3.6 * U;

  const avail = bottom - top - 8 * U;
  const sizes = { lg: [4.8, 4.1, 3.5], md: [4.1, 3.5], sm: [3.5] }[bodySize(plain)].map((s) => s * U);
  const lineHeight = bodySize(plain) === 'lg' ? 1.74 : 1.8;
  const fit = fitRuns(
    runs,
    (size) => measurer(ctx, 400, 600, size, FONT.body),
    w,
    avail - headH - gap,
    sizes,
    lineHeight,
  );

  const blockH = headH + gap + fit.height;
  let y = top + (bottom - top - blockH) / 2;

  y = drawLines(ctx, headLines, PAD, y, {
    size: headSize, lineHeight: headLH, weight: 600, emWeight: 600, family: FONT.ui,
    color: COLORS.ink, emColor: COLORS.ink,
  });
  drawLines(ctx, fit.lines, PAD, y + gap, {
    size: fit.size, lineHeight, weight: 400, emWeight: 600, family: FONT.body,
    color: COLORS.inkSoft, emColor: COLORS.ink,
  });
}

function drawCover(ctx: Ctx, card: Extract<Card, { kind: 'cover' }>, top: number, bottom: number, toneInk: string): void {
  const w = CARD_W - 2 * PAD;
  let y = top;

  if (card.label) {
    y += 5 * U;
    const labelSize = 10 * U;
    const labelLines = wrapRuns([{ text: card.label, em: false }], measurer(ctx, 700, 700, labelSize, FONT.ui), w);
    y = drawLines(ctx, labelLines, PAD, y, {
      size: labelSize, lineHeight: 1.14, weight: 700, emWeight: 700, family: FONT.ui, color: COLORS.ink, emColor: COLORS.ink,
    });
    if (card.tagline) {
      const size = 3.9 * U;
      const lines = wrapRuns([{ text: card.tagline, em: false }], measurer(ctx, 400, 400, size, FONT.body), w);
      y = drawLines(ctx, lines, PAD, y + 3.4 * U, {
        size, lineHeight: 1.65, weight: 400, emWeight: 400, family: FONT.body, color: COLORS.inkSoft, emColor: COLORS.inkSoft,
      });
    }
    y += 4 * U;
    ctx.strokeStyle = rgba(toneInk, 0.22);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(CARD_W - PAD, y);
    ctx.stroke();
  }

  // Up to six figures, three to a row.
  const tiles = card.tiles;
  if (!tiles.length) return;
  const cols = 3;
  const rows = Math.ceil(tiles.length / cols);
  const gapX = 3 * U;
  const colW = (w - gapX * (cols - 1)) / cols;
  const rowH = (bottom - y) / rows;

  tiles.forEach((tile, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = PAD + col * (colW + gapX);
    const rowTop = y + row * rowH;

    const valueSize = 6.2 * U;
    const labelSize = 3 * U;
    const labelLines = wrapRuns([{ text: tile.label, em: false }], measurer(ctx, 400, 400, labelSize, FONT.body), colW);
    const blockH = valueSize * 1.1 + 1 * U + labelLines.length * labelSize * 1.35;
    let ty = rowTop + (rowH - blockH) / 2;

    ctx.textBaseline = 'middle';
    ctx.font = weightFont(600, valueSize, FONT.ui);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(ellipsize(ctx, tile.value, colW), x, ty + (valueSize * 1.1) / 2);
    ty += valueSize * 1.1 + 1 * U;
    drawLines(ctx, labelLines, x, ty, {
      size: labelSize, lineHeight: 1.35, weight: 400, emWeight: 400, family: FONT.body, color: COLORS.inkMuted, emColor: COLORS.inkMuted,
    });

    if (row < rows - 1) {
      ctx.strokeStyle = rgba(toneInk, 0.22);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, rowTop + rowH);
      ctx.lineTo(x + colW, rowTop + rowH);
      ctx.stroke();
    }
  });
}

function drawTraits(ctx: Ctx, card: Extract<Card, { kind: 'traits' }>, top: number, bottom: number, toneInk: string): void {
  const w = CARD_W - 2 * PAD;
  const traits = card.traits.slice(0, 4);

  // Notes first: they set how much height the radar gets.
  const gapX = 5 * U;
  const colW = (w - gapX) / 2;
  const keySize = 3.3 * U;
  const noteSize = 3 * U;
  const noteLH = 1.5;
  const notes = traits.map((trait) => {
    const lines = wrapRuns([{ text: trait.note, em: false }], measurer(ctx, 400, 400, noteSize, FONT.body), colW).slice(0, 3);
    return { trait, lines, h: 1.8 * U + keySize * 1.3 + 0.8 * U + lines.length * noteSize * noteLH };
  });
  const rowGap = 2.4 * U;
  const rowH = [Math.max(notes[0]?.h ?? 0, notes[1]?.h ?? 0), Math.max(notes[2]?.h ?? 0, notes[3]?.h ?? 0)];
  const listH = rowH[0] + rowGap + rowH[1];
  const listTop = bottom - 2 * U - listH;

  // Radar, in whatever is left above the notes (never smaller than 40cqw).
  const radarTop = top + 3 * U;
  const radarH = Math.max(40 * U, listTop - 2 * U - radarTop);
  drawRadar(ctx, traits, PAD, radarTop, w, radarH, toneInk);

  notes.forEach((n, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = PAD + col * (colW + gapX);
    const y = listTop + (row ? rowH[0] + rowGap : 0);

    ctx.strokeStyle = rgba(toneInk, 0.22);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + colW, y);
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.font = weightFont(600, keySize, FONT.ui);
    ctx.fillStyle = COLORS.ink;
    const keyY = y + 1.8 * U + (keySize * 1.3) / 2;
    ctx.fillText(n.trait.key, x, keyY);
    const keyW = ctx.measureText(`${n.trait.key} `).width;
    ctx.font = weightFont(700, keySize, FONT.ui);
    ctx.fillStyle = toneInk;
    ctx.fillText(String(Math.round(n.trait.score)), x + keyW, keyY);

    drawLines(ctx, n.lines, x, y + 1.8 * U + keySize * 1.3 + 0.8 * U, {
      size: noteSize, lineHeight: noteLH, weight: 400, emWeight: 400, family: FONT.body, color: COLORS.inkMuted, emColor: COLORS.inkMuted,
    });
  });
}

/**
 * The radar, in the same geometry as the card's SVG (a 440×370 viewBox starting
 * at x=-20, centre 200,185, outer ring 100 units) scaled to fit its box.
 */
function drawRadar(ctx: Ctx, traits: Array<{ key: string; score: number }>, x: number, y: number, w: number, h: number, toneInk: string): void {
  if (traits.length < 4) return;
  const s = Math.min(w / 440, h / 370);
  const ox = x + (w - 440 * s) / 2 + 20 * s;
  const oy = y + (h - 370 * s) / 2;
  const P = (ux: number, uy: number): [number, number] => [ox + ux * s, oy + uy * s];
  const cx = 200;
  const cy = 185;

  const poly = (pts: Array<[number, number]>) => {
    ctx.beginPath();
    pts.forEach(([ux, uy], i) => { const [px, py] = P(ux, uy); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath();
  };

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(toneInk, 0.22);
  for (const k of [100, 75, 50]) {
    poly([[cx, cy - k], [cx + k, cy], [cx, cy + k], [cx - k, cy]]);
    ctx.globalAlpha = k === 100 ? 0.75 : k === 75 ? 0.6 : 0.5;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  const [t1x, t1y] = P(cx, cy - 100); const [t2x, t2y] = P(cx, cy + 100);
  const [l1x, l1y] = P(cx - 100, cy); const [l2x, l2y] = P(cx + 100, cy);
  ctx.moveTo(t1x, t1y); ctx.lineTo(t2x, t2y); ctx.moveTo(l1x, l1y); ctx.lineTo(l2x, l2y);
  ctx.stroke();

  const r = (score: number) => Math.max(8, Math.min(100, score));
  const pts: Array<[number, number]> = [
    [cx, cy - r(traits[0].score)], [cx + r(traits[1].score), cy], [cx, cy + r(traits[2].score)], [cx - r(traits[3].score), cy],
  ];
  poly(pts);
  ctx.fillStyle = rgba(toneInk, 0.2);
  ctx.fill();
  ctx.strokeStyle = toneInk;
  ctx.lineWidth = Math.max(2.4 * s, 3);
  ctx.lineJoin = 'round';
  ctx.stroke();
  for (const [ux, uy] of pts) {
    const [px, py] = P(ux, uy);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(5 * s, 6), 0, Math.PI * 2);
    ctx.fillStyle = COLORS.white;
    ctx.fill();
    ctx.lineWidth = Math.max(2.4 * s, 3);
    ctx.stroke();
  }

  // Label sizes follow the radar's scale but never fall below a readable floor:
  // scaled strictly, the captions would be ~2cqw on a 1080px image.
  const keySize = Math.max(19 * s, 2.9 * U);
  const scoreSize = Math.max(24 * s, 3.4 * U);
  const label = (trait: { key: string; score: number }, ux: number, uy: number, align: CanvasTextAlign) => {
    const [px, py] = P(ux, uy);
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.font = weightFont(500, keySize, FONT.ui);
    ctx.fillStyle = COLORS.inkSoft;
    ctx.fillText(trait.key, px, py);
    ctx.font = weightFont(600, scoreSize, FONT.ui);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(String(Math.round(trait.score)), px, py + keySize * 0.2 + scoreSize * 0.95);
  };
  label(traits[0], cx, 22, 'center');
  label(traits[1], cx + 114, cy - 4, 'left');
  label(traits[2], cx, cy + 128, 'center');
  label(traits[3], cx - 114, cy - 4, 'right');
  ctx.textAlign = 'left';
}

function drawClosing(ctx: Ctx, card: Extract<Card, { kind: 'closing' }>, top: number, bottom: number, toneInk: string): void {
  const w = CARD_W - 2 * PAD;
  const y = top + 5 * U;

  if (card.oneLine) {
    const size = 5.2 * U;
    const lines = wrapRuns(quotedRuns(card.oneLine), measurer(ctx, 600, 600, size, FONT.ui), w);
    drawLines(ctx, lines, PAD, y, {
      size, lineHeight: 1.55, weight: 600, emWeight: 600, family: FONT.ui, color: COLORS.ink, emColor: COLORS.ink,
    });
  }
  if (!card.questions.length) return;

  // The questions sit at the bottom, above the base bar.
  const size = 3.6 * U;
  const lh = 1.6;
  const textX = PAD + 6.4 * U;
  const blocks = card.questions.map((q) => wrapRuns([{ text: q, em: false }], measurer(ctx, 400, 400, size, FONT.body), w - 6.4 * U));
  const gap = 2.4 * U;
  const labelH = 2.9 * U * 1.5;
  const listH = blocks.reduce((n, b) => n + b.length * size * lh, 0) + gap * (blocks.length - 1);
  let qy = bottom - 4 * U - listH;

  ctx.textBaseline = 'middle';
  ctx.font = weightFont(600, 2.9 * U, FONT.ui);
  setLetterSpacing(ctx, 0.22 * 2.9 * U);
  ctx.fillStyle = toneInk;
  ctx.fillText(t('recap.closing.next').toUpperCase(), PAD, qy - 2 * U - labelH / 2);
  setLetterSpacing(ctx, 0);

  blocks.forEach((lines, i) => {
    const d = 4 * U;
    ctx.fillStyle = toneInk;
    ctx.beginPath();
    ctx.arc(PAD + d / 2, qy + (size * lh) / 2, d / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.font = weightFont(700, 2.6 * U, FONT.ui);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), PAD + d / 2, qy + (size * lh) / 2);
    ctx.textAlign = 'left';

    qy = drawLines(ctx, lines, textX, qy, {
      size, lineHeight: lh, weight: 400, emWeight: 400, family: FONT.body, color: COLORS.inkSoft, emColor: COLORS.inkSoft,
    }) + gap;
  });
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

/**
 * Paint one card's back, public wording only, onto a `CARD_W`×`CARD_H` canvas
 * context. The caller owns the canvas and any rounding or shadow around it.
 */
export function drawCardBack(ctx: Ctx, input: DrawInput): void {
  const tone = toneFor(input.key).light;
  const toneInk = tintInk(tone, 40);
  const { card } = input;

  ctx.save();
  paintBackground(ctx, tone);
  const contentTop = paintTopic(ctx, input, toneInk) + 1;

  let left = '';
  switch (card.kind) {
    case 'cover':   left = t('recap.cover.basis', { n: card.notes }); break;
    case 'traits':  left = t('recap.base.traits'); break;
    case 'chapter': left = t('recap.base.public'); break;
    case 'closing': left = ''; break;
  }
  const contentBottom = paintBase(ctx, input, toneInk, left);

  switch (card.kind) {
    case 'cover':   drawCover(ctx, card, contentTop, contentBottom, toneInk); break;
    case 'traits':  drawTraits(ctx, card, contentTop, contentBottom, toneInk); break;
    case 'chapter': drawChapter(ctx, card, contentTop, contentBottom); break;
    case 'closing': drawClosing(ctx, card, contentTop, contentBottom, toneInk); break;
  }
  ctx.restore();
}

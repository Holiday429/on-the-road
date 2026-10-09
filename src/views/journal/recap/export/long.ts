/* ==========================================================================
   On the Road · Recap export — the long image
   --------------------------------------------------------------------------
   One PNG of the chosen cards, with the brand at the head and a code to the
   site at the foot: something that can be posted on its own and still invite the
   reader in.

   Three cards to a row. One column made nine cards ~11,900px tall — a strip that
   social apps squash to a sliver. Three across keeps a full deck near 2:3 (about
   2400×3800), a shape a feed shows whole. The cost is size on screen: once a
   phone fits the image to its width a card's text is small, so the canvas is wide
   (each card 688px) to leave real pixels to zoom into.

   A last row that isn't full is centred rather than left-aligned.

   Height is bounded. Browsers cap a canvas's total area (iOS Safari at 16.7M
   pixels), so an unusually long deck is rendered at a reduced scale rather than
   failing to produce an image at all.
   ========================================================================== */

import { t } from '../../../../core/i18n.ts';
import { COLORS } from '../../card/card-spec.ts';
import type { Card } from '../render.ts';
import { CARD_H, CARD_W, FONT, drawCardBack } from './draw.ts';
import { SITE_URL, displayUrl, drawQr } from './qr.ts';

export const LONG_W = 2400;
export const COLUMNS = 3;
const MARGIN = 120;
const GAP = 48;
/** (2400 − 2·120 − 2·48) / 3 = 688 */
const CARD_DRAW_W = (LONG_W - MARGIN * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
const CARD_DRAW_H = Math.round((CARD_DRAW_W * 4) / 3);      // 917
const CARD_RADIUS = 32;
const HEADER_H = 400;
const FOOTER_H = 500;
/** Stay well inside the smallest common canvas-area limit (16,777,216). */
export const MAX_PIXELS = 14_000_000;

export interface LongPlan {
  width: number;
  height: number;
  headerH: number;
  /** Top-left of each card, in px. */
  cardRects: Array<{ x: number; y: number }>;
  /** Drawn size of every card. */
  cardW: number;
  cardH: number;
  rows: number;
  footerTop: number;
  /** Multiply the canvas size by this to stay inside MAX_PIXELS (1 = full size). */
  scale: number;
}

/** The geometry of the image for `count` cards. Pure, so the sizing rules are testable. */
export function planLong(count: number): LongPlan {
  const headerH = HEADER_H;
  const rows = Math.ceil(count / COLUMNS);
  const cardRects = Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / COLUMNS);
    const inRow = Math.min(COLUMNS, count - row * COLUMNS);   // a short last row is centred
    const rowW = inRow * CARD_DRAW_W + (inRow - 1) * GAP;
    const x = (LONG_W - rowW) / 2 + (i % COLUMNS) * (CARD_DRAW_W + GAP);
    return { x, y: headerH + row * (CARD_DRAW_H + GAP) };
  });
  const footerTop = headerH + rows * CARD_DRAW_H + Math.max(0, rows - 1) * GAP + GAP;
  const height = footerTop + FOOTER_H;
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (LONG_W * height)));
  return { width: LONG_W, height, headerH, cardRects, cardW: CARD_DRAW_W, cardH: CARD_DRAW_H, rows, footerTop, scale };
}

export interface LongInput {
  cards: Array<{ card: Card; key: string }>;
  /** Optional brand mark, loaded by the caller (failure to load must not block the export). */
  logo?: CanvasImageSource | null;
  /** Creates the offscreen canvases the cards are drawn on. Defaults to the DOM. */
  makeCanvas?: (w: number, h: number) => HTMLCanvasElement;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const domCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Render the long image. The cards inside are numbered 1…n in the order given. */
export function renderLongImage(input: LongInput): HTMLCanvasElement {
  const make = input.makeCanvas ?? domCanvas;
  const plan = planLong(input.cards.length);

  const canvas = make(Math.round(plan.width * plan.scale), Math.round(plan.height * plan.scale));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(plan.scale, plan.scale);

  // Ground: warm paper with a faint amber wash at the head.
  ctx.fillStyle = '#f7f5f0';
  ctx.fillRect(0, 0, plan.width, plan.height);
  const wash = ctx.createLinearGradient(0, 0, 0, plan.headerH + 200);
  wash.addColorStop(0, 'rgba(249,184,48,0.20)');
  wash.addColorStop(1, 'rgba(249,184,48,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, plan.width, plan.headerH + 200);

  paintHeader(ctx, plan, input.logo ?? null);

  input.cards.forEach((entry, i) => {
    const tile = make(CARD_W, CARD_H);
    drawCardBack(tile.getContext('2d')!, { card: entry.card, key: entry.key, page: i + 1, total: input.cards.length });
    const { x, y } = plan.cardRects[i];

    // Shadow under a filled rounded rect, then the card clipped to the same shape.
    ctx.save();
    ctx.shadowColor = 'rgba(28,25,23,0.16)';
    ctx.shadowBlur = 35;
    ctx.shadowOffsetY = 13;
    ctx.fillStyle = '#ffffff';
    roundRectPath(ctx, x, y, plan.cardW, plan.cardH, CARD_RADIUS);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, x, y, plan.cardW, plan.cardH, CARD_RADIUS);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tile, x, y, plan.cardW, plan.cardH);
    ctx.restore();
  });

  paintFooter(ctx, plan, input.logo ?? null);
  return canvas;
}

/**
 * Brand and title only. The archetype is NOT repeated here: the first card is
 * the archetype, directly below, and saying it twice in a row reads as a stutter.
 */
function paintHeader(ctx: CanvasRenderingContext2D, plan: LongPlan, logo: CanvasImageSource | null): void {
  const size = 180;
  const top = (plan.headerH - size) / 2 + 20;
  ctx.textBaseline = 'middle';

  if (logo) {
    ctx.save();
    roundRectPath(ctx, MARGIN, top, size, size, size / 2);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(MARGIN, top, size, size);
    ctx.drawImage(logo, MARGIN, top, size, size);
    ctx.restore();
  }
  const textX = MARGIN + (logo ? size + 48 : 0);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 84px ${FONT.ui}`;
  ctx.fillText('On the Road', textX, top + size / 2 - 34);
  ctx.fillStyle = COLORS.inkMuted;
  ctx.font = `500 50px ${FONT.ui}`;
  ctx.fillText(t('recap.longimg.title'), textX, top + size / 2 + 50);
}

function paintFooter(ctx: CanvasRenderingContext2D, plan: LongPlan, logo: CanvasImageSource | null): void {
  const top = plan.footerTop;
  ctx.strokeStyle = 'rgba(28,25,23,0.12)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(MARGIN, top + 50);
  ctx.lineTo(plan.width - MARGIN, top + 50);
  ctx.stroke();

  const qr = 320;
  const qrX = plan.width - MARGIN - qr;
  const qrY = top + 110;
  ctx.save();
  ctx.shadowColor = 'rgba(28,25,23,0.12)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 10;
  drawQr(ctx, SITE_URL, qrX, qrY, qr, COLORS.ink);
  ctx.restore();

  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 60px ${FONT.ui}`;
  const maxText = qrX - MARGIN - 60;
  const cta = t('recap.longimg.cta');
  let line = cta;
  while (line.length > 1 && ctx.measureText(line).width > maxText) line = line.slice(0, -1);
  ctx.fillText(line === cta ? line : `${line}…`, MARGIN, qrY + 80);

  ctx.fillStyle = COLORS.inkMuted;
  ctx.font = `500 44px ${FONT.ui}`;
  ctx.fillText(displayUrl(), MARGIN, qrY + 170);

  const mark = 96;
  const markY = qrY + qr - mark;
  if (logo) {
    ctx.save();
    roundRectPath(ctx, MARGIN, markY, mark, mark, mark / 2);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(MARGIN, markY, mark, mark);
    ctx.drawImage(logo, MARGIN, markY, mark, mark);
    ctx.restore();
  }
  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 46px ${FONT.ui}`;
  ctx.fillText('On the Road', MARGIN + (logo ? mark + 28 : 0), markY + mark / 2);
}

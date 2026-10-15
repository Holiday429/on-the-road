/* ==========================================================================
   On the Road · Passport share image — drawing (pure)
   --------------------------------------------------------------------------
   The passport as one picture: whose it is, what it adds up to, the dotted
   world with the visited countries lit, and the latest stamps pressed on the
   paper. 1080 × 1440 (3:4), always cream paper and ink — it leaves the app.

   The context is passed in rather than created, so the layout is tested against
   a recording fake with no canvas. Stamps arrive already rasterised
   (stamp-raster.ts); a stamp with no image is simply left out.
   ========================================================================== */

import { drawQr } from '../journal/recap/export/qr.ts';
import { FONT } from '../journal/recap/export/draw.ts';
import { DOT_COLS, dotMapCells } from '../../data/dot-map.ts';
import { SHARE } from './share-palette.ts';

export const SHARE_W = 1080;
/** Everything above the stamps: header, name, totals, the dotted world. Fixed, whatever the passport holds. */
const HEAD_H = 905;
/** The footer: the rule, the invitation and the QR code. */
const FOOT_H = 155;
/** The shortest the picture can be — a passport with a stamp or two still reads as a 3:4 card. */
export const SHARE_MIN_H = 1440;
/** Kept for the layout's old name; the picture is no longer capped at this. @deprecated */
export const SHARE_H = SHARE_MIN_H;

const MARGIN = 64;
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

export interface ShareStamp {
  /** The rasterised stamp, square; null = could not be drawn. */
  image: CanvasImageSource | null;
  /** Degrees. */
  rotation: number;
}

export interface ShareInput {
  nickname: string;
  passportNo: string;
  issued: string;
  /** The traveller's title ("Wanderer"), already in their language. */
  level: string;
  stats: { countries: number; cities: number; nights: number; trips: number };
  /** Words, already translated. */
  words: {
    title: string; issued: string; countries: string; cities: string; nights: string; trips: string;
    visited: string; more: string; invite: string;
  };
  /** ISO codes of every visited country. */
  isos: string[];
  stamps: ShareStamp[];
  logo: HTMLImageElement | null;
  url: string;
}

export interface StampSlot { cx: number; cy: number; size: number }

/** How the stamps are laid out for `n` of them: a grid wide enough to keep them big without crowding. */
export function stampGrid(n: number): { cols: number; rows: number; size: number; rowH: number } {
  const count = Math.max(0, n);
  // Few stamps stay large; many go into a wider grid so they still fit side by side.
  const cols = count <= 2 ? Math.max(1, count) : count <= 12 ? 4 : count <= 24 ? 5 : 6;
  const rows = Math.ceil(count / cols) || 0;
  const cell = (SHARE_W - MARGIN * 2) / cols;
  const size = Math.round(Math.min(cell * 0.95, count <= 2 ? 300 : 240));
  // Rows overlap a little, the way stamps crowd a real page.
  const rowH = Math.round(size * (cols >= 5 ? 0.84 : 0.88));
  return { cols, rows, size, rowH };
}

/** How tall the whole picture is for `n` stamps: the fixed parts, plus however many rows of stamps there are. */
export function shareHeight(n: number): number {
  const { rows, size, rowH } = stampGrid(n);
  const block = rows === 0 ? 0 : rowH * (rows - 1) + size;
  const zone = block + (rows > 0 ? 110 : 40);
  return Math.max(SHARE_MIN_H, Math.round(HEAD_H + zone + FOOT_H));
}

/** Where each of `n` stamps goes: rows centred in the grid, the whole block centred under the map. Every stamp gets a slot. */
export function stampSlots(n: number): StampSlot[] {
  const count = Math.max(0, n);
  if (count === 0) return [];
  const { cols, rows, size, rowH } = stampGrid(count);
  const cell = (SHARE_W - MARGIN * 2) / cols;
  const top = HEAD_H + 46 + size / 2;
  const slots: StampSlot[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, count - r * cols);
    const left = (SHARE_W - inRow * cell) / 2 + cell / 2;
    for (let c = 0; c < inRow; c++) {
      // A little offset, fixed by position, so the stamps look pressed by hand rather than set on a grid.
      const jx = ((r * 3 + c * 5) % 7 - 3) * 3;
      const jy = ((r * 5 + c * 3) % 5 - 2) * 3;
      slots.push({ cx: left + c * cell + jx, cy: top + r * rowH + jy, size });
    }
  }
  return slots;
}

type Ctx = CanvasRenderingContext2D;

function spacing(ctx: Ctx, px: number): void {
  // Not every engine has it; without it the small caps are simply a little tighter.
  (ctx as unknown as { letterSpacing?: string }).letterSpacing = `${px}px`;
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, width: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** The biggest size ≤ `max` at which `text` fits `width`, never below `min`. */
function fitFont(ctx: Ctx, text: string, weight: number, family: string, max: number, min: number, width: number): number {
  let size = max;
  for (; size > min; size -= 4) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= width) break;
  }
  return size;
}

export function drawPassportShare(ctx: Ctx, input: ShareInput): void {
  const inner = SHARE_W - MARGIN * 2;
  const w = input.words;
  // The picture is as tall as the stamps need; everything above them is fixed, the footer hangs off the bottom.
  const H = shareHeight(input.stamps.length);

  // Paper, with a fine inset rule like the edge of a page.
  ctx.fillStyle = SHARE.paper;
  ctx.fillRect(0, 0, SHARE_W, H);
  ctx.strokeStyle = SHARE.paperEdge;
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, SHARE_W - 48, H - 48);

  // Header: the word on the cover, and the number.
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.ink;
  ctx.font = `600 34px ${FONT.ui}`;
  spacing(ctx, 11);
  ctx.fillText(w.title.toUpperCase(), MARGIN, 118);
  spacing(ctx, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = SHARE.inkSoft;
  ctx.font = `500 26px ${MONO}`;
  ctx.fillText(`N° ${input.passportNo}`, SHARE_W - MARGIN, 116);
  line(ctx, MARGIN, 140, SHARE_W - MARGIN, 140, 3, SHARE.ink);

  // Name, and when it was issued.
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.ink;
  const nameSize = fitFont(ctx, input.nickname, 700, FONT.ui, 104, 44, inner);
  ctx.font = `700 ${nameSize}px ${FONT.ui}`;
  ctx.fillText(input.nickname, MARGIN, 250);
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 27px ${MONO}`;
  ctx.fillText(`${w.issued} ${input.issued}  ·  ${input.level}`, MARGIN, 304);

  // What it adds up to.
  const cols: Array<[number, string]> = [
    [input.stats.countries, w.countries], [input.stats.cities, w.cities], [input.stats.nights, w.nights], [input.stats.trips, w.trips],
  ];
  const colW = inner / cols.length;
  line(ctx, MARGIN, 350, SHARE_W - MARGIN, 350, 1.5, SHARE.rule);
  line(ctx, MARGIN, 520, SHARE_W - MARGIN, 520, 1.5, SHARE.rule);
  cols.forEach(([n, label], i) => {
    const cx = MARGIN + colW * i + colW / 2;
    if (i > 0) line(ctx, MARGIN + colW * i, 372, MARGIN + colW * i, 498, 1.5, SHARE.rule);
    ctx.textAlign = 'center';
    ctx.fillStyle = SHARE.ink;
    ctx.font = `700 78px ${MONO}`;
    ctx.fillText(n.toLocaleString(), cx, 444);
    ctx.fillStyle = SHARE.inkMuted;
    ctx.font = `500 22px ${MONO}`;
    spacing(ctx, 4);
    ctx.fillText(label.toUpperCase(), cx, 486);
    spacing(ctx, 0);
  });

  // The dotted world, the visited countries lit.
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 22px ${MONO}`;
  spacing(ctx, 4);
  ctx.fillText(w.visited.toUpperCase(), MARGIN, 568);
  spacing(ctx, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = SHARE.accent;
  ctx.fillText(String(input.stats.countries), SHARE_W - MARGIN, 568);
  const mapW = 760;
  const cell = mapW / DOT_COLS;
  const mapX = (SHARE_W - mapW) / 2;
  const mapY = 588;
  const cells = dotMapCells(input.isos);
  ctx.fillStyle = SHARE.dot;
  for (const c of cells) {
    if (c.lit) continue;
    ctx.beginPath();
    ctx.arc(mapX + c.x * cell + cell / 2, mapY + c.y * cell + cell / 2, cell * 0.26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = SHARE.accent;
  for (const c of cells) {
    if (!c.lit) continue;
    ctx.beginPath();
    ctx.arc(mapX + c.x * cell + cell / 2, mapY + c.y * cell + cell / 2, cell * 0.46, 0, Math.PI * 2);
    ctx.fill();
  }

  // The latest stamps, pressed on the paper.
  const slots = stampSlots(input.stamps.length);
  input.stamps.slice(0, slots.length).forEach((s, i) => {
    if (!s.image) return;
    const { cx, cy, size } = slots[i];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((s.rotation * Math.PI) / 180);
    // Ink soaks into paper rather than covering it — the same multiply the stamps use on the page.
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(s.image, -size / 2, -size / 2, size, size);
    ctx.restore();
  });
  if (w.more) {
    ctx.textAlign = 'right';
    ctx.fillStyle = SHARE.inkMuted;
    ctx.font = '600 40px Caveat, "DM Sans", cursive';
    ctx.fillText(w.more, SHARE_W - MARGIN, H - FOOT_H - 24);
  }

  // Footer: an invitation, not a link to this passport. Measured from the foot, so it sits on the edge of any height.
  const footTop = H - FOOT_H;
  line(ctx, MARGIN, footTop, SHARE_W - MARGIN, footTop, 1.5, SHARE.rule);
  const qr = 96;
  drawQr(ctx, input.url, SHARE_W - MARGIN - qr, footTop + 14, qr, SHARE.ink);
  let textX = MARGIN;
  if (input.logo) {
    ctx.drawImage(input.logo, MARGIN, footTop + 28, 64, 64);
    textX = MARGIN + 84;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.ink;
  ctx.font = `600 30px ${FONT.ui}`;
  ctx.fillText(w.invite, textX, footTop + 56);
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText(input.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), textX, footTop + 92);
}

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
export const SHARE_H = 1440;
/** Stamps that fit on the image: two rows of four. */
export const MAX_SHARE_STAMPS = 8;

const MARGIN = 64;
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
const STAMP_ZONE = { top: 905, bottom: 1285 };
const COLS = 4;

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

/** Where each of `n` stamps goes: rows of up to four, each row centred, the whole block centred in the zone. */
export function stampSlots(n: number): StampSlot[] {
  const count = Math.min(Math.max(n, 0), MAX_SHARE_STAMPS);
  if (count === 0) return [];
  const rows = Math.ceil(count / COLS);
  const cell = (SHARE_W - MARGIN * 2) / COLS;
  const size = rows === 1 ? 240 : 224;
  const rowH = rows === 1 ? size : 196;
  const blockH = rowH * (rows - 1) + size;
  const top = STAMP_ZONE.top + ((STAMP_ZONE.bottom - STAMP_ZONE.top) - blockH) / 2 + size / 2;
  const slots: StampSlot[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(COLS, count - r * COLS);
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

  // Paper, with a fine inset rule like the edge of a page.
  ctx.fillStyle = SHARE.paper;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  ctx.strokeStyle = SHARE.paperEdge;
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, SHARE_W - 48, SHARE_H - 48);

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
    ctx.fillText(w.more, SHARE_W - MARGIN, STAMP_ZONE.bottom + 38);
  }

  // Footer: an invitation, not a link to this passport.
  line(ctx, MARGIN, 1318, SHARE_W - MARGIN, 1318, 1.5, SHARE.rule);
  const qr = 96;
  drawQr(ctx, input.url, SHARE_W - MARGIN - qr, 1332, qr, SHARE.ink);
  let textX = MARGIN;
  if (input.logo) {
    ctx.drawImage(input.logo, MARGIN, 1346, 64, 64);
    textX = MARGIN + 84;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.ink;
  ctx.font = `600 30px ${FONT.ui}`;
  ctx.fillText(w.invite, textX, 1374);
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText(input.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), textX, 1410);
}

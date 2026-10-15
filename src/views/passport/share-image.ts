/* ==========================================================================
   On the Road · Passport share image — drawing (pure)
   --------------------------------------------------------------------------
   The passport as one picture, in the shape a passport actually is: an open
   book, landscape, a cover of cloth around two cream pages either side of a
   spine. The left page is the data page the traveller's own book opens on —
   the portrait frame, the guilloche, the nickname and the machine-readable
   lines — carrying NOTHING real: no legal name, no document number, no date
   of birth, whatever the traveller keeps in their own passport page. The
   right page is a stamps page, every stamp pressed onto it.

   The picture is a fixed 3:2 spread. More stamps make the stamps smaller and
   the grid wider; they never make the picture taller, because a passport is
   not a scroll. Always cream paper and ink whatever theme the app is in — it
   leaves the app.

   The context is passed in rather than created, so the layout is tested against
   a recording fake with no canvas. Stamps arrive already rasterised
   (stamp-raster.ts); a stamp with no image is simply left out.
   ========================================================================== */

import { drawQr } from '../journal/recap/export/qr.ts';
import { FONT } from '../journal/recap/export/draw.ts';
import { DOT_COLS, DOT_ROWS, dotMapCells } from '../../data/dot-map.ts';
import { SHARE } from './share-palette.ts';

/** An open passport, landscape: two pages side by side, near enough 3:2. */
export const SHARE_W = 1600;
export const SHARE_H = 1080;
/** Kept for the name the old portrait layout used. @deprecated the picture is one fixed size now. */
export const SHARE_MIN_H = SHARE_H;

/** The desk the book lies on, outside the cover. */
const MARGIN = 54;
/** The cover's own border, outside the pages. */
const COVER_PAD = 30;
/** The gutter between the two pages. */
const SPINE_W = 26;
/** The strip under the book: the invitation and the QR code. */
const FOOT_H = 128;

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
  /** ISO alpha-2, for the machine-readable lines; '' when they have not said. */
  nationality?: string;
  /** The country they travel as, in words — never a document, just what the cover page shows. */
  nationalityLabel?: string;
  /** The cloth colour of the traveller's own cover; the default navy when they have not dressed it. */
  coverColor?: string;
  /** The portrait, loaded and allowed on a canvas; null = draw the nickname's initial instead. */
  photo?: CanvasImageSource | null;
  stats: { countries: number; cities: number; nights: number; trips: number };
  /** Words, already translated. */
  words: {
    title: string; issued: string; countries: string; cities: string; nights: string; trips: string;
    visited: string; more: string; invite: string;
    nickname: string; nationality: string; level: string; stamps: string;
  };
  /** The two machine-readable lines, already built (bio.ts) — decoration, no real document in them. */
  mrz: [string, string];
  /** ISO codes of every visited country. */
  isos: string[];
  stamps: ShareStamp[];
  logo: HTMLImageElement | null;
  url: string;
}

export interface StampSlot { cx: number; cy: number; size: number }

/** The book's own box on the picture. */
function bookBox(): { x: number; y: number; w: number; h: number } {
  const x = MARGIN;
  const y = MARGIN;
  const w = SHARE_W - MARGIN * 2;
  const h = SHARE_H - MARGIN - FOOT_H;
  return { x, y, w, h };
}

/** One page's box. `side` 0 = left (data), 1 = right (stamps). */
export function pageBox(side: 0 | 1): { x: number; y: number; w: number; h: number } {
  const b = bookBox();
  const w = (b.w - COVER_PAD * 2 - SPINE_W) / 2;
  const x = b.x + COVER_PAD + (side === 1 ? w + SPINE_W : 0);
  return { x, y: b.y + COVER_PAD, w, h: b.h - COVER_PAD * 2 };
}

/**
 * How the stamps are laid out for `n` of them on the right page. The page is a fixed size, so a fuller
 * passport means a wider grid and smaller stamps — never a taller picture.
 */
export function stampGrid(n: number): { cols: number; rows: number; size: number; rowH: number } {
  const count = Math.max(0, n);
  const page = pageBox(1);
  const availW = page.w - 48;
  const availH = page.h - 96;
  // Start from the squarest grid that holds them, then widen until the rows fit the page's height too.
  let cols = Math.max(1, Math.ceil(Math.sqrt(count * (availW / Math.max(1, availH)))));
  let rows = Math.ceil(count / cols) || 0;
  let size = 0;
  for (; cols <= Math.max(1, count); cols++) {
    rows = Math.ceil(count / cols) || 0;
    const byW = availW / cols;
    // Rows overlap a little, the way stamps crowd a real page.
    const byH = rows > 0 ? availH / (0.84 * (rows - 1) + 1) : availH;
    size = Math.min(byW * 0.94, byH, 260);
    if (rows === 0 || 0.84 * (rows - 1) * size + size <= availH) break;
  }
  size = Math.round(Math.max(44, size));
  return { cols, rows, size, rowH: Math.round(size * 0.84) };
}

/** The picture is one fixed size — the signature stays for the callers that ask how tall to make the canvas. */
export function shareHeight(_n = 0): number {
  return SHARE_H;
}

/** Where each of `n` stamps goes on the right page. Every stamp gets a slot. */
export function stampSlots(n: number): StampSlot[] {
  const count = Math.max(0, n);
  if (count === 0) return [];
  const { cols, rows, size, rowH } = stampGrid(count);
  const page = pageBox(1);
  const availW = page.w - 48;
  const cell = availW / cols;
  const block = rowH * (rows - 1) + size;
  // Below the page's own heading, centred in what is left.
  const fieldTop = page.y + 72;
  const fieldH = page.y + page.h - 24 - fieldTop;
  const top = fieldTop + Math.max(0, (fieldH - block) / 2) + size / 2;
  const slots: StampSlot[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, count - r * cols);
    const left = page.x + 24 + (availW - inRow * cell) / 2 + cell / 2;
    for (let c = 0; c < inRow; c++) {
      // A little offset, fixed by position, so the stamps look pressed by hand rather than set on a grid.
      const jitter = Math.min(6, size * 0.04);
      const jx = ((r * 3 + c * 5) % 7 - 3) * jitter;
      const jy = ((r * 5 + c * 3) % 5 - 2) * jitter;
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

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The biggest size ≤ `max` at which `text` fits `width`, never below `min`. */
function fitFont(ctx: Ctx, text: string, weight: number, family: string, max: number, min: number, width: number): number {
  let size = max;
  for (; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= width) break;
  }
  return size;
}

/** Draws `img` to fill the box the way object-fit: cover does (centred, the overflow cropped). */
function drawCover(ctx: Ctx, img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
  const src = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const iw = src.naturalWidth || src.width || w;
  const ih = src.naturalHeight || src.height || h;
  const k = Math.max(w / iw, h / ih);
  const dw = iw * k;
  const dh = ih * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * A portrait frame on the data page: the traveller's photo when there is one (toned down like the real page's),
 * else the pale sky wash with the nickname's initial. `ghost` is the small second portrait, in black and white.
 */
function portrait(ctx: Ctx, photo: CanvasImageSource | null, initial: string, x: number, y: number, w: number, h: number, r: number, ghost: boolean): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (photo) {
    ctx.fillStyle = SHARE.photoTop;
    ctx.fillRect(x, y, w, h);
    // Not every engine filters a canvas; without it the picture is simply as it was taken.
    (ctx as unknown as { filter?: string }).filter = ghost ? 'grayscale(1) contrast(0.85)' : 'saturate(0.8) contrast(1.04)';
    if (ghost) ctx.globalAlpha = 0.5;
    drawCover(ctx, photo, x, y, w, h);
    (ctx as unknown as { filter?: string }).filter = 'none';
    ctx.globalAlpha = 1;
  } else if (ghost) {
    ctx.fillStyle = SHARE.photoGhost;
    ctx.fillRect(x, y, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(42, 37, 32, 0.26)';
    ctx.font = `700 ${Math.round(w * 0.5)}px ${FONT.ui}`;
    ctx.fillText(initial, x + w / 2, y + h / 2 + w * 0.18);
  } else {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, SHARE.photoTop);
    grad.addColorStop(1, SHARE.photoBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(42, 37, 32, 0.4)';
    ctx.font = `700 ${Math.round(w * 0.52)}px ${FONT.ui}`;
    ctx.fillText(initial, x + w / 2, y + h / 2 + w * 0.19);
  }
  ctx.restore();
  if (!ghost) {
    ctx.strokeStyle = SHARE.rule;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
  }
}

export function drawPassportShare(ctx: Ctx, input: ShareInput): void {
  const w = input.words;

  // The desk the book lies on.
  ctx.fillStyle = SHARE.desk;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);

  /* ── The cover: cloth, with the foil rule of the real one ───────────────── */
  const b = bookBox();
  ctx.save();
  roundRect(ctx, b.x, b.y, b.w, b.h, 18);
  ctx.clip();
  ctx.fillStyle = input.coverColor || SHARE.cover;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  const sheen = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y);
  sheen.addColorStop(0, 'rgba(255,255,255,0.06)');
  sheen.addColorStop(0.5, 'rgba(0,0,0,0.16)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = sheen;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, b.x, b.y, b.w, b.h, 18);
  ctx.stroke();

  /* ── The two pages ──────────────────────────────────────────────────────── */
  const L = pageBox(0);
  const R = pageBox(1);
  for (const p of [L, R]) {
    roundRect(ctx, p.x, p.y, p.w, p.h, 6);
    ctx.fillStyle = SHARE.paper;
    ctx.fill();
  }

  // The spine: a shadowed gutter between the two, so the spread reads as one open book.
  const gutter = ctx.createLinearGradient(L.x + L.w, 0, R.x, 0);
  gutter.addColorStop(0, 'rgba(0,0,0,0)');
  gutter.addColorStop(0.45, 'rgba(0,0,0,0.2)');
  gutter.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  gutter.addColorStop(0.55, 'rgba(0,0,0,0.2)');
  gutter.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gutter;
  ctx.fillRect(L.x + L.w, L.y, SPINE_W, L.h);
  // A whisper of shade at the inner edge of each page, as if it curved into the spine.
  const shadeL = ctx.createLinearGradient(L.x + L.w - 44, 0, L.x + L.w, 0);
  shadeL.addColorStop(0, 'rgba(0,0,0,0)');
  shadeL.addColorStop(1, 'rgba(0,0,0,0.09)');
  ctx.fillStyle = shadeL;
  ctx.fillRect(L.x + L.w - 44, L.y, 44, L.h);
  const shadeR = ctx.createLinearGradient(R.x, 0, R.x + 44, 0);
  shadeR.addColorStop(0, 'rgba(0,0,0,0.09)');
  shadeR.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadeR;
  ctx.fillRect(R.x, R.y, 44, R.h);

  drawDataPage(ctx, input, L);
  drawStampsPage(ctx, input, R);

  /* ── Under the book: an invitation, not a link to this passport ─────────── */
  const footTop = SHARE_H - FOOT_H;
  const qr = 84;
  drawQr(ctx, input.url, SHARE_W - MARGIN - qr, footTop + 22, qr, SHARE.ink);
  let textX = MARGIN;
  if (input.logo) {
    ctx.drawImage(input.logo, MARGIN, footTop + 30, 56, 56);
    textX = MARGIN + 72;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = SHARE.ink;
  ctx.font = `600 28px ${FONT.ui}`;
  ctx.fillText(w.invite, textX, footTop + 58);
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 22px ${MONO}`;
  ctx.fillText(input.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), textX, footTop + 90);
}

/* ── The left page: the data page, with nothing real on it ──────────────────── */
function drawDataPage(ctx: Ctx, input: ShareInput, p: { x: number; y: number; w: number; h: number }): void {
  const pad = 34;
  const w = input.words;
  const inner = p.w - pad * 2;

  ctx.save();
  roundRect(ctx, p.x, p.y, p.w, p.h, 6);
  ctx.clip();

  // Security-print linework, the same faint guilloche the real page carries.
  ctx.strokeStyle = SHARE.ink;
  ctx.globalAlpha = 0.07;
  ctx.lineWidth = 1;
  const gcx = p.x + p.w * 0.72;
  const gcy = p.y + p.h * 0.26;
  for (let i = 0; i < 18; i++) {
    ctx.save();
    ctx.translate(gcx, gcy);
    ctx.rotate((i * Math.PI) / 18);
    ctx.beginPath();
    ctx.ellipse(0, 0, p.w * 0.38, p.w * 0.17, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  /* Head: the word on the cover, and the booklet's own serial. */
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.ink;
  ctx.font = `600 26px ${FONT.ui}`;
  spacing(ctx, 8);
  ctx.fillText(w.title.toUpperCase(), p.x + pad, p.y + pad + 22);
  spacing(ctx, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = SHARE.inkSoft;
  ctx.font = `500 20px ${MONO}`;
  ctx.fillText(`N° ${input.passportNo}`, p.x + p.w - pad, p.y + pad + 21);
  const headRule = p.y + pad + 38;
  line(ctx, p.x + pad, headRule, p.x + p.w - pad, headRule, 2, SHARE.ink);

  /* The portrait frame and the fields beside it. */
  const photoW = Math.round(inner * 0.28);
  const photoH = Math.round(photoW * 1.28);
  const photoX = p.x + pad;
  const photoY = headRule + 34;
  const initial = [...input.nickname.trim()][0]?.toUpperCase() ?? '?';
  portrait(ctx, input.photo ?? null, initial, photoX, photoY, photoW, photoH, 8, false);
  // The small ghost portrait under it, as the real page has: paler, and in black and white.
  const ghostW = Math.round(photoW * 0.46);
  const ghostH = Math.round(ghostW * 1.28);
  const ghostY = photoY + photoH + 16;
  portrait(ctx, input.photo ?? null, initial, photoX, ghostY, ghostW, ghostH, 5, true);

  /* The fields: a nickname and what they have earned. Nothing a document would carry. */
  // Room between the portrait and what is written beside it: the details sit apart from the frame, not against it.
  const fx = photoX + photoW + 58;
  const fw = p.x + p.w - pad - fx;
  let fy = photoY + 10;
  const field = (label: string, value: string, big = false) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = SHARE.inkMuted;
    ctx.font = `500 15px ${MONO}`;
    spacing(ctx, 3);
    ctx.fillText(label.toUpperCase(), fx, fy);
    spacing(ctx, 0);
    ctx.fillStyle = SHARE.ink;
    if (big) {
      const size = fitFont(ctx, value, 700, FONT.ui, 46, 24, fw);
      ctx.font = `700 ${size}px ${FONT.ui}`;
      ctx.fillText(value, fx, fy + size * 0.82 + 6);
      fy += size * 0.82 + 50;
    } else {
      const size = fitFont(ctx, value, 600, MONO, 23, 15, fw);
      ctx.font = `600 ${size}px ${MONO}`;
      ctx.fillText(value, fx, fy + 28);
      fy += 72;
    }
  };
  field(w.nickname, input.nickname, true);
  if (input.nationalityLabel) field(w.nationality, input.nationalityLabel.toUpperCase());
  field(w.level, input.level.toUpperCase());
  field(w.issued, input.issued);

  /* The dotted world, in whatever room the page has left between the portrait and the totals. The map keeps its
     own proportions, so it is sized to the smaller of the width and the height on offer — never drawn under the
     totals. */
  const mrzTop = p.y + p.h - 64;
  const statsTop = mrzTop - 86;
  const mapTop = Math.max(fy + 6, ghostY + ghostH + 22);
  line(ctx, p.x + pad, mapTop, p.x + p.w - pad, mapTop, 1.5, SHARE.rule);
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 15px ${MONO}`;
  spacing(ctx, 3);
  ctx.fillText(w.visited.toUpperCase(), p.x + pad, mapTop + 26);
  spacing(ctx, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = SHARE.accent;
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText(String(input.stats.countries), p.x + p.w - pad, mapTop + 26);

  const mapAreaTop = mapTop + 40;
  const mapAreaH = Math.max(40, statsTop - 14 - mapAreaTop);
  const cell = Math.min(inner / DOT_COLS, mapAreaH / DOT_ROWS);
  const mapW = cell * DOT_COLS;
  const mapX = p.x + pad + (inner - mapW) / 2;
  const mapY = mapAreaTop + (mapAreaH - cell * DOT_ROWS) / 2;
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

  /* What it adds up to, in a row above the machine-readable lines. */
  const cols: Array<[number, string]> = [
    [input.stats.countries, w.countries], [input.stats.cities, w.cities], [input.stats.nights, w.nights], [input.stats.trips, w.trips],
  ];
  line(ctx, p.x + pad, statsTop, p.x + p.w - pad, statsTop, 1.5, SHARE.rule);
  const colW = inner / cols.length;
  cols.forEach(([n, label], i) => {
    const cx = p.x + pad + colW * i + colW / 2;
    if (i > 0) line(ctx, p.x + pad + colW * i, statsTop + 14, p.x + pad + colW * i, statsTop + 70, 1.5, SHARE.rule);
    ctx.textAlign = 'center';
    ctx.fillStyle = SHARE.ink;
    ctx.font = `700 34px ${MONO}`;
    ctx.fillText(n.toLocaleString(), cx, statsTop + 48);
    ctx.fillStyle = SHARE.inkMuted;
    ctx.font = `500 14px ${MONO}`;
    spacing(ctx, 2);
    ctx.fillText(label.toUpperCase(), cx, statsTop + 70);
    spacing(ctx, 0);
  });

  /* The machine-readable lines: decoration, built from the nickname and the made-up serial. */
  ctx.fillStyle = SHARE.mrzBand;
  ctx.fillRect(p.x, mrzTop, p.w, p.y + p.h - mrzTop);
  line(ctx, p.x, mrzTop, p.x + p.w, mrzTop, 1.5, SHARE.rule);
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.inkSoft;
  const mrzSize = Math.min(19, Math.floor((inner / 44) * 1.72));
  ctx.font = `500 ${mrzSize}px ${MONO}`;
  ctx.fillText(input.mrz[0], p.x + pad, mrzTop + 26);
  ctx.fillText(input.mrz[1], p.x + pad, mrzTop + 50);

  ctx.restore();
}

/* ── The right page: the stamps, pressed on the paper ────────────────────────── */
function drawStampsPage(ctx: Ctx, input: ShareInput, p: { x: number; y: number; w: number; h: number }): void {
  const pad = 26;
  ctx.save();
  roundRect(ctx, p.x, p.y, p.w, p.h, 6);
  ctx.clip();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 15px ${MONO}`;
  spacing(ctx, 3);
  ctx.fillText(input.words.stamps.toUpperCase(), p.x + pad, p.y + pad + 20);
  spacing(ctx, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = SHARE.accent;
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText(String(input.stamps.length), p.x + p.w - pad, p.y + pad + 20);
  line(ctx, p.x + pad, p.y + pad + 34, p.x + p.w - pad, p.y + pad + 34, 1.5, SHARE.rule);

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

  if (input.words.more) {
    ctx.textAlign = 'right';
    ctx.fillStyle = SHARE.inkMuted;
    ctx.font = '600 26px Caveat, "DM Sans", cursive';
    ctx.fillText(input.words.more, p.x + p.w - pad, p.y + p.h - pad);
  }
  ctx.restore();
}

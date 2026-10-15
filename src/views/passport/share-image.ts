/* ==========================================================================
   On the Road · Passport share image — drawing (pure)
   --------------------------------------------------------------------------
   The passport as one picture, drawn as the open book itself reads: a navy
   cover frames a spread of two cream pages either side of a spine shadow —
   the left page is the data page (whose it is, what it adds up to, the
   dotted world), the right is a stamps page, every stamp pressed on it.
   Portrait overall (1080 wide, tall enough for the stamps, 3:4 at the
   shortest) so it shares well, but the spread inside it is unmistakably a
   passport, not a stat card. Always cream paper, ink and navy cloth,
   whatever theme the app is in — it leaves the app.

   The context is passed in rather than created, so the layout is tested against
   a recording fake with no canvas. Stamps arrive already rasterised
   (stamp-raster.ts); a stamp with no image is simply left out.
   ========================================================================== */

import { drawQr } from '../journal/recap/export/qr.ts';
import { FONT } from '../journal/recap/export/draw.ts';
import { DOT_COLS, dotMapCells } from '../../data/dot-map.ts';
import { SHARE } from './share-palette.ts';

export const SHARE_W = 1080;
const MARGIN = 56;
/** The navy cover's own border, outside the pages. */
const COVER_PAD = 26;
/** Header above the book: the word on the cover, the number, a rule. */
const HEAD_H = 118;
/** Footer below the book: a rule, the invitation and the QR code. */
const FOOT_H = 168;
/** Gap between the header/footer bands and the book itself. */
const BAND_GAP = 36;
/** The shortest the picture can be — a passport with a stamp or two still reads as a 3:4 card. */
export const SHARE_MIN_H = 1440;
/** Kept for the layout's old name; the picture is no longer capped at this. @deprecated */
export const SHARE_H = SHARE_MIN_H;

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

/** How wide the right-hand page is: the book's own width minus the left page and the spine. */
function pageW(): number {
  const bookW = SHARE_W - MARGIN * 2 - COVER_PAD * 2;
  const spine = 18;
  return (bookW - spine) / 2;
}

/** How the stamps are laid out for `n` of them on the right page: a grid wide enough to keep them legible. */
export function stampGrid(n: number): { cols: number; rows: number; size: number; rowH: number } {
  const count = Math.max(0, n);
  const avail = pageW() - 32;
  // Few stamps stay large; many go into a wider grid so they still fit side by side on the one page.
  const cols = count <= 2 ? Math.max(1, count) : count <= 6 ? 2 : count <= 12 ? 3 : 4;
  const rows = Math.ceil(count / cols) || 0;
  const cell = avail / cols;
  const size = Math.round(Math.min(cell * 0.92, count <= 2 ? 220 : 170));
  // Rows overlap a little, the way stamps crowd a real page.
  const rowH = Math.round(size * (cols >= 3 ? 0.8 : 0.86));
  return { cols, rows, size, rowH };
}

/** How tall the stamps page's own field is, for `n` stamps — the block of rows, with room to breathe. */
function stampsBlockH(n: number): number {
  const { rows, size, rowH } = stampGrid(n);
  if (rows === 0) return 0;
  return rowH * (rows - 1) + size;
}

/** The left (data) page's fixed content height: name, line, totals, map. Grows no further for more stamps. */
const LEFT_CONTENT_H = 1030;

/** How tall the whole picture is for `n` stamps: the book is as tall as the data page needs, or the stamps — whichever is more — plus the fixed header and footer. */
export function shareHeight(n: number): number {
  const stampsH = 100 + stampsBlockH(n) + (n > 0 ? 60 : 0);
  const bookH = Math.max(LEFT_CONTENT_H, stampsH) + COVER_PAD * 2;
  return Math.max(SHARE_MIN_H, Math.round(HEAD_H + BAND_GAP + bookH + BAND_GAP + FOOT_H));
}

/** Where each of `n` stamps goes on the right page, in picture coordinates. Every stamp gets a slot. */
export function stampSlots(n: number): StampSlot[] {
  const count = Math.max(0, n);
  if (count === 0) return [];
  const { cols, rows, size, rowH } = stampGrid(count);
  const H = shareHeight(count);
  const bookTop = HEAD_H + BAND_GAP;
  const bookH = H - HEAD_H - BAND_GAP - BAND_GAP - FOOT_H;
  const pageX = MARGIN + COVER_PAD + pageW() + 18;      // the spine's far edge: where the right page starts
  const pageTop = bookTop + COVER_PAD;
  const block = rowH * (rows - 1) + size;
  const top = pageTop + (bookH - COVER_PAD * 2 - block) / 2 + size / 2;
  const avail = pageW() - 32;
  const cell = avail / cols;
  const slots: StampSlot[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, count - r * cols);
    const left = pageX + 16 + (avail - inRow * cell) / 2 + cell / 2;
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
  for (; size > min; size -= 4) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= width) break;
  }
  return size;
}

export function drawPassportShare(ctx: Ctx, input: ShareInput): void {
  const w = input.words;
  const H = shareHeight(input.stamps.length);

  // The picture's own paper, behind everything — the margin around the book reads as the desk, not a page.
  ctx.fillStyle = SHARE.paper;
  ctx.fillRect(0, 0, SHARE_W, H);

  /* ── Header: the word on the cover, the number, a rule ──────────────────── */
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.ink;
  ctx.font = `600 32px ${FONT.ui}`;
  spacing(ctx, 10);
  ctx.fillText(w.title.toUpperCase(), MARGIN, 58);
  spacing(ctx, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = SHARE.inkSoft;
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText(`N° ${input.passportNo}`, SHARE_W - MARGIN, 56);
  line(ctx, MARGIN, 84, SHARE_W - MARGIN, 84, 2, SHARE.rule);

  /* ── The book: a navy cover framing two cream pages either side of a spine ─ */
  const bookTop = HEAD_H + BAND_GAP;
  const bookH = H - HEAD_H - BAND_GAP - BAND_GAP - FOOT_H;
  const bookW = SHARE_W - MARGIN * 2;
  const bookX = MARGIN;

  ctx.save();
  roundRect(ctx, bookX, bookTop, bookW, bookH, 22);
  ctx.clip();
  ctx.fillStyle = SHARE.cover;
  ctx.fillRect(bookX, bookTop, bookW, bookH);
  // A soft sheen, the way the cloth cover catches light near its spine.
  const sheen = ctx.createLinearGradient(bookX, bookTop, bookX + bookW, bookTop);
  sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.5, 'rgba(0,0,0,0.12)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = sheen;
  ctx.fillRect(bookX, bookTop, bookW, bookH);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, bookX, bookTop, bookW, bookH, 22);
  ctx.stroke();

  const pw = pageW();
  const leftX = bookX + COVER_PAD;
  const rightX = leftX + pw + 18;
  const pageY = bookTop + COVER_PAD;
  const pageH = bookH - COVER_PAD * 2;
  const r = 6;

  // Left (data) page.
  roundRect(ctx, leftX, pageY, pw, pageH, r);
  ctx.fillStyle = SHARE.paper;
  ctx.fill();
  // Right (stamps) page.
  roundRect(ctx, rightX, pageY, pw, pageH, r);
  ctx.fill();

  // The spine: a shadowed gutter between the two pages, so the spread reads as one open book.
  const spineX = leftX + pw;
  const spineW = rightX - spineX;
  const gutter = ctx.createLinearGradient(spineX, 0, rightX, 0);
  gutter.addColorStop(0, 'rgba(0,0,0,0)');
  gutter.addColorStop(0.45, 'rgba(0,0,0,0.16)');
  gutter.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  gutter.addColorStop(0.55, 'rgba(0,0,0,0.16)');
  gutter.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gutter;
  ctx.fillRect(spineX, pageY, spineW, pageH);
  // A whisper of shade at the inner edge of each page, as if it curved slightly into the spine.
  const shadeL = ctx.createLinearGradient(spineX - 34, 0, spineX, 0);
  shadeL.addColorStop(0, 'rgba(0,0,0,0)');
  shadeL.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = shadeL;
  ctx.fillRect(spineX - 34, pageY, 34, pageH);
  const shadeR = ctx.createLinearGradient(rightX, 0, rightX + 34, 0);
  shadeR.addColorStop(0, 'rgba(0,0,0,0.08)');
  shadeR.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadeR;
  ctx.fillRect(rightX, pageY, 34, pageH);

  drawDataPage(ctx, input, leftX, pageY, pw);
  drawStampsPage(ctx, input, rightX, pageY, pw, pageH);

  /* ── Footer: an invitation, not a link to this passport ─────────────────── */
  const footTop = H - FOOT_H;
  line(ctx, MARGIN, footTop, SHARE_W - MARGIN, footTop, 1.5, SHARE.rule);
  const qr = 92;
  drawQr(ctx, input.url, SHARE_W - MARGIN - qr, footTop + 24, qr, SHARE.ink);
  let textX = MARGIN;
  if (input.logo) {
    ctx.drawImage(input.logo, MARGIN, footTop + 36, 60, 60);
    textX = MARGIN + 78;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.ink;
  ctx.font = `600 29px ${FONT.ui}`;
  ctx.fillText(w.invite, textX, footTop + 66);
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 23px ${MONO}`;
  ctx.fillText(input.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), textX, footTop + 100);
}

/* ── The left page: whose it is, what it adds up to, the dotted world ───────── */
function drawDataPage(ctx: Ctx, input: ShareInput, x: number, y: number, pw: number): void {
  const pad = 32;
  const inner = pw - pad * 2;
  const w = input.words;

  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.ink;
  const nameSize = fitFont(ctx, input.nickname, 700, FONT.ui, 62, 30, inner);
  ctx.font = `700 ${nameSize}px ${FONT.ui}`;
  ctx.fillText(input.nickname, x + pad, y + pad + nameSize * 0.78);
  const nameBottom = y + pad + nameSize * 0.78 + 16;
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 19px ${MONO}`;
  ctx.fillText(`${w.issued} ${input.issued}`, x + pad, nameBottom + 24);
  ctx.fillStyle = SHARE.accent;
  ctx.font = `600 19px ${MONO}`;
  ctx.fillText(input.level, x + pad, nameBottom + 50);

  // What it adds up to — a 2×2 grid, since the page is narrower than the old single strip.
  const statsTop = nameBottom + 86;
  line(ctx, x + pad, statsTop, x + pw - pad, statsTop, 1.5, SHARE.rule);
  const cols: Array<[number, string]> = [
    [input.stats.countries, w.countries], [input.stats.cities, w.cities], [input.stats.nights, w.nights], [input.stats.trips, w.trips],
  ];
  const colW = inner / 2;
  const rowH = 118;
  cols.forEach(([n, label], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = x + pad + colW * col + colW / 2;
    const cy = statsTop + 30 + row * rowH;
    ctx.textAlign = 'center';
    ctx.fillStyle = SHARE.ink;
    ctx.font = `700 52px ${MONO}`;
    ctx.fillText(n.toLocaleString(), cx, cy + 44);
    ctx.fillStyle = SHARE.inkMuted;
    ctx.font = `500 17px ${MONO}`;
    spacing(ctx, 3);
    ctx.fillText(label.toUpperCase(), cx, cy + 74);
    spacing(ctx, 0);
  });
  line(ctx, x + pad + colW, statsTop + 16, x + pad + colW, statsTop + rowH * 2 - 16, 1.5, SHARE.rule);
  const mapTop = statsTop + rowH * 2 + 14;
  line(ctx, x + pad, mapTop, x + pw - pad, mapTop, 1.5, SHARE.rule);

  // The dotted world, the visited countries lit.
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 17px ${MONO}`;
  spacing(ctx, 3);
  ctx.fillText(w.visited.toUpperCase(), x + pad, mapTop + 30);
  spacing(ctx, 0);
  ctx.textAlign = 'right';
  ctx.fillStyle = SHARE.accent;
  ctx.font = `600 17px ${MONO}`;
  ctx.fillText(String(input.stats.countries), x + pw - pad, mapTop + 30);
  const mapW = inner;
  const cell = mapW / DOT_COLS;
  const mapX = x + pad;
  const mapY = mapTop + 48;
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
}

/* ── The right page: the stamps, pressed on the paper ────────────────────────── */
function drawStampsPage(ctx: Ctx, input: ShareInput, x: number, y: number, pw: number, ph: number): void {
  const pad = 20;
  ctx.textAlign = 'left';
  ctx.fillStyle = SHARE.inkMuted;
  ctx.font = `500 17px ${MONO}`;
  spacing(ctx, 3);
  ctx.fillText('STAMPS', x + pad, y + pad + 16);
  spacing(ctx, 0);
  line(ctx, x + pad, y + pad + 30, x + pw - pad, y + pad + 30, 1.5, SHARE.rule);

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
    ctx.font = '600 28px Caveat, "DM Sans", cursive';
    ctx.fillText(input.words.more, x + pw - pad, y + ph - pad);
  }
}

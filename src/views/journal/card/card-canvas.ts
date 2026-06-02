/* ==========================================================================
   On the Road · Share card — Canvas 2D renderer
   --------------------------------------------------------------------------
   `renderCardToCanvas` builds an off-screen canvas at @2x for a given entry +
   ratio. All four types share a skeleton (background → main visual → content →
   footer) and differ in the content band. Text wrapping is measured per glyph
   so mixed CJK/Latin lines break correctly (the canvas API does not wrap).
   ========================================================================== */

import { ensureCardFonts } from './card-fonts.ts';
import type { CardData } from './card-layout.ts';
import type { CardRatio } from './card-spec.ts';
import {
  CARD_WIDTH, SCALE, FOOTER_H, PAD, RADIUS, COLORS, FONTS,
  cardHeight, font, tintMix, tintInk,
} from './card-spec.ts';

export interface RenderOptions {
  ratio: CardRatio;
}

export async function renderCardToCanvas(
  data: CardData,
  opts: RenderOptions,
): Promise<HTMLCanvasElement> {
  await ensureCardFonts();

  const w = CARD_WIDTH;
  const h = cardHeight(opts.ratio);

  const canvas = document.createElement('canvas');
  canvas.width = w * SCALE;
  canvas.height = h * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'top';
  (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high';

  // Background paper
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, w, h);

  // Pre-load cover image (if any) so the type renderers can draw it synchronously.
  const cover = data.coverImage ? await loadImage(data.coverImage).catch(() => null) : null;

  const footerTop = h - FOOTER_H;
  const contentBottom = footerTop - 8;

  switch (data.kind) {
    case 'moment':      drawMoment(ctx, data, cover, w, contentBottom); break;
    case 'note':        drawNote(ctx, data, cover, w, contentBottom); break;
    case 'interesting': drawInteresting(ctx, data, cover, w, contentBottom); break;
    case 'place':       drawPlace(ctx, data, cover, w, contentBottom); break;
  }

  drawFooter(ctx, data, w, footerTop, h);

  return canvas;
}

/* ── Shared primitives ─────────────────────────────────────────────────── */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Draw an image cover-fit (centered crop) into a rounded rect. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Split a string into wrapped lines that each fit `maxWidth`. CJK-aware:
 *  breaks between any characters, keeps Latin words intact where possible. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  // Tokenize into words (Latin) and single CJK/punct chars.
  const tokens = text.match(/[A-Za-z0-9'’.,!?:;€$%&()/-]+|\s+|[^\s]/g) ?? [];
  for (const tok of tokens) {
    const candidate = current + tok;
    if (ctx.measureText(candidate).width <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current.replace(/\s+$/, ''));
      current = tok.replace(/^\s+/, '');
    }
  }
  if (current.trim()) lines.push(current.replace(/\s+$/, ''));
  return lines.length ? lines : [''];
}

/** Draw wrapped paragraph text; returns the y cursor after the block. */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number, maxWidth: number,
  lineHeight: number,
  opts: { color: string; fontStr: string; maxLines?: number },
): number {
  ctx.fillStyle = opts.color;
  ctx.font = opts.fontStr;
  let lines = wrapText(ctx, text, maxWidth);
  if (opts.maxLines && lines.length > opts.maxLines) {
    lines = lines.slice(0, opts.maxLines);
    let last = lines[lines.length - 1];
    while (last.length && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

/** A small section heading in tint, like "Highlights". */
function drawHeading(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tint: string): number {
  ctx.font = font(700, 15, FONTS.ui);
  ctx.fillStyle = tintInk(tint, 75);
  ctx.fillText(text, x, y);
  return y + 22;
}

/* ── Footer (shared) ───────────────────────────────────────────────────── */

function drawFooter(ctx: CanvasRenderingContext2D, data: CardData, w: number, top: number, h: number) {
  const x = PAD;
  // Divider
  ctx.strokeStyle = COLORS.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top + 12);
  ctx.lineTo(w - PAD, top + 12);
  ctx.stroke();

  let y = top + 30;
  // Location + date row
  ctx.font = font(500, 14, FONTS.body);
  ctx.fillStyle = COLORS.inkMuted;
  const place = data.destination || '—';
  ctx.fillText(`📍 ${place}`, x, y);

  const dateText = `📅 ${data.dateLabel}`;
  ctx.textAlign = 'right';
  ctx.fillText(dateText, w - PAD, y);
  ctx.textAlign = 'left';

  // Tag pills
  y += 34;
  if (data.tags.length) {
    let tx = x;
    ctx.font = font(500, 13, FONTS.ui);
    for (const tag of data.tags) {
      const label = `#${tag}`;
      const tw = ctx.measureText(label).width + 24;
      if (tx + tw > w - PAD) break;
      roundRectPath(ctx, tx, y, tw, 28, 14);
      ctx.fillStyle = tintMix(data.tint, 16);
      ctx.fill();
      ctx.fillStyle = COLORS.inkSoft;
      ctx.fillText(label, tx + 12, y + 6);
      tx += tw + 8;
    }
  }

  // Brand watermark
  ctx.font = font(600, 12, FONTS.ui);
  ctx.fillStyle = COLORS.inkFaint;
  ctx.textAlign = 'right';
  ctx.fillText('On the Road', w - PAD, h - 26);
  ctx.textAlign = 'left';
}

/* ── ① Moments ─────────────────────────────────────────────────────────── */

function drawMoment(ctx: CanvasRenderingContext2D, data: CardData, cover: HTMLImageElement | null, w: number, bottom: number) {
  const x = PAD;
  const innerW = w - PAD * 2;
  let y = PAD;

  // Cover (or tint block) — ~52% of available height
  const visualH = Math.round((bottom - PAD) * 0.52);
  if (cover) {
    drawCover(ctx, cover, x, y, innerW, visualH, RADIUS);
  } else {
    roundRectPath(ctx, x, y, innerW, visualH, RADIUS);
    ctx.fillStyle = tintMix(data.tint, 30);
    ctx.fill();
    ctx.font = font(400, 64, FONTS.body);
    ctx.textAlign = 'center';
    ctx.fillText(data.emoji, x + innerW / 2, y + visualH / 2 - 40);
    ctx.textAlign = 'left';
  }
  // Handwritten title overlaid bottom-left of image
  ctx.font = font(700, 40, FONTS.hand);
  ctx.fillStyle = cover ? COLORS.white : tintInk(data.tint, 80);
  ctx.save();
  if (cover) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 12; }
  const titleLines = wrapText(ctx, data.title, innerW - 48);
  let ty = y + visualH - 24 - (titleLines.length - 1) * 42;
  for (const line of titleLines) { ctx.fillText(line, x + 24, ty); ty += 42; }
  ctx.restore();

  y += visualH + 32;

  // Quote (Caveat, large)
  const quote = data.paragraphs.join(' ');
  if (quote) {
    ctx.font = font(600, 30, FONTS.hand);
    const lines = wrapText(ctx, `“${quote}”`, innerW - 20).slice(0, 4);
    const lh = 40;
    // tint quote bar, sized to the wrapped lines
    ctx.fillStyle = tintMix(data.tint, 60);
    ctx.fillRect(x, y + 6, 4, lines.length * lh - 8);
    ctx.fillStyle = COLORS.inkSoft;
    let qy = y;
    for (const line of lines) { ctx.fillText(line, x + 18, qy); qy += lh; }
  }
}

/* ── ② Notes ───────────────────────────────────────────────────────────── */

function drawNote(ctx: CanvasRenderingContext2D, data: CardData, cover: HTMLImageElement | null, w: number, bottom: number) {
  const x = PAD;
  const innerW = w - PAD * 2;
  let y = PAD;

  // Header: title (left) + small thumbnail (right)
  const thumb = 96;
  const titleW = cover ? innerW - thumb - 16 : innerW;
  ctx.font = font(700, 34, FONTS.hand);
  ctx.fillStyle = COLORS.ink;
  const tLines = wrapText(ctx, data.title, titleW);
  let ty = y + 6;
  for (const line of tLines.slice(0, 2)) { ctx.fillText(line, x, ty); ty += 38; }
  if (cover) drawCover(ctx, cover, w - PAD - thumb, y, thumb, thumb, 14);

  // tint underline under title
  ctx.fillStyle = tintMix(data.tint, 55);
  ctx.fillRect(x, ty + 2, Math.min(titleW, 120), 6);
  y = Math.max(ty + 20, y + thumb + 14);

  // List items
  const lh = 22;
  for (const item of data.listItems) {
    if (y > bottom - 40) break;
    // bullet
    ctx.fillStyle = tintInk(data.tint, 70);
    ctx.beginPath();
    ctx.arc(x + 5, y + 9, 4, 0, Math.PI * 2);
    ctx.fill();
    // primary
    ctx.font = font(700, 16, FONTS.ui);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(truncate(ctx, item.primary, innerW - 22), x + 18, y);
    y += lh;
    for (const det of item.details) {
      if (y > bottom - 20) break;
      ctx.font = font(400, 14, FONTS.body);
      ctx.fillStyle = COLORS.inkMuted;
      ctx.fillText(truncate(ctx, det, innerW - 22), x + 18, y);
      y += lh - 2;
    }
    y += 8;
  }

  // Prose fallback (if no list parsed)
  if (!data.listItems.length && data.paragraphs.length) {
    y = drawWrapped(ctx, data.paragraphs.join(' '), x, y, innerW, 24,
      { color: COLORS.inkSoft, fontStr: font(400, 16, FONTS.body), maxLines: 8 });
    y += 6;
  }

  // Tip box
  if (data.tip && y < bottom - 70) {
    drawTipBox(ctx, `💡 ${data.tip}`, x, y, innerW, bottom, data.tint);
  }
}

function drawTipBox(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, innerW: number, bottom: number, tint: string) {
  ctx.font = font(500, 14, FONTS.body);
  const lines = wrapText(ctx, text, innerW - 32).slice(0, 3);
  const boxH = 20 + lines.length * 22;
  if (y + boxH > bottom) return;
  roundRectPath(ctx, x, y, innerW, boxH, 12);
  ctx.fillStyle = tintMix(tint, 18);
  ctx.fill();
  ctx.fillStyle = COLORS.inkSoft;
  let ly = y + 12;
  for (const line of lines) { ctx.fillText(line, x + 16, ly); ly += 22; }
}

/* ── ③ Interesting ─────────────────────────────────────────────────────── */

function drawInteresting(ctx: CanvasRenderingContext2D, data: CardData, cover: HTMLImageElement | null, w: number, bottom: number) {
  const x = PAD;
  const innerW = w - PAD * 2;
  let y = PAD;

  const visualH = Math.round((bottom - PAD) * 0.42);
  if (cover) {
    drawCover(ctx, cover, x, y, innerW, visualH, RADIUS);
    // "wow!" doodle top-right
    ctx.font = font(700, 26, FONTS.hand);
    ctx.fillStyle = tintInk(data.tint, 80);
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.8)'; ctx.shadowBlur = 8;
    ctx.fillText('wow!', x + innerW - 78, y + 16);
    ctx.restore();
    y += visualH + 22;
  } else {
    y += 6;
  }

  // Title + emoji
  y = drawWrapped(ctx, data.title, x, y, innerW, 32,
    { color: COLORS.ink, fontStr: font(700, 26, FONTS.ui), maxLines: 2 });
  y += 8;

  // Observation prose
  if (data.paragraphs.length) {
    y = drawWrapped(ctx, data.paragraphs.join(' '), x, y, innerW, 24,
      { color: COLORS.inkSoft, fontStr: font(400, 16, FONTS.body), maxLines: 4 });
    y += 14;
  }

  // "What I loved" box
  const loved = data.loved.length ? data.loved : data.tags.map((t) => t);
  if (loved.length && y < bottom - 80) {
    const lh = 28;
    const rows = loved.slice(0, 4);
    const boxH = 24 + rows.length * lh;
    const drawH = Math.min(boxH, bottom - y);
    roundRectPath(ctx, x, y, innerW, drawH, 14);
    ctx.fillStyle = tintMix(data.tint, 16);
    ctx.fill();
    ctx.font = font(700, 14, FONTS.ui);
    ctx.fillStyle = tintInk(data.tint, 75);
    ctx.fillText('What I loved:', x + 16, y + 12);
    let ly = y + 38;
    for (const row of rows) {
      if (ly > y + drawH - 20) break;
      ctx.font = font(700, 15, FONTS.ui);
      ctx.fillStyle = tintInk(data.tint, 78);
      ctx.fillText('✓', x + 16, ly);
      ctx.font = font(400, 15, FONTS.body);
      ctx.fillStyle = COLORS.inkSoft;
      ctx.fillText(truncate(ctx, row, innerW - 56), x + 38, ly);
      ly += lh;
    }
  }
}

/* ── ④ Places ──────────────────────────────────────────────────────────── */

function drawPlace(ctx: CanvasRenderingContext2D, data: CardData, cover: HTMLImageElement | null, w: number, bottom: number) {
  const x = PAD;
  const innerW = w - PAD * 2;
  let y = PAD;

  const visualH = Math.round((bottom - PAD) * 0.38);
  if (cover) {
    drawCover(ctx, cover, x, y, innerW, visualH, RADIUS);
    // heart top-right
    ctx.font = font(400, 26, FONTS.body);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8;
    ctx.fillText('♡', x + innerW - 44, y + 14);
    ctx.restore();
    y += visualH + 20;
  } else {
    y += 6;
  }

  // Place name (Caveat) + region
  ctx.font = font(700, 38, FONTS.hand);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(truncate(ctx, data.title, innerW), x, y);
  y += 42;
  if (data.destination && data.destination !== data.title) {
    ctx.font = font(400, 16, FONTS.body);
    ctx.fillStyle = COLORS.inkMuted;
    ctx.fillText(truncate(ctx, data.destination, innerW), x, y);
    y += 26;
  }

  // Star rating
  if (typeof data.rating === 'number') {
    y = drawStars(ctx, data.rating, x, y, data.tint) + 14;
  } else {
    y += 6;
  }

  // Sections (Highlights / Best time / Recommend …)
  for (const sec of data.sections) {
    if (y > bottom - 40) break;
    y = drawHeading(ctx, sec.heading, x, y, data.tint);
    if (sec.body) {
      y = drawWrapped(ctx, sec.body, x, y, innerW, 22,
        { color: COLORS.inkSoft, fontStr: font(400, 15, FONTS.body), maxLines: 3 });
    }
    y += 12;
  }

  // Prose fallback if no sections
  if (!data.sections.length && data.paragraphs.length) {
    y = drawWrapped(ctx, data.paragraphs.join(' '), x, y, innerW, 24,
      { color: COLORS.inkSoft, fontStr: font(400, 16, FONTS.body), maxLines: 6 });
  }

  // Recommend badge (handwritten sticker)
  if (data.recommend && y < bottom - 20) {
    ctx.font = font(700, 22, FONTS.hand);
    const bw = ctx.measureText(data.recommend).width + 28;
    const bx = w - PAD - bw;
    const by = Math.min(y, bottom - 36);
    roundRectPath(ctx, bx, by, bw, 34, 10);
    ctx.fillStyle = tintMix(data.tint, 40);
    ctx.fill();
    ctx.fillStyle = tintInk(data.tint, 85);
    ctx.fillText(data.recommend, bx + 14, by + 6);
  }
}

function drawStars(ctx: CanvasRenderingContext2D, rating: number, x: number, y: number, tint: string): number {
  const size = 22;
  const gap = 4;
  const accent = tintInk(tint, 80);
  for (let i = 0; i < 5; i++) {
    const filled = rating >= i + 1;
    const half = !filled && rating >= i + 0.5;
    ctx.font = font(400, size, FONTS.body);
    ctx.fillStyle = filled || half ? accent : COLORS.inkFaint;
    ctx.fillText(filled ? '★' : half ? '★' : '☆', x + i * (size + gap), y);
  }
  ctx.font = font(600, 16, FONTS.ui);
  ctx.fillStyle = COLORS.inkSoft;
  ctx.fillText(rating.toFixed(1), x + 5 * (size + gap) + 6, y + 3);
  return y + size;
}

/* ── util ──────────────────────────────────────────────────────────────── */

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

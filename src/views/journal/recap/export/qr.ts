/* ==========================================================================
   On the Road · Recap export — QR code
   --------------------------------------------------------------------------
   The long image ends with a code to the whole site — an invitation to try the
   product, not a link to this portrait. The matrix is computed by a small
   library; drawing it is ours, so it can be tested and styled to the card.
   ========================================================================== */

import qrcode from 'qrcode-generator';

/** Where the code points: the product itself. */
export const SITE_URL = 'https://easy-on-the-road.vercel.app/';

/** The URL as printed beside the code: no scheme, no trailing slash. */
export function displayUrl(url = SITE_URL): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** The QR matrix: `true` is a dark module. */
export function qrMatrix(text: string): boolean[][] {
  // Level M recovers ~15% damage: enough for a code that is screenshotted,
  // recompressed and scaled, without growing the symbol much.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * Draw the code into the square at (x, y) of side `size`, on a white tile with
 * the standard quiet zone (a code needs blank margin to be read at all).
 */
export function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, ink = '#1c1917'): void {
  const matrix = qrMatrix(text);
  const quiet = 2;
  const cells = matrix.length + quiet * 2;
  const cell = size / cells;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = ink;
  matrix.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return;
    // Overlap by a hair so anti-aliasing leaves no seams between modules.
    ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell + 0.4, cell + 0.4);
  }));
}

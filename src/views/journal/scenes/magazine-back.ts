/* ==========================================================================
   On the Road · Journal magazine — the back of the book (markup)
   --------------------------------------------------------------------------
   The last two pages of a magazine are not blank: the inside back cover says
   what was in the issue (the colophon), and the back cover carries the
   masthead's line, a price, a barcode and a code to scan. Here that is: the
   figures of the issue, then a back cover in the cover's own colours with a
   barcode drawn from the issue (so each album's is its own) and a real QR code
   to the product, in the same tile a printer would set it in.

   Pure markup. The QR matrix comes from the recap export's (qrcode-generator);
   the barcode is a pattern of bars derived from a hash, not a real EAN.
   ========================================================================== */

import { t } from '../../../core/i18n.ts';
import { escHtml } from '../shared/utils.ts';
import { hashId } from './feed-plan.ts';
import { displayUrl, qrMatrix, SITE_URL } from '../recap/export/qr.ts';
import type { JournalAlbumCover } from '../../../data/schema.ts';
import { issueLine } from './album-cover.ts';

export interface IssueFacts {
  notes: number;
  photos: number;
  /** Places written about, in the order first met, deduplicated. */
  places: string[];
  /** ISO dates of the first and last entry, or ''. */
  from: string;
  to: string;
  /** For the issue line. */
  newest: string;
}

/** The facts of an issue, from the entries as the magazine prints them. */
export function issueFacts(entries: Array<{ destination: string; happenedOn: string; images?: string[]; coverImage?: string }>): IssueFacts {
  const places: string[] = [];
  for (const e of entries) {
    const p = e.destination.trim();
    if (p && !places.includes(p)) places.push(p);
  }
  const dates = entries.map((e) => e.happenedOn).filter(Boolean).sort();
  return {
    notes: entries.length,
    photos: entries.reduce((n, e) => n + (e.images?.length ?? (e.coverImage ? 1 : 0)), 0),
    places, from: dates[0] ?? '', to: dates[dates.length - 1] ?? '', newest: dates[dates.length - 1] ?? '',
  };
}

/** The bars of a barcode for `seed`: 38 widths of 1–3 modules, the same every time. */
export function barcodeBars(seed: string): number[] {
  const bars: number[] = [];
  let h = hashId(seed) + 7919;
  for (let i = 0; i < 38; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    bars.push(1 + (h >> 8) % 3);
  }
  return bars;
}

/** The digits printed under the barcode, derived from the album (12 of them, in groups). */
export function barcodeDigits(seed: string): string {
  let h = hashId(seed) + 104729;
  let out = '';
  for (let i = 0; i < 12; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; out += String((h >> 8) % 10); }
  return `${out.slice(0, 1)} ${out.slice(1, 7)} ${out.slice(7)}`;
}

/** The barcode as inline SVG, bars and gaps alternating. */
export function barcodeSvg(seed: string): string {
  const bars = barcodeBars(seed);
  let x = 0;
  const rects: string[] = [];
  bars.forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="46"/>`);
    x += w;
  });
  return `<svg class="mag-barcode-svg" viewBox="0 0 ${x} 46" preserveAspectRatio="none" aria-hidden="true">${rects.join('')}</svg>`;
}

/** The QR code as inline SVG: one path of unit squares, drawn on a quiet zone of four modules. */
export function qrSvg(text: string): string {
  const m = qrMatrix(text);
  const quiet = 2;
  const size = m.length + quiet * 2;
  const cells: string[] = [];
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) cells.push(`M${c + quiet} ${r + quiet}h1v1h-1z`); }));
  return `<svg class="mag-qr-svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${escHtml(displayUrl())}"><path d="${cells.join('')}"/></svg>`;
}

/** The inside back cover: what was in this issue. */
export function renderColophon(f: IssueFacts, issue: string): string {
  const places = f.places.slice(0, 10);
  return `
    <div class="mag-colophon">
      <span class="mag-colophon-mark">On the Road</span>
      <span class="mag-colophon-issue">${escHtml(issue)}</span>
      <hr class="mag-colophon-rule">
      <p class="mag-colophon-line">${escHtml(t('journal.mag.facts', { notes: f.notes, photos: f.photos }))}</p>
      ${places.length ? `<p class="mag-colophon-places">${places.map((p) => escHtml(p)).join(' · ')}${f.places.length > places.length ? ' …' : ''}</p>` : ''}
      <p class="mag-colophon-small">${escHtml(t('journal.mag.colophon'))}</p>
    </div>`;
}

/** The back cover: the line, the price, the barcode and the code to scan. */
export function renderBackCover(cover: JournalAlbumCover, seed: string, f: IssueFacts): string {
  const issue = issueLine(f.notes, f.newest);
  return `
    <div class="mag-back">
      <div class="mag-back-top">
        <span class="mag-back-name">On the Road</span>
        <span class="mag-back-tag">${escHtml(t('journal.mag.tagline'))}</span>
      </div>
      <div class="mag-back-mid">
        <span class="mag-back-title">${escHtml(cover.headline)}</span>
        <span class="mag-back-issue">${escHtml(issue)}</span>
      </div>
      <div class="mag-back-foot">
        <div class="mag-qr">
          <div class="mag-qr-tile">${qrSvg(SITE_URL)}</div>
          <span class="mag-qr-note">${escHtml(t('journal.mag.scan'))}<br>${escHtml(displayUrl())}</span>
        </div>
        <div class="mag-barcode">
          <div class="mag-barcode-tile">${barcodeSvg(seed)}<span class="mag-barcode-digits">${escHtml(barcodeDigits(seed))}</span></div>
          <span class="mag-price">${escHtml(t('journal.mag.price'))}</span>
        </div>
      </div>
    </div>`;
}

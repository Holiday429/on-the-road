/* ==========================================================================
   On the Road · Paper kit · markup helpers
   --------------------------------------------------------------------------
   Render functions for the pieces in paper.css. They return HTML strings (the
   app is vanilla DOM) and escape everything they are given; pass pre-formatted
   text, never HTML. Import the styles once from wherever you use them:
       import '../../core/paper/paper.css';
   ========================================================================== */

import { escHtml as esc } from '../utils.ts';

export type PaperTone = 'neutral' | 'good' | 'bad' | 'warn';

export interface PaperRow {
  label: string;
  value: string;
  /** Emoji / glyph shown before the label. */
  icon?: string;
  /** A small second line (a budget, a note). */
  sub?: string;
  tone?: PaperTone;
  strong?: boolean;
  total?: boolean;
  /** Makes the row a button; the value is read back as `data-act`. */
  act?: string;
  /** Extra data-* attributes, already escaped, e.g. `data-id="x"`. */
  attrs?: string;
  /** Extra classes, e.g. `paper-printing` for a line that was just added. */
  className?: string;
}

/** One tape line: `🍜 Lunch ········· ¥45`. */
export function paperRow(r: PaperRow): string {
  const cls = ['paper-row', r.tone && r.tone !== 'neutral' ? `is-${r.tone}` : '', r.strong ? 'is-strong' : '', r.total ? 'is-total' : '', r.className ?? ''].filter(Boolean).join(' ');
  const tag = r.act ? 'button type="button"' : 'div';
  const end = r.act ? 'button' : 'div';
  return `<${tag} class="${cls}"${r.act ? ` data-act="${esc(r.act)}"` : ''}${r.attrs ? ` ${r.attrs}` : ''}>
    <span class="paper-row-label">${r.icon ? `<span aria-hidden="true">${esc(r.icon)}</span>` : ''}<span>${esc(r.label)}</span></span>
    <span class="paper-row-lead" aria-hidden="true"></span>
    <span class="paper-row-value">${esc(r.value)}</span>
    ${r.sub ? `<span class="paper-row-sub">${esc(r.sub)}</span>` : ''}
  </${end}>`;
}

export function paperRows(rows: PaperRow[]): string {
  return `<div class="paper-rows">${rows.map(paperRow).join('')}</div>`;
}

export interface PaperStampOpts { text: string; tone?: PaperTone; corner?: boolean; pressed?: boolean }

export function paperStamp(o: PaperStampOpts): string {
  // Red is the default ink; the others are modifiers.
  const tone = o.tone && o.tone !== 'bad' ? `paper-stamp--${o.tone}` : '';
  const cls = ['paper-stamp', tone, o.corner ? 'paper-stamp--corner' : '', o.pressed ? 'is-pressed' : ''].filter(Boolean).join(' ');
  return `<span class="${cls}">${esc(o.text)}</span>`;
}

export interface PaperTagOpts { verdict: string; sub?: string; tone?: PaperTone; hidden?: boolean }

/** A luggage tag with a punched hole. */
export function paperTag(o: PaperTagOpts): string {
  return `<div class="paper-tag${o.tone && o.tone !== 'neutral' ? ` paper-tag--${o.tone}` : ''}"${o.hidden ? ' hidden' : ''}>
    <div class="paper-tag-verdict">${esc(o.verdict)}</div>${o.sub ? `<div class="paper-tag-sub">${esc(o.sub)}</div>` : ''}
  </div>`;
}

export interface PaperReceiptOpts {
  title: string;
  /** A line under the title: a date range, a count… */
  meta?: string;
  rows: PaperRow[];
  /** Printed under a rule, in larger type. */
  total?: { label: string; value: string; tone?: PaperTone };
  footer?: string;
  stamp?: PaperStampOpts;
  barcode?: boolean;
  zigzag?: boolean;
  className?: string;
  attrs?: string;
}

/** A till receipt: centred head, tape rows, total, optional stamp / barcode. */
export function paperReceipt(o: PaperReceiptOpts): string {
  const cls = ['paper', 'paper--slip', 'paper-receipt', o.zigzag ? 'paper--zigzag' : '', o.className ?? ''].filter(Boolean).join(' ');
  const rows = o.rows.map(paperRow).join('') + (o.total ? paperRow({ ...o.total, total: true, strong: true }) : '');
  return `<div class="${cls}"${o.attrs ? ` ${o.attrs}` : ''}>
    <div class="paper-receipt-head"><div class="paper-receipt-title">${esc(o.title)}</div>${o.meta ? `<div class="paper-receipt-meta">${esc(o.meta)}</div>` : ''}</div>
    <div class="paper-rows">${rows}</div>
    ${o.stamp ? `<div class="paper-receipt-stamp">${paperStamp(o.stamp)}</div>` : ''}
    ${o.barcode ? '<div class="paper-barcode" aria-hidden="true"></div>' : ''}
    ${o.footer ? `<div class="paper-receipt-foot">${esc(o.footer)}</div>` : ''}
  </div>`;
}

/** Plays the "a new line was just printed" motion on an element (no-op under reduced motion via CSS). */
export function printIn(el: Element | null | undefined): void {
  if (!el) return;
  el.classList.remove('paper-printing');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('paper-printing');
}

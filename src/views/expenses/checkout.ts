/* ==========================================================================
   On the Road · Expenses · ON THE ROAD MART checkout
   --------------------------------------------------------------------------
   The Add-expense card as a supermarket till: a customer display (VFD) that
   shows the last thing scanned and the day's running total, a scan window, a
   keypad of product keys, and — beside the till — the day's printed receipt.

   Pure view-model + markup here (no DOM reads, no store access); expenses.ts
   owns state and wiring, checkout-fx.ts owns the motion. Built on the paper
   kit (core/paper).
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml } from '../../core/utils.ts';

export interface MartLine {
  id: string;
  icon: string;
  /** Description, or the category name when there is none. */
  name: string;
  category: string;
  /** Amount in the trip's base currency, already a number. */
  baseAmount: number;
  /** What was actually paid, in its own currency. */
  amount: number;
  currency: string;
  /** Original amount line ("€12.00 @ 7.820"), only when paid in another currency. */
  original?: string;
}

export interface DayFigures {
  count: number;
  total: number;
  /** Spend per non-base currency, in that currency — the display's "≈" line. */
  foreign: { currency: string; amount: number }[];
}

export function dayFigures(lines: MartLine[], baseCurrency: string): DayFigures {
  const foreign = new Map<string, number>();
  let total = 0;
  for (const l of lines) {
    total += l.baseAmount;
    if (l.currency !== baseCurrency) foreign.set(l.currency, (foreign.get(l.currency) ?? 0) + l.amount);
  }
  return { count: lines.length, total, foreign: [...foreign].map(([currency, amount]) => ({ currency, amount })) };
}

/* ── Display (VFD) ───────────────────────────────────────────────────────── */

/** The digits of a whole-number total as rolling strips (see rollOdometer in checkout-fx.ts). */
export function odoMarkup(n: number): string {
  const s = Math.round(n).toLocaleString('en-US');
  return [...s].map((ch) => (ch >= '0' && ch <= '9'
    ? `<span class="odo-digit"><span class="odo-strip" style="transform:translateY(-${ch}em)">${'0123456789'.replace(/./g, (d) => `<span>${d}</span>`)}</span></span>`
    : `<span class="odo-sep">${escHtml(ch)}</span>`)).join('');
}

export interface ScreenTopInput {
  /** The "last scanned" line, or the idle greeting. */
  line1: string;
  /** "TODAY · 12 OCT" */
  dayLabel: string;
  count: number;
  total: number;
  baseSymbol: string;
  /** "≈ €162 · JP¥128,400" or ''. */
  alt: string;
}

/** The top of the till's one screen: a status bar (day · items · foreign spend · running total)
 *  over the line that shows what was last scanned — and that the next product label slides across. */
export function renderScreenTop(o: ScreenTopInput): string {
  return `
    <div class="ck-status">
      <span id="exp-vfd-day">${escHtml(o.dayLabel)}</span>
      <span>${escHtml(t('expenses.mart.items'))} <b id="exp-vfd-count">${String(o.count).padStart(2, '0')}</b></span>
      <span class="ck-status-alt" id="exp-vfd-alt">${escHtml(o.alt)}</span>
      <span class="ck-status-total"><span>${escHtml(o.baseSymbol)}</span><span class="odo" id="exp-vfd-odo" data-total="${Math.round(o.total)}">${odoMarkup(o.total)}</span></span>
      <span class="ck-led" aria-hidden="true"></span>
    </div>
    <div class="ck-scanline" id="exp-scan" aria-live="polite">
      <span class="ck-last" id="exp-vfd1">${escHtml(o.line1)}</span><span class="ck-caret" aria-hidden="true">_</span>
    </div>`;
}

/** The "≈ €162 · JP¥128,400" line: what the day cost in the currencies it was paid in. */
export function altLine(foreign: DayFigures['foreign'], money: (amount: number, currency: string) => string): string {
  return foreign.length ? `≈ ${foreign.map((f) => money(f.amount, f.currency)).join('  ·  ')}` : '';
}

/** The "≈ ¥1,280" line under the amount: only when paying in another currency. */
export function convertedHint(amount: number, currency: string, baseCurrency: string, toBase: (a: number, c: string) => number, fmt: (n: number) => string): string {
  if (!(amount > 0) || currency === baseCurrency) return '';
  return `≈ ${fmt(toBase(amount, currency))}`;
}

/* ── Receipt ─────────────────────────────────────────────────────────────── */

/** A fixed pseudo-random barcode for a seed (the day + count), as bar widths 1–3 with gaps between. */
export function barcodeBars(seed: string): { w: number; gap: boolean }[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const out: { w: number; gap: boolean }[] = [];
  for (let i = 0; i < 52; i++) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    out.push({ w: 1 + ((h >>> 17) % 3), gap: i % 2 === 1 });
  }
  return out;
}

export interface ReceiptInput {
  lines: MartLine[];
  /** "LISBON · PORTUGAL" */
  store: string;
  /** "2026-10-12  18:42" */
  stamp: string;
  fmt: (n: number) => string;
  /** A past day: its receipt is settled and carries the PAID stamp. */
  paid: boolean;
  /** Ids that were not on the receipt before this refresh — they print in. */
  fresh?: ReadonlySet<string>;
  /** Hide the void buttons and the zoom control (the full-receipt modal). */
  readonly?: boolean;
  /** Seed for the barcode. */
  seed: string;
  /** A small line under the total, e.g. "TRIP SO FAR ¥1,284" (the receipt book). */
  running?: string;
  /** Animate the lines printing in one after another (the receipt book). */
  stagger?: boolean;
}

/** The receipt: head and meta on top, lines + subtotal in a scrolling middle
 *  (a long day scrolls instead of growing the page), total / barcode / thanks fixed at the foot. */
export function renderReceipt(inp: ReceiptInput): string {
  const total = inp.lines.reduce((s, l) => s + l.baseAmount, 0);
  const body = inp.lines.length
    ? inp.lines.map((l, i) => `
        <div class="rc-line${inp.fresh?.has(l.id) || inp.stagger ? ' rc-line--print' : ''}" data-line="${escHtml(l.id)}"${inp.stagger ? ` style="animation-delay:${Math.min(i, 14) * 70 + 260}ms"` : ''}>
          <span class="rc-no">${String(i + 1).padStart(2, '0')}</span>
          <span class="rc-emoji" aria-hidden="true">${escHtml(l.icon)}</span>
          <span class="rc-desc" title="${escHtml(l.name)}">${escHtml(l.name.toUpperCase())}</span>
          <span class="rc-dots" aria-hidden="true"></span>
          <span class="rc-amt">${escHtml(inp.fmt(l.baseAmount))}</span>
          ${inp.readonly ? '<span></span>' : `<button type="button" class="rc-void" data-void="${escHtml(l.id)}" title="${escHtml(t('expenses.mart.void'))}" aria-label="${escHtml(t('expenses.mart.void'))}">✕</button>`}
          ${l.original ? `<span class="rc-orig">${escHtml(l.original)}</span>` : ''}
        </div>`).join('')
    : `<div class="rc-empty">${escHtml(t('expenses.tapeEmpty'))}</div>`;
  const bars = barcodeBars(inp.seed).map((b) => `<i class="${b.gap ? 'is-gap ' : ''}w${b.w}"></i>`).join('');
  return `
    <div class="rc-inner">
      <div class="rc-head">
        <h2 class="rc-title">ON THE ROAD MART</h2>
        <div class="rc-tag">${escHtml(t('expenses.mart.tagline'))}</div>
      </div>
      <div class="rc-meta">
        <div><span>${escHtml(t('expenses.mart.store'))}</span><span>${escHtml(inp.store)}</span></div>
        <div><span>${escHtml(t('expenses.mart.cashier'))}</span><span>#0429</span></div>
        <div><span>${escHtml(t('expenses.mart.date'))}</span><span>${escHtml(inp.stamp)}</span></div>
      </div>
      <div class="rc-scroll">
        <div class="rc-lines">${body}</div>
        <div class="rc-row rc-row--sub"><span>${escHtml(t('expenses.tapeSubtotal').toUpperCase())}</span><span>${escHtml(inp.fmt(total))}</span></div>
      </div>
      <div class="rc-foot">
        <div class="rc-total"><span>${escHtml(t('expenses.mart.total'))}</span><span class="rc-total-amt" data-total="${Math.round(total)}">${escHtml(inp.fmt(total))}</span></div>
        ${inp.running ? `<div class="rc-running">${escHtml(inp.running)}</div>` : ''}
        <div class="rc-barcode" aria-hidden="true">${bars}</div>
        <div class="rc-bcnum">${escHtml(inp.seed.replace(/\D/g, '').slice(0, 12))}</div>
        <div class="rc-thanks">${escHtml(t('expenses.mart.thanks'))}</div>
        ${inp.readonly ? '' : `<button type="button" class="rc-view" data-act="zoom">${escHtml(t('expenses.mart.viewFull'))}</button>`}
      </div>
      ${inp.paid && inp.lines.length ? `<div class="rc-stamp">${escHtml(t('expenses.mart.paid'))}</div>` : ''}
    </div>`;
}

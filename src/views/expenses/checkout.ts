/* ==========================================================================
   On the Road · Expenses · checkout counter
   --------------------------------------------------------------------------
   The Add-expense form borrows from a supermarket till: a big readout that
   shows what you are ringing up (and its worth in your home currency), a Pay
   button, and a paper tape of everything rung up for the day with a running
   subtotal. A line that was just added prints in.

   Pure view-model + markup here; expenses.ts owns state and wiring. Built from
   the shared paper kit (core/paper).
   ========================================================================== */

import { paperRow, type PaperRow } from '../../core/paper/paper.ts';
import { t } from '../../core/i18n.ts';
import { escHtml } from '../../core/utils.ts';

/** How many lines the tape shows before folding the rest into "+N more". */
export const TAPE_MAX = 5;

export interface TapeEntry {
  id: string;
  icon: string;
  /** Description, or the category name when there is none. */
  name: string;
  /** Amount in the trip's base currency, already a number. */
  baseAmount: number;
  /** Original amount ("€12.00") when it was paid in another currency. */
  original?: string;
}

export interface TapeInput {
  entries: TapeEntry[];
  /** Pre-formatted date heading, e.g. "Mon 12 Oct". */
  dateLabel: string;
  fmt: (n: number) => string;
  /** Ids that were not on the tape before this refresh — they print in. */
  fresh?: ReadonlySet<string>;
}

export function tapeRows(inp: TapeInput): { rows: PaperRow[]; extra: number; subtotal: number } {
  const { entries, fmt, fresh } = inp;
  const shown = entries.slice(-TAPE_MAX);            // newest at the bottom, like a real tape
  const rows: PaperRow[] = shown.map((e) => ({
    label: e.name, icon: e.icon, value: fmt(e.baseAmount), sub: e.original,
    attrs: `data-tape-id="${escHtml(e.id)}"`,
    className: fresh?.has(e.id) ? 'paper-printing' : undefined,
  }));
  return {
    rows,
    extra: entries.length - shown.length,
    subtotal: entries.reduce((s, e) => s + e.baseAmount, 0),
  };
}

export function renderTape(inp: TapeInput): string {
  const { rows, extra, subtotal } = tapeRows(inp);
  const n = inp.entries.length;
  const head = `<div class="ck-tape-head"><span>${escHtml(inp.dateLabel)}</span><span>${escHtml(n === 1 ? t('expenses.tapeItem1') : t('expenses.tapeItems', { n }))}</span></div>`;
  if (!n) return `${head}<div class="ck-tape-empty">${escHtml(t('expenses.tapeEmpty'))}</div>`;
  const more = extra > 0 ? paperRow({ label: t('expenses.tapeMore', { n: extra }), value: '', act: 'open-records' }) : '';
  return `${head}<div class="paper-rows">${more}${rows.map(paperRow).join('')}${paperRow({ label: t('expenses.tapeSubtotal'), value: inp.fmt(subtotal), total: true, strong: true })}</div>`;
}

/** The "≈ ¥1,280" line under the readout: only when paying in another currency. */
export function convertedHint(amount: number, currency: string, baseCurrency: string, toBase: (a: number, c: string) => number, fmt: (n: number) => string): string {
  if (!(amount > 0) || currency === baseCurrency) return '';
  return `≈ ${fmt(toBase(amount, currency))}`;
}

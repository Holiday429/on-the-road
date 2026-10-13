/* ==========================================================================
   On the Road · Expenses · checkout wiring
   --------------------------------------------------------------------------
   Connects the till (checkout.ts markup, checkout-fx.ts motion) to the
   expense data. expenses.ts hands it live accessors (like budget-page.ts) and
   calls three things: `martVfd` while building the form, `refreshMart` after
   any data/date change, and `runScan` when SCAN is pressed.

   Rule that keeps the scan honest: while a scan is in flight the display and
   receipt are held, so the new line shows up when the laser passes — not the
   instant the store's local echo arrives.
   ========================================================================== */

import {
  dayFigures, breakdownRows, altLine, renderScreenTop, renderReceipt,
  type MartLine,
} from './checkout.ts';
import { showLine, rollOdometer, playScan, beep, pulse, reducedMotion } from './checkout-fx.ts';
import { t } from '../../core/i18n.ts';
import { openModal } from '../../core/modal.ts';
import { baseCurrency } from '../../data/trip-context.ts';
import { currencySymbol } from '../../data/rates.ts';
import type { StoredExpense } from '../../data/stores/expense-store.ts';
import type { Category } from './expense-helpers.ts';
import { categoryChartColor } from './expense-helpers.ts';

export interface MartContext {
  expenses: () => StoredExpense[];
  inBase: (e: StoredExpense) => number;
  fmt: (n: number) => string;
  categoryById: (id: string) => Category | undefined;
  /** Country-budget standing for the place selected in the form, as one display line ('' if no cap). */
  reminder: () => string;
  /** The place currently selected in the form (used when the day has no spend yet). */
  place: () => { city: string; country: string };
  remove: (id: string) => void;
}

let ctx: MartContext | null = null;
export function initMart(c: MartContext): void { ctx = c; }

let seen: Set<string> | null = null;   // receipt lines already printed
let scanHold = false;
let line1 = '';                        // what display line 1 currently shows ('' = idle greeting)
let idleIdx = 0;
let holdIdleUntil = 0;
let shownTotal = 0;                    // origin for the next odometer roll
let idleTimer: number | undefined;

const todayIso = () => new Date().toISOString().split('T')[0];
const idleMsg = (i: number): string => {
  const msgs = [t('expenses.mart.welcome'), t('expenses.mart.ready')];
  const note = ctx?.reminder();
  if (note) msgs.push(note);
  return msgs[i % msgs.length];
};
const dayShort = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
const money = (amount: number, currency: string) => {
  const whole = currency === 'JPY' || Number.isInteger(amount);
  return `${currencySymbol(currency)}${amount.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
};

function dayRows(iso: string): StoredExpense[] {
  return (ctx?.expenses() ?? []).filter((e) => e.date === iso).sort((a, b) => a.createdAt - b.createdAt);
}

function toLines(rows: StoredExpense[]): MartLine[] {
  const c = ctx!;
  const base = baseCurrency();
  return rows.map((e) => {
    const cat = c.categoryById(e.category);
    return {
      id: e.id, icon: cat?.icon ?? '🗂️', category: e.category,
      name: e.description || cat?.label || t('dash.spend.unlabelled'),
      baseAmount: c.inBase(e), amount: e.amount, currency: e.currency,
      original: e.currency !== base ? `${money(e.amount, e.currency)} @ ${e.rate.toFixed(3)}` : undefined,
    };
  });
}

/* ── Display ─────────────────────────────────────────────────────────────── */

/** Markup for the screen's status bar + last-scanned line, drawn from the day `iso`. Re-baselines the odometer. */
export function martVfd(iso: string): string {
  const lines = toLines(dayRows(iso));
  const fig = dayFigures(lines, baseCurrency());
  shownTotal = fig.total;
  // A country with a budget cap opens the screen with its standing; otherwise the greeting.
  if (!line1) line1 = ctx?.reminder() || idleMsg(idleIdx);
  return renderScreenTop({
    line1, count: fig.count, total: fig.total, baseSymbol: currencySymbol(baseCurrency()),
    dayLabel: `${iso === todayIso() ? `${t('expenses.mart.today')} · ` : ''}${dayShort(iso)}`,
    alt: altLine(fig.foreign, money),
  });
}

/** Rotate the idle greeting while nothing is happening (one timer for the page's life). */
export function startIdle(): void {
  if (idleTimer) return;
  idleTimer = window.setInterval(() => {
    const el = document.getElementById('exp-vfd1');
    if (!el || !el.offsetParent || scanHold || Date.now() < holdIdleUntil) return;
    idleIdx += 1;
    line1 = idleMsg(idleIdx);
    showLine(el, line1);
  }, 4200);
}

/** Empty amount: the display shakes and asks for one. */
export function vfdError(): void {
  const box = document.getElementById('exp-screen');
  if (!box) return;
  box.classList.add('is-err');
  line1 = t('expenses.mart.enterAmount');
  holdIdleUntil = Date.now() + 2200;
  showLine(document.getElementById('exp-vfd1'), line1);
  window.setTimeout(() => {
    box.classList.remove('is-err');
    if (line1 === t('expenses.mart.enterAmount')) { line1 = idleMsg(idleIdx); showLine(document.getElementById('exp-vfd1'), line1, false); }
  }, 2200);
}

/* ── Repaint from data ───────────────────────────────────────────────────── */

/** Repaint the receipt and the display's figures for the form's current date. `reset` re-baselines which lines are "new". */
export function refreshMart(formEl: HTMLElement, reset: boolean, feed = false): void {
  if (!ctx || scanHold) return;
  const iso = (formEl.querySelector('#exp-date') as HTMLInputElement | null)?.value || todayIso();
  const rows = dayRows(iso);
  const lines = toLines(rows);
  const fig = dayFigures(lines, baseCurrency());

  // Display: figures only — line 1 belongs to the scan / idle logic.
  const pad = String(fig.count).padStart(2, '0');
  const set = (id: string, text: string) => { const n = document.getElementById(id); if (n) n.textContent = text; };
  set('exp-vfd-count', pad);
  set('exp-vfd-alt', altLine(fig.foreign, money));
  set('exp-vfd-day', `${iso === todayIso() ? `${t('expenses.mart.today')} · ` : ''}${dayShort(iso)}`);
  if (fig.total !== shownTotal) { rollOdometer(document.getElementById('exp-vfd-odo'), shownTotal, fig.total); shownTotal = fig.total; }

  // Receipt.
  const wrap = document.querySelector<HTMLElement>('#view-expenses .exp-receipt-wrap');
  if (!wrap) return;
  if (reset || !seen) seen = new Set(rows.map((e) => e.id));
  const fresh = new Set(rows.filter((e) => !seen!.has(e.id)).map((e) => e.id));
  fresh.forEach((id) => seen!.add(id));
  const prevScroll = wrap.querySelector<HTMLElement>('.rc-scroll')?.scrollTop ?? 0;
  // eslint-disable-next-line no-restricted-syntax -- audited: renderReceipt escapes every value
  wrap.innerHTML = `
    <div class="ck-printer" aria-hidden="true"><div class="ck-printer-body"><div class="ck-printer-slot"></div></div></div>
    <div class="rc paper paper--zigzag${feed && !reducedMotion() ? ' rc--feed' : ''}">${receiptHtml(iso, lines, rows, fresh, false)}</div>`;
  bindReceipt(wrap);
  // Newest line is at the bottom: follow it when one prints (or the day changes), else stay where the reader was.
  const scroller = wrap.querySelector<HTMLElement>('.rc-scroll');
  if (scroller) scroller.scrollTop = reset || fresh.size ? scroller.scrollHeight : prevScroll;
}

function receiptHtml(iso: string, lines: MartLine[], rows: StoredExpense[], fresh: ReadonlySet<string>, readonly: boolean): string {
  const c = ctx!;
  const last = rows[rows.length - 1];
  // The store is wherever the day was spent (latest line that says), else where the form points now.
  const placed = [...rows].reverse().find((r) => r.city || r.country);
  const place = placed ? { city: placed.city, country: placed.country } : c.place();
  const store = [place.city, place.country].filter(Boolean).join(' · ') || t('expenses.mart.wholeTrip');
  const time = iso === todayIso() ? new Date() : new Date(last?.createdAt ?? Date.now());
  const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  return renderReceipt({
    lines, store: store.toUpperCase(), stamp: `${iso}  ${hhmm}`,
    fmt: c.fmt,
    breakdown: breakdownRows(lines, (id) => {
      const cat = c.categoryById(id);
      return cat ? { icon: cat.icon, label: cat.label, color: categoryChartColor(cat.color) } : undefined;
    }),
    paid: iso < todayIso(), fresh, readonly, seed: `${iso.replace(/-/g, '')}${String(lines.length).padStart(2, '0')}0429`,
  });
}

function bindReceipt(wrap: HTMLElement): void {
  const rc = wrap.querySelector<HTMLElement>('.rc');
  rc?.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.closest('[data-act="zoom"]')) { openFullReceipt(); return; }
    const del = target.closest<HTMLElement>('[data-void]');
    if (del) voidLine(del.dataset.void!, del.closest<HTMLElement>('.rc-line'));
  });
}

function voidLine(id: string, row: HTMLElement | null): void {
  if (!confirm(t('expenses.mart.voidConfirm'))) return;
  if (!row || reducedMotion()) { ctx!.remove(id); return; }
  row.classList.add('rc-line--void');
  window.setTimeout(() => ctx!.remove(id), 400);
}

function openFullReceipt(): void {
  const form = document.querySelector<HTMLElement>('#view-expenses .exp-form-wrap');
  const iso = (form?.querySelector('#exp-date') as HTMLInputElement | null)?.value || todayIso();
  const rows = dayRows(iso);
  openModal({
    body: `<div class="rc rc--zoom paper paper--zigzag">${receiptHtml(iso, toLines(rows), rows, new Set(), true)}</div>`,
    className: 'rc-modal',
  });
}

/* ── Scan ────────────────────────────────────────────────────────────────── */

export interface ScanArgs {
  amount: number;
  currency: string;
  label: string;
  icon: string;
  /** Persist the expense; resolves false (or rejects) when it did not save. */
  save: () => Promise<boolean>;
  /** Put the typed values back after a failed save. */
  restore: () => void;
  onFailed: () => void;
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** The scan: label slides past the laser, then the display, bag and receipt take the line. */
export async function runScan(formEl: HTMLElement, a: ScanArgs): Promise<void> {
  const still = reducedMotion();
  scanHold = true;
  const saving = Promise.resolve().then(a.save).catch((e) => { console.error('Failed to add expense:', e); return false; });
  const scanning = playScan(document.getElementById('exp-scan'), { icon: a.icon, label: a.label.toUpperCase(), amount: money(a.amount, a.currency) });

  await wait(still ? 0 : 430);
  // Give a quick save a moment to land; a slow one (offline) must not freeze the till.
  const early = await Promise.race([saving, wait(1200).then(() => null)]);
  scanHold = false;
  if (early === false) { await scanning; a.restore(); a.onFailed(); vfdError(); return; }

  beep();
  line1 = `${a.icon} ${a.label.toUpperCase()}  ${money(a.amount, a.currency)}`;
  holdIdleUntil = Date.now() + 3200;
  showLine(document.getElementById('exp-vfd1'), line1);
  const box = document.getElementById('exp-screen');
  box?.classList.remove('is-err');
  pulse(box, 'is-ok');
  pulse(document.getElementById('exp-vfd-count'), 'is-bump');
  refreshMart(formEl, false);

  void saving.then((ok) => { if (!ok) { a.restore(); a.onFailed(); } });
  await scanning;
}

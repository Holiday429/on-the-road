/* ==========================================================================
   On the Road · Expenses · receipt book
   --------------------------------------------------------------------------
   Every day that has spend has one till receipt. The book shows them one at a
   time on the counter: the printer feeds a sheet out, the lines print in, the
   total counts up, a past day is stamped PAID. Flip with ‹ ›, the arrow keys,
   a click on the sheets peeking behind, a tap on a day in the strip — or drag
   the sheet away to tear it off. Opened from "Total spent".

   The receipt itself is the same markup as the till's (checkout.ts); the day
   list is pure (receipt-book-model.ts).
   ========================================================================== */

import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { reducedMotion } from './checkout-fx.ts';
import { bookMoney, bookReceiptHtml, spendDays } from './checkout-wire.ts';
import { barHeight, openIndex, stepIndex, type BookDay } from './receipt-book-model.ts';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const parts = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return { y, m: MONTHS[(m || 1) - 1], d }; };
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Drag distance (px) that tears a sheet away. */
const TEAR = 90;

let open: { close: () => void } | null = null;

function dayChip(d: BookDay, max: number): string {
  const p = parts(d.iso);
  return `<button type="button" class="rcb-day" role="tab" data-rb-day="${esc(d.iso)}" title="${esc(`${longDate(d.iso)} · ${bookMoney(d.total)}`)}">
    <i style="height:${barHeight(d.total, max)}%"></i><b>${p.d}</b><span>${p.m}</span>
  </button>`;
}

function peek(d: BookDay | undefined, side: 'prev' | 'next'): string {
  if (!d) return '';
  const p = parts(d.iso);
  return `<button type="button" class="rcb-peek rcb-peek--${side}" data-rb-step="${side === 'prev' ? -1 : 1}" aria-label="${esc(longDate(d.iso))}">
    <span>${p.d} ${p.m}</span><b>${esc(bookMoney(d.total))}</b>
  </button>`;
}

/** Counts a figure up inside the total line. */
function countUp(el: HTMLElement | null, to: number, ms = 700): void {
  if (!el) return;
  if (reducedMotion() || to <= 0) return;
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = bookMoney(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step); else el.textContent = bookMoney(to);
  };
  requestAnimationFrame(step);
}

export function openReceiptBook(startIso: string): void {
  open?.close();
  const days = spendDays();
  const max = Math.max(0, ...days.map((d) => d.total));
  let index = openIndex(days, startIso);
  let busy = false;

  const root = document.createElement('div');
  root.className = 'rcb';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', t('expenses.book.title'));
  // eslint-disable-next-line no-restricted-syntax -- audited: every interpolation escaped (esc / bookMoney)
  root.innerHTML = `
    <div class="rcb-top">
      <div class="rcb-title"><span aria-hidden="true">🧾</span> ${esc(t('expenses.book.title'))}</div>
      <div class="rcb-count" data-rb-count aria-live="polite"></div>
      <button type="button" class="rcb-x" data-rb-close aria-label="${esc(t('common.close'))}">✕</button>
    </div>
    ${days.length ? `<div class="rcb-days" role="tablist" data-rb-days>${days.map((d) => dayChip(d, max)).join('')}</div>` : ''}
    <div class="rcb-stage">
      <button type="button" class="rcb-nav" data-rb-step="-1" aria-label="${esc(t('expenses.book.prev'))}">‹</button>
      <div class="rcb-counter">
        <div class="ck-printer" aria-hidden="true"><div class="ck-printer-body"></div></div>
        <div class="rcb-paper" data-rb-paper></div>
      </div>
      <button type="button" class="rcb-nav" data-rb-step="1" aria-label="${esc(t('expenses.book.next'))}">›</button>
    </div>
    <div class="rcb-hint">${esc(t('expenses.book.hint'))}</div>`;
  document.body.appendChild(root);
  document.body.classList.add('exp-records-lock');
  requestAnimationFrame(() => root.classList.add('is-in'));

  const paper = root.querySelector<HTMLElement>('[data-rb-paper]')!;

  /** A sheet for a day: the receipt on paper, ready to feed out. */
  const sheet = (iso: string | null): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'rc rc--book rc--feed paper paper--zigzag rcb-sheet';
    // eslint-disable-next-line no-restricted-syntax -- audited: bookReceiptHtml escapes every value
    el.innerHTML = iso ? bookReceiptHtml(iso) : `<div class="rc-inner"><div class="rc-empty">${esc(t('expenses.book.empty'))}</div></div>`;
    return el;
  };

  function paintChrome(): void {
    const d = days[index];
    root.querySelector<HTMLElement>('[data-rb-count]')!.textContent = d ? t('expenses.book.count', { i: index + 1, n: days.length }) : '';
    root.querySelectorAll<HTMLElement>('.rcb-day').forEach((b) => {
      const on = b.dataset.rbDay === d?.iso;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    root.querySelectorAll<HTMLButtonElement>('.rcb-nav').forEach((b) => {
      b.disabled = !d || (b.dataset.rbStep === '-1' ? index <= 0 : index >= days.length - 1);
    });
    paper.querySelectorAll('.rcb-peek').forEach((n) => n.remove());
    paper.insertAdjacentHTML('afterbegin', peek(days[index - 1], 'prev') + peek(days[index + 1], 'next'));
  }

  /** Puts the sheet for days[index] on the counter; the old one (if any) is torn off toward `dir`. */
  function show(dir: 1 | -1 | 0): void {
    const old = paper.querySelector<HTMLElement>('.rcb-sheet');
    const still = reducedMotion();
    const d = days[index];
    const next = sheet(d?.iso ?? null);
    if (still) next.classList.remove('rc--feed');
    if (old) {
      old.style.setProperty('--dir', String(dir || 1));
      old.classList.add('rcb-sheet--out');
      window.setTimeout(() => old.remove(), still ? 0 : 380);
    }
    paper.appendChild(next);
    paintChrome();
    if (d) {
      window.setTimeout(() => countUp(next.querySelector<HTMLElement>('.rc-total-amt'), d.total), still ? 0 : 520);
    }
    bindDrag(next);
    busy = true;
    window.setTimeout(() => { busy = false; }, still ? 0 : 420);
  }

  function step(by: number): void {
    if (busy && !reducedMotion()) return;
    const to = stepIndex(index, by, days.length);
    if (to === index) return;
    const dir: 1 | -1 = to > index ? 1 : -1;
    index = to;
    show(dir);
  }

  function jump(iso: string): void {
    const to = days.findIndex((d) => d.iso === iso);
    if (to < 0 || to === index) return;
    const dir: 1 | -1 = to > index ? 1 : -1;
    index = to;
    show(dir);
  }

  /** Drag the sheet sideways; far enough and it tears off to the next / previous day. */
  function bindDrag(el: HTMLElement): void {
    let x0 = 0; let dx = 0; let live = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || (e.target as HTMLElement).closest('.rc-scroll, button')) return;
      x0 = e.clientX; dx = 0; live = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!live) return;
      dx = e.clientX - x0;
      el.style.transform = `translateX(${dx}px) rotate(${dx / 28}deg)`;
    });
    const end = () => {
      if (!live) return;
      live = false;
      el.classList.remove('is-dragging');
      el.style.transform = '';
      if (Math.abs(dx) > TEAR) step(dx < 0 ? 1 : -1);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  };
  function close(): void {
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('exp-records-lock');
    root.classList.remove('is-in');
    window.setTimeout(() => root.remove(), reducedMotion() ? 0 : 220);
    open = null;
  }
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-rb-close]') || el === root) { close(); return; }
    const by = el.closest<HTMLElement>('[data-rb-step]');
    if (by) { step(Number(by.dataset.rbStep)); return; }
    const day = el.closest<HTMLElement>('[data-rb-day]');
    if (day) jump(day.dataset.rbDay!);
  });
  open = { close };
  show(0);
  root.querySelector<HTMLElement>('[data-rb-close]')?.focus({ preventScroll: true });
}

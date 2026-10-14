/* ==========================================================================
   On the Road · Passport — the memory of a country
   --------------------------------------------------------------------------
   Tap a stamp and a memory card slides in from the right while the book moves
   over to make room: the stamp large, a receipt for the stay (cities, nights,
   what was spent), the photos as taped-down polaroids, and the journal entries
   of that country. It holds only what the passport knows — nothing here leads
   away from the book. Previous / next walk through the pressed stamps without
   closing it. All numbers come from data/country-memory.ts.
   ========================================================================== */

import '../../core/paper/paper.css';
import { t } from '../../core/i18n.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import { renderStamp } from '../../core/paper/stamp.ts';
import { stampDate } from '../../core/paper/stamp-base.ts';
import { paperReceipt, type PaperRow } from '../../core/paper/paper.ts';
import { currencySymbol } from '../../data/rates.ts';
import type { CountryMemory } from '../../data/country-memory.ts';

export interface CardActions {
  /** Previous (-1) / next (1) pressed stamp. */
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}

export interface DrawerHandle {
  /** Shows this stamp's memory; `pos` is its place among the pressed stamps. */
  show(m: CountryMemory, locale: string, pos: { i: number; n: number }): void;
  /** The drawer and the dim behind it (for measuring and re-attaching after the desk is rebuilt). */
  el: HTMLElement;
  scrim: HTMLElement;
  close(): void;
}

const money = (currency: string, n: number, locale: string): string => `${currencySymbol(currency)}${Math.round(n).toLocaleString(locale)}`;

const year = (iso: string): string => iso.slice(0, 4);
const day = (iso: string): string => `${stampDate(iso)} ${year(iso)}`;

function dateRange(a: string, b: string): string {
  return a === b ? day(a) : `${stampDate(a)} – ${stampDate(b)} ${year(b)}`;
}

/** Tilt of the n-th polaroid, degrees — fixed, so it does not shuffle when the card repaints. */
const TILT = [-2.6, 1.8, -1.2, 2.4];

function polaroids(m: CountryMemory): string {
  const urls = m.covers.map((u) => safeUrl(u)).filter(Boolean);
  if (urls.length === 0) {
    return `<div class="pp-polaroids"><figure class="pp-polaroid is-empty" style="--tilt:-1.6deg"><span class="pp-tape" aria-hidden="true"></span>
      <div class="pp-polaroid-pic"></div><figcaption>${esc(t('passport.card.noPhotos'))}</figcaption></figure></div>`;
  }
  const cities = m.stamp.cities.length ? m.stamp.cities : [m.stamp.country];
  return `<div class="pp-polaroids">${urls.map((u, i) => `
    <figure class="pp-polaroid" style="--tilt:${TILT[i % TILT.length]}deg"><span class="pp-tape" aria-hidden="true"></span>
      <div class="pp-polaroid-pic"><img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false"></div>
      <figcaption>${esc(cities[i % cities.length])}</figcaption></figure>`).join('')}</div>`;
}

function receipt(m: CountryMemory, locale: string): string {
  const s = m.stamp;
  const rows: PaperRow[] = [];
  if (m.trip.cities.length) rows.push({ label: t('passport.card.cities'), value: m.trip.cities.join(' · ') });
  rows.push({ label: t('passport.card.nights'), value: String(m.trip.nights) });
  if (m.total.trips > 1) rows.push({ label: t('passport.card.total'), value: t('passport.card.totalValue', { n: m.total.nights, k: m.total.trips }) });
  rows.push({ label: t('passport.card.journal'), value: String(m.journalCount) });
  // One currency reads as the receipt's total; several are never added together.
  const one = m.spend.length === 1 ? m.spend[0] : null;
  if (!one) for (const l of m.spend) rows.push({ label: t('passport.card.spent'), value: money(l.currency, l.total, locale) });
  return paperReceipt({
    title: t('passport.card.stub'),
    meta: [s.tripName, dateRange(m.trip.dateFrom, m.trip.dateTo)].filter(Boolean).join(' · '),
    rows,
    total: one ? { label: t('passport.card.spent'), value: money(one.currency, one.total, locale) } : undefined,
    zigzag: true,
    className: 'pp-card-receipt',
  });
}

function entries(m: CountryMemory): string {
  if (m.entries.length === 0) return `<p class="pp-drawer-none">${esc(t('passport.card.noEntries'))}</p>`;
  return `<ul class="pp-entries">${m.entries.map((e) => `<li class="pp-entry">
      <div class="pp-entry-top"><strong>${esc(e.title || t('passport.card.untitled'))}</strong><time>${esc(day(e.date))}</time></div>
      ${e.excerpt ? `<p>${esc(e.excerpt)}</p>` : ''}</li>`).join('')}</ul>`;
}

/** The inside of the drawer for one stamp. */
export function drawerHtml(m: CountryMemory, locale: string, pos: { i: number; n: number }): string {
  const s = m.stamp;
  const sub = [s.tripName, dateRange(m.trip.dateFrom, m.trip.dateTo)].filter(Boolean).join(' · ');
  return `<header class="pp-drawer-head">
      <div class="pp-drawer-titles">
        <div class="pp-drawer-kicker">${esc(t('passport.card.kicker'))} · ${pos.i + 1} / ${pos.n}</div>
        <h2 class="pp-drawer-title">${esc(s.country)}</h2>
        <div class="pp-drawer-sub">${esc(sub)}${s.orphan ? ` · ${esc(t('passport.deletedTrip'))}` : ''}</div>
      </div>
      <div class="pp-drawer-btns">
        <button type="button" class="pp-round" data-pp-card-step="-1" aria-label="${esc(t('passport.card.prev'))}"${pos.n < 2 ? ' disabled' : ''}>←</button>
        <button type="button" class="pp-round" data-pp-card-step="1" aria-label="${esc(t('passport.card.next'))}"${pos.n < 2 ? ' disabled' : ''}>→</button>
        <button type="button" class="pp-round is-close" data-pp-card-close aria-label="${esc(t('common.close'))}">✕</button>
      </div>
    </header>
    <div class="pp-drawer-body">
      <div class="pp-drawer-top">
        <div class="pp-card-stamp">${renderStamp(s, { size: 190 })}</div>
        ${receipt(m, locale)}
      </div>
      <section><h3 class="pp-drawer-h">${esc(t('passport.card.photos'))}</h3>${polaroids(m)}</section>
      <section><h3 class="pp-drawer-h">${esc(t('passport.card.journal'))}${m.journalCount ? ` · ${m.journalCount}` : ''}</h3>${entries(m)}</section>
    </div>`;
}

/** Opens the drawer inside `host` (the desk); returns a handle to repaint it for another stamp or close it. */
export function openMemoryDrawer(host: HTMLElement, a: CardActions): DrawerHandle {
  const scrim = document.createElement('div');
  scrim.className = 'pp-drawer-scrim';
  scrim.setAttribute('data-pp-card-close', '');
  scrim.setAttribute('data-no-turn', '');
  const el = document.createElement('aside');
  el.className = 'pp-drawer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('data-no-turn', '');
  host.append(scrim, el);

  let closed = false;
  let first = true;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    el.classList.add('is-leaving');
    scrim.classList.add('is-leaving');
    window.setTimeout(() => { el.remove(); scrim.remove(); }, 260);
    a.onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      // The arrows walk the stamps while the card is open, not the book's pages.
      e.stopPropagation();
      e.preventDefault();
      a.onStep(e.key === 'ArrowRight' ? 1 : -1);
    }
  };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const step = target.closest<HTMLElement>('[data-pp-card-step]');
    if (step) { a.onStep(Number(step.dataset.ppCardStep) > 0 ? 1 : -1); return; }
    if (target.closest('[data-pp-card-close]')) close();
  });
  scrim.addEventListener('click', close);
  // A photo that cannot be fetched is dropped, leaving the tinted frame — never the browser's broken-image icon.
  el.addEventListener('error', (e) => {
    const img = e.target as HTMLElement;
    if (img.tagName === 'IMG') img.remove();
  }, true);

  return {
    el,
    scrim,
    close,
    show(m, locale, pos) {
      el.setAttribute('aria-label', m.stamp.country);
      el.style.setProperty('--ink-c', m.stamp.ink);
      // eslint-disable-next-line no-restricted-syntax -- audited: drawerHtml escapes every interpolation
      el.innerHTML = drawerHtml(m, locale, pos);
      el.querySelector<HTMLElement>('.pp-drawer-body')?.scrollTo({ top: 0 });
      if (first) el.querySelector<HTMLElement>('[data-pp-card-close]')?.focus({ preventScroll: true });
      first = false;
    },
  };
}

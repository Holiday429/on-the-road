/* ==========================================================================
   On the Road · Passport — the memory of a country
   --------------------------------------------------------------------------
   Tap a stamp and a memory card slides in from the right while the book moves
   over to make room: a picture of the place across the top (the itinerary's cover
   for the stop, else a journal photo, else the country's colour and flag), the
   stamp large, a receipt for the stay (cities, nights, what was spent — one
   line per category, Stay / Food / …, the same words and icons the Expenses
   page's own till slip uses), the journal's photos taped down as polaroids.
   Nothing more: it is a card to glance
   at, not a page to scroll. It holds only what the passport knows — nothing here leads
   away from the book. Previous / next walk through the pressed stamps without
   closing it. All numbers come from data/country-memory.ts.
   ========================================================================== */

import '../../core/paper/paper.css';
import { t } from '../../core/i18n.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import { renderStamp } from '../../core/paper/stamp.ts';
import { stampDate } from '../../core/paper/stamp-base.ts';
import '../expenses/styles/checkout.css';
import { renderReceipt, type MartLine } from '../expenses/checkout.ts';
import { todayIso } from '../../data/trip-phase.ts';
import { currencySymbol } from '../../data/rates.ts';
import { BUILTIN_CATEGORIES } from '../expenses/expense-defaults.ts';
import { nationalityFlag } from '../../data/nationalities.ts';
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

/** The journal's photos of this country, taped down as polaroids. Nothing at all when there are none: an empty frame says nothing. */
function polaroids(m: CountryMemory): string {
  // safeUrl already escapes for an attribute; escaping again would break any address with a `&` in it.
  const shots = m.photos.map((p) => ({ ...p, url: safeUrl(p.url) })).filter((p) => p.url);
  if (shots.length === 0) return '';
  const label = (p: { city: string; title: string; date: string }) => p.city || p.title || m.stamp.country;
  return `<section>
    <div class="pp-polaroids">${shots.map((p, i) => `
      <figure class="pp-polaroid" style="--tilt:${TILT[i % TILT.length]}deg"><span class="pp-tape" aria-hidden="true"></span>
        <div class="pp-polaroid-pic"><img src="${p.url}" alt="${esc(label(p))}" loading="lazy" referrerpolicy="no-referrer" draggable="false"></div>
        <figcaption>${esc(label(p))}</figcaption></figure>`).join('')}</div></section>`;
}

/** The picture across the head of the card; the country's colour and flag when there is no photo, so every card has one. */
function heroArt(m: CountryMemory): string {
  const url = m.hero ? safeUrl(m.hero.url) : '';
  if (url) {
    const y = m.hero?.focalY;
    const pos = typeof y === 'number' && Number.isFinite(y) ? Math.round(Math.min(1, Math.max(0, y)) * 100) : 50;
    return `<img class="pp-hero-img" src="${url}" alt="" decoding="async" referrerpolicy="no-referrer" draggable="false" style="object-position:center ${pos}%">`;
  }
  return `<div class="pp-hero-fallback" aria-hidden="true"><span>${esc(nationalityFlag(m.stamp.iso))}</span></div>`;
}

/** A category's icon and label, the way the Expenses page's own till slip shows it (same list, same words). */
function categoryLine(id: string): { icon: string; label: string } {
  const known = BUILTIN_CATEGORIES.find((c) => c.id === id);
  return known ?? { icon: '🏷️', label: t('passport.card.otherSpend') };
}

/**
 * The stay's spend as the Expenses page's own till slip: the same markup (expenses/checkout.ts renderReceipt) and the
 * same styles, so the two can never drift apart. One numbered line per category, biggest first, then the subtotal and
 * the boxed total. Different currencies are never added, so each currency gets its own slip.
 */
function receipt(m: CountryMemory, locale: string): string {
  const s = m.stamp;
  const range = dateRange(m.trip.dateFrom, m.trip.dateTo);
  const meta: Array<readonly [string, string]> = [
    [t('expenses.mart.store'), s.country.toUpperCase()],
    ...(m.trip.cities.length ? [[t('passport.card.cities').toUpperCase(), m.trip.cities.join(' · ')] as const] : []),
    [t('passport.card.nights').toUpperCase(), String(m.trip.nights)],
    ...(m.total.trips > 1 ? [[t('passport.card.total').toUpperCase(), t('passport.card.totalValue', { n: m.total.nights, k: m.total.trips })] as const] : []),
    [t('expenses.mart.date'), range],
  ];
  const slip = (lines: MartLine[], fmt: (n: number) => string, rows: ReadonlyArray<readonly [string, string]>, seed: string) =>
    `<div class="rc rc--zoom paper paper--zigzag pp-card-receipt">${renderReceipt({
      lines, store: s.country.toUpperCase(), stamp: range, fmt, meta: rows, readonly: true,
      // A stay that is over is settled, like a past day on the Expenses page.
      paid: m.trip.dateTo < todayIso(), seed,
    })}</div>`;
  const seedOf = (k: string) => `${m.trip.dateFrom.replace(/-/g, '')}${String(k.length).padStart(2, '0')}0429`;

  const currencies = [...new Set(m.spendByCategory.map((l) => l.currency))];
  if (currencies.length === 0) return slip([], () => '—', meta, seedOf(''));
  return currencies.map((currency, i) => {
    const lines: MartLine[] = m.spendByCategory
      .filter((l) => l.currency === currency)
      .sort((a, b) => b.total - a.total)
      .map((l) => {
        const { icon, label } = categoryLine(l.category);
        return { id: `${currency}:${l.category}`, icon, name: label, category: l.category, baseAmount: l.total, amount: l.total, currency };
      });
    return slip(lines, (n) => money(currency, n, locale), i === 0 ? meta : [[t('expenses.mart.store'), s.country.toUpperCase()]], seedOf(currency + i));
  }).join('');
}

/** The inside of the drawer for one stamp. */
export function drawerHtml(m: CountryMemory, locale: string, _pos: { i: number; n: number }): string {
  const s = m.stamp;
  // The picture says where this is; the words under it only have to say when. The trip's name is on the
  // page the stamp came from, and the arrows that used to sit up here are the book's own job.
  const sub = dateRange(m.trip.dateFrom, m.trip.dateTo);
  return `<header class="pp-drawer-head pp-hero${m.hero && safeUrl(m.hero.url) ? ' has-cover' : ''}">
      ${heroArt(m)}
      <div class="pp-hero-shade"></div>
      <div class="pp-drawer-btns">
        <button type="button" class="pp-round is-close" data-pp-card-close aria-label="${esc(t('common.close'))}">✕</button>
      </div>
      <div class="pp-drawer-titles">
        <h2 class="pp-drawer-title">${esc(s.country)}</h2>
        <div class="pp-drawer-sub">${esc(sub)}${s.orphan ? ` · ${esc(t('passport.deletedTrip'))}` : ''}</div>
      </div>
      ${s.firstEver ? `<div class="pp-drawer-first"><i>★</i> ${esc(t('passport.card.first', { c: s.country }))}</div>` : ''}
      <div class="pp-card-stamp">${renderStamp(s, { size: 190 })}</div>
    </header>
    <div class="pp-drawer-body">
      <div class="pp-drawer-top">
        ${receipt(m, locale)}
      </div>
      ${polaroids(m)}
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
    if ((e.target as HTMLElement).closest('[data-pp-card-close]')) close();
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

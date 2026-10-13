/* ==========================================================================
   On the Road · Trip wrap page
   --------------------------------------------------------------------------
   `#wrap` — a tall page of chapters, one per screen, that looks back over the
   current trip: route, passport, stays, the bill, the bag, the journal. It owns
   no data: it subscribes to the existing stores, hands them to the pure
   `tripWrap()` (data/trip-wrap.ts) and draws the result (wrap-chapters.ts).
   Reached from the Dashboard banner and the sidebar trip card once the trip is
   over; it also works mid-trip ("the story so far"), and time travel previews it.
   ========================================================================== */

import './wrap.css';
import '../../core/paper/paper.css';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { expenseStore, type StoredExpense } from '../../data/stores/expense-store.ts';
import { expenseCategoryStore, type StoredExpenseCategory } from '../../data/stores/expense-category-store.ts';
import { journalStore, type StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { packStore, type StoredPackList } from '../../data/stores/pack-store.ts';
import { currentTrip, baseCurrency, tripBudget } from '../../data/trip-context.ts';
import { todayIso } from '../../data/trip-phase.ts';
import { onSimChange } from '../../data/sim-clock.ts';
import { currencySymbol, getRateTable, peekRateTable, type RateTable } from '../../data/rates.ts';
import { tripWrap, type WrapModel } from '../../data/trip-wrap.ts';
import { t, onLocaleChange, getLocale } from '../../core/i18n.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc, morphInto } from '../../core/utils.ts';
import { formatKg } from '../../data/packing-formula.ts';
import { displayWeight, type WeightUnit } from '../pack/pack-helpers.ts';
import { BUILTIN_CATEGORIES } from '../expenses/expense-helpers.ts';
import { coordsFor } from '../map/geo.ts';
import { entryImages } from '../journal/shared/utils.ts';
import { MIN_ENTRIES_FOR_PORTRAIT } from '../journal/recap/generator.ts';
import { wrapChapters, presentChapters, type WrapCtx, type ChapterId } from './wrap-chapters.ts';
import { chapterKeyTarget } from './wrap-nav.ts';

let _unsubs: Array<() => void> = [];
let _wired = false;
let _legs: StoredLeg[] = [];
let _expenses: StoredExpense[] = [];
let _cats: StoredExpenseCategory[] = [];
let _journal: StoredJournalEntry[] = [];
let _packs: StoredPackList[] = [];
let _rates: RateTable = {};
let _io: IntersectionObserver | null = null;

const view = () => document.getElementById('view-wrap');

function weightUnit(): WeightUnit {
  try { return (localStorage.getItem('pk-weight-unit') as WeightUnit | null) ?? 'kg'; } catch { return 'kg'; }
}

/** What the page draws from; null when no trip is loaded. */
export function buildWrap(): { model: WrapModel; ctx: WrapCtx } | null {
  const trip = currentTrip();
  if (!trip) return null;
  const base = baseCurrency();
  const today = todayIso();
  const toBase = (e: { baseAmount?: number; baseCurrency?: string }) => {
    const amt = e.baseAmount ?? 0;
    return !e.baseCurrency || e.baseCurrency === base ? amt : amt * (_rates[e.baseCurrency] ?? 1);
  };
  const model = tripWrap({
    trip: { name: trip.name, startDate: trip.startDate, endDate: trip.endDate, homeCity: trip.homeCity, returnCity: trip.returnCity, totalBudget: tripBudget() },
    legs: _legs,
    expenses: _expenses,
    toBase: (e) => toBase(e as unknown as StoredExpense),
    pack: _packs[0],
    journal: _journal.map((e) => ({ id: e.id, happenedOn: e.happenedOn, destination: e.destination, favorite: e.favorite, images: entryImages(e) })),
    portraitMin: MIN_ENTRIES_FOR_PORTRAIT,
    coordOf: (p) => coordsFor(p),
    today,
  });
  const locale = getLocale();
  const sym = currencySymbol(base);
  const unit = weightUnit();
  const ctx: WrapCtx = {
    m: model,
    locale,
    ongoing: today <= trip.endDate,
    money: (n) => `${sym}${Math.round(n).toLocaleString(locale)}`,
    km: (n) => Math.round(n).toLocaleString(locale),
    weight: (g) => (unit === 'kg' ? formatKg(g) : displayWeight(g, unit)),
    cat: (id) => {
      const mine = _cats.find((c) => c.id === id);
      if (mine) return { label: mine.label, icon: mine.icon };
      const b = BUILTIN_CATEGORIES.find((c) => c.id === id);
      return b ? { label: b.label, icon: b.icon } : { label: id, icon: '🗂️' };
    },
  };
  return { model, ctx };
}

function toc(ids: ChapterId[]): string {
  return `<nav class="wrap-toc" aria-label="${esc(t('wrap.toc'))}">${ids.map((id) =>
    `<button type="button" class="wrap-toc-dot" data-wrap-go="${id}" aria-label="${esc(t(`wrap.ch.${id}`))}" title="${esc(t(`wrap.ch.${id}`))}"></button>`).join('')}</nav>`;
}

export function renderWrap(): void {
  const root = view();
  if (!root) return;
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via esc()
  root.querySelector('.view-header')!.innerHTML = `
    <div class="view-title"><span class="view-title-icon" aria-hidden="true"><span class="nav-icon-emoji">🎞️</span></span><span>${esc(t('wrap.title'))}</span></div>
    <div class="view-subtitle">${esc(t('wrap.subtitle'))}</div>`;
  const body = root.querySelector<HTMLElement>('.wrap-body')!;
  const built = buildWrap();
  if (!built || !built.model.hasRoute) {
    morphInto(body, `<div class="wrap-empty">${esc(t('wrap.empty'))}</div>`);
    return;
  }
  morphInto(body, `${toc(presentChapters(built.ctx))}<div class="wrap-chapters">${wrapChapters(built.ctx).join('')}</div>`);
  observeChapters(body);
}

/** Marks the dot of the chapter on screen. */
function observeChapters(body: HTMLElement): void {
  _io?.disconnect();
  if (typeof IntersectionObserver === 'undefined') return;
  _io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = (e.target as HTMLElement).dataset.ch;
      body.querySelectorAll<HTMLElement>('.wrap-toc-dot').forEach((d) => d.classList.toggle('is-on', d.dataset.wrapGo === id));
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  body.querySelectorAll('.wrap-ch').forEach((el) => _io!.observe(el));
}

/* ── Actions ─────────────────────────────────────────────────────────────── */

function goChapter(id: string): void {
  document.getElementById(`wrap-ch-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function replayRoute(root: HTMLElement): void {
  const line = root.querySelector<SVGPathElement>('.wrap-map-line');
  const stops = [...root.querySelectorAll<SVGGElement>('.wrap-map-stop')];
  if (!line || typeof line.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ms = Math.min(6000, 1200 + stops.length * 350);
  line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: ms, easing: 'ease-in-out' });
  stops.forEach((g, i) => g.animate([{ opacity: 0 }, { opacity: 0, offset: 0.001 }, { opacity: 1 }],
    { duration: 300, delay: (ms * i) / Math.max(1, stops.length - 1), fill: 'backwards' }));
}

/** Opens Journal in the given mode. Journal keeps its mode private (and is not
 *  ours to change), so this presses the mode buttons it has already drawn,
 *  waiting for them if the page is still mounting. */
export async function openJournalMode(mode: 'capture' | 'story' | 'recap'): Promise<void> {
  await navigateTo('journal');
  const press = (m: string) => document.querySelector<HTMLElement>(`#view-journal [data-journal-mode="${m}"]`);
  let backed = false;
  for (let i = 0; i < 30; i++) {
    if (mode === 'capture' && !press('capture')) return;          // already on the entries list
    const target = press(mode);
    if (target) { target.click(); return; }
    // Another mode is open and only offers "← Entries": go back first, then pick.
    const back = press('capture');
    if (back && !backed && mode !== 'capture') { backed = true; back.click(); }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function wire(root: HTMLElement): void {
  if (_wired) return;
  _wired = true;
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-wrap-go],[data-wrap-replay],[data-wrap-passport],[data-wrap-journal],[data-wrap-home]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (el.dataset.wrapGo) goChapter(el.dataset.wrapGo);
    else if ('wrapReplay' in el.dataset) replayRoute(root);
    else if ('wrapPassport' in el.dataset) void import('../passport/passport-links.ts').then((m) => m.openPassport());
    else if (el.dataset.wrapJournal) void openJournalMode(el.dataset.wrapJournal as 'capture' | 'story' | 'recap');
    else if ('wrapHome' in el.dataset) void navigateTo('today');
  });
  document.addEventListener('keydown', (e) => {
    if (!root.classList.contains('active') || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest('input, textarea, select, [contenteditable="true"], dialog, [role="dialog"], .drawer')) return;
    const chapters = [...root.querySelectorAll<HTMLElement>('.wrap-ch')];
    const to = chapterKeyTarget(e.key, chapters.map((c) => c.getBoundingClientRect()), window.innerHeight);
    if (to == null) return;
    e.preventDefault();
    chapters[to].scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
}

/* ── Mount ───────────────────────────────────────────────────────────────── */

export function initWrap(): void {
  const root = view();
  if (!root) return;
  _unsubs.forEach((u) => u());
  const rerender = () => renderWrap();
  _rates = peekRateTable(baseCurrency());
  _unsubs = [
    routeStore.subscribe((rows) => { _legs = rows; rerender(); }),
    expenseStore.subscribe((rows) => { _expenses = rows; rerender(); }),
    expenseCategoryStore.subscribe((rows) => { _cats = rows; rerender(); }),
    journalStore.subscribe((rows) => { _journal = rows; rerender(); }),
    packStore.subscribe((rows) => { _packs = rows; rerender(); }),
    onLocaleChange(rerender),
    onSimChange(rerender),
  ];
  void getRateTable(baseCurrency()).then((table) => { _rates = table; rerender(); });
  wire(root);
  renderWrap();
}

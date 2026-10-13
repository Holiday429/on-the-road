/* ==========================================================================
   On the Road · Passport
   --------------------------------------------------------------------------
   `#passport` — the traveller's passport, one for the whole account: every
   country on every trip earns a stamp (data/passport.ts, fed by
   data/passport-feed.ts). A full-screen desk with a book on it: closed cover,
   inside page, data page, visas, stamp pages, back page. Drag a page edge (or
   use ← →) to turn pages; a stamp lands with a thunk the first time its page
   is turned to.

   Owns the DOM and the subscriptions; the layout is pure (book.ts), the
   markup is pages.ts, the page turning is flip.ts.
   ========================================================================== */

import './passport.css';
import './passport-links.css';
import { navigateTo, consumeNavIntent, type NavIntent } from '../../core/app.ts';
import { t, onLocaleChange, getLocale } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { currentUser } from '../../firebase/auth.ts';
import { onPassport } from '../../data/passport-feed.ts';
import { safetyProfileStore } from '../../data/stores/safety-profile-store.ts';
import { todayIso } from '../../data/trip-phase.ts';
import { markStampsSeen, unseenStamps } from '../../data/stamp-seen.ts';
import type { PassportData } from '../../data/passport.ts';
import { bookPages, flippedToShow, leavesFor, pageOfStamp, stampPages, type BookPage, type Leaf } from './book.ts';
import { createFlip, type FlipBook } from './flip.ts';
import { pageHtml, type PageCtx } from './pages.ts';
import { isSoundOn, playCover, playFlip, playThunk, setSoundOn } from './sound.ts';

const view = () => document.getElementById('view-passport');

let _data: PassportData = { stamps: [], countries: 0, cities: 0, nights: 0, trips: 0 };
let _nationality = '';
let _unsubs: Array<() => void> = [];
let _flip: FlipBook | null = null;
let _leaves: Leaf[] = [];
let _pages: BookPage[] = [];
let _single = false;
let _turned = 0;               // kept across rebuilds and, within a session, across visits
let _sig = '';
let _wired = false;
const narrow = () => window.matchMedia?.('(max-width: 820px)').matches ?? false;

/** First name (or the whole display name); the passport's nickname until the traveller picks their own. */
function nickname(): string {
  const n = currentUser()?.displayName?.trim() ?? '';
  return n.split(/\s+/)[0] || t('passport.bio.traveller');
}

function ctx(): PageCtx {
  const u = currentUser();
  return {
    data: _data,
    nickname: nickname(),
    nationality: _nationality,
    photoUrl: u?.photoURL?.trim() ?? '',
    uid: u?.uid ?? 'guest',
    issued: _data.stamps[0]?.date ?? todayIso(),
    fresh: new Set(unseenStamps(_data.stamps.map((s) => s.id))),
    locale: getLocale(),
    pageNo: (p) => _pages.indexOf(p) + 1,
  };
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

/** Leaves this close to the one showing carry their pages; the rest wait (stamp filters are not cheap). */
const WINDOW = 3;

function leafHtml(i: number, filled: boolean, c: PageCtx): string {
  const l = _leaves[i];
  const face = (p: BookPage | null, cls: string) =>
    `<div class="pp-face ${cls}" data-filled="${filled ? 1 : 0}">${filled ? pageHtml(p, c) : '<div class="pp-sheet pp-blank"></div>'}</div>`;
  return `<div class="pp-leaf" data-leaf="${i}">${face(l.front, 'is-front')}${face(_single ? null : l.back, 'is-back')}</div>`;
}

function pageLabel(turned: number): string {
  if (turned === 0) return t('passport.nav.cover');
  const total = _pages.length;
  if (_single) return t('passport.nav.page', { n: turned, m: total });
  const left = 2 * turned - 1;
  return left >= total ? t('passport.nav.page', { n: total, m: total }) : t('passport.nav.spread', { a: left, b: Math.min(total, left + 1), m: total });
}

function jumpsHtml(): string {
  const tripPages = new Map<string, { name: string; at: number }>();
  _pages.forEach((p, i) => {
    if (p.kind === 'stamps' && p.tripId && !tripPages.has(p.tripId)) tripPages.set(p.tripId, { name: p.tripName, at: i });
  });
  if (tripPages.size < 2) return '';
  return [...tripPages.values()].map((j) =>
    `<button type="button" class="pp-jump" data-pp-jump="${j.at}">${esc(j.name || t('passport.stamps.title'))}</button>`).join('');
}

function render(): void {
  const root = view();
  if (!root) return;
  const body = root.querySelector<HTMLElement>('.pp-body')!;
  _single = narrow();
  _pages = bookPages(stampPages(_data.stamps));
  _leaves = leavesFor(_pages, _single);
  const c = ctx();
  const turned = Math.min(_turned, _leaves.length);
  const near = (i: number) => Math.abs(i - turned) <= WINDOW;
  // eslint-disable-next-line no-restricted-syntax -- audited: page markup escapes every interpolation (pages.ts)
  body.innerHTML = `
    <div class="pp-desk">
      <div class="pp-stage${_single ? ' is-single' : ''}">
        <div class="pp-book" id="pp-book"><div class="pp-spine"></div>${_leaves.map((_, i) => leafHtml(i, near(i), c)).join('')}</div>
      </div>
    </div>
    <div class="pp-bar">
      <button type="button" class="btn btn-ghost" data-pp-prev aria-label="${esc(t('passport.nav.prev'))}">‹</button>
      <span class="pp-page-label" data-pp-label aria-live="polite"></span>
      <button type="button" class="btn btn-ghost" data-pp-next aria-label="${esc(t('passport.nav.next'))}">›</button>
      <button type="button" class="btn btn-ghost" data-pp-sound aria-pressed="${isSoundOn()}" title="${esc(t('passport.sound'))}">${isSoundOn() ? '🔊' : '🔈'}</button>
      <button type="button" class="btn btn-ghost" data-pp-map>${esc(t('passport.onMap'))}</button>
    </div>
    <div class="pp-jumps">${jumpsHtml()}</div>`;

  _flip?.destroy();
  _flip = createFlip({
    book: body.querySelector<HTMLElement>('#pp-book')!,
    single: () => _single,
    onTurn: (from, to) => { if (from === 0 || to === 0 || to === _leaves.length || from === _leaves.length) playCover(); else playFlip(); },
    onChange: (n) => { _turned = n; afterTurn(); },
  });
  _flip.goTo(turned, false);
  afterTurn();
}

/** Fills the pages now near the one showing, updates the label and lets new stamps land. */
function afterTurn(): void {
  const root = view();
  const book = root?.querySelector<HTMLElement>('#pp-book');
  if (!root || !book) return;
  const c = ctx();
  const turned = _flip?.turned() ?? _turned;
  _leaves.forEach((l, i) => {
    if (Math.abs(i - turned) > WINDOW) return;
    const el = book.querySelector<HTMLElement>(`.pp-leaf[data-leaf="${i}"]`);
    el?.querySelectorAll<HTMLElement>('.pp-face').forEach((f) => {
      if (f.dataset.filled === '1') return;
      const page = f.classList.contains('is-back') ? (_single ? null : l.back) : l.front;
      // eslint-disable-next-line no-restricted-syntax -- audited: page markup escapes every interpolation (pages.ts)
      f.innerHTML = pageHtml(page, c);
      f.dataset.filled = '1';
    });
  });
  const label = root.querySelector<HTMLElement>('[data-pp-label]');
  if (label) label.textContent = pageLabel(turned);
  (root.querySelector<HTMLButtonElement>('[data-pp-prev]'))!.disabled = turned === 0;
  (root.querySelector<HTMLButtonElement>('[data-pp-next]'))!.disabled = turned >= _leaves.length;
  pressVisible(book, turned);
}

/** The faces showing at this turned-count. */
function visibleFaces(book: HTMLElement, turned: number): HTMLElement[] {
  const faces: Array<HTMLElement | null> = [];
  if (_single) faces.push(book.querySelector<HTMLElement>(`.pp-leaf[data-leaf="${turned}"] .is-front`));
  else {
    if (turned > 0) faces.push(book.querySelector<HTMLElement>(`.pp-leaf[data-leaf="${turned - 1}"] .is-back`));
    faces.push(book.querySelector<HTMLElement>(`.pp-leaf[data-leaf="${turned}"] .is-front`));
  }
  return faces.filter((f): f is HTMLElement => !!f);
}

/** Stamps on the page(s) now showing that this device has not seen yet land one after another. */
function pressVisible(book: HTMLElement, turned: number): void {
  const fresh = visibleFaces(book, turned).flatMap((f) => [...f.querySelectorAll<HTMLElement>('.pp-slot[data-fresh]')]);
  if (fresh.length === 0) return;
  markStampsSeen(fresh.map((el) => el.dataset.stamp!).filter(Boolean));
  fresh.forEach((el, i) => {
    const stamp = el.querySelector<HTMLElement>('.pp-stamp');
    window.setTimeout(() => {
      el.removeAttribute('data-fresh');
      stamp?.classList.add('is-pressed');
      playThunk();
    }, 450 + i * 320);
  });
}

/* ── Intent: open the book on a given stamp ──────────────────────────────── */

function applyIntent(intent: NavIntent | null): void {
  if (!intent) return;
  let stampId = intent.stamp;
  if (!stampId && intent.legId) stampId = _data.stamps.find((s) => s.legIds.includes(intent.legId!))?.id;
  if (!stampId && intent.iso) stampId = [..._data.stamps].reverse().find((s) => s.iso === intent.iso)?.id;
  if (!stampId) return;
  const at = pageOfStamp(_pages, stampId);
  if (at < 0) return;
  _turned = flippedToShow(at, _single);
  _flip?.goTo(_turned, false);
  afterTurn();
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

function wire(root: HTMLElement): void {
  if (_wired) return;
  _wired = true;
  root.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-pp-prev]')) { _flip?.prev(); return; }
    if (el.closest('[data-pp-next]')) { _flip?.next(); return; }
    if (el.closest('[data-pp-sound]')) {
      setSoundOn(!isSoundOn());
      const b = el.closest<HTMLElement>('[data-pp-sound]')!;
      b.textContent = isSoundOn() ? '🔊' : '🔈';
      b.setAttribute('aria-pressed', String(isSoundOn()));
      return;
    }
    if (el.closest('[data-pp-map]')) { void navigateTo('map', { mode: 'world' }); return; }
    const jump = el.closest<HTMLElement>('[data-pp-jump]');
    if (jump) { _flip?.goTo(flippedToShow(Number(jump.dataset.ppJump), _single)); return; }
    // The cover opens on a tap; a page's outer edge turns it.
    const face = el.closest<HTMLElement>('.pp-face');
    if (!face || el.closest('[data-no-turn], button, a') || _flip?.justDragged()) return;
    if (face.querySelector('.pp-cover-face') && (_flip?.turned() ?? 0) === 0) { _flip?.next(); return; }
    const r = face.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const onBack = face.classList.contains('is-back');
    if (!onBack && x > 0.86) _flip?.next();
    else if (onBack && x < 0.14) _flip?.prev();
    else if (_single && !onBack && x < 0.14) _flip?.prev();
  });
}

function head(root: HTMLElement): void {
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via esc()
  root.querySelector('.view-header')!.innerHTML = `
    <div class="view-title"><span class="view-title-icon" aria-hidden="true"><span class="nav-icon-emoji">🛂</span></span><span>${esc(t('passport.title'))}</span></div>
    <div class="view-subtitle">${esc(t('passport.view.subtitle'))}</div>`;
}

const signature = (d: PassportData): string =>
  `${d.stamps.map((s) => `${s.id}:${s.nights}:${s.date}`).join('|')}#${d.cities}#${d.nights}#${_nationality}#${getLocale()}`;

/* ── Mount ───────────────────────────────────────────────────────────────── */

export function initPassport(): void {
  const root = view();
  if (!root) return;
  _unsubs.forEach((u) => u());
  head(root);
  const refresh = (force = false) => {
    const s = signature(_data);
    if (!force && s === _sig) return;
    _sig = s;
    render();
  };
  _unsubs = [
    onPassport((d) => { _data = d; refresh(); }),
    safetyProfileStore.subscribe((p) => { _nationality = p?.nationality ?? ''; refresh(); }),
    onLocaleChange(() => { head(root); refresh(true); }),
  ];
  const mq = window.matchMedia?.('(max-width: 820px)');
  const onMq = () => { if (narrow() !== _single) render(); };
  mq?.addEventListener('change', onMq);
  _unsubs.push(() => mq?.removeEventListener('change', onMq));
  window.addEventListener('otr:nav-intent', onIntent);
  _unsubs.push(() => window.removeEventListener('otr:nav-intent', onIntent));
  wire(root);
  _sig = signature(_data);
  render();
  applyIntent(consumeNavIntent('passport'));
}

function onIntent(e: Event): void {
  if ((e as CustomEvent<{ view: string }>).detail?.view === 'passport') applyIntent(consumeNavIntent('passport'));
}

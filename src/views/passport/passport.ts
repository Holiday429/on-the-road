/* ==========================================================================
   On the Road · Passport
   --------------------------------------------------------------------------
   `#passport` — the traveller's passport, one for the whole account: every
   country on every trip earns a stamp (data/passport.ts), and the traveller
   presses it themselves (press.ts) — or lets it press itself. A full-screen
   desk with a book on it: closed cover, inside page, data page, visas, stamp
   pages, back page. Drag a page edge (or use ← →) to turn pages.

   Owns the DOM and the subscriptions; the layout is pure (book.ts), the
   markup is pages.ts, the page turning is flip.ts, the stamping is press.ts,
   the data-page form is bio-edit.ts.
   ========================================================================== */

import './passport.css';
import './passport-links.css';
import { navigateTo, consumeNavIntent, type NavIntent } from '../../core/app.ts';
import { t, onLocaleChange, getLocale } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { renderStamp } from '../../core/paper/stamp.ts';
import { miniGlobeSvg } from '../../core/paper/mini-globe.ts';
import { currentUser } from '../../firebase/auth.ts';
import { onPassport, peekFeedLegs } from '../../data/passport-feed.ts';
import { passportState, snapOf, type PassportFeed } from '../../data/passport-state.ts';
import { passportStore } from '../../data/stores/passport-store.ts';
import { journalStore } from '../../data/stores/journal-store.ts';
import { expenseStore } from '../../data/stores/expense-store.ts';
import { countryMemory } from '../../data/country-memory.ts';
import { currentTripId } from '../../data/trip-context.ts';
import type { ExtrasData } from '../../views/atlas/country-extras.ts';
import { safetyProfileStore } from '../../data/stores/safety-profile-store.ts';
import { todayIso } from '../../data/trip-phase.ts';
import type { PassportStamp } from '../../data/passport.ts';
import type { PlacementRec } from '../../data/schema.ts';
import {
  PAGE_CAP, autoPlacement, bookPages, flippedToShow, leavesFor, pageOfStamp, stampPages,
  type BookPage, type Leaf, type StampPage,
} from './book.ts';
import { createFlip, type FlipBook } from './flip.ts';
import { pageHtml, type PageCtx } from './pages.ts';
import { openBioEditor } from './bio-edit.ts';
// The name the traveller goes by is one thing, shown in two places (see profile-me.ts).
import { defaultNickname } from '../profile/profile-me.ts';
import { openVisaEditor } from './visa-edit.ts';
import { visaStore, type StoredVisa } from '../../data/stores/visa-store.ts';
import { regionLabel, schengenUsage, visaUses, visaWarnings } from '../../data/visa.ts';
import { startPress } from './press.ts';
import { openStampCard } from './stamp-card.ts';
import { isSoundOn, playCover, playFlip, playThunk, setSoundOn } from './sound.ts';

const view = () => document.getElementById('view-passport');

let _feed: PassportFeed = { stamps: [], countries: 0, cities: 0, nights: 0, trips: 0, pressed: [], pending: [], warnings: [], visaWarnings: [] };
let _placements: Record<string, PlacementRec> = {};
let _profile = { nickname: '', photoURL: '', nationality: '', occupation: '', signature: '' };
let _safetyNationality = '';
let _visas: StoredVisa[] = [];
let _unsubs: Array<() => void> = [];
let _flip: FlipBook | null = null;
let _leaves: Leaf[] = [];
let _pages: BookPage[] = [];
let _single = false;
let _turned = 0;               // kept across rebuilds and, within a session, across visits
let _sig = '';
let _wired = false;
/** Stamps just pressed: hidden until their page shows, then they land. */
const _fresh = new Set<string>();
/** Placements written locally that the stored copy has not echoed back yet. */
const _unsaved = new Set<string>();
/** The stamp the rubber stamp is hovering with, and those still to follow in the same sitting. */
let _pressing: PassportStamp | null = null;
let _queue: PassportStamp[] = [];
let _stopPress: (() => void) | null = null;
let _closeCard: (() => void) | null = null;
/** Journal and spend rows for the back of a stamp — subscribed to the first time a stamp is opened. */
const _extras: ExtrasData = { journal: [], expenses: [], nomad: [], intel: [] };
let _extrasOn = false;
/** Bumped to stop a replay in progress. */
let _replay = 0;
let _replaying = false;
let _running = 0;
const narrow = () => window.matchMedia?.('(max-width: 820px)').matches ?? false;

const nickname = (): string => _profile.nickname || defaultNickname();
const nationality = (): string => _profile.nationality || _safetyNationality;

/** What each visa was used for (trips and countries) and which stays do not fit it, in the reader's words. */
function visaNotes(): Map<string, { uses: string; warns: string[] }> {
  const legs = peekFeedLegs();
  const today = todayIso();
  const names = new Map(_feed.stamps.map((x) => [x.tripId, x.tripName]));
  const out = new Map<string, { uses: string; warns: string[] }>();
  for (const v of _visas) {
    const uses = visaUses(v, legs).map((u) => `${names.get(u.tripId) || '—'} (${u.isos.join(' ')})`).join(', ');
    const label = regionLabel(v.region, getLocale(), t('passport.visa.schengen'));
    const warns = visaWarnings(v, legs, today).map((w) => t(`passport.visa.warn.${w.kind}`, {
      region: label, trip: names.get(w.tripId) ?? '', date: w.date, days: String(w.days ?? ''),
    }));
    out.set(v.id, { uses: uses ? t('passport.visa.usedFor', { x: uses }) : '', warns });
  }
  return out;
}

function state() {
  return passportState(_feed.stamps, _placements);
}

function ctx(): PageCtx {
  const u = currentUser();
  const st = state();
  return {
    data: _feed,
    nickname: nickname(),
    nationality: nationality(),
    occupation: _profile.occupation,
    signature: _profile.signature,
    photoUrl: _profile.photoURL || u?.photoURL?.trim() || '',
    uid: u?.uid ?? 'guest',
    issued: st.pressed[0]?.date ?? _feed.stamps[0]?.date ?? todayIso(),
    visas: _visas,
    visaNotes: visaNotes(),
    schengen: schengenUsage(peekFeedLegs(), todayIso()),
    fresh: _replaying ? new Set(_feed.stamps.map((x) => x.id).concat(Object.keys(_placements))) : _fresh,
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

/** The tray of stamps waiting to be pressed. */
function trayHtml(): string {
  const waiting = state().pending.filter((s) => s.id !== _pressing?.id);
  if (waiting.length === 0 || _pressing) return '';
  const first = state().pressed.length === 0;
  const heads = waiting.slice(0, 5).map((s) => `<span class="pp-tray-stamp">${renderStamp(s, { size: 56 })}</span>`).join('');
  return `<div class="pp-tray">
    <div class="pp-tray-stamps" aria-hidden="true">${heads}</div>
    <div class="pp-tray-text">${esc(t(first ? 'passport.tray.first' : 'passport.tray.waiting', { n: waiting.length }))}</div>
    <div class="pp-tray-actions">
      <button type="button" class="btn btn-primary" data-pp-press>${esc(t('passport.tray.press'))}</button>
      <button type="button" class="btn btn-ghost" data-pp-press-all>${esc(t('passport.tray.pressAll'))}</button>
    </div>
  </div>`;
}

function layout(): StampPage[] {
  const st = state();
  const ensure = _pressing ? { tripId: _pressing.tripId, tripName: _pressing.tripName } : undefined;
  return stampPages(st.pressed, _placements, { ensureTrip: ensure });
}

function render(): void {
  const root = view();
  if (!root) return;
  const body = root.querySelector<HTMLElement>('.pp-body')!;
  _single = narrow();
  _pages = bookPages(layout(), _visas.length);
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
      <button type="button" class="pp-prop-globe" data-pp-map title="${esc(t('atlas.title'))}" aria-label="${esc(t('atlas.title'))}">${miniGlobeSvg(52)}</button>
    </div>
    <div class="pp-tray-host" data-pp-tray></div>
    <div class="pp-bar">
      <button type="button" class="btn btn-ghost" data-pp-prev aria-label="${esc(t('passport.nav.prev'))}">‹</button>
      <span class="pp-page-label" data-pp-label aria-live="polite"></span>
      <button type="button" class="btn btn-ghost" data-pp-next aria-label="${esc(t('passport.nav.next'))}">›</button>
      <button type="button" class="btn btn-ghost" data-pp-replay>${esc(t('passport.replay'))}</button>
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

/** Fills the pages now near the one showing, updates the label and tray, and lets new stamps land. */
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
  const tray = root.querySelector<HTMLElement>('[data-pp-tray]');
  // eslint-disable-next-line no-restricted-syntax -- audited: tray markup escapes every interpolation
  if (tray) tray.innerHTML = trayHtml();
  landVisible(book, turned);
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

/** Stamps just pressed that are on a page now showing land one after another, with the thunk. */
function landVisible(book: HTMLElement, turned: number): void {
  const slots = visibleFaces(book, turned).flatMap((f) => [...f.querySelectorAll<HTMLElement>('.pp-slot[data-fresh]')]);
  slots.forEach((el, i) => {
    const id = el.dataset.stamp ?? '';
    const pressure = _placements[id]?.pressure ?? 0.75;
    _fresh.delete(id);
    el.removeAttribute('data-fresh');
    el.querySelector<HTMLElement>('.pp-stamp')?.classList.add('is-pressed');
    window.setTimeout(() => playThunk(pressure), i * 320);
  });
}

/* ── Pressing ────────────────────────────────────────────────────────────── */

function endPress(): void {
  _stopPress?.();
  _stopPress = null;
  _pressing = null;
  _queue = [];
  render();
}

function commit(s: PassportStamp, p: PlacementRec): void {
  _placements = { ..._placements, [s.id]: p };
  _fresh.add(s.id);
  _unsaved.add(s.id);
  void passportStore.save({ placements: _placements });
}

/** Presses the next stamp in the queue: shows its page, then lets the traveller stamp it. */
function nextPress(): void {
  const s = _queue.shift();
  if (!s) { endPress(); return; }
  _stopPress?.();
  _pressing = s;
  render();
  const at = _pages.findIndex((p) => p.kind === 'stamps' && p.tripId === s.tripId && p.items.length < PAGE_CAP);
  if (at < 0) { endPress(); return; }
  const target = flippedToShow(at, _single);
  const moved = target !== (_flip?.turned() ?? 0);
  _turned = target;
  _flip?.goTo(target, true);
  afterTurn();
  window.setTimeout(() => {
    const root = view();
    const page = _pages[at] as StampPage;
    const face = root?.querySelector<HTMLElement>(`.pp-sheet[data-page-key="${CSS.escape(page.key)}"]`)?.closest<HTMLElement>('.pp-face');
    const desk = root?.querySelector<HTMLElement>('.pp-desk');
    if (!face || !desk || _pressing?.id !== s.id) return;
    const suggest = autoPlacement(s, _pages.filter((p): p is StampPage => p.kind === 'stamps'));
    const done = (p: PlacementRec) => { _stopPress = null; commit(s, p); _pressing = null; render(); window.setTimeout(nextPress, 900); };
    _stopPress = startPress({
      desk, face, stamp: s, start: { x: suggest.x, y: suggest.y },
      onDone: (r) => done({ page: suggest.page, x: r.x, y: r.y, rot: s.rotation, pressure: r.pressure, at: Date.now(), snap: snapOf(s) }),
      onAuto: () => done({ ...suggest, snap: snapOf(s) }),
      onCancel: endPress,
    });
  }, moved ? 820 : 80);
}

/** Press these one by one. */
function pressInTurn(stamps: PassportStamp[]): void {
  _queue = [...stamps];
  nextPress();
}

/** Press every waiting stamp at once, each on the first free spot. */
function pressAll(): void {
  const pending = state().pending;
  if (pending.length === 0) return;
  let acc = { ..._placements };
  let pressed = [...state().pressed];
  for (const s of pending) {
    const pages = stampPages(pressed, acc, { ensureTrip: { tripId: s.tripId, tripName: s.tripName } });
    const p: PlacementRec = { ...autoPlacement(s, pages), snap: snapOf(s) };
    acc = { ...acc, [s.id]: p };
    pressed = [...pressed, s];
    _fresh.add(s.id);
    _unsaved.add(s.id);
  }
  _placements = acc;
  void passportStore.save({ placements: _placements });
  render();
  // Open on the first of the new stamps so the traveller watches them land.
  const at = pageOfStamp(_pages, pending[0].id);
  if (at >= 0) { _turned = flippedToShow(at, _single); _flip?.goTo(_turned, true); afterTurn(); }
}

/* ── The back of a stamp ─────────────────────────────────────────────────── */

function ensureExtras(): void {
  if (_extrasOn) return;
  _extrasOn = true;
  _unsubs.push(journalStore.subscribeAll((rows) => { _extras.journal = rows; }));
  _unsubs.push(expenseStore.subscribeAll((rows) => { _extras.expenses = rows; }));
}

function openCard(id: string): void {
  const stamp = state().pressed.find((x) => x.id === id);
  const desk = view()?.querySelector<HTMLElement>('.pp-desk');
  if (!stamp || !desk) return;
  ensureExtras();
  _closeCard?.();
  const memory = countryMemory(stamp, _feed.stamps, peekFeedLegs(), _extras);
  _closeCard = openStampCard(desk, memory, getLocale(), {
    onMap: (iso) => { void navigateTo('atlas', { iso }); },
    onJournal: !stamp.orphan && stamp.tripId === currentTripId() ? () => { void navigateTo('journal'); } : undefined,
    onClose: () => { _closeCard = null; },
  });
}

/* ── Replay: the whole passport, pressed again in order ──────────────────── */

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

async function replay(): Promise<void> {
  const token = ++_replay;
  const alive = () => token === _replay;
  const root = view();
  const book = root?.querySelector<HTMLElement>('#pp-book');
  const withStamps = _pages.map((p, i) => (p.kind === 'stamps' && p.items.length ? i : -1)).filter((i) => i >= 0);
  if (!root || !book || withStamps.length === 0) return;
  _closeCard?.();
  _running += 1;
  _replaying = true;
  book.querySelectorAll<HTMLElement>('.pp-slot[data-stamp]').forEach((el) => el.setAttribute('data-fresh', ''));
  const done = new Set<string>();
  _flip?.goTo(0, true);
  await sleep(600);
  for (const at of withStamps) {
    const target = flippedToShow(at, _single);
    while (alive() && (_flip?.turned() ?? 0) < target) { _flip?.next(); await sleep(750); }
    if (!alive()) break;
    const faces = visibleFaces(book, _flip?.turned() ?? 0);
    const slots = faces.flatMap((f) => [...f.querySelectorAll<HTMLElement>('.pp-slot[data-stamp]')])
      .filter((el) => !done.has(el.dataset.stamp!))
      .sort((a, b) => (state().pressed.find((x) => x.id === a.dataset.stamp)?.date ?? '').localeCompare(state().pressed.find((x) => x.id === b.dataset.stamp)?.date ?? ''));
    for (const el of slots) {
      if (!alive()) break;
      const id = el.dataset.stamp!;
      done.add(id);
      el.removeAttribute('data-fresh');
      el.querySelector<HTMLElement>('.pp-stamp')?.classList.add('is-pressed');
      playThunk(_placements[id]?.pressure ?? 0.75);
      await sleep(560);
    }
  }
  if (alive()) await sleep(600);
  // Whatever the way out (finished, interrupted), nothing may stay hidden — unless a newer replay has taken over.
  _running -= 1;
  if (_running > 0) return;
  _replaying = false;
  book.querySelectorAll<HTMLElement>('.pp-slot[data-fresh]').forEach((el) => {
    if (!_fresh.has(el.dataset.stamp ?? '')) el.removeAttribute('data-fresh');
  });
}

/* ── Intent: open the book on a given stamp ──────────────────────────────── */

function applyIntent(intent: NavIntent | null): void {
  if (!intent) return;
  let stamp = intent.stamp ? _feed.stamps.find((s) => s.id === intent.stamp) : undefined;
  if (!stamp && intent.legId) stamp = _feed.stamps.find((s) => s.legIds.includes(intent.legId!));
  if (!stamp && intent.iso) stamp = [..._feed.stamps].reverse().find((s) => s.iso === intent.iso);
  if (!stamp) return;
  // A stamp still waiting to be pressed opens straight into the ceremony.
  if (!_placements[stamp.id]) { pressInTurn([stamp]); return; }
  const at = pageOfStamp(_pages, stamp.id);
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
    if (el.closest('.pp-press')) return;
    if (el.closest('[data-pp-card-close], .pp-card-scrim')) return;
    if (el.closest('[data-pp-replay]')) { void replay(); return; }
    if (el.closest('[data-pp-prev], [data-pp-next], [data-pp-jump]')) _replay++;     // any turn of the traveller's own ends a replay
    if (el.closest('[data-pp-prev]')) { _flip?.prev(); return; }
    if (el.closest('[data-pp-next]')) { _flip?.next(); return; }
    if (el.closest('[data-pp-press]')) { pressInTurn(state().pending); return; }
    if (el.closest('[data-pp-press-all]')) { pressAll(); return; }
    const visa = el.closest<HTMLElement>('[data-pp-visa]');
    if (visa) { openVisaEditor(_visas.find((x) => x.id === visa.dataset.ppVisa) ?? null); return; }
    if (el.closest('[data-pp-visa-add]')) { openVisaEditor(null); return; }
    if (el.closest('[data-pp-edit]')) { openBioEditor({ nickname: defaultNickname(), nationality: _safetyNationality }, () => { /* the subscription repaints */ }); return; }
    if (el.closest('[data-pp-sound]')) {
      setSoundOn(!isSoundOn());
      const b = el.closest<HTMLElement>('[data-pp-sound]')!;
      b.textContent = isSoundOn() ? '🔊' : '🔈';
      b.setAttribute('aria-pressed', String(isSoundOn()));
      return;
    }
    if (el.closest('[data-pp-map]')) { void navigateTo('atlas'); return; }
    const jump = el.closest<HTMLElement>('[data-pp-jump]');
    if (jump) { _flip?.goTo(flippedToShow(Number(jump.dataset.ppJump), _single)); return; }
    const slot = el.closest<HTMLElement>('.pp-slot[data-stamp]');
    if (slot && !_pressing && !_flip?.justDragged() && !slot.hasAttribute('data-fresh')) { openCard(slot.dataset.stamp!); return; }
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

const signature = (): string =>
  [
    _feed.stamps.map((s) => `${s.id}:${s.nights}:${s.date}`).join('|'),
    Object.entries(_placements).map(([k, p]) => `${k}@${p.page}:${p.x}:${p.y}`).join('|'),
    Object.values(_profile).join('~'), peekFeedLegs().map((l) => `${l.id}${l.dateFrom}${l.dateTo}${l.country}`).join(''), _visas.map((v) => `${v.id}:${v.updatedAt}`).join('|'), _safetyNationality, getLocale(), _feed.cities, _feed.nights,
  ].join('#');

/* ── Mount ───────────────────────────────────────────────────────────────── */

export function initPassport(): void {
  const root = view();
  if (!root) return;
  _unsubs.forEach((u) => u());
  head(root);
  const refresh = (force = false) => {
    const s = signature();
    if (!force && s === _sig) return;
    _sig = s;
    // Do not pull the page out from under a stamp that is being pressed.
    if (_pressing) return;
    render();
  };
  _unsubs = [
    onPassport((d) => { _feed = d; refresh(); }),
    passportStore.subscribe((p) => {
      _profile = { nickname: p?.nickname ?? '', photoURL: p?.photoURL ?? '', nationality: p?.nationality ?? '', occupation: p?.occupation ?? '', signature: p?.signature ?? '' };
      // Placements written in this sitting stand until the stored copy has caught up with them.
      const stored = p?.placements ?? {};
      for (const id of [..._unsaved]) if (stored[id]) _unsaved.delete(id);
      _placements = { ...stored, ...Object.fromEntries([..._unsaved].map((id) => [id, _placements[id]]).filter(([, v]) => v)) };
      refresh();
    }),
    safetyProfileStore.subscribe((p) => { _safetyNationality = p?.nationality ?? ''; refresh(); }),
    visaStore.subscribe((rows) => { _visas = rows.slice().sort((a, b) => (a.validFrom || '9').localeCompare(b.validFrom || '9')); refresh(); }),
    onLocaleChange(() => { head(root); refresh(true); }),
  ];
  const mq = window.matchMedia?.('(max-width: 820px)');
  const onMq = () => { if (narrow() !== _single) render(); };
  mq?.addEventListener('change', onMq);
  _unsubs.push(() => mq?.removeEventListener('change', onMq));
  window.addEventListener('otr:nav-intent', onIntent);
  _unsubs.push(() => window.removeEventListener('otr:nav-intent', onIntent));
  wire(root);
  _sig = signature();
  render();
  applyIntent(consumeNavIntent('passport'));
}

function onIntent(e: Event): void {
  if ((e as CustomEvent<{ view: string }>).detail?.view === 'passport') applyIntent(consumeNavIntent('passport'));
}

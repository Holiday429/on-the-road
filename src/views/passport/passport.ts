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
   the data-page form is bio-edit.ts, the memory card is stamp-card.ts and the
   cover customiser is cover-panel.ts. The passport shows only what is in the
   passport: nothing on these pages leads away to another view.
   ========================================================================== */

import { PASSPORT_ICON_HTML } from '../../core/icons.ts';
import './passport.css';
import './passport-links.css';
import { consumeNavIntent, type NavIntent } from '../../core/app.ts';
import { t, onLocaleChange, getLocale } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { renderStamp } from '../../core/paper/stamp.ts';
import { currentUser } from '../../firebase/auth.ts';
import { onPassport, peekFeedLegs } from '../../data/passport-feed.ts';
import { passportState, snapOf, type PassportFeed } from '../../data/passport-state.ts';
import { passportDocStore, passportStore } from '../../data/stores/passport-store.ts';
import { journalStore } from '../../data/stores/journal-store.ts';
import { expenseStore } from '../../data/stores/expense-store.ts';
import { countryMemory } from '../../data/country-memory.ts';
import type { ExtrasData } from '../../views/atlas/country-extras.ts';
import { safetyProfileStore } from '../../data/stores/safety-profile-store.ts';
import { todayIso } from '../../data/trip-phase.ts';
import type { PassportStamp } from '../../data/passport.ts';
import type { PassportCover, PlacementRec } from '../../data/schema.ts';
import { coverStyle, normalizeCover, sameCover, DEFAULT_COVER } from '../../data/passport-cover.ts';
import {
  PAGE_CAP, SHUT_PAUSE_MS, autoPlacement, bookPages, flippedToShow, leavesFor, pageOfStamp, reachedBackCover, stampPages,
  type BookPage, type Leaf, type StampPage,
} from './book.ts';
import { createFlip, type FlipBook } from './flip.ts';
import { pageHtml, type PageCtx } from './pages.ts';
import { openBioEditor } from './bio-edit.ts';
import { NO_DOC, type DocInput } from './bio.ts';
import { attachLens, regionName } from './lens.ts';
// The name the traveller goes by is one thing, shown in two places (see profile-me.ts).
import { defaultNickname } from '../profile/profile-me.ts';
import { openVisaEditor } from './visa-edit.ts';
import { visaStore, type StoredVisa } from '../../data/stores/visa-store.ts';
import { regionLabel, schengenUsage, visaUses, visaWarnings } from '../../data/visa.ts';
import { startPress } from './press.ts';
import { openMemoryDrawer, type DrawerHandle } from './stamp-card.ts';
import { openCoverPanel, type PanelHandle } from './cover-panel.ts';
import { isSoundOn, playCover, playFlip, playThunk, setSoundOn } from './sound.ts';

const view = () => document.getElementById('view-passport');

let _feed: PassportFeed = { stamps: [], countries: 0, cities: 0, nights: 0, trips: 0, pressed: [], pending: [], warnings: [], visaWarnings: [] };
let _placements: Record<string, PlacementRec> = {};
let _profile = { nickname: '', photoURL: '', nationality: '', occupation: '', signature: '' };
let _safetyNationality = '';
let _doc: DocInput = NO_DOC;
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
/** The memory card (right) and the cover panel (left): at most one is open, and the book moves over to make room. */
let _drawer: DrawerHandle | null = null;
let _drawerStamp = '';
let _panel: PanelHandle | null = null;
/** How the traveller dressed the booklet; null = never touched (the theme's own navy). */
let _cover: PassportCover | null = null;
let _coverSave = 0;
/** Journal and spend rows for the back of a stamp — subscribed to the first time a stamp is opened. */
const _extras: ExtrasData = { journal: [], expenses: [], nomad: [], intel: [] };
let _extrasOn = false;
/** Bumped to stop a replay in progress. */
let _replay = 0;
let _replaying = false;
/** Pending "close the book" after the back cover; 0 = none. */
let _shutTimer = 0;
let _running = 0;
const narrow = () => window.matchMedia?.('(max-width: 599px)').matches ?? false;

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
    cover: normalizeCover(_cover),
    pressed: st.pressed.length,
    doc: _doc,
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
  _pages = bookPages(layout(), _visas.length, _single);
  _leaves = leavesFor(_pages, _single);
  const c = ctx();
  const turned = Math.min(_turned, _leaves.length);
  const near = (i: number) => Math.abs(i - turned) <= WINDOW;
  // eslint-disable-next-line no-restricted-syntax -- audited: page markup escapes every interpolation (pages.ts)
  body.innerHTML = `
    <div class="pp-desk">
      <div class="pp-stage${_single ? ' is-single' : ''}">
        <div class="pp-book" id="pp-book" style="${esc(bookStyle())}"><div class="pp-spine"></div><div class="pp-gutter" aria-hidden="true"></div>${_leaves.map((_, i) => leafHtml(i, near(i), c)).join('')}</div>
      </div>
    </div>
    <div class="pp-tray-host" data-pp-tray></div>
    <div class="pp-controls">
      <div class="pp-jumps">${jumpsHtml()}</div>
      <div class="pp-bar">
        <div class="pp-bar-nav">
          <button type="button" class="pp-round" data-pp-prev aria-label="${esc(t('passport.nav.prev'))}">‹</button>
          <span class="pp-page-label" data-pp-label aria-live="polite"></span>
          <button type="button" class="pp-round" data-pp-next aria-label="${esc(t('passport.nav.next'))}">›</button>
        </div>
        <div class="pp-bar-tools">
          <button type="button" class="btn btn-ghost pp-tool-btn" data-pp-replay>${esc(t(_replaying ? 'passport.replay.stop' : 'passport.replay'))}</button>
          <button type="button" class="btn btn-ghost pp-tool-btn" data-pp-cover aria-pressed="${!!_panel}">${esc(t('passport.cover.edit'))}</button>
          <button type="button" class="pp-round pp-icon-btn" data-pp-sound aria-pressed="${isSoundOn()}" aria-label="${esc(t('passport.sound'))}" title="${esc(t('passport.sound'))}">${isSoundOn() ? '🔊' : '🔈'}</button>
          <button type="button" class="btn btn-primary pp-share-btn" data-pp-share${state().pressed.length === 0 ? ' disabled' : ''}>${esc(t('passport.share'))}</button>
        </div>
      </div>
    </div>`;

  _flip?.destroy();
  _flip = createFlip({
    book: body.querySelector<HTMLElement>('#pp-book')!,
    single: () => _single,
    onTurn: (from, to) => { if (from === 0 || to === 0 || to === _leaves.length || from === _leaves.length) playCover(); else playFlip(); },
    onChange: (n) => { _turned = n; afterTurn(); },
  });
  _flip.goTo(turned, false);
  afterTurn();
  // The desk was rebuilt: put an open card or panel back on it.
  const desk = body.querySelector<HTMLElement>('.pp-desk')!;
  for (const side of [_drawer, _panel]) if (side) desk.append(side.scrim, side.el);
  fitRoom();
  fitStage();
}

/** The custom properties of the traveller's cover; nothing for the untouched original, so the theme's navy shows. */
function bookStyle(): string {
  const c = normalizeCover(_cover);
  return _cover && !sameCover(c, DEFAULT_COVER) ? coverStyle(c) : '';
}

/** The cover face and the back cover repainted after the traveller changed them. */
function applyCover(): void {
  const book = view()?.querySelector<HTMLElement>('#pp-book');
  if (!book) return;
  book.setAttribute('style', bookStyle());
  const c = ctx();
  _leaves.forEach((l, i) => {
    const leaf = book.querySelector<HTMLElement>(`.pp-leaf[data-leaf="${i}"]`);
    const faces: Array<[string, BookPage | null]> = [['.is-front', l.front], ['.is-back', _single ? null : l.back]];
    for (const [sel, page] of faces) {
      if (page?.kind !== 'cover' && page?.kind !== 'backcover') continue;
      const f = leaf?.querySelector<HTMLElement>(sel);
      // eslint-disable-next-line no-restricted-syntax -- audited: page markup escapes every interpolation (pages.ts)
      if (f && f.dataset.filled === '1') f.innerHTML = pageHtml(page, c);
    }
  });
}

function onCoverChange(c: PassportCover): void {
  _cover = c;
  applyCover();
  window.clearTimeout(_coverSave);
  _coverSave = window.setTimeout(() => { _coverSave = 0; void passportStore.save({ cover: c }); }, 450);
}

/**
 * How much room the book actually has. The view sits under a topbar of its own height and over a bar of controls
 * whose height depends on how they wrap, so both are measured — but NOT from the desk's own rendered size: the
 * desk holds the book, so reading room back from it after the book has already grown into that room would feed
 * the book's old size into its own next size, creeping the page taller on every resize and eventually pushing
 * the controls off the bottom of the window. Room is measured from the window down instead: a ceiling the book
 * is sized to fit under, never a floor read back from whatever the book last was.
 */
function fitRoom(): void {
  const root = view();
  const body = root?.querySelector<HTMLElement>('.pp-body');
  const desk = body?.querySelector<HTMLElement>('.pp-desk');
  const controls = body?.querySelector<HTMLElement>('.pp-controls');
  if (!root || !body || !desk) return;
  // Above: the topbar and whatever header the view carries. Below: the phone's nav bar, when there is one.
  const above = Math.max(0, Math.round(body.getBoundingClientRect().top));
  // (The nav is fixed, so it has no offsetParent even when shown: its height is what says whether it is there.)
  const navH = document.getElementById('mobile-nav')?.getBoundingClientRect().height ?? 0;
  const below = Math.round(navH);
  body.style.setProperty('--pp-chrome', `${above + below + 16}px`);
  // The controls' own height (it wraps to more rows on a narrow window) is read at its CURRENT size — fixed
  // input, not fed by the book — so there is nothing here for a feedback loop to run away with.
  const controlsH = controls ? Math.round(controls.getBoundingClientRect().height) : 0;
  // The tray of unpressed stamps sits between the desk and the controls; it takes its own height out of the book's room.
  const tray = body.querySelector<HTMLElement>('.pp-tray-host');
  const trayH = tray && tray.childElementCount ? Math.round(tray.getBoundingClientRect().height) + 12 : 0;
  const gap = 28;      // the column's own gaps (.pp-body's `gap`, roughly) between desk, tray and controls
  const ceiling = window.innerHeight - above - below - controlsH - trayH - gap;
  const room = Math.max(240, Math.round(ceiling - 8));
  body.style.setProperty('--pp-room', `${room}px`);
  // Half a spread can never be wider than half the desk, whatever the window's shape.
  body.style.setProperty('--pp-half', `${Math.max(140, Math.round(desk.clientWidth / 2) - 8)}px`);
}

/** Moves the book aside (and shrinks it if it must) so an open card or panel does not cover it. */
function fitStage(): void {
  const desk = view()?.querySelector<HTMLElement>('.pp-desk');
  const stage = desk?.querySelector<HTMLElement>('.pp-stage');
  if (!desk || !stage) return;
  const side = _drawer ?? _panel;
  desk.classList.toggle('has-side', !!side);
  if (!side || narrow()) { stage.style.transform = ''; return; }
  const w = side.el.offsetWidth;
  const room = desk.clientWidth - w - 28;
  // The card beside it is what the traveller is reading now, so the book steps back a little even when it
  // would still fit — then shrinks further if the room beside the card is genuinely tight.
  const scale = Math.max(0.5, Math.min(0.86, room / stage.offsetWidth));
  stage.style.transform = `translateX(${_drawer ? -w / 2 : w / 2}px) scale(${scale.toFixed(3)})`;
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
  fitRoom();
  landVisible(book, turned);
  watchForEnd(turned);
}

/**
 * Read to the end: the back cover is held for a moment, then the booklet is turned over in the hand and comes to
 * rest on its front cover — the way you would shut a book you have finished. Turning back, or anything else that
 * moves the book, calls this again and cancels the close.
 */
function watchForEnd(turned: number): void {
  window.clearTimeout(_shutTimer);
  _shutTimer = 0;
  if (_replaying || !reachedBackCover(turned, _leaves.length)) return;
  _shutTimer = window.setTimeout(() => {
    _shutTimer = 0;
    // Still on the back cover (the traveller did not turn back in the meantime)?
    if (!_flip || !reachedBackCover(_flip.turned(), _leaves.length)) return;
    void turnOver();
  }, SHUT_PAUSE_MS);
}

/** Time for each half of the booklet turning over, ms. */
const OVER_MS = 440;
let _turningOver = false;

/**
 * Turns the whole closed booklet over, back cover to front cover, as one object. The pages inside never move: the
 * booklet swings edge-on (nothing of it can be seen), the leaves are put back under the cover while it is thin as a
 * line, and it swings on to show the front. The same spin carries on in the same direction throughout.
 */
async function turnOver(): Promise<void> {
  const book = view()?.querySelector<HTMLElement>('#pp-book');
  if (!book || !_flip || _turningOver) return;
  _turningOver = true;
  const shut = book.classList.contains('is-shut');
  // Each side of a closed book is one page: the axis runs through the middle of the page that shows.
  // (Shut, the book sits shifted right so its left page is centred; closed, shifted left so its right page is.)
  const lean = (x: number) => (_single ? '' : `translateX(${x}%) `);
  const set = (transform: string, originX: number, ms: number, ease: string) => {
    book.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none';
    book.style.transformOrigin = _single ? '50% 50%' : `${originX}% 50%`;
    book.style.transform = transform;
  };
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  try {
    playCover();
    // 1. The back cover swings away, edge-on.
    set(`${lean(shut ? 25 : 0)}rotateY(-90deg)`, shut ? 25 : 50, OVER_MS, 'cubic-bezier(.5, 0, .9, .6)');
    await sleep(OVER_MS);
    if (!_flip) return;
    // 2. Unseen: the pages go back under the cover and the booklet is set up on the far side of its spin.
    book.classList.add('is-snap');
    _turned = 0;
    _flip.goTo(0, false);
    set(`${lean(-25)}rotateY(90deg)`, 75, 0, '');
    void book.offsetWidth;
    await frame();
    book.classList.remove('is-snap');
    // 3. The front cover swings round and settles.
    set(`${lean(-25)}rotateY(0deg)`, 75, OVER_MS + 80, 'cubic-bezier(.1, .5, .3, 1)');
    await sleep(OVER_MS + 80);
  } finally {
    book.classList.remove('is-snap');
    book.style.transition = '';
    book.style.transformOrigin = '';
    book.style.transform = '';
    _turningOver = false;
  }
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
  // A replay presses its own stamps one by one; pages turning under it must not drop them all at once.
  if (_replaying) return;
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
  _unsubs.push(journalStore.subscribeAll((rows) => { _extras.journal = rows; paintCard(); }));
  _unsubs.push(expenseStore.subscribeAll((rows) => { _extras.expenses = rows; paintCard(); }));
}

/** The pressed stamps in the order the book shows them. */
const pressedInOrder = (): PassportStamp[] => _pages.flatMap((p) => (p.kind === 'stamps' ? p.items.map((i) => i.stamp) : []));

function paintCard(): void {
  if (!_drawer) return;
  const list = pressedInOrder();
  const i = list.findIndex((x) => x.id === _drawerStamp);
  if (i < 0) { _drawer.close(); return; }
  _drawer.show(countryMemory(list[i], _feed.stamps, peekFeedLegs(), _extras), getLocale(), { i, n: list.length });
}

function closeSide(): void {
  _drawer?.close();
  _panel?.close();
}

function openCard(id: string): void {
  const desk = view()?.querySelector<HTMLElement>('.pp-desk');
  if (!desk || !state().pressed.some((x) => x.id === id)) return;
  ensureExtras();
  _panel?.close();
  _drawer ??= openMemoryDrawer(desk, {
    onStep: stepCard,
    onClose: () => { _drawer = null; _drawerStamp = ''; fitStage(); },
  });
  _drawerStamp = id;
  paintCard();
  fitStage();
}

/** Previous / next pressed stamp; the book turns to its page too. */
function stepCard(dir: 1 | -1): void {
  const list = pressedInOrder();
  if (list.length < 2) return;
  const i = list.findIndex((x) => x.id === _drawerStamp);
  const next = list[(i + dir + list.length) % list.length];
  _drawerStamp = next.id;
  paintCard();
  const at = pageOfStamp(_pages, next.id);
  if (at >= 0) { _turned = flippedToShow(at, _single); _flip?.goTo(_turned, true); }
}

/** Turns the passport into a picture and hands it to the share sheet (or downloads it). */
async function shareNow(btn: HTMLButtonElement): Promise<void> {
  if (btn.disabled) return;
  const label = btn.textContent;
  // Drawing a long passport takes a moment; the button says so until the preview is up, then goes back to itself.
  const restore = () => { btn.disabled = false; btn.textContent = label; };
  btn.disabled = true;
  btn.textContent = t('passport.share.making');
  try {
    // Loaded on demand: the picture code and the QR library are not needed to read the book.
    const { sharePassport } = await import('./share.ts');
    const c = ctx();
    await sharePassport({ nickname: c.nickname, uid: c.uid, issued: c.issued, nationality: c.nationality, cover: c.cover, photoUrl: c.photoUrl, data: _feed, pressed: state().pressed }, restore);
  } catch (err) {
    console.error('Passport share failed:', err);
    const { toast } = await import('../journal/recap/export/ui.ts');
    toast(t('passport.share.failed'));
  } finally {
    restore();
  }
}

function toggleCoverPanel(): void {
  if (_panel) { _panel.close(); return; }
  const desk = view()?.querySelector<HTMLElement>('.pp-desk');
  if (!desk) return;
  _drawer?.close();
  _panel = openCoverPanel(desk, normalizeCover(_cover), {
    onChange: onCoverChange,
    onClose: () => { _panel = null; fitStage(); view()?.querySelector('[data-pp-cover]')?.setAttribute('aria-pressed', 'false'); },
  });
  view()?.querySelector('[data-pp-cover]')?.setAttribute('aria-pressed', 'true');
  fitStage();
}

/* ── Replay: the whole passport, pressed again in order ──────────────────── */

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Shows every stamp that a replay was holding back (those a newly pressed stamp is still waiting to land stay hidden). */
function revealAll(book: HTMLElement): void {
  book.querySelectorAll<HTMLElement>('.pp-slot[data-fresh]').forEach((el) => {
    if (!_fresh.has(el.dataset.stamp ?? '')) el.removeAttribute('data-fresh');
  });
}

function setReplayLabel(): void {
  const b = view()?.querySelector<HTMLElement>('[data-pp-replay]');
  if (b) b.textContent = t(_replaying ? 'passport.replay.stop' : 'passport.replay');
}

/** Ends a replay in progress at once; every stamp is back on its page. */
function stopReplay(): void {
  _replay++;
  _running = 0;
  _replaying = false;
  const book = view()?.querySelector<HTMLElement>('#pp-book');
  if (book) revealAll(book);
  setReplayLabel();
}

async function replay(): Promise<void> {
  const token = ++_replay;
  const alive = () => token === _replay;
  const root = view();
  const book = root?.querySelector<HTMLElement>('#pp-book');
  const withStamps = _pages.map((p, i) => (p.kind === 'stamps' && p.items.length ? i : -1)).filter((i) => i >= 0);
  if (!root || !book || withStamps.length === 0) return;
  closeSide();
  _running += 1;
  _replaying = true;
  setReplayLabel();
  // Lift every stamp off the pages first (they are put back one by one, in the order they were earned).
  book.querySelectorAll<HTMLElement>('.pp-slot[data-stamp]').forEach((el) => {
    el.setAttribute('data-fresh', '');
    el.querySelector<HTMLElement>('.pp-stamp')?.classList.remove('is-pressed');
  });
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
  _running = Math.max(0, _running - 1);
  if (_running > 0) return;
  _replaying = false;
  revealAll(book);
  setReplayLabel();
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
    if (el.closest('.pp-drawer, .pp-drawer-scrim')) return;
    if (el.closest('[data-pp-replay]')) { if (_replaying) stopReplay(); else void replay(); return; }
    if (el.closest('[data-pp-cover]')) { toggleCoverPanel(); return; }
    const share = el.closest<HTMLButtonElement>('[data-pp-share]');
    if (share) { void shareNow(share); return; }
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
    <div class="view-title"><span class="view-title-icon" aria-hidden="true"><span class="nav-icon-emoji">${PASSPORT_ICON_HTML}</span></span><span>${esc(t('passport.title'))}</span></div>
    <div class="view-subtitle">${esc(t('passport.view.subtitle'))}</div>`;
}

const signature = (): string =>
  [
    _feed.stamps.map((s) => `${s.id}:${s.nights}:${s.date}`).join('|'),
    Object.entries(_placements).map(([k, p]) => `${k}@${p.page}:${p.x}:${p.y}`).join('|'),
    Object.values(_profile).join('~'), peekFeedLegs().map((l) => `${l.id}${l.dateFrom}${l.dateTo}${l.country}`).join(''), _visas.map((v) => `${v.id}:${v.updatedAt}`).join('|'), _safetyNationality, JSON.stringify(_doc), getLocale(), _feed.cities, _feed.nights,
  ].join('#');

/* ── Mount ───────────────────────────────────────────────────────────────── */

export function initPassport(): void {
  const root = view();
  if (!root) return;
  _unsubs.forEach((u) => u());
  window.clearTimeout(_shutTimer);
  _shutTimer = 0;
  closeSide();
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
      // The cover follows the stored copy unless a change of this sitting is still waiting to be saved.
      const stored = p?.cover ? normalizeCover(p.cover) : null;
      if (!_coverSave && (stored ? !_cover || !sameCover(stored, _cover) : !!_cover)) { _cover = stored; applyCover(); }
      // Placements written in this sitting stand until the stored copy has caught up with them.
      const storedPlacements = p?.placements ?? {};
      for (const id of [..._unsaved]) if (storedPlacements[id]) _unsaved.delete(id);
      _placements = { ...storedPlacements, ...Object.fromEntries([..._unsaved].map((id) => [id, _placements[id]]).filter(([, v]) => v)) };
      refresh();
    }),
    safetyProfileStore.subscribe((p) => { _safetyNationality = p?.nationality ?? ''; refresh(); }),
    passportDocStore.subscribe((d) => {
      _doc = d
        ? { fullName: d.fullName, number: d.number, birthDate: d.birthDate, gender: d.gender, issued: d.issued, expires: d.expires, showNumber: d.showNumber, showFullName: d.showFullName, showBirth: d.showBirth }
        : NO_DOC;
      refresh();
    }),
    visaStore.subscribe((rows) => { _visas = rows.slice().sort((a, b) => (a.validFrom || '9').localeCompare(b.validFrom || '9')); refresh(); }),
    onLocaleChange(() => { head(root); refresh(true); }),
  ];
  const mq = window.matchMedia?.('(max-width: 599px)');
  const onMq = () => { if (narrow() !== _single) render(); };
  mq?.addEventListener('change', onMq);
  _unsubs.push(() => mq?.removeEventListener('change', onMq));
  const onResize = () => { fitRoom(); fitStage(); };
  window.addEventListener('resize', onResize);
  _unsubs.push(() => window.removeEventListener('resize', onResize));
  window.addEventListener('otr:nav-intent', onIntent);
  _unsubs.push(() => window.removeEventListener('otr:nav-intent', onIntent));
  wire(root);
  // The magnifier names a country the way the passport does (its stamps), else in the reader's language.
  _unsubs.push(attachLens(root, (iso) => _feed.stamps.find((s) => s.iso === iso)?.country || regionName(iso, getLocale())));
  _sig = signature();
  render();
  applyIntent(consumeNavIntent('passport'));
}

function onIntent(e: Event): void {
  if ((e as CustomEvent<{ view: string }>).detail?.view === 'passport') applyIntent(consumeNavIntent('passport'));
}

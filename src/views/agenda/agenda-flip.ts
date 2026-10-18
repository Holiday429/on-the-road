/* ==========================================================================
   On the Road · Agenda — turning pages
   --------------------------------------------------------------------------
   The glue between the agenda's state and the paper kit's hinged flip
   (core/paper/page-flip.ts): a month turns like a wall-calendar page, a day
   turns like a tear-off sheet. At most one turn is in flight; anything that
   needs the screen (a click, a store update) lands it first.

   Dragging a month page — up for the next month, down for the one before; a
   sideways swipe on touch — follows the hand, and is let go either way.
   ========================================================================== */

import { beginHingeFlip, commitsTurn, dragProgress, pageCopy, type HingeDir, type HingeFlip } from '../../core/paper/page-flip.ts';

interface Active { finish(): void }
let _active: Active | null = null;
let _idle: () => void = () => {};

/** Called whenever a turn has finished or been put back — the place to draw what was held off meanwhile. */
export function onFlipIdle(fn: () => void): void { _idle = fn; }
export function isFlipping(): boolean { return _active !== null; }
/** Land the turn in flight (and commit it) right now. */
export function finishFlip(): void { _active?.finish(); }

/**
 * Turn the page in `host` (whose live page is `live`) to `target`, a detached
 * copy of the page that arrives. Calls `commit` once it has landed — or at
 * once when there is nothing to animate with.
 */
export function turnPage(host: HTMLElement, live: HTMLElement, target: HTMLElement, dir: HingeDir, commit: () => void, feel: TurnFeel = {}): void {
  finishFlip();
  const flip = dir === 1
    ? beginHingeFlip(host, { dir, sheet: pageCopy(live), under: target, curl: feel.curl })
    : beginHingeFlip(host, { dir, sheet: target, under: pageCopy(live), curl: feel.curl });
  if (!flip) { commit(); return; }
  hold(host, live, flip, commit, 1, feel.ms);
}

/** How a sheet moves: a wall-calendar month is stiff card and takes its time; a day's tear-off sheet is thin and quick. */
export interface TurnFeel {
  /** How far the free edge leads the hinge when most bent, degrees. */
  curl?: number;
  /** Time a whole turn takes, ms. */
  ms?: number;
}

/** Keep the live page out of the way while the sheet moves, and finish the turn when it has landed. */
function hold(host: HTMLElement, live: HTMLElement, flip: HingeFlip, commit: () => void, settleTo: 0 | 1, ms?: number): void {
  live.style.visibility = 'hidden';
  // The page that arrives may be taller than the one that leaves (a day with more on it).
  const under = host.querySelector<HTMLElement>('.hf-under > *');
  if (under) host.style.minHeight = `${Math.max(host.offsetHeight, under.offsetHeight)}px`;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    _active = null;
    flip.destroy();
    host.style.minHeight = '';
    live.style.visibility = '';
    if (settleTo === 1) commit();
    _idle();
  };
  _active = { finish };
  void flip.settle(settleTo, ms).then(finish);
}

export interface DragHooks {
  /** The page showing now. */
  live(): HTMLElement | null;
  /** A detached copy of the page a turn in `dir` would bring. */
  target(dir: HingeDir): HTMLElement;
  /** The turn was completed. */
  commit(dir: HingeDir): void;
}

/**
 * Let `host` be pulled like a calendar page. Mouse and pen: drag up / down (or
 * sideways); touch: swipe sideways only, so the page still scrolls. A drag that
 * moved suppresses the click that ends it.
 */
export function attachPageDrag(host: HTMLElement, hooks: DragHooks): void {
  let st: { x0: number; y0: number; t0: number; touch: boolean; id: number; dir: HingeDir | 0; vertical: boolean; flip: HingeFlip | null; live: HTMLElement | null; progress: number } | null = null;
  let dragged = false;

  host.addEventListener('click', (e) => {
    if (!dragged) return;
    e.stopPropagation();
    e.preventDefault();
    dragged = false;
  }, true);

  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || isFlipping() || (e.target as HTMLElement).closest('.cal-nav-tools')) return;
    st = { x0: e.clientX, y0: e.clientY, t0: performance.now(), touch: e.pointerType === 'touch', id: e.pointerId, dir: 0, vertical: false, flip: null, live: null, progress: 0 };
  });

  host.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x0;
    const dy = e.clientY - st.y0;
    if (!st.flip) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      const vertical = !st.touch && Math.abs(dy) > Math.abs(dx);
      if (st.touch && Math.abs(dy) > Math.abs(dx)) { st = null; return; }   // the page is being scrolled
      const delta = vertical ? dy : dx;
      const dir: HingeDir = delta < 0 ? 1 : -1;
      const live = hooks.live();
      if (!live) { st = null; return; }
      const target = hooks.target(dir);
      const flip = dir === 1
        ? beginHingeFlip(host, { dir, sheet: pageCopy(live), under: target })
        : beginHingeFlip(host, { dir, sheet: target, under: pageCopy(live) });
      if (!flip) { st = null; return; }
      live.style.visibility = 'hidden';
      host.setPointerCapture?.(e.pointerId);
      Object.assign(st, { flip, dir, vertical, live });
      _active = {
        finish: () => { /* a drag in hand is never taken away */ },
      };
    }
    const delta = st.vertical ? dy : dx;
    const along = st.dir === 1 ? Math.max(0, -delta) : Math.max(0, delta);
    st.progress = dragProgress(along, st.vertical ? host.offsetHeight : host.offsetWidth * 0.7);
    st.flip!.set(st.progress);
  });

  const release = (e: PointerEvent) => {
    if (!st || e.pointerId !== st.id) return;
    const s = st;
    st = null;
    if (!s.flip || !s.dir || !s.live) return;
    dragged = true;
    setTimeout(() => { dragged = false; }, 60);
    const dist = Math.abs(s.vertical ? e.clientY - s.y0 : e.clientX - s.x0);
    const velocity = dist / Math.max(1, performance.now() - s.t0);
    const go = e.type !== 'pointercancel' && commitsTurn(s.progress, velocity);
    const dir = s.dir;
    const commit = () => hooks.commit(dir);
    // Hand the flip back to the shared finisher: it settles, then commits (or just removes the sheet).
    _active = null;
    hold(host, s.live, s.flip, commit, go ? 1 : 0);
  };
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);
}

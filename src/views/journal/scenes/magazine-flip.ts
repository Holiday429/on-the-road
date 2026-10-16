/* ==========================================================================
   On the Road · Journal magazine — turning a page in 3D
   --------------------------------------------------------------------------
   One sheet of paper hinged at the spine. Going forward the right-hand page
   swings over to the left, and its back — the next spread's left page — lands
   where the old left page was; going back, the reverse. On a phone (one page at
   a time) the page is lifted away, or laid back down, from the same hinge.

   The sheet is built from COPIES of the pages, on top of the live spread, so
   nothing about the book's state changes while it moves: the caller commits the
   turn (and redraws) only when the sheet has landed, and a drag that is let go
   short of halfway puts the sheet back and the book is exactly as it was. The
   pure arithmetic — how far a drag has turned a page, whether a release
   completes it, how a progress maps to an angle — is here and tested; the
   drag's thresholds are the passport book's (views/passport/flip.ts), so the two
   books feel alike.
   ========================================================================== */

import { shouldCommit, turnProgress } from '../../passport/flip.ts';

export { shouldCommit, turnProgress };

export type FlipDir = 1 | -1;
export type FlipMode = 'spread' | 'single';

/** Time a turn takes when it is let go or clicked, ms. */
export const FLIP_MS = 650;
/** In a phone's single-page mode the page swings only this far (it leaves the screen, it does not go around). */
const SINGLE_SWING = 100;

/**
 * The sheet's rotation, degrees, at `progress` (0 = at rest, 1 = turned).
 * Forward turns the right page leftwards (0 → -180); backward turns the left
 * page rightwards (0 → 180). A single page lifts to -100 going forward and comes
 * back from -100 going backward.
 */
export function sheetAngle(progress: number, dir: FlipDir, mode: FlipMode): number {
  const p = Math.min(1, Math.max(0, progress));
  if (mode === 'single') return dir === 1 ? -SINGLE_SWING * p : -SINGLE_SWING * (1 - p);
  return dir === 1 ? -180 * p : 180 * p;
}

/**
 * How dark the turning sheet is: nothing when it lies flat, most when it
 * stands on edge (halfway), a little more as it comes down on the far side.
 */
export function sheetShade(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.round((1 - Math.abs(2 * p - 1)) * 0.38 * 100) / 100;
}

export interface Flip {
  /** Follow a drag (or any hand-driven progress). */
  set(progress: number): void;
  /** Animate on from the current progress to the end. Resolves when it has landed. */
  settle(to: 0 | 1): Promise<void>;
  /** Remove the sheet and put the live pages back. */
  destroy(): void;
}

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const canFlip = (el: HTMLElement) => typeof el.animate === 'function' && !reduced();

const clone = (page: HTMLElement | undefined): HTMLElement => {
  const c = (page?.cloneNode(true) as HTMLElement | undefined) ?? Object.assign(document.createElement('div'), { className: 'mag-page is-void' });
  c.querySelectorAll('img').forEach((img) => img.setAttribute('loading', 'eager'));
  return c;
};

/**
 * Put a turning sheet over `spread` (the live `.mag-spread`).
 *
 * `to` is the pages of the spread being turned to, in order (two, or one in
 * single mode) — the book rendered for the target leaf, taken from a detached
 * copy. Returns null when there is nothing to animate with (reduced motion, no
 * Web Animations API, or a spread that is not as expected): the caller then
 * just turns.
 */
export function beginFlip(spread: HTMLElement, mode: FlipMode, dir: FlipDir, to: HTMLElement[]): Flip | null {
  if (!canFlip(spread)) return null;
  const slot = spread.querySelector<HTMLElement>('.mag-flip-slot');
  const live = [...spread.querySelectorAll<HTMLElement>(':scope > .mag-page')];
  if (!slot || !live.length || to.length !== live.length) return null;

  const root = document.createElement('div');
  root.className = `mag-flip is-${mode} is-${dir === 1 ? 'forward' : 'backward'}`;
  const sheet = document.createElement('div');
  sheet.className = 'mag-sheet';
  const front = document.createElement('div');
  front.className = 'mag-sheet-face is-front';
  const back = document.createElement('div');
  back.className = 'mag-sheet-face is-back';
  const shade = document.createElement('i');
  shade.className = 'mag-sheet-shade';
  const under = document.createElement('div');
  under.className = 'mag-flip-under';
  const hidden: HTMLElement[] = [];
  const hide = (el: HTMLElement | undefined) => { if (el) { el.style.visibility = 'hidden'; hidden.push(el); } };

  if (mode === 'single') {
    const [oldPage] = live;
    const [newPage] = to;
    if (dir === 1) {
      // The old page lifts away, the next lies under it.
      sheet.style.left = '0';
      front.append(clone(oldPage));
      under.append(clone(newPage));
      hide(oldPage);
    } else {
      // The previous page is laid back down over this one.
      sheet.style.left = '0';
      front.append(clone(newPage));
    }
    back.className = 'mag-sheet-face is-back is-blank';
  } else if (dir === 1) {
    // The right page swings over to the left; the next spread's right page waits under it.
    const oldRight = live[1];
    const [newLeft, newRight] = to;
    sheet.style.left = '50%';
    sheet.classList.add('is-right');
    front.append(clone(oldRight));
    back.append(clone(newLeft));
    under.style.left = '50%';
    under.append(clone(newRight));
    hide(oldRight);
  } else {
    // The left page swings over to the right; the earlier spread's left page waits under it.
    const [oldLeft] = live;
    const [newLeft, newRight] = to;
    sheet.style.left = '0';
    sheet.classList.add('is-left');
    front.append(clone(oldLeft));
    back.append(clone(newRight));
    under.style.left = '0';
    under.append(clone(newLeft));
    hide(oldLeft);
  }

  sheet.append(front, back, shade);
  root.append(under, sheet);
  slot.replaceChildren(root);

  let progress = 0;
  /** Bumped by anything that takes over the sheet, so an animation in flight stops itself. */
  let token = 0;
  const apply = (p: number) => {
    progress = p;
    sheet.style.transform = `rotateY(${sheetAngle(p, dir, mode)}deg)`;
    root.style.setProperty('--shade', String(sheetShade(p)));
    if (mode === 'single') sheet.style.opacity = String(dir === 1 ? 1 - p ** 3 : p ** 0.5);
  };
  apply(0);

  return {
    set(p) { token++; apply(Math.min(1, Math.max(0, p))); },
    settle(end) {
      const from = progress;
      if (from === end) return Promise.resolve();
      const mine = ++token;
      const ms = Math.max(160, FLIP_MS * Math.abs(end - from));
      return new Promise<void>((resolve) => {
        const start = performance.now();
        const step = () => {
          if (token !== mine) { resolve(); return; }
          const t = Math.min(1, (performance.now() - start) / ms);
          const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
          apply(from + (end - from) * eased);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    },
    destroy() {
      token++;
      slot.replaceChildren();
      for (const el of hidden) el.style.visibility = '';
    },
  };
}

/**
 * Which way a drag turns, given the side it started on. `x0` and `x` are
 * clientX; `spineX` the spine's clientX. A spread turns forward by dragging the
 * right page leftwards, back by dragging the left page rightwards; a single
 * page turns either way wherever it is grabbed. 0 = not a turn.
 */
export function dragDirection(x0: number, x: number, spineX: number, mode: FlipMode): FlipDir | 0 {
  const dx = x - x0;
  if (Math.abs(dx) < 8) return 0;
  const dir: FlipDir = dx < 0 ? 1 : -1;
  if (mode === 'single') return dir;
  const side = x0 >= spineX ? 'right' : 'left';
  return (dir === 1 && side === 'right') || (dir === -1 && side === 'left') ? dir : 0;
}

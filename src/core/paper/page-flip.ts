/* ==========================================================================
   On the Road · Paper kit · page flip (hinged at the top)
   --------------------------------------------------------------------------
   One sheet of paper hinged along its top edge, like a wall calendar or a
   tear-off pad. Going forward the sheet is lifted by its lower edge, swings up
   toward you and away over the top; going back the previous sheet comes down
   from there and lands on the page.

   The sheet is built from COPIES of the pages, laid over `host`, so nothing
   about the live page changes while it moves: the caller commits the new state
   (and redraws) only when the sheet has landed, and a drag let go short of the
   threshold puts the sheet back and the page is exactly as it was.

       import '../../core/paper/page-flip.css';
       const flip = beginHingeFlip(host, { dir: 1, sheet: oldCopy, under: newCopy });
       await flip?.settle(1);  flip?.destroy();

   Returns null when there is nothing to animate with (reduced motion, no Web
   Animations API) — the caller then just changes the page.

   The pure arithmetic (angle, fade, shade, whether a release completes the
   turn) is exported and tested; the DOM part only applies it.
   ========================================================================== */

export type HingeDir = 1 | -1;

/** How far the sheet is lifted at the end of a forward turn, degrees. It never goes round the hinge: it leaves. */
export const LIFT_DEG = 104;
/** Time a turn takes when it is clicked or let go, ms. */
export const HINGE_MS = 620;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The sheet's lift, degrees, at `progress` (0 = at rest, 1 = turned).
 * Forward: the sheet that is leaving lifts 0 → LIFT_DEG. Backward: the sheet
 * that is arriving comes down LIFT_DEG → 0.
 */
export function liftAngle(progress: number, dir: HingeDir): number {
  const p = clamp01(progress);
  return LIFT_DEG * (dir === 1 ? p : 1 - p);
}

/** The sheet fades out as it goes edge-on and away, so it never shows a hard cut. */
export function liftOpacity(angle: number): number {
  if (angle <= 50) return 1;
  return Math.max(0, 1 - ((angle - 50) / (LIFT_DEG - 50)) ** 1.6);
}

/** How dark the shadow under the sheet is: nothing when it lies flat, most while it stands high. */
export function liftShade(angle: number): number {
  const a = Math.min(LIFT_DEG, Math.max(0, angle));
  return Math.round(Math.sin((a * Math.PI) / 180) * 0.34 * 100) / 100;
}

/** Fraction of a full turn (0–1) for a drag of `delta` px across a page `length` px long. */
export function dragProgress(delta: number, length: number): number {
  if (length <= 0) return 0;
  return clamp01(Math.abs(delta) / (length * 0.8));
}

/** Whether a released drag completes the turn (far enough, or flicked). `velocity` is px/ms in the turning direction. */
export function commitsTurn(progress: number, velocity: number): boolean {
  return progress > 0.3 || velocity > 0.45;
}

export interface HingeFlip {
  /** Follow a drag (or any hand-driven progress). */
  set(progress: number): void;
  /** Animate on from the current progress to the end. Resolves when it has landed (or was taken over). */
  settle(to: 0 | 1, ms?: number): Promise<void>;
  /** Remove the sheet. */
  destroy(): void;
}

export interface HingeOpts {
  dir: HingeDir;
  /** The page that moves: the old page going forward, the new page going back. */
  sheet: HTMLElement;
  /** The page lying under the sheet, where there is one the live page does not already show. */
  under?: HTMLElement;
}

export const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A copy that can be drawn over the live page: no ids, no focus, no clicks. */
export function pageCopy(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  c.removeAttribute('id');
  c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  c.querySelectorAll('img').forEach((img) => img.setAttribute('loading', 'eager'));
  return c;
}

export function beginHingeFlip(host: HTMLElement, o: HingeOpts): HingeFlip | null {
  if (reducedMotion() || typeof host.animate !== 'function') return null;

  const root = document.createElement('div');
  root.className = `hf is-${o.dir === 1 ? 'forward' : 'backward'}`;
  root.setAttribute('aria-hidden', 'true');
  root.toggleAttribute('inert', true);

  const sheet = document.createElement('div');
  sheet.className = 'hf-sheet';
  const front = document.createElement('div');
  front.className = 'hf-face is-front';
  front.append(o.sheet);
  const back = document.createElement('div');
  back.className = 'hf-face is-back';
  sheet.append(front, back);

  if (o.under) {
    const under = document.createElement('div');
    under.className = 'hf-under';
    under.append(o.under);
    root.append(under);
  }
  root.append(sheet);
  host.append(root);

  let progress = 0;
  /** Bumped by anything that takes over the sheet, so an animation in flight stops itself. */
  let token = 0;
  const apply = (p: number) => {
    progress = p;
    const a = liftAngle(p, o.dir);
    sheet.style.transform = `rotateX(${a}deg)`;
    sheet.style.opacity = String(liftOpacity(a));
    root.style.setProperty('--hf-shade', String(liftShade(a)));
  };
  apply(0);

  return {
    set(p) { token++; apply(clamp01(p)); },
    settle(end, ms = HINGE_MS) {
      const from = progress;
      if (from === end) return Promise.resolve();
      const mine = ++token;
      const dur = Math.max(140, ms * Math.abs(end - from));
      return new Promise<void>((resolve) => {
        const start = performance.now();
        const step = () => {
          if (token !== mine) { resolve(); return; }
          const t = Math.min(1, (performance.now() - start) / dur);
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
      root.remove();
    },
  };
}

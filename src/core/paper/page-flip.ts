/* ==========================================================================
   On the Road · Paper kit · page flip (hinged at the top)
   --------------------------------------------------------------------------
   One sheet of paper hinged along its top edge, like a wall calendar or a
   tear-off pad. Going forward the sheet is lifted by its lower edge, curls up
   toward you and goes over the hinge; going back the previous sheet comes down
   from there and lays itself on the page.

   The sheet is not a flat card: it is cut into horizontal slices, each hung from
   the one above it, and each turned a little further than that one — so the
   sheet BENDS while it moves, the way paper does when it is lifted by one edge
   (a straight rotating copy reads as a flap, not paper). Every slice is lit by
   its own angle, so the curve catches the light, and its back is the plain
   paper side.

   The slices are COPIES of the pages, laid over `host`, so nothing about the
   live page changes while it moves: the caller commits the new state (and
   redraws) only when the sheet has landed, and a drag let go short of the
   threshold puts the sheet back and the page is exactly as it was.

       import '../../core/paper/page-flip.css';
       const flip = beginHingeFlip(host, { dir: 1, sheet: oldCopy, under: newCopy });
       await flip?.settle(1);  flip?.destroy();

   The flip is clipped at the host's top edge, so a sheet that has gone over the
   hinge disappears behind whatever is fixed above it (the calendar's cap, the
   day pad's binding strip) instead of fading.

   Returns null when there is nothing to animate with (reduced motion, no Web
   Animations API) — the caller then just changes the page.

   The pure arithmetic (angles, light, whether a release completes the turn) is
   exported and tested; the DOM part only applies it.
   ========================================================================== */

export type HingeDir = 1 | -1;

/** How far the hinge-side of the sheet is lifted at the end of a forward turn, degrees: past upright, so it is behind the cap. */
export const LIFT_DEG = 104;
/** Time a turn takes when it is clicked or let go, ms. */
export const HINGE_MS = 720;
/** Slices a sheet is cut into. */
export const SLICES = 12;
/** How far the free edge runs ahead of the hinge edge at the most bent moment, degrees. */
export const CURL_DEG = 42;

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

/** How much the free edge leads the hinge edge: none at rest, most mid-turn. */
export function bendAngle(progress: number, curl = CURL_DEG): number {
  const p = clamp01(progress);
  return curl * Math.sin(Math.PI * p) ** 0.85;
}

/**
 * The turn of each slice relative to the one above it, degrees. The first is
 * the sheet's whole lift; the rest share the bend, growing toward the free edge
 * so the curve is the shallow one of a sheet held at its hinge.
 */
export function sliceAngles(progress: number, dir: HingeDir, n = SLICES, curl = CURL_DEG): number[] {
  const bend = bendAngle(progress, curl);
  const weights = Array.from({ length: n }, (_, k) => 0.35 + 0.65 * (k / Math.max(1, n - 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w, k) => (k === 0 ? liftAngle(progress, dir) : 0) + (bend * w) / total);
}

/** Each slice's angle to the page (the running sum of {@link sliceAngles}) — what its light depends on. */
export function absoluteAngles(rel: number[]): number[] {
  let sum = 0;
  return rel.map((a) => (sum += a));
}

/** How dark a slice's face is, 0–1: nothing when it faces you, most when it stands edge-on. */
export function sliceShade(angle: number): number {
  const a = Math.min(90, Math.max(0, angle));
  return Math.round(Math.sin((a * Math.PI) / 180) ** 1.3 * 0.36 * 100) / 100;
}

/** The sheen on a slice that is turned to catch the light (a lamp over the desk): peaks near 38°, gone flat-on and upright. */
export function sliceGloss(angle: number): number {
  const a = Math.abs(angle - 38);
  return Math.round(Math.exp(-((a / 17) ** 2)) * 0.2 * 100) / 100;
}

/** How dark the shadow under the sheet is on the page beneath: nothing when it lies flat, most while it stands high. */
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
  /** How far the free edge runs ahead of the hinge when most bent, degrees (default {@link CURL_DEG}). */
  curl?: number;
  /** Slices the sheet is cut into (default {@link SLICES}). */
  slices?: number;
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
  const n = Math.max(2, o.slices ?? SLICES);
  const curl = o.curl ?? CURL_DEG;
  // Slices are placed in pixels: the sheet is as big as the page it lifts.
  const W = host.offsetWidth;
  const H = host.offsetHeight;
  const h = H / n;

  const root = document.createElement('div');
  root.className = `hf is-${o.dir === 1 ? 'forward' : 'backward'}`;
  root.setAttribute('aria-hidden', 'true');
  root.toggleAttribute('inert', true);

  /** One slice: the strip of the page it carries (front), the plain back, and the slice below it. */
  const slices: HTMLElement[] = [];
  let parent: HTMLElement = root;
  for (let k = 0; k < n; k++) {
    const slice = document.createElement('div');
    slice.className = k === 0 ? 'hf-slice hf-sheet' : 'hf-slice';
    slice.style.cssText = `top:${k === 0 ? 0 : h}px;height:${h + 0.75}px`;
    const front = document.createElement('div');
    front.className = 'hf-face is-front';
    const page = document.createElement('div');
    page.className = 'hf-page';
    page.style.cssText = `top:${-k * h}px;width:${W}px;height:${H}px`;
    page.append(k === 0 ? o.sheet : o.sheet.cloneNode(true));
    const dark = document.createElement('i');
    dark.className = 'hf-dark';
    const gloss = document.createElement('i');
    gloss.className = 'hf-gloss';
    front.append(page, dark, gloss);
    const back = document.createElement('div');
    back.className = 'hf-face is-back';
    slice.append(front, back);
    parent.append(slice);
    slices.push(slice);
    parent = slice;
  }

  if (o.under) {
    const under = document.createElement('div');
    under.className = 'hf-under';
    under.append(o.under);
    root.prepend(under);
  }
  host.append(root);

  let progress = 0;
  /** Bumped by anything that takes over the sheet, so an animation in flight stops itself. */
  let token = 0;
  const apply = (p: number) => {
    progress = p;
    const rel = sliceAngles(p, o.dir, n, curl);
    const abs = absoluteAngles(rel);
    rel.forEach((a, k) => {
      const el = slices[k];
      el.style.transform = `rotateX(${a.toFixed(2)}deg)`;
      el.style.setProperty('--hf-dk', String(sliceShade(abs[k])));
      el.style.setProperty('--hf-gl', String(sliceGloss(abs[k])));
    });
    root.style.setProperty('--hf-shade', String(liftShade(abs[0])));
  };
  apply(0);

  return {
    set(p) { token++; apply(clamp01(p)); },
    settle(end, ms = HINGE_MS) {
      const from = progress;
      if (from === end) return Promise.resolve();
      const mine = ++token;
      const dur = Math.max(160, ms * Math.abs(end - from));
      return new Promise<void>((resolve) => {
        const start = performance.now();
        const step = () => {
          if (token !== mine) { resolve(); return; }
          const t = Math.min(1, (performance.now() - start) / dur);
          apply(from + (end - from) * easeTurn(t));
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

/** Paper picks up slowly, swings, and the last of it settles under its own weight. */
function easeTurn(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

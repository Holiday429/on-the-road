/* ==========================================================================
   On the Road · Journal gallery — the drifting wall
   --------------------------------------------------------------------------
   Like a hall where the photographs slowly pass you: the wall scrolls upward
   by itself, and the moment you take hold of it — wheel, drag, key — it hands
   control back and stays put. (A tap or a finger resting on it does not: on a touch screen that
   would end the drift the first time the page was held. A scrollbar drag is caught by the
   "someone else moved the wall" check below.) At the bottom it stops (nothing loops). The
   scroller node survives re-renders (the journal morphs its markup), so one
   loop per node is enough; whether it should be drifting is the caller's state.
   ========================================================================== */

/** Pixels per second the wall travels. Slow enough to read a placard. */
export const DRIFT_PX_PER_S = 26;

/** Pure step: where the wall is after `dtMs`, and whether it has reached the end. */
export function advance(pos: number, dtMs: number, max: number, speed = DRIFT_PX_PER_S): { pos: number; done: boolean } {
  if (max <= 0) return { pos: 0, done: true };
  const next = Math.min(max, pos + (speed * Math.max(0, dtMs)) / 1000);
  return { pos: next, done: next >= max };
}

export interface FlowDeps {
  /** Should the wall be drifting right now? */
  isDrifting: () => boolean;
  /** The wall stopped (the user touched it, or it reached the end). */
  onStop: () => void;
}

interface Handle { el: HTMLElement; raf: number; pos: number; last: number; stop: () => void }
let current: Handle | null = null;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function detach(): void {
  current?.stop();
  current = null;
}

/** Call after every render: starts, keeps or stops the drift for the current wall element. */
export function syncGalleryFlow(root: ParentNode, deps: FlowDeps): void {
  const wall = root.querySelector<HTMLElement>('[data-gallery-wall]');
  if (!wall) { detach(); return; }

  if (current && current.el !== wall) detach();
  if (!current) {
    const h: Handle = { el: wall, raf: 0, pos: wall.scrollTop, last: 0, stop: () => {} };
    const touch = () => { if (deps.isDrifting()) deps.onStop(); };
    const events: [string, EventListener][] = [
      ['wheel', touch], ['touchmove', touch], ['keydown', touch],
    ];
    for (const [name, fn] of events) wall.addEventListener(name, fn, { passive: true });
    h.stop = () => {
      cancelAnimationFrame(h.raf);
      h.raf = 0;
      for (const [name, fn] of events) wall.removeEventListener(name, fn);
    };
    current = h;
  }

  const h = current;
  const want = deps.isDrifting() && !prefersReducedMotion();
  if (!want) { cancelAnimationFrame(h.raf); h.raf = 0; h.last = 0; return; }
  if (h.raf) return;   // already running

  h.pos = wall.scrollTop;
  const tick = (now: number) => {
    if (!deps.isDrifting() || current !== h) { h.raf = 0; return; }
    const dt = h.last ? now - h.last : 0;
    h.last = now;
    // someone else moved the wall (scrollbar, keyboard): take that as "stop"
    if (Math.abs(wall.scrollTop - h.pos) > 3) { h.raf = 0; deps.onStop(); return; }
    const max = wall.scrollHeight - wall.clientHeight;
    const step = advance(h.pos, dt, max);
    h.pos = step.pos;
    wall.scrollTop = step.pos;
    if (step.done) { h.raf = 0; deps.onStop(); return; }
    h.raf = requestAnimationFrame(tick);
  };
  h.raf = requestAnimationFrame(tick);
}

/** Tear down (leaving the Journal): stops the loop and removes the listeners. */
export function stopGalleryFlow(): void { detach(); }

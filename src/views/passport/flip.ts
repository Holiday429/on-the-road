/* ==========================================================================
   On the Road · Passport — page turning
   --------------------------------------------------------------------------
   Drives the leaves of the book (.pp-leaf, in order) with CSS 3D: a leaf is
   "turned" when its index is below the book's turned-count; dragging a page
   edge follows the finger with rotateY and then settles to whichever side is
   nearer; arrow keys and next()/prev() turn a whole leaf. No library — the
   pages are stiff card, they only need to hinge on the spine.
   ========================================================================== */

/** Fraction of a full turn (0–1) for a drag of `dx` px on a page `pageW` px wide. */
export function turnProgress(dx: number, pageW: number): number {
  if (pageW <= 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(dx) / (pageW * 0.9)));
}

/** Whether a released drag completes the turn (far enough, or flicked). `velocity` is px/ms in the turning direction. */
export function shouldCommit(progress: number, velocity: number): boolean {
  return progress > 0.3 || velocity > 0.45;
}

/** Stacking: leaves still on the right pile up from the spine outward; turned ones the other way. */
export function leafZ(index: number, turned: number, total: number): number {
  return index < turned ? index + 1 : total - index;
}

export interface FlipOptions {
  /** The element holding the .pp-leaf elements; also receives the pointer events. */
  book: HTMLElement;
  /** True on narrow screens, where a leaf carries one page and a drag need not start on a given side. */
  single: () => boolean;
  /** Called after every change of the turned-count, with whether it came from the traveller turning a page. */
  onChange: (turned: number) => void;
  /** Called when the traveller turns a page, with the turned-count before and after (for the sound). */
  onTurn?: (from: number, to: number) => void;
}

export interface FlipBook {
  turned(): number;
  goTo(turned: number, animate?: boolean): void;
  next(): void;
  prev(): void;
  /** Re-reads the leaves (after the book was re-rendered). */
  refresh(): void;
  /** True for a moment after a drag, so the click that ends it can be ignored. */
  justDragged(): boolean;
  destroy(): void;
}

export function createFlip(o: FlipOptions): FlipBook {
  let leaves: HTMLElement[] = [];
  let turned = 0;
  let dragMoved = false;
  let drag: { x0: number; t0: number; side: 'left' | 'right'; leaf: HTMLElement | null; dir: 1 | -1 | 0; progress: number } | null = null;
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  function paint(): void {
    leaves.forEach((el, i) => {
      el.classList.toggle('is-turned', i < turned);
      el.style.zIndex = String(leafZ(i, turned, leaves.length));
      el.style.transform = '';
      el.classList.remove('is-dragging');
    });
    o.book.dataset.turned = String(turned);
    o.book.classList.toggle('is-closed', turned === 0);
    o.book.classList.toggle('is-shut', turned === leaves.length && !o.single());
  }

  function set(n: number, animate: boolean, fromUser: boolean): void {
    const next = Math.min(leaves.length, Math.max(0, n));
    if (next === turned) { paint(); return; }
    const lo = Math.min(turned, next);
    const hi = Math.max(turned, next);
    // Sheets crossing the spine ride on top while they swing.
    if (animate && !reduced()) for (let i = lo; i < hi; i++) { if (leaves[i]) leaves[i].style.zIndex = String(leaves.length + 5); }
    const from = turned;
    turned = next;
    if (fromUser) o.onTurn?.(from, next);
    leaves.forEach((el, i) => {
      el.classList.remove('is-dragging');
      el.style.transform = '';
      el.classList.toggle('is-turned', i < turned);
    });
    o.book.dataset.turned = String(turned);
    o.book.classList.toggle('is-closed', turned === 0);
    o.book.classList.toggle('is-shut', turned === leaves.length && !o.single());
    const settle = () => leaves.forEach((el, i) => { el.style.zIndex = String(leafZ(i, turned, leaves.length)); });
    if (animate && !reduced()) window.setTimeout(settle, 720); else settle();
    o.onChange(turned);
  }

  const spineX = (): number => {
    const spine = o.book.querySelector<HTMLElement>('.pp-spine');
    return spine ? spine.getBoundingClientRect().left : o.book.getBoundingClientRect().left;
  };

  function down(e: PointerEvent): void {
    if (e.button > 0 || (e.target as HTMLElement).closest('[data-no-turn], input, textarea, select')) return;
    drag = { x0: e.clientX, t0: performance.now(), side: e.clientX >= spineX() ? 'right' : 'left', leaf: null, dir: 0, progress: 0 };
    dragMoved = false;
  }

  function move(e: PointerEvent): void {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (drag.dir === 0) {
      if (Math.abs(dx) < 8) return;
      const dir: 1 | -1 = dx < 0 ? 1 : -1;       // leftwards = forwards
      const ok = o.single() || (dir === 1 && drag.side === 'right') || (dir === -1 && drag.side === 'left');
      const leaf = leaves[dir === 1 ? turned : turned - 1];
      if (!ok || !leaf) { drag = null; return; }
      drag.dir = dir;
      drag.leaf = leaf;
      leaf.classList.add('is-dragging');
      leaf.style.zIndex = String(leaves.length + 5);
      o.book.setPointerCapture?.(e.pointerId);
    }
    dragMoved = true;
    drag.progress = turnProgress(dx, o.book.querySelector<HTMLElement>('.pp-face')?.getBoundingClientRect().width ?? 1);
    const deg = drag.dir === 1 ? -180 * drag.progress : -180 * (1 - drag.progress);
    drag.leaf!.style.transform = `rotateY(${deg}deg)`;
  }

  function up(e: PointerEvent): void {
    if (!drag) return;
    const d = drag;
    drag = null;
    o.book.releasePointerCapture?.(e.pointerId);
    if (d.dir === 0 || !d.leaf) return;
    const dt = Math.max(1, performance.now() - d.t0);
    const v = (Math.abs(e.clientX - d.x0) / dt);
    const commit = shouldCommit(d.progress, v);
    const target = commit ? turned + d.dir : turned;
    if (target === turned) {
      // Spring back.
      d.leaf.classList.remove('is-dragging');
      d.leaf.style.transform = '';
      window.setTimeout(paint, 720);
    } else {
      set(target, true, true);
    }
    window.setTimeout(() => { dragMoved = false; }, 0);
  }

  const key = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); set(turned + 1, true, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); set(turned - 1, true, true); }
  };

  o.book.addEventListener('pointerdown', down);
  o.book.addEventListener('pointermove', move);
  o.book.addEventListener('pointerup', up);
  o.book.addEventListener('pointercancel', up);
  document.addEventListener('keydown', key);

  const api: FlipBook = {
    turned: () => turned,
    goTo: (n, animate = true) => set(n, animate, false),
    next: () => set(turned + 1, true, true),
    prev: () => set(turned - 1, true, true),
    refresh() {
      leaves = [...o.book.querySelectorAll<HTMLElement>('.pp-leaf')];
      turned = Math.min(turned, leaves.length);
      paint();
    },
    justDragged: () => dragMoved,
    destroy() {
      o.book.removeEventListener('pointerdown', down);
      o.book.removeEventListener('pointermove', move);
      o.book.removeEventListener('pointerup', up);
      o.book.removeEventListener('pointercancel', up);
      document.removeEventListener('keydown', key);
    },
  };
  api.refresh();
  return api;
}

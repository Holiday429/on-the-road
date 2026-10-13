/* ==========================================================================
   On the Road · Passport — pressing a stamp
   --------------------------------------------------------------------------
   The ceremony: a rubber stamp hovers over the page the stamp belongs on. Drag
   it where you want the mark; then press and hold — the longer you hold, the
   darker the ink — and let go. A quick tap works too (a light mark), and the
   keyboard can move the stamp (arrows) and press it (Enter / Space).

   This file only gathers the traveller's gesture: where (in % of the page),
   how hard. Writing the placement and drawing the result is passport.ts.
   ========================================================================== */

import { renderStamp } from '../../core/paper/stamp.ts';
import { t } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import type { PassportStamp } from '../../data/passport.ts';

export interface PressResult { x: number; y: number; pressure: number }

export interface PressOpts {
  /** Positioning parent: the desk. The overlay fills it. */
  desk: HTMLElement;
  /** The page face the stamp will land on. */
  face: HTMLElement;
  stamp: PassportStamp;
  /** Where the stamp hovers to begin with, in % of the page. */
  start: { x: number; y: number };
  onDone: (r: PressResult) => void;
  onAuto: () => void;
  onCancel: () => void;
}

/** Marks stay inside the page. */
const X_MIN = 20, X_MAX = 80, Y_MIN = 26, Y_MAX = 88;
/** Press time for the darkest mark, and the shortest that still counts as pressing. */
export const FULL_PRESS_MS = 1100;
/** Distance from the top of the tool (knob, neck) to the middle of its rubber block, in px. */
const TOOL_ANCHOR = 116;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** How hard a press of `ms` milliseconds is: a tap is light, a long hold is full. */
export function pressureFor(ms: number): number {
  return Math.round(clamp(ms / FULL_PRESS_MS, 0.3, 1) * 100) / 100;
}

export function startPress(o: PressOpts): () => void {
  const layer = document.createElement('div');
  layer.className = 'pp-press';
  // eslint-disable-next-line no-restricted-syntax -- audited: every interpolation escaped (esc / renderStamp)
  layer.innerHTML = `
    <div class="pp-press-card" data-no-turn>
      <div class="pp-press-text">
        <strong>${esc(o.stamp.country)}</strong>
        <span>${esc(t('passport.press.hint'))}</span>
      </div>
      <div class="pp-press-actions">
        <button type="button" class="btn btn-ghost" data-press-auto>${esc(t('passport.press.auto'))}</button>
        <button type="button" class="btn btn-ghost" data-press-cancel>${esc(t('passport.press.cancel'))}</button>
      </div>
    </div>
    <div class="pp-tool" tabindex="0" role="button" aria-label="${esc(t('passport.press.tool', { c: o.stamp.country }))}" data-no-turn>
      <div class="pp-tool-knob"></div>
      <div class="pp-tool-neck"></div>
      <div class="pp-tool-base">${renderStamp({ ...o.stamp, rotation: 0 }, { size: 112, className: 'pp-tool-art' })}</div>
      <div class="pp-tool-shadow"></div>
    </div>`;
  o.desk.appendChild(layer);
  const tool = layer.querySelector<HTMLElement>('.pp-tool')!;

  /** Tool centre in desk pixels. */
  let cx = 0, cy = 0;
  const deskBox = () => o.desk.getBoundingClientRect();
  const faceBox = () => o.face.getBoundingClientRect();
  const toPct = (): { x: number; y: number } => {
    const f = faceBox(); const d = deskBox();
    return {
      x: clamp(((cx - (f.left - d.left)) / f.width) * 100, X_MIN, X_MAX),
      y: clamp(((cy - (f.top - d.top)) / f.height) * 100, Y_MIN, Y_MAX),
    };
  };
  const fromPct = (p: { x: number; y: number }) => {
    const f = faceBox(); const d = deskBox();
    cx = f.left - d.left + (p.x / 100) * f.width;
    cy = f.top - d.top + (p.y / 100) * f.height;
  };
  // The mark lands under the middle of the rubber block, not the middle of the whole tool.
  const place = () => { tool.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -${TOOL_ANCHOR}px)`; };
  fromPct(o.start);
  place();
  tool.focus({ preventScroll: true });

  let drag: { dx: number; dy: number; x0: number; y0: number; moved: boolean; t0: number } | null = null;
  let raf = 0;
  const animate = (t0: number) => {
    const step = () => {
      tool.style.setProperty('--press', String(clamp((performance.now() - t0) / FULL_PRESS_MS, 0, 1)));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  const stopAnim = () => { cancelAnimationFrame(raf); tool.style.setProperty('--press', '0'); tool.classList.remove('is-pressing'); };

  const down = (e: PointerEvent) => {
    if (e.button > 0) return;
    e.preventDefault();
    const d = deskBox();
    drag = { dx: cx - (e.clientX - d.left), dy: cy - (e.clientY - d.top), x0: e.clientX, y0: e.clientY, moved: false, t0: performance.now() };
    tool.setPointerCapture(e.pointerId);
    tool.classList.add('is-pressing');
    animate(drag.t0);
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 7) {
      drag.moved = true;
      stopAnim();                                   // moving the stamp is not pressing it
      tool.classList.add('is-dragging');
    }
    if (!drag.moved) return;
    const d = deskBox();
    cx = clamp(e.clientX - d.left + drag.dx, 0, d.width);
    cy = clamp(e.clientY - d.top + drag.dy, 0, d.height);
    place();
  };
  const up = (e: PointerEvent) => {
    if (!drag) return;
    const was = drag;
    drag = null;
    tool.releasePointerCapture?.(e.pointerId);
    tool.classList.remove('is-dragging');
    if (was.moved) return;
    const ms = performance.now() - was.t0;
    stopAnim();
    finish(pressureFor(ms));
  };
  const cancel = () => { drag = null; stopAnim(); };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 24 : 8;
    if (e.key === 'ArrowLeft') cx -= step;
    else if (e.key === 'ArrowRight') cx += step;
    else if (e.key === 'ArrowUp') cy -= step;
    else if (e.key === 'ArrowDown') cy += step;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(0.8); return; }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); o.onCancel(); return; }
    else return;
    e.preventDefault();
    const d = deskBox();
    cx = clamp(cx, 0, d.width); cy = clamp(cy, 0, d.height);
    place();
  };

  let done = false;
  function finish(pressure: number): void {
    if (done) return;
    done = true;
    const p = toPct();
    close();
    o.onDone({ x: p.x, y: p.y, pressure });
  }
  function close(): void {
    stopAnim();
    layer.remove();
  }

  tool.addEventListener('pointerdown', down);
  tool.addEventListener('pointermove', move);
  tool.addEventListener('pointerup', up);
  tool.addEventListener('pointercancel', cancel);
  tool.addEventListener('keydown', key);
  layer.querySelector('[data-press-auto]')!.addEventListener('click', () => { if (done) return; done = true; close(); o.onAuto(); });
  layer.querySelector('[data-press-cancel]')!.addEventListener('click', () => { if (done) return; done = true; close(); o.onCancel(); });
  return () => { done = true; close(); };
}

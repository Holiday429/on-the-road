/* ==========================================================================
   On the Road · To-do — crossing an item off
   --------------------------------------------------------------------------
   One motion for every place a to-do is ticked (the Agenda's note, the
   Dashboard's note, a plan item on the day sheet): the tick is drawn in pen,
   then one stroke is drawn across the WHOLE entry, left to right, and only then
   is the change written. Where the item belongs to a list it then leaves (the
   Dashboard's note shows open items only) or, on the Agenda, travels to the
   "done" section: the rows are measured before the write and slid from where
   they were to where they land (FLIP), so the eye follows the crossed-off line
   down the note instead of seeing it vanish and reappear.

   The write is held back until the line has been drawn, so a failed write
   (signed out, offline) just takes the pen marks off again.
   ========================================================================== */

import './todo-strike.css';
import { reducedMotion } from '../../core/paper/page-flip.ts';

/** The pen stroke across an entry, ms. */
export const STRIKE_MS = 380;
/** The line is left on the page for a beat before the entry moves. */
export const HOLD_MS = 170;
/** An entry leaving the list, ms. */
export const LEAVE_MS = 300;
/** Rows sliding to their new places, ms. */
export const MOVE_MS = 520;

const NS = 'http://www.w3.org/2000/svg';

/** A wobbly stroke `w` px wide: pen on paper is never ruler-straight, and it rises a little where the hand lifts. */
export function penPath(w: number): string {
  const f = (n: number) => (w * n).toFixed(1);
  return `M0 7.2 C${f(0.18)} 4.9 ${f(0.34)} 8.6 ${f(0.52)} 6.3 S${f(0.82)} 4.6 ${w.toFixed(1)} 6.4`;
}

function penLine(w: number): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'todo-pen');
  svg.setAttribute('viewBox', `0 0 ${w.toFixed(1)} 12`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', penPath(w));
  path.setAttribute('pathLength', '1');
  svg.append(path);
  return svg;
}

export interface StrikeOpts {
  /** The words the line starts at (and whose first line it runs along). */
  from: HTMLElement;
  /** The last thing on the entry: the line runs to its right edge (default: `from`). */
  to?: HTMLElement;
  /** The entry slides away after the line is drawn (it is leaving the list for good). */
  leave?: boolean;
}

/**
 * Cross `row` off: tick, line, (leave,) then `commit()`. `row` must be
 * `position: relative`. `commit` may return a promise; if it fails the marks are removed.
 */
export function strikeRow(row: HTMLElement, o: StrikeOpts, commit: () => unknown): void {
  if (row.dataset.striking) return;
  if (reducedMotion()) { void commit(); return; }
  row.dataset.striking = '1';
  row.classList.add('is-ticking');

  const r = row.getBoundingClientRect();
  const end = (o.to ?? o.from).getBoundingClientRect().right;
  // One stroke per line of the words (an entry that wraps is crossed out line by line), the last one
  // running on to the end of the entry.
  const lines = lineRects(o.from);
  const strokes = lines.map((l, i) => {
    const last = i === lines.length - 1;
    const left = l.left - r.left - 3;
    const width = Math.max(24, (last ? Math.max(end, l.right) : l.right) - l.left + 6);
    const svg = penLine(width);
    svg.style.cssText = `left:${left}px;width:${width}px;top:${l.top - r.top + l.height / 2 - 7}px`;
    const dur = STRIKE_MS / lines.length;
    const path = svg.firstElementChild as SVGPathElement;
    path.style.transitionDuration = `${dur}ms`;
    path.style.transitionDelay = `${90 + i * dur}ms`;
    row.append(svg);
    return svg;
  });
  strokes[0]?.getBoundingClientRect();   // commit the undrawn state, so what follows is a transition
  strokes.forEach((svg) => svg.classList.add('is-drawing'));

  const undo = () => {
    strokes.forEach((svg) => svg.remove());
    row.classList.remove('is-ticking', 'is-leaving');
    delete row.dataset.striking;
  };
  const written = STRIKE_MS + HOLD_MS;
  if (o.leave) setTimeout(() => row.classList.add('is-leaving'), written);
  setTimeout(() => {
    try { Promise.resolve(commit()).catch(undo); } catch { undo(); }
  }, written + (o.leave ? LEAVE_MS : 0));
}

/** The box of each line the text of `el` is set in (a wrapped entry has several), merged per line. */
export function lineRects(el: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const out: DOMRect[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.top - r.top) < prev.height / 2) {
      out[out.length - 1] = new DOMRect(Math.min(prev.left, r.left), prev.top, Math.max(prev.right, r.right) - Math.min(prev.left, r.left), prev.height);
    } else out.push(r);
  }
  return out.length ? out : [el.getBoundingClientRect()];
}

/** Where every row (matched by `[data-todo-id]`) is now, to be handed to {@link playMoves} after the redraw. */
export interface RowRects { at: number; rects: Map<string, DOMRect> }

export function captureRects(root: ParentNode): RowRects {
  const rects = new Map<string, DOMRect>();
  root.querySelectorAll<HTMLElement>('[data-todo-id]').forEach((el) => rects.set(el.dataset.todoId!, el.getBoundingClientRect()));
  return { at: performance.now(), rects };
}

/** Slide each row from where it was to where it is. Stale captures (the write never came back) are ignored. */
export function playMoves(root: ParentNode, prev: RowRects | null): void {
  if (!prev || performance.now() - prev.at > 2500 || reducedMotion()) return;
  root.querySelectorAll<HTMLElement>('[data-todo-id]').forEach((el) => {
    const was = prev.rects.get(el.dataset.todoId!);
    if (!was || typeof el.animate !== 'function') return;
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: MOVE_MS, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' },
    );
  });
}

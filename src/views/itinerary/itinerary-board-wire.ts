/* ==========================================================================
   On the Road · Itinerary board — wiring
   --------------------------------------------------------------------------
   Click behaviour for the departures board and its gate card: open a stop, the
   ⋯ menu, edit-dates from a gap warning, the strip. Everything that touches
   itinerary.ts's module state comes in through `env`, so this file stays free
   of it. The gate card is never swapped out from here — it only ever shows the
   stop you are on, so there is no second source of truth to keep in sync.
   ========================================================================== */

import { wirePassportOpeners } from '../passport/passport-links.ts';
import type { BoardCtx } from './itinerary-board.ts';

export interface BoardEnv extends BoardCtx {
  /** Open a stop; `row` lets the board flip its tiles on the way out. */
  open: (id: string, row?: HTMLElement | null) => void;
  editDates: (id: string) => void;
  remove: (id: string) => void;
}

let _menuBound = false;

function closeBoardMenus() {
  document.querySelectorAll<HTMLElement>('.rb-menu:not([hidden])').forEach((m) => { m.hidden = true; });
}

/** The whole gate card opens its stop (click, Enter or Space); the passport icon beside it opens the passport. */
/** The photo keeps its own proportions, so its width follows from the card's height. Copy that
 *  width to CSS (--gate-photo-w) so the text starts after the photo rather than under it. */
function fitGatePhoto(gate: HTMLElement) {
  const photo = gate.querySelector<HTMLElement>('.rb-gate-photo');
  if (!photo || typeof ResizeObserver === 'undefined') return;
  const set = () => gate.style.setProperty('--gate-photo-w', `${Math.round(photo.getBoundingClientRect().width)}px`);
  new ResizeObserver(set).observe(photo);
  set();
}

function wireGate(root: HTMLElement, env: BoardEnv) {
  wirePassportOpeners(root);
  root.querySelectorAll<HTMLElement>('.rb-gate').forEach(fitGatePhoto);
  root.querySelectorAll<HTMLElement>('.rb-gate[data-act="open"]').forEach((el) => {
    el.addEventListener('click', () => env.open(el.dataset.id!));
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      env.open(el.dataset.id!);
    });
  });
}

export function wireBoard(timeline: HTMLElement, env: BoardEnv) {
  const host = timeline.querySelector<HTMLElement>('[data-rb-gate-host]');
  if (host) wireGate(host, env);

  timeline.querySelectorAll<HTMLElement>('.rb-row[data-act="open"]').forEach((row) =>
    row.addEventListener('click', () => env.open(row.dataset.id!, row)));

  timeline.querySelectorAll<HTMLElement>('[data-act="menu"]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = btn.parentElement!.querySelector<HTMLElement>('.rb-menu')!;
      const wasHidden = menu.hidden;
      closeBoardMenus();
      menu.hidden = !wasHidden;
    }));
  if (!_menuBound) {
    _menuBound = true;
    document.addEventListener('click', closeBoardMenus);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBoardMenus(); });
  }

  timeline.querySelectorAll<HTMLElement>('[data-act="edit-dates-from-list"], [data-act="fix-gap"]').forEach((el) =>
    el.addEventListener('click', () => env.editDates(el.dataset.id!)));
  timeline.querySelectorAll<HTMLElement>('[data-act="del"]').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); closeBoardMenus(); env.remove(btn.dataset.id!); }));

  // The strip: a click shows that stop on the gate card and scrolls to its row.
  timeline.querySelectorAll<HTMLElement>('[data-act="strip"]').forEach((seg) =>
    seg.addEventListener('click', () => {
      timeline.querySelector<HTMLElement>(`.rb-rowwrap[data-id="${CSS.escape(seg.dataset.id!)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
}

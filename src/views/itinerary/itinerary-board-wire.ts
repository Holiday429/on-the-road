/* ==========================================================================
   On the Road · Itinerary board — wiring
   --------------------------------------------------------------------------
   Click / hover behaviour for the departures board and its gate card: open a
   stop, the ⋯ menu, edit-dates from a gap warning, the hover preview, the
   strip. Everything that touches itinerary.ts's module state comes in through
   `env`, so this file stays free of it.
   ========================================================================== */

import { navigateTo, type NavIntent } from '../../core/app.ts';
import { wirePassportOpeners } from '../passport/passport-links.ts';
import type { Leg } from './itinerary-shared.ts';
import { renderGate, type BoardCtx } from './itinerary-board.ts';
import { gateFor } from './itinerary-board-model.ts';

export interface BoardEnv extends BoardCtx {
  /** Open a stop; `row` lets the board flip its tiles on the way out. */
  open: (id: string, row?: HTMLElement | null) => void;
  editDates: (id: string) => void;
  remove: (id: string) => void;
}

let _menuBound = false;
let _previewTimer = 0;

function closeBoardMenus() {
  document.querySelectorAll<HTMLElement>('.rb-menu:not([hidden])').forEach((m) => { m.hidden = true; });
}

/** Wires what the gate card offers: open the city, jump to the map, open the passport. */
function wireGate(root: HTMLElement, env: BoardEnv) {
  wirePassportOpeners(root);
  root.querySelectorAll<HTMLElement>('[data-act="open"]').forEach((el) =>
    el.addEventListener('click', () => env.open(el.dataset.id!)));
  root.querySelectorAll<HTMLElement>('[data-act="gate-map"]').forEach((el) =>
    el.addEventListener('click', () => navigateTo('map', { mode: 'route', legId: el.dataset.id! } satisfies NavIntent)));
}

export function wireBoard(timeline: HTMLElement, env: BoardEnv) {
  const host = timeline.querySelector<HTMLElement>('[data-rb-gate-host]');
  if (!host) return;
  const gate = () => renderGate(gateFor(env.legs, env.today), env);
  const show = (html: string) => {
    // eslint-disable-next-line no-restricted-syntax -- audited: renderGate escapes every interpolation
    host.innerHTML = html;
    wireGate(host, env);
  };
  wireGate(host, env);

  // Hovering a row previews that stop on the gate card; touch has no hover, so it just opens.
  const preview = (id: string | undefined) => {
    clearTimeout(_previewTimer);
    _previewTimer = window.setTimeout(() => {
      const leg: Leg | undefined = id ? env.legs.find((l) => l.id === id) : undefined;
      show(leg ? renderGate(gateFor(env.legs, env.today), env, { preview: leg }) : gate());
    }, id ? 140 : 220);
  };
  if (window.matchMedia?.('(hover: hover)').matches) {
    timeline.querySelectorAll<HTMLElement>('.rb-rowwrap').forEach((w) => {
      w.addEventListener('mouseenter', () => preview(w.dataset.id));
      w.addEventListener('mouseleave', () => preview(undefined));
    });
  }

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
      preview(seg.dataset.id);
    }));
}

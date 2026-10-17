/* ==========================================================================
   On the Road · Itinerary plan — ticket machine wiring
   --------------------------------------------------------------------------
   The one-line add bar: type "Tivoli 3h kr170", watch it read back as title ·
   duration · price, pick a category chip, press Print (or Enter). The ticket
   lands in the loose box. Markup: renderPlanMachine (itinerary-plan-views.ts).
   ========================================================================== */

import { t as tr } from '../../core/i18n.ts';
import type { PlanItem } from '../../data/schema.ts';
import type { Leg } from './itinerary-shared.ts';
import { parsePlanText } from './itinerary-plan-parse.ts';

export interface MachineEnv {
  uid: () => string;
  clean: <T>(v: T) => T;
  /** Save a new plans array on the leg. */
  savePlans: (plans: PlanItem[]) => void;
  /** The category chip picked last, kept across re-renders. */
  getCat: () => string;
  setCat: (id: string) => void;
}

export function wirePlanMachine(timeline: HTMLElement, leg: Leg, env: MachineEnv): void {
  const input = timeline.querySelector<HTMLInputElement>('#rd-plan-input');
  const details = timeline.querySelector<HTMLElement>('#rd-plan-add-details');
  const preview = timeline.querySelector<HTMLElement>('#rd-plan-parse');
  const note = timeline.querySelector<HTMLInputElement>('#rd-plan-note');
  if (!input) return;

  input.addEventListener('focus', () => { if (details) details.hidden = false; });
  input.addEventListener('input', () => {
    const p = parsePlanText(input.value);
    const bits = [p.duration ? `≈${p.duration}` : '', p.cost ?? ''].filter(Boolean);
    if (!preview) return;
    preview.hidden = !input.value.trim() || !bits.length;
    preview.textContent = bits.length ? `${tr('route.machineReads')}: ${p.title} · ${bits.join(' · ')}` : '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); print(); }
  });

  timeline.querySelectorAll<HTMLElement>('[data-act="plan-cat"]').forEach((chip) =>
    chip.addEventListener('click', () => {
      const id = chip.dataset.cat!;
      const next = env.getCat() === id ? '' : id;
      env.setCat(next);
      timeline.querySelectorAll<HTMLElement>('[data-act="plan-cat"]').forEach((c) => {
        const on = c.dataset.cat === next;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', String(on));
      });
    }));
  timeline.querySelector('[data-act="add-plan"]')?.addEventListener('click', print);

  function print() {
    const raw = input!.value.trim();
    if (!raw) return;
    const p = parsePlanText(raw);
    const plans = leg.plans ?? [];
    const item: PlanItem = {
      id: env.uid(), title: p.title,
      category: env.getCat(),
      note: note?.value.trim() || undefined,
      duration: p.duration, cost: p.cost,
      dayId: null, done: false, order: plans.length,
    };
    env.savePlans([...plans, env.clean(item)]);
  }
}

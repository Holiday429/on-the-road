/* ==========================================================================
   On the Road · Dashboard — time-travel control (testing aid)
   --------------------------------------------------------------------------
   A small 🕒 button in the greeting row (shown only after visiting with
   ?debug=1) that opens a drawer to pick any moment, with one-tap jumps to
   before the trip, each stop's arrival day, the last day and after — so a
   finished trip can be viewed as it looked at any stage. While a simulation is
   on, a pill shows the simulated time with a ✕ to return to the real clock.
   The clock itself lives in data/sim-clock.ts.
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { addDays } from '../../data/day-agenda.ts';
import { appNow, debugEnabled, isSimulating, nowLocalValue, setSimulatedNow } from '../../data/sim-clock.ts';
import { tripSpan } from '../../data/trip-now.ts';

/** Local time used when a jump picks only a date — morning, so a same-day flight is still ahead. */
const JUMP_TIME = '10:00';

export type SimJump =
  | { kind: 'before' | 'last' | 'after'; iso: string }
  | { kind: 'leg'; iso: string; leg: StoredLeg; index: number };

/** One-tap targets, in trip order: a week before, each stop's first day, the
 *  trip's last day, the day after. Empty with no dates at all. */
export function simJumps(trip: { startDate: string; endDate: string } | null, legsIn: StoredLeg[]): SimJump[] {
  const legs = [...legsIn].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const span = tripSpan(trip, legs);
  if (!span) return [];
  return [
    { kind: 'before', iso: addDays(span.start, -7) },
    ...legs.map((leg, i): SimJump => ({ kind: 'leg', iso: leg.dateFrom, leg, index: i + 1 })),
    { kind: 'last', iso: span.end },
    { kind: 'after', iso: addDays(span.end, 1) },
  ];
}

function fmtDate(iso: string): string {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
}
function fmtNow(): string {
  try { return appNow().toLocaleString(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return nowLocalValue(); }
}

/** The greeting-row control: the pill while simulating, the 🕒 button in debug mode, else nothing. */
export function renderSimControl(): string {
  if (isSimulating()) {
    return `
      <span class="td-sim td-sim--on">
        <button type="button" class="td-sim-main" data-sim-open title="${esc(t('dash.sim.title'))}">🕒 ${esc(t('dash.sim.on', { when: fmtNow() }))}</button>
        <button type="button" class="td-sim-x" data-sim-reset aria-label="${esc(t('dash.sim.reset'))}" title="${esc(t('dash.sim.reset'))}">✕</button>
      </span>`;
  }
  if (!debugEnabled()) return '';
  return `<button type="button" class="td-sim td-sim--btn" data-sim-open title="${esc(t('dash.sim.title'))}" aria-label="${esc(t('dash.sim.title'))}">🕒</button>`;
}

function jumpLabel(j: SimJump): string {
  switch (j.kind) {
    case 'before': return t('dash.sim.before');
    case 'last': return t('dash.sim.last');
    case 'after': return t('dash.sim.after');
    default: return `${j.index}. ${`${j.leg.flag} ${j.leg.city}`.trim()}`;
  }
}

function openSimDrawer(trip: { startDate: string; endDate: string } | null, legs: StoredLeg[], trigger: HTMLElement | null): void {
  const jumps = simJumps(trip, legs);
  const d = openDrawer({
    title: `🕒 ${t('dash.sim.title')}`,
    subtitle: isSimulating() ? t('dash.sim.on', { when: fmtNow() }) : t('dash.sim.off'),
    body: `
      <label class="field-label" for="sim-dt">${esc(t('dash.sim.pick'))}</label>
      <div class="td-sim-row">
        <input class="input" id="sim-dt" type="datetime-local" value="${esc(nowLocalValue())}">
        <button type="button" class="btn btn-primary" data-sim-apply>${esc(t('dash.sim.apply'))}</button>
      </div>
      ${jumps.length ? `
        <h3 class="td-dh">${esc(t('dash.sim.jump'))}</h3>
        <div class="td-sim-jumps">
          ${jumps.map((j) => `<button type="button" class="td-sim-jump" data-sim-to="${esc(j.iso)}"><span>${esc(jumpLabel(j))}</span><small>${esc(fmtDate(j.iso))}</small></button>`).join('')}
        </div>` : ''}
      <p class="td-dempty td-sim-note">${esc(t('dash.sim.note'))}</p>`,
    footer: `<button type="button" class="btn btn-ghost" data-sim-reset ${isSimulating() ? '' : 'disabled'}>${esc(t('dash.sim.reset'))}</button>`,
    returnFocus: trigger,
  });
  const apply = (local: string | null) => { if (setSimulatedNow(local)) closeDrawer(); };
  d.root.querySelector('[data-sim-apply]')?.addEventListener('click', () => {
    const v = d.root.querySelector<HTMLInputElement>('#sim-dt')?.value;
    if (v) apply(v);
  });
  d.root.querySelectorAll<HTMLElement>('[data-sim-to]').forEach((b) =>
    b.addEventListener('click', () => apply(`${b.dataset.simTo}T${JUMP_TIME}`)));
  d.root.querySelector('[data-sim-reset]')?.addEventListener('click', () => apply(null));
}

/** `get` is read at click time so the drawer sees the latest trip/legs. */
export function wireSimControl(body: HTMLElement, get: () => { trip: { startDate: string; endDate: string } | null; legs: StoredLeg[] }): void {
  body.querySelectorAll<HTMLElement>('[data-sim-open]').forEach((b) =>
    b.addEventListener('click', () => { const { trip, legs } = get(); openSimDrawer(trip, legs, b); }));
  body.querySelectorAll<HTMLElement>('.td-sim [data-sim-reset]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); setSimulatedNow(null); }));
}

/* ==========================================================================
   On the Road · Dashboard — time-travel control
   --------------------------------------------------------------------------
   A 🕒 button in the greeting row, just left of the notification bell. It opens
   a drawer to pick any day (or moment), with one-tap jumps to before the trip,
   each stop's arrival day, the last day and after — and the Dashboard becomes
   that day: banner, agenda, spend, journal, map, pack. While looking back, a
   pill shows the chosen time with a ✕ to return to now. The clock itself lives
   in data/sim-clock.ts.
   ========================================================================== */

import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { addDays } from '../../data/day-agenda.ts';
import { appNow, isSimulating, nowDateValue, setSimulatedNow } from '../../data/sim-clock.ts';
import { tripSpan } from '../../data/trip-now.ts';

/** Time of day the app starts from when a date is chosen — morning, so a same-day flight is still ahead (then it ticks on). */
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
/** The chosen day, no clock time — the control works in whole days. */
function fmtNow(): string {
  try { return appNow().toLocaleDateString(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return nowDateValue(); }
}

/** The greeting-row control: the pill while looking back, otherwise the 🕒 button. */
export function renderSimControl(): string {
  if (isSimulating()) {
    return `
      <span class="td-sim td-sim--on">
        <button type="button" class="td-sim-main" data-sim-open title="${esc(t('dash.sim.title'))}">🕒 ${esc(t('dash.sim.on', { when: fmtNow() }))}</button>
        <button type="button" class="td-sim-x" data-sim-reset aria-label="${esc(t('dash.sim.reset'))}" title="${esc(t('dash.sim.reset'))}">✕</button>
      </span>`;
  }
  return `<button type="button" class="td-sim td-sim--btn" data-sim-open title="${esc(t('dash.sim.title'))}" aria-label="${esc(t('dash.sim.title'))}">🕒</button>`;
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A Monday-first month grid in the Dashboard agenda's look, with `picked` highlighted. */
function simCalendar(monthKey: string, picked: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const today = nowDateValue();
  const hdr = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="ag-dow">${d}</span>`).join('');
  let cells = '<span class="ag-cell ag-empty"></span>'.repeat(offset);
  for (let d = 1; d <= days; d++) {
    const cur = `${monthKey}-${String(d).padStart(2, '0')}`;
    const cls = ['ag-cell', cur === today ? 'is-today' : '', cur === picked ? 'is-sel' : ''].filter(Boolean).join(' ');
    cells += `<button type="button" class="${cls}" data-sim-day="${cur}"><span class="ag-num">${d}</span></button>`;
  }
  const title = first.toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' });
  return `
    <div class="ag-month-nav">
      <button type="button" class="ag-nav" data-sim-month="-1" aria-label="${esc(t('dash.agenda.prevMonth'))}">‹</button>
      <div class="ag-month-title">${esc(title)}</div>
      <button type="button" class="ag-nav" data-sim-month="1" aria-label="${esc(t('dash.agenda.nextMonth'))}">›</button>
    </div>
    <div class="ag-grid">${hdr}${cells}</div>`;
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
  let picked = nowDateValue();
  let viewMonth = picked.slice(0, 7);
  const d = openDrawer({
    title: `🕒 ${t('dash.sim.title')}`,
    subtitle: isSimulating() ? t('dash.sim.on', { when: fmtNow() }) : t('dash.sim.off'),
    body: `
      <div class="td-sim-h">${esc(t('dash.sim.pick'))}</div>
      <div class="td-sim-pick">
        <div class="td-sim-cal" data-sim-cal>${simCalendar(viewMonth, picked)}</div>
        <div class="td-sim-side">
          <button type="button" class="btn btn-ghost" data-sim-today>${esc(t('dash.agenda.today'))}</button>
          <button type="button" class="btn btn-primary" data-sim-apply>${esc(t('dash.sim.apply'))}</button>
        </div>
      </div>
      ${jumps.length ? `
        <div class="td-sim-h td-sim-h--gap">${esc(t('dash.sim.jump'))}</div>
        <div class="td-sim-jumps">
          ${jumps.map((j) => `<button type="button" class="td-sim-jump" data-sim-to="${esc(j.iso)}"><span>${esc(jumpLabel(j))}</span><small>${esc(fmtDate(j.iso))}</small></button>`).join('')}
        </div>` : ''}
      <p class="td-dempty td-sim-note">${esc(t('dash.sim.note'))}</p>`,
    footer: `<button type="button" class="btn btn-ghost" data-sim-reset ${isSimulating() ? '' : 'disabled'}>${esc(t('dash.sim.reset'))}</button>`,
    returnFocus: trigger,
  });
  const apply = (local: string | null) => { if (setSimulatedNow(local)) closeDrawer(); };
  // The month grid is the app's own (the browser's date popup is blue and can't be themed).
  const cal = d.root.querySelector<HTMLElement>('[data-sim-cal]');
  cal?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const nav = target.closest<HTMLElement>('[data-sim-month]');
    const day = target.closest<HTMLElement>('[data-sim-day]');
    if (nav) viewMonth = shiftMonth(viewMonth, Number(nav.dataset.simMonth));
    else if (day) picked = day.dataset.simDay!;
    else return;
    // eslint-disable-next-line no-restricted-syntax -- audited: digits and a localized month name only
    cal.innerHTML = simCalendar(viewMonth, picked);
  });
  d.root.querySelector('[data-sim-today]')?.addEventListener('click', () => apply(null));   // today = the real clock again
  d.root.querySelector('[data-sim-apply]')?.addEventListener('click', () => apply(`${picked}T${JUMP_TIME}`));
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

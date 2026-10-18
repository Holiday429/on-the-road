/* ==========================================================================
   On the Road · Itinerary · plan-view renderers
   --------------------------------------------------------------------------
   Pure string-builders for the five plan views (board / category / feed /
   calendar / map) plus the day-derivation and item helpers they share. None
   of these read module state — the calendar view takes its month offset as a
   parameter — so they live cleanly outside itinerary.ts.
   ========================================================================== */

import { escHtml as esc } from '../../core/utils.ts';
import { t as tr } from '../../core/i18n.ts';
import { daysBetween, fmtDate, dayColour } from './itinerary-utils.ts';
import { geocodeLocal } from '../map/geocode.ts';
import { allCategories, categoryById, type Leg } from './itinerary-shared.ts';
import type { PlanItem, PlanDay } from '../../data/schema.ts';
import { dayLoad } from './itinerary-plan-parse.ts';
import { todayIso } from '../../data/trip-phase.ts';

export function ensurePlanDays(leg: Leg): PlanDay[] {
  const total = daysBetween(leg.dateFrom, leg.dateTo);
  const existing = [...(leg.planDays ?? [])].sort((a, b) => a.order - b.order);

  // Build expected day list from leg dates
  const pad = (n: number) => String(n).padStart(2, '0');
  const expected: PlanDay[] = Array.from({ length: total }, (_, i) => {
    const d = new Date(leg.dateFrom + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const found = existing.find(e => e.date === iso);
    return found ?? { id: `day-${iso}`, date: iso, label: '', notes: '', order: i };
  });
  return expected;
}

/** One plan item as a paper ticket: a punch strip on the left (tap to punch = done),
 *  a category-coloured band, the title, and "≈3H · €18" underneath. `drag: false`
 *  drops the drag hook in views that have no drop zone. */
export function renderPlanItem(p: PlanItem, leg: Leg, o: { drag?: boolean } = {}): string {
  const cat = p.category ? categoryById(leg, p.category) : undefined;
  const color = cat?.color ?? 'var(--surface-3)';
  const meta = [p.duration ? `≈${esc(p.duration.toUpperCase())}` : '', p.cost ? esc(p.cost) : ''].filter(Boolean).join('  ·  ');
  const hint = [cat?.label, p.note].filter(Boolean).join(' · ');
  const name = esc(p.title);
  return `
    <div class="rd-plan-tag${p.done ? ' is-done' : ''}" data-id="${esc(p.id)}"${o.drag === false ? '' : ' data-drag="plan-item"'} style="--pt-cat:${esc(color)}"${hint ? ` title="${esc(hint)}"` : ''}>
      <button class="rd-plan-tag-check rd-pt-punch" data-act="toggle-plan" data-plan="${esc(p.id)}" aria-pressed="${p.done}" aria-label="${esc(tr(p.done ? 'route.planUnpunch' : 'route.planPunch', { title: p.title }))}"><span class="rd-pt-hole"></span></button>
      <div class="rd-pt-main">
        <span class="rd-pt-band">${esc(cat?.label ?? tr('route.planNoCategory'))}</span>
        <span class="rd-plan-tag-name rd-pt-title">${name}</span>
        ${meta ? `<span class="rd-pt-meta">${meta}</span>` : ''}
        <span class="rd-pt-tools">
          <button class="rd-plan-tag-open" data-act="open-plan" data-plan="${esc(p.id)}" title="${esc(tr('route.planDetails'))}">›</button>
          <button class="rd-plan-tag-del" data-act="del-plan" data-plan="${esc(p.id)}" title="${esc(tr('route.planDelete'))}">✕</button>
        </span>
        ${p.address || p.mapUrl ? '<span class="rd-pt-nav" aria-hidden="true">◉</span>' : ''}
        ${p.note ? '<span class="rd-pt-fold" aria-hidden="true"></span>' : ''}
      </div>
      ${p.done ? `<span class="rd-pt-checked" aria-hidden="true">${esc(tr('route.planChecked'))}</span>` : ''}
    </div>`;
}

/** The ticket machine: one line that reads "Tivoli 3h kr170", category chips, a print button. */
export function renderPlanMachine(leg: Leg, cat: string): string {
  const chips = allCategories(leg).map((c) =>
    `<button type="button" class="rd-pm-cat${c.id === cat ? ' is-active' : ''}" data-act="plan-cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === cat}" style="--pt-cat:${esc(c.color)}">${esc(c.label)}</button>`).join('');
  return `
    <div class="rd-pm">
      <div class="rd-pm-body">
        <div class="rd-pm-row">
          <span class="rd-pm-ico" aria-hidden="true">🎟</span>
          <input class="rd-pm-input" id="rd-plan-input" placeholder="${esc(tr('route.machinePlaceholder'))}" aria-label="${esc(tr('route.machineAria'))}" autocomplete="off">
          <button type="button" class="rd-pm-print" data-act="add-plan">${esc(tr('route.machinePrint'))}</button>
        </div>
        <div class="rd-pm-parse" id="rd-plan-parse" hidden></div>
        <div class="rd-pm-cats" role="group" aria-label="${esc(tr('route.categorySelect'))}">${chips}</div>
        <div id="rd-plan-add-details" class="rd-plan-add-details" hidden>
          <input class="input" id="rd-plan-note" placeholder="${esc(tr('route.planNoteLabel'))}">
        </div>
      </div>
      <div class="rd-pm-slot" aria-hidden="true">${esc(tr('route.machineSlot'))}</div>
    </div>`;
}

/** The days (a wrapping grid, never a sideways rail). Each is a heading over up to three plain
 *  lines — one per item, with the category as a dot — and what it costs, if known; the open day
 *  unfolds as a panel of tickets under the grid. There is no "hours planned": most items have no
 *  duration, so the total would only ever be wrong. */
export function renderPlanBoardView(leg: Leg, openDayId: string | null = null): string {
  const days = ensurePlanDays(leg);
  const plans = leg.plans ?? [];
  const today = todayIso();
  const byDay = (id: string) => plans.filter((p) => p.dayId === id).sort((a, b) => a.order - b.order);

  const envelope = (day: PlanDay, idx: number) => {
    const items = byDay(day.id);
    const load = dayLoad(items);
    const dow = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
    const spines = items.slice(0, 3).map((p) => {
      const c = p.category ? categoryById(leg, p.category)?.color : undefined;
      return `<span class="rd-env-spine${p.done ? ' is-done' : ''}" style="--pt-cat:${esc(c ?? 'var(--surface-3)')}"><i></i><span>${esc(p.title)}</span></span>`;
    }).join('');
    const open = openDayId === day.id;
    return `
      <div class="rd-plan-drop-zone rd-env${open ? ' is-open' : ''}${day.date === today ? ' is-today' : ''}" data-day-id="${esc(day.id)}">
        <button type="button" class="rd-env-btn" data-act="toggle-day" data-day-id="${esc(day.id)}" aria-expanded="${open}"
          aria-label="${esc(tr('route.dayPrefix', { n: idx + 1 }))} ${esc(dow)}, ${items.length}">
          <span class="rd-env-head"><span class="rd-env-day">${esc(tr('route.dayPrefix', { n: idx + 1 }))}</span><span class="rd-env-date">${esc(dow)}</span></span>
          ${day.label ? `<span class="rd-plan-day-label">${esc(day.label)}</span>` : ''}
          ${items.length
            ? `<span class="rd-env-spines">${spines}${items.length > 3 ? `<span class="rd-env-more">+${items.length - 3}</span>` : ''}</span>`
            : `<span class="rd-env-empty">${esc(tr('route.dropHint'))}</span>`}
          ${load.cost ? `<span class="rd-env-foot">${esc(load.cost)}</span>` : ''}
        </button>
        ${items.length ? `<button class="rd-plan-day-nav" data-act="export-day" data-day-id="${esc(day.id)}" title="${esc(tr('export.navigateDay'))}" aria-label="${esc(tr('export.navigateDay'))}">↗</button>` : ''}
      </div>`;
  };

  const openIdx = days.findIndex((d) => d.id === openDayId);
  let panel = '';
  if (openIdx >= 0) {
    const day = days[openIdx];
    const items = byDay(day.id);
    const load = dayLoad(items);
    const dow = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
    panel = `
      <div class="rd-env-panel rd-plan-drop-zone" data-day-id="${esc(day.id)}">
        <div class="rd-env-panel-head">
          <span class="rd-env-day">${esc(tr('route.dayPrefix', { n: openIdx + 1 }))} · ${esc(dow)}</span>
          ${load.cost ? `<span class="rd-env-panel-meta">${esc(load.cost)}</span>` : ''}
          <button type="button" class="rd-env-close" data-act="close-day">${esc(tr('route.closeDay'))}</button>
        </div>
        <div class="rd-env-tickets">
          ${items.map((p) => renderPlanItem(p, leg)).join('')}
          ${items.length ? '' : `<div class="rd-plan-drop-hint">${esc(tr('route.emptyDayHint'))}</div>`}
        </div>
      </div>`;
  }

  return `
    <div class="rd-plan-board-wrap">
      <div class="rd-env-grid">${days.map(envelope).join('')}</div>
      ${panel}
    </div>
    <div id="rd-plan-drag-ghost" class="rd-plan-drag-ghost" hidden></div>`;
}

export function renderPlanCategoryView(leg: Leg): string {
  const plans = leg.plans ?? [];
  if (!plans.length) return `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.planCategoryEmpty')}</span></div>`;

  const cats = allCategories(leg);
  const groups = cats.map(cat => {
    const items = plans.filter(p => (p.category || 'other') === cat.id).sort((a, b) => a.order - b.order);
    if (!items.length) return '';
    return `
      <div class="rd-plan-cat-group">
        <div class="rd-plan-cat-head">
          <span class="rd-cat-badge" style="--cat:${esc(cat.color)}">${esc(cat.label)}</span>
          <span class="rd-plan-cat-count">${items.length}</span>
        </div>
        <div class="rd-plan-cat-rows">
          ${items.map(p => renderPlanItem(p, leg, { drag: false })).join('')}
        </div>
      </div>`;
  }).join('');

  return `<div class="rd-plan-cat-list">${groups || `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.noItemsYet')}</span></div>`}</div>`;
}

export function renderPlanFeedView(leg: Leg): string {
  const plans = leg.plans ?? [];
  const days = ensurePlanDays(leg);
  const today = todayIso();

  if (!plans.some(p => p.dayId)) {
    return `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.feedEmpty')}</span></div>`;
  }

  // Days in order. Unscheduled tickets are NOT listed here — they already have a
  // home in the Unassigned column on the right, and repeating them made the feed
  // read as two lists of the same thing.
  const assigned: { day: PlanDay; items: typeof plans }[] = days
    .map(day => ({ day, items: plans.filter(p => p.dayId === day.id).sort((a, b) => a.order - b.order) }))
    .filter(g => g.items.length > 0);

  function dayStatus(date: string): 'active' | 'past' | 'upcoming' {
    if (date === today) return 'active';
    if (date < today) return 'past';
    return 'upcoming';
  }

  const feedItem = (p: PlanItem, status: 'active' | 'past' | 'upcoming') => `
      <div class="rd-feed-item rd-feed-item--${status}" data-plan="${esc(p.id)}">
        <div class="rd-feed-item-dot" style="background:${p.done ? 'var(--ink-faint)' : status === 'active' ? 'var(--route-active)' : status === 'past' ? 'var(--route-past)' : 'var(--route-upcoming)'}"></div>
        <div class="rd-feed-item-body">${renderPlanItem(p, leg, { drag: false })}</div>
      </div>`;

  const dayGroups = assigned.map(({ day, items }) => {
    const status = dayStatus(day.date);
    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    const dayIdx = days.findIndex(d => d.id === day.id);
    return `
      <div class="rd-feed-day-group rd-feed-day--${status}">
        <div class="rd-feed-day-head">
          <span class="rd-feed-day-dot" style="background:${status === 'active' ? 'var(--route-active)' : status === 'past' ? 'var(--route-past)' : 'var(--route-upcoming)'}"></span>
          <span class="rd-feed-day-label">${tr('route.dayPrefix', { n: dayIdx + 1 })}${status === 'active' ? ' · Today' : ''}</span>
          <span class="rd-feed-day-date">${dateLabel}</span>
          ${day.label ? `<span class="rd-plan-day-label">${esc(day.label)}</span>` : ''}
        </div>
        <div class="rd-feed-items">
          ${items.map(p => feedItem(p, status)).join('')}
        </div>
      </div>`;
  }).join('');

  return `<div class="rd-feed-list">${dayGroups}</div>`;
}

/** Stored on the section so prev/next buttons can navigate without full re-render. */

export function renderPlanCalendarView(leg: Leg, calMonth: number): string {
  const plans = leg.plans ?? [];
  const planDays = ensurePlanDays(leg);
  const today = new Date().toISOString().slice(0, 10);

  // Determine the displayed month
  const legStart = new Date(leg.dateFrom + 'T00:00:00');
  const displayDate = new Date(legStart.getFullYear(), legStart.getMonth() + calMonth, 1);
  const year = displayDate.getFullYear();
  const month = displayDate.getMonth(); // 0-based

  const monthLabel = displayDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Day-of-week offset (Mon=0 … Sun=6)
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Set of ISO dates that belong to this leg
  const legDates = new Set(planDays.map(d => d.date));

  // Build calendar cells
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  let cells = '';
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      // padding cell
      const adjDate = dayNum < 1
        ? new Date(year, month, dayNum).toISOString().slice(0, 10)
        : new Date(year, month + 1, dayNum - daysInMonth).toISOString().slice(0, 10);
      cells += `<div class="rd-cal-grid-cell rd-cal-grid-cell--other"><span class="rd-cal-grid-num">${new Date(adjDate + 'T00:00:00').getDate()}</span></div>`;
      continue;
    }
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const isToday = iso === today;
    const inLeg = legDates.has(iso);
    const planDay = planDays.find(d => d.date === iso);
    const items = planDay ? plans.filter(p => p.dayId === planDay.id).sort((a, b) => a.order - b.order) : [];

    cells += `
      <div class="rd-cal-grid-cell${isToday ? ' is-today' : ''}${inLeg ? ' in-leg' : ''}">
        <span class="rd-cal-grid-num${isToday ? ' is-today-num' : ''}">${dayNum}</span>
        ${items.slice(0, 3).map(p => {
          const cat = p.category ? categoryById(leg, p.category) : undefined;
          const color = cat?.color ?? '#f0f0f0';
          return `<div class="rd-cal-grid-item ${p.done ? 'is-done' : ''}" data-plan="${esc(p.id)}" data-act="open-plan" style="--cat:${esc(color)}" title="${esc(p.title)}">${esc(p.title)}</div>`;
        }).join('')}
        ${items.length > 3 ? `<div class="rd-cal-grid-more">+${items.length - 3} more</div>` : ''}
      </div>`;
  }

  const DOW_HEADERS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

  return `
    <div class="rd-cal-grid-wrap">
      <div class="rd-cal-grid-nav">
        <button class="rd-icon-btn" data-act="cal-prev">‹</button>
        <span class="rd-cal-grid-month">${monthLabel}</span>
        <button class="rd-icon-btn" data-act="cal-next">›</button>
      </div>
      <div class="rd-cal-grid">
        ${DOW_HEADERS.map(d => `<div class="rd-cal-grid-dow">${d}</div>`).join('')}
        ${cells}
      </div>
    </div>`;
}

// Palette: one colour per day index (cycles after 14). Each entry is [bg, text].
/** Render the plan map sidebar item list (synchronous — uses cached coords). */
export function renderPlanMapView(leg: Leg): string {
  const plans = leg.plans ?? [];
  const days = ensurePlanDays(leg);

  const itemRow = (p: PlanItem, colour: string) => {
    const hasCoords = p.lat != null || geocodeLocal(p.address || p.title) != null;
    return `
      <div class="rd-pmap-item${hasCoords ? '' : ' rd-pmap-item--pending'}" data-pmap-item="${esc(p.id)}" style="--day-colour:${colour}">
        <span class="rd-pmap-item-dot" style="background:${hasCoords ? colour : 'var(--ink-faint)'}"></span>
        <span class="rd-pmap-item-name">${esc(p.title)}</span>
        ${p.address ? `<span class="rd-pmap-item-addr">${esc(p.address)}</span>` : ''}
        ${!hasCoords ? `<span class="rd-pmap-item-locating">${tr('route.locating')}</span>` : ''}
      </div>`;
  };

  // Build sidebar legend rows grouped by day — show ALL items, not just geocoded ones
  const dayRows = days.map((day, i) => {
    const items = plans.filter(p => p.dayId === day.id);
    if (!items.length) return '';
    const colour = dayColour(i);
    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `
      <div class="rd-pmap-day-group">
        <div class="rd-pmap-day-head">
          <span class="rd-pmap-day-dot" style="background:${colour}"></span>
          <span class="rd-pmap-day-label">${tr('route.dayPrefix', { n: i + 1 })}</span>
          <span class="rd-pmap-day-date">${dateLabel}</span>
        </div>
        ${items.map(p => itemRow(p, colour)).join('')}
      </div>`;
  }).join('');

  const unassigned = plans.filter(p => !p.dayId);
  const unassignedRows = unassigned.length ? `
    <div class="rd-pmap-day-group">
      <div class="rd-pmap-day-head">
        <span class="rd-pmap-day-dot" style="background:var(--ink-faint)"></span>
        <span class="rd-pmap-day-label">${tr('route.unassigned')}</span>
      </div>
      ${unassigned.map(p => itemRow(p, 'var(--ink-faint)')).join('')}
    </div>` : '';

  const hasAny = plans.length > 0;
  const hint = !hasAny
    ? `<div class="rd-placeholder rd-placeholder-soft" style="margin-top:var(--sp-3)"><span>${tr('route.planMapEmpty')}</span></div>`
    : '';

  return `
    <div class="rd-plan-map-layout">
      <div class="rd-plan-map-tile" id="rd-plan-leaflet" data-leg-id="${esc(leg.id)}"></div>
      <aside class="rd-plan-map-panel">
        <div class="rd-pmap-header">
          <span class="rd-plan-map-flag">${leg.flag || '🗺️'}</span>
          <div>
            <div class="rd-plan-map-city-name">${esc(leg.city)}</div>
            <div class="rd-plan-map-city-meta">${fmtDate(leg.dateFrom)} → ${fmtDate(leg.dateTo)}</div>
          </div>
        </div>
        <div class="rd-pmap-list">
          ${dayRows}${unassignedRows}${hint}
        </div>
      </aside>
    </div>`;
}

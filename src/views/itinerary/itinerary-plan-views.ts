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

export function renderPlanItem(p: PlanItem, leg: Leg): string {
  const cat = p.category ? categoryById(leg, p.category) : undefined;
  const color = cat?.color ?? '#ebebeb';
  const tooltipParts = [cat?.label, p.note, p.duration, p.cost].filter(Boolean);
  const tooltip = tooltipParts.join(' · ');
  return `
    <div class="rd-plan-tag ${p.done ? 'is-done' : ''}" data-id="${esc(p.id)}" data-drag="plan-item" style="background:${esc(color)}"${tooltip ? ` data-tooltip="${esc(tooltip)}"` : ''}>
      <button class="rd-plan-tag-check" data-act="toggle-plan" data-plan="${esc(p.id)}" title="Mark done">
        ${p.done ? '✓' : ''}
      </button>
      <span class="rd-plan-tag-name">${esc(p.title)}</span>
      <button class="rd-plan-tag-open" data-act="open-plan" data-plan="${esc(p.id)}" title="Details">›</button>
      <button class="rd-plan-tag-del" data-act="del-plan" data-plan="${esc(p.id)}" title="Delete">✕</button>
    </div>`;
}

export function renderPlanBoardView(leg: Leg): string {
  const days = ensurePlanDays(leg);
  const plans = leg.plans ?? [];

  const dayCol = (day: PlanDay, idx: number) => {
    const items = plans.filter(p => p.dayId === day.id).sort((a, b) => a.order - b.order);
    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `
      <div class="rd-plan-day-col">
        <div class="rd-plan-day-head">
          <span class="rd-plan-day-num">${tr('route.dayPrefix', { n: idx + 1 })}</span>
          <span class="rd-plan-day-date">${dateLabel}</span>
          ${day.label ? `<span class="rd-plan-day-label">${esc(day.label)}</span>` : ''}
        </div>
        <div class="rd-plan-drop-zone pk-drop-zone" data-day-id="${esc(day.id)}">
          ${items.map(p => renderPlanItem(p, leg)).join('')}
          ${items.length === 0 ? `<div class="rd-plan-drop-hint">${tr('route.dropHint')}</div>` : ''}
        </div>
      </div>`;
  };

  return `
    <div class="rd-plan-board-wrap">
      <div class="rd-plan-columns">
        ${days.map((d, i) => dayCol(d, i)).join('')}
      </div>
    </div>
    <div id="rd-plan-drag-ghost" class="rd-plan-drag-ghost" hidden></div>`;
}

export function renderPlanCategoryView(leg: Leg): string {
  const plans = leg.plans ?? [];
  if (!plans.length) return `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.planCategoryEmpty')}</span></div>`;

  const days = ensurePlanDays(leg);
  const dayLabel = (dayId: string | null | undefined) => {
    if (!dayId) return tr('route.unassigned');
    const idx = days.findIndex(d => d.id === dayId);
    return idx >= 0 ? tr('route.dayPrefix', { n: idx + 1 }) : tr('route.unassigned');
  };

  const cats = allCategories(leg);
  const groups = cats.map(cat => {
    const items = plans.filter(p => (p.category || 'other') === cat.id).sort((a, b) => a.order - b.order);
    if (!items.length) return '';
    return `
      <div class="rd-plan-cat-group">
        <div class="rd-plan-cat-head">
          <span class="rd-cat-badge" style="background:${esc(cat.color)}">${esc(cat.label)}</span>
          <span class="rd-plan-cat-count">${items.length}</span>
        </div>
        <div class="rd-plan-cat-rows">
          ${items.map(p => `
            <div class="rd-plan-cat-row ${p.done ? 'is-done' : ''}" data-plan="${esc(p.id)}">
              <button class="rd-plan-tag-check" data-act="toggle-plan" data-plan="${esc(p.id)}">${p.done ? '✓' : ''}</button>
              <span class="rd-plan-cat-title">${esc(p.title)}</span>
              <span class="rd-plan-cat-day">${dayLabel(p.dayId)}</span>
              <button class="rd-icon-btn rd-sm" data-act="open-plan" data-plan="${esc(p.id)}">›</button>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');

  return `<div class="rd-plan-cat-list">${groups || `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.noItemsYet')}</span></div>`}</div>`;
}

export function renderPlanFeedView(leg: Leg): string {
  const plans = leg.plans ?? [];
  const days = ensurePlanDays(leg);
  const today = new Date().toISOString().slice(0, 10);

  if (!plans.length) {
    return `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.feedEmpty')}</span></div>`;
  }

  // Group by day in chronological order; unassigned appended at end
  const assigned: { day: PlanDay; items: typeof plans }[] = days
    .map(day => ({ day, items: plans.filter(p => p.dayId === day.id).sort((a, b) => a.order - b.order) }))
    .filter(g => g.items.length > 0);

  const unassigned = plans.filter(p => !p.dayId).sort((a, b) => a.order - b.order);

  function dayStatus(date: string): 'active' | 'past' | 'upcoming' {
    if (date === today) return 'active';
    if (date < today) return 'past';
    return 'upcoming';
  }

  const feedItem = (p: PlanItem, status: 'active' | 'past' | 'upcoming') => {
    const cat = p.category ? categoryById(leg, p.category) : undefined;
    const color = cat?.color ?? '#ebebeb';
    return `
      <div class="rd-feed-item ${p.done ? 'is-done' : ''} rd-feed-item--${status}" data-plan="${esc(p.id)}">
        <div class="rd-feed-item-dot" style="background:${p.done ? 'var(--ink-faint)' : status === 'active' ? 'var(--route-active)' : status === 'past' ? 'var(--route-past)' : 'var(--route-upcoming)'}"></div>
        <div class="rd-feed-item-body">
          <div class="rd-feed-item-row">
            <button class="rd-plan-tag-check ${p.done ? 'is-done' : ''}" data-act="toggle-plan" data-plan="${esc(p.id)}">${p.done ? '✓' : ''}</button>
            ${cat ? `<span class="rd-cat-badge rd-cat-badge--sm" style="background:${esc(color)}">${esc(cat.label)}</span>` : ''}
            <span class="rd-feed-item-title">${esc(p.title)}</span>
            <button class="rd-icon-btn" data-act="open-plan" data-plan="${esc(p.id)}">›</button>
          </div>
          ${p.note ? `<div class="rd-feed-item-note">${esc(p.note)}</div>` : ''}
        </div>
      </div>`;
  };

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

  const unassignedGroup = unassigned.length ? `
    <div class="rd-feed-day-group rd-feed-day--unassigned">
      <div class="rd-feed-day-head">
        <span class="rd-feed-day-dot" style="background:var(--ink-faint)"></span>
        <span class="rd-feed-day-label">${tr('route.unassigned')}</span>
        <span class="rd-feed-day-date">${tr('route.notYetScheduled')}</span>
      </div>
      <div class="rd-feed-items">
        ${unassigned.map(p => feedItem(p, 'upcoming')).join('')}
      </div>
    </div>` : '';

  return `<div class="rd-feed-list">${dayGroups}${unassignedGroup}</div>`;
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
          return `<div class="rd-cal-grid-item ${p.done ? 'is-done' : ''}" data-plan="${esc(p.id)}" data-act="open-plan" style="background:${esc(color)}" title="${esc(p.title)}">${esc(p.title)}</div>`;
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

/* ==========================================================================
   On the Road · Trip popover — trip switcher menu + calendar hover tooltip
   ========================================================================== */

import { currentTrip, listTrips, switchTrip, type StoredTrip } from '../data/trip-context.ts';
import { routeStore, type StoredLeg } from '../data/stores/route-store.ts';
import { escHtml as escapeHtml } from './utils.ts';
import { t } from './i18n.ts';
import { openNewTripModal, openRenameTripModal, openDeleteTripModal, openLeaveTripModal } from './trip-modals.ts';

// Injected by app.ts to avoid a circular import.
export interface TripPopoverHost {
  currentUserId(): string | undefined;
  buildSidebar(): void;
  getTripMenuOpen(): boolean;
  setTripMenuOpen(open: boolean): void;
}
let host: TripPopoverHost | null = null;
export function initTripPopover(h: TripPopoverHost): void {
  host = h;
}

// Trips loaded for the switcher (refreshed on open / after create).
let tripList: StoredTrip[] = [];
export function getTripList(): StoredTrip[] { return tripList; }
export function setTripList(trips: StoredTrip[]): void { tripList = trips; }

// ── Trip popover (floating panel rendered into <body>) ────────────────────────
// `anchor` is the element to position the panel against. Defaults to the sidebar
// trip pill; the mobile dashboard banner passes its own anchor so the same menu
// works when the sidebar is hidden (PWA / phone).
export function openTripPopover(anchor?: HTMLElement | null) {
  closeTripPopover();

  const pill = anchor ?? document.getElementById('trip-pill');
  const rect = pill?.getBoundingClientRect();

  const backdrop = document.createElement('div');
  backdrop.id = 'trip-popover-backdrop';
  backdrop.addEventListener('click', () => { host!.setTripMenuOpen(false); closeTripPopover(); host!.buildSidebar(); });

  const panel = document.createElement('div');
  panel.id = 'trip-popover';
  panel.setAttribute('role', 'menu');

  // Position below the anchor, clamped so the 280px panel stays on-screen.
  // Prefer dropping below; if that would overflow the viewport bottom (e.g. a
  // banner low on a short landscape screen), flip above the anchor instead.
  if (rect) {
    const PANEL_W = 280;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - PANEL_W - 8);
    const below = rect.bottom + 8;
    const flipUp = below + 320 > window.innerHeight && rect.top > window.innerHeight / 2;
    panel.style.left = `${left}px`;
    if (flipUp) {
      panel.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    } else {
      panel.style.top = `${below}px`;
    }
  }

  const activeId = currentTrip()?.id;
  const myUid = host!.currentUserId();
  const rows = tripList.map((t) => {
    // Owner-only trips show edit + delete; trips shared with me as a
    // collaborator show "leave" instead of delete (I can't delete someone
    // else's trip). A trip with no members map is a legacy owner trip.
    const amOwner = !t.members || !myUid || t.members[myUid] === 'owner';
    return `
    <div class="trip-menu-row" data-trip-id="${escapeHtml(t.id)}">
      <button class="trip-menu-item${t.id === activeId ? ' is-active' : ''}" data-trip-id="${escapeHtml(t.id)}">
        <span class="trip-menu-dot" style="background:${escapeHtml(t.coverColor || '#f9b830')}"></span>
        <span class="trip-menu-name">${escapeHtml(t.name)}</span>
        ${t.id === activeId ? '<span class="trip-menu-check">✓</span>' : ''}
      </button>
      <button class="trip-menu-share" data-trip-id="${escapeHtml(t.id)}" title="Share trip" aria-label="Share ${escapeHtml(t.name)}">👥</button>
      ${amOwner ? `
        <button class="trip-menu-edit" data-trip-id="${escapeHtml(t.id)}" title="Rename trip" aria-label="Rename ${escapeHtml(t.name)}">✎</button>
        <button class="trip-menu-delete" data-trip-id="${escapeHtml(t.id)}" title="Delete trip" aria-label="Delete ${escapeHtml(t.name)}">🗑</button>
      ` : `
        <button class="trip-menu-leave" data-trip-id="${escapeHtml(t.id)}" title="Leave trip" aria-label="Leave ${escapeHtml(t.name)}">🚪</button>
      `}
    </div>`;
  }).join('');

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  panel.innerHTML = `
    <div class="trip-popover-header">${t('app.title')}</div>
    ${rows || `<div class="trip-menu-empty">${t('app.tripMenuEmpty')}</div>`}
    <button class="trip-menu-new" id="trip-menu-new">${t('common.newTrip')}</button>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  panel.querySelectorAll<HTMLElement>('.trip-menu-item').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripId!;
      const trip = tripList.find((t) => t.id === id);
      host!.setTripMenuOpen(false);
      closeTripPopover();
      await switchTrip(id);
      if (trip) {
        import('./trip-chooser.ts').then(({ showTripToast }) => showTripToast(trip.name));
      }
    });
  });

  panel.querySelectorAll<HTMLElement>('.trip-menu-share').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripId!;
      host!.setTripMenuOpen(false);
      closeTripPopover();
      host!.buildSidebar();
      import('./trip-share.ts').then(({ openShareModal }) => openShareModal(id));
    });
  });

  panel.querySelectorAll<HTMLElement>('.trip-menu-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripId!;
      const trip = tripList.find(t => t.id === id);
      if (!trip) return;
      host!.setTripMenuOpen(false);
      closeTripPopover();
      host!.buildSidebar();
      openRenameTripModal(trip);
    });
  });

  panel.querySelectorAll<HTMLElement>('.trip-menu-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripId!;
      const trip = tripList.find(t => t.id === id);
      if (!trip) return;
      host!.setTripMenuOpen(false);
      closeTripPopover();
      host!.buildSidebar();
      openDeleteTripModal(trip);
    });
  });

  panel.querySelectorAll<HTMLElement>('.trip-menu-leave').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripId!;
      const trip = tripList.find(t => t.id === id);
      if (!trip) return;
      host!.setTripMenuOpen(false);
      closeTripPopover();
      host!.buildSidebar();
      void openLeaveTripModal(trip);
    });
  });

  panel.querySelector<HTMLElement>('#trip-menu-new')?.addEventListener('click', (e) => {
    e.stopPropagation();
    host!.setTripMenuOpen(false);
    closeTripPopover();
    openNewTripModal();
  });
}

export function closeTripPopover() {
  document.getElementById('trip-popover-backdrop')?.remove();
  document.getElementById('trip-popover')?.remove();
}

/** Open the trip switcher / share menu anchored to an arbitrary element.
   Used by the mobile dashboard banner so trip switching + sharing stay
   reachable when the sidebar (which hosts the pill) is hidden in the PWA. */
export function openTripSwitcher(anchor: HTMLElement) {
  if (!currentTrip()) { openNewTripModal(); return; }
  if (host!.getTripMenuOpen()) { host!.setTripMenuOpen(false); closeTripPopover(); return; }
  host!.setTripMenuOpen(true);
  openTripPopover(anchor);
  listTrips()
    .then((trips) => {
      tripList = trips;
      if (host!.getTripMenuOpen() && document.getElementById('trip-popover')) openTripPopover(anchor);
    })
    .catch((e) => console.warn('listTrips failed:', e));
}

/* ── Trip calendar hover tooltip ────────────────────────────────────────── */

let calHoverTimer: ReturnType<typeof setTimeout> | null = null;

export function wireTripCalendarHover(pill: HTMLElement | null) {
  if (!pill) return;

  pill.addEventListener('mouseenter', () => {
    if (host!.getTripMenuOpen()) return;
    calHoverTimer = setTimeout(() => {
      if (!host!.getTripMenuOpen()) openCalendarTooltip(pill);
    }, 220);
  });
  pill.addEventListener('mouseleave', (e) => {
    if (calHoverTimer) { clearTimeout(calHoverTimer); calHoverTimer = null; }
    const related = e.relatedTarget as Node | null;
    const tooltip = document.getElementById('trip-cal-tooltip');
    if (tooltip && !tooltip.contains(related)) closeCalendarTooltip();
  });
}

export function closeCalendarTooltip() {
  document.getElementById('trip-cal-tooltip')?.remove();
}

/** Clears any pending hover timer — called before opening the action popover
   so a stale hover doesn't fire the tooltip on top of it. */
export function cancelCalendarHover(): void {
  if (calHoverTimer) { clearTimeout(calHoverTimer); calHoverTimer = null; }
}

function openCalendarTooltip(pill: HTMLElement) {
  closeCalendarTooltip();
  const trip = currentTrip();
  if (!trip) return;

  const legs = routeStore.peek().sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const startDate = trip.startDate;
  const endDate = trip.endDate;
  if (!startDate) return;

  const tooltip = document.createElement('div');
  tooltip.id = 'trip-cal-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  tooltip.innerHTML = buildCalendarHTML(startDate, endDate ?? null, legs);

  document.body.appendChild(tooltip);

  // Position to the right of the pill
  const rect = pill.getBoundingClientRect();
  const TW = 272;
  const left = rect.right + 10;
  const clampedLeft = Math.min(left, window.innerWidth - TW - 8);
  tooltip.style.top  = `${rect.top}px`;
  tooltip.style.left = `${clampedLeft}px`;

  tooltip.addEventListener('mouseenter', () => {
    if (calHoverTimer) { clearTimeout(calHoverTimer); calHoverTimer = null; }
  });
  tooltip.addEventListener('mouseleave', () => closeCalendarTooltip());
}

function buildCalendarHTML(startDate: string, endDate: string | null, legs: StoredLeg[]): string {
  // Build a map: ISO-date → list of plan item titles
  const dayItems = new Map<string, string[]>();
  const legByDate = new Map<string, StoredLeg>();

  for (const leg of legs) {
    const from = new Date(`${leg.dateFrom}T00:00:00`);
    const to   = new Date(`${leg.dateTo}T00:00:00`);
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      legByDate.set(iso, leg);
    }
    if (leg.planDays) {
      for (const pd of leg.planDays) {
        const items = (leg.plans ?? []).filter(p => p.dayId === pd.id && p.title);
        if (items.length) dayItems.set(pd.date, items.map(p => p.title));
      }
    }
  }

  // Collect all months to render
  const tripStart = new Date(`${startDate}T00:00:00`);
  const tripEnd   = endDate ? new Date(`${endDate}T00:00:00`) : (() => {
    const last = legs.at(-1);
    return last ? new Date(`${last.dateTo}T00:00:00`) : tripStart;
  })();
  const today = new Date(); today.setHours(0,0,0,0);

  const months: { year: number; month: number }[] = [];
  let cur = new Date(tripStart.getFullYear(), tripStart.getMonth(), 1);
  const lastMonth = new Date(tripEnd.getFullYear(), tripEnd.getMonth(), 1);
  while (cur <= lastMonth) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  const MON = ['Mo','Tu','We','Th','Fr','Sa','Su'];
  const MNAME = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const blocks = months.map(({ year, month }) => {
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    // Monday-start offset
    const offset = (firstDay.getDay() + 6) % 7;

    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<span class="tcc-empty"></span>';

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const date = new Date(year, month, d);
      const isStart  = iso === startDate;
      const isEnd    = endDate ? iso === endDate : false;
      const isToday  = date.getTime() === today.getTime();
      const inTrip   = date >= tripStart && date <= tripEnd;
      const leg      = legByDate.get(iso);
      const items    = dayItems.get(iso) ?? [];

      let cls = 'tcc-day';
      if (isStart)      cls += ' tcc-start';
      else if (isEnd)   cls += ' tcc-end';
      else if (inTrip && leg) cls += ' tcc-in-trip';
      if (isToday)      cls += ' tcc-today';

      const tipItems = items.length
        ? `<ul class="tcc-tip-list">${items.slice(0,4).map(t => `<li>${escapeHtml(t)}</li>`).join('')}${items.length > 4 ? `<li>+${items.length-4} more</li>` : ''}</ul>`
        : leg ? `<div class="tcc-tip-city">${escapeHtml(leg.city)}</div>` : '';

      const badge = isStart ? '✈' : isEnd ? '🏠' : isToday ? '●' : String(d);

      cells += `<span class="${cls}" data-date="${iso}">
        ${badge}
        ${tipItems ? `<span class="tcc-tip">${tipItems}</span>` : ''}
      </span>`;
    }

    return `
      <div class="tcc-month">
        <div class="tcc-month-name">${MNAME[month]} ${year}</div>
        <div class="tcc-grid">
          ${MON.map(m => `<span class="tcc-dow">${m}</span>`).join('')}
          ${cells}
        </div>
      </div>`;
  }).join('');

  const daysCount = Math.round((tripEnd.getTime() - tripStart.getTime()) / 86400000) + 1;
  return `
    <div class="tcc-header">
      <span class="tcc-trip-name">${escapeHtml(currentTrip()?.name ?? '')}</span>
      <span class="tcc-trip-len">${daysCount}d</span>
    </div>
    ${blocks}
  `;
}

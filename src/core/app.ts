/* ==========================================================================
   On the Road · App Shell & Router
   ========================================================================== */

import type { User } from '../firebase/auth.ts';
import {
  currentTrip, currentTripId, listTrips, createTrip, switchTrip, onTripChange,
  updateTrip, removeTrip,
  type StoredTrip, type NewTripInput,
} from '../data/trip-context.ts';
import { TRAVEL_STYLES, type TravelStyle } from '../data/schema.ts';
import { createDestinationInput, type DestinationInputInstance } from './destination-input.ts';
import checklistIcon from '../../icon/Checklist.png';
import guideIcon from '../../icon/Guide.png';
import itineraryIcon from '../../icon/Itinerary.png';
import journalIcon from '../../icon/Journal.png';
import packIcon from '../../icon/Pack.png';
import paymentIcon from '../../icon/payment.png';
import profileIcon from '../../icon/profile.png';
import safetyIcon from '../../icon/Safety.png';
import stayIcon from '../../icon/stay.png';
import mapsIcon from '../../icon/maps.png';
import nomadIcon from '../../icon/Nomad.png';

export type ViewId = 'prep' | 'route' | 'expenses' | 'pack' | 'cities' | 'budget' | 'safety' | 'journal' | 'map' | 'nomad';

interface NavItem {
  id: ViewId;
  label: string;
  iconSrc: string;
  section: 'before' | 'during' | 'after';
}

const NAV_ITEMS: NavItem[] = [
  // Before
  { id: 'prep',     label: 'Checklist', iconSrc: checklistIcon, section: 'before' },
  { id: 'pack',     label: 'Pack',      iconSrc: packIcon,      section: 'before' },
  { id: 'budget',   label: 'Stay',      iconSrc: stayIcon,      section: 'before' },
  // During
  { id: 'route',    label: 'Itinerary', iconSrc: itineraryIcon, section: 'during' },
  { id: 'cities',   label: 'Guide',     iconSrc: guideIcon,     section: 'during' },
  { id: 'nomad',    label: 'Nomad',     iconSrc: nomadIcon,     section: 'during' },
  { id: 'safety',   label: 'Safety',    iconSrc: safetyIcon,    section: 'during' },
  // After
  { id: 'expenses', label: 'Expenses',  iconSrc: paymentIcon,   section: 'after'  },
  { id: 'map',      label: 'Map',       iconSrc: mapsIcon,      section: 'after'  },
  { id: 'journal',  label: 'Journal',   iconSrc: journalIcon,   section: 'after'  },
];

const SECTION_LABELS = { before: 'Before', during: 'On The Road', after: 'After' };

// Trips loaded for the switcher (refreshed on open / after create).
let tripList: StoredTrip[] = [];
let tripMenuOpen = false;

// ── Trip popover (floating panel rendered into <body>) ────────────────────────
function openTripPopover() {
  closeTripPopover();

  const pill = document.getElementById('trip-pill');
  const rect = pill?.getBoundingClientRect();

  const backdrop = document.createElement('div');
  backdrop.id = 'trip-popover-backdrop';
  backdrop.addEventListener('click', () => { tripMenuOpen = false; closeTripPopover(); buildSidebar(); });

  const panel = document.createElement('div');
  panel.id = 'trip-popover';
  panel.setAttribute('role', 'menu');

  // Position below pill, clamped so the 280px panel stays on-screen
  if (rect) {
    const PANEL_W = 280;
    const top  = rect.bottom + 8;
    const left = Math.min(rect.left, window.innerWidth - PANEL_W - 8);
    panel.style.top  = `${top}px`;
    panel.style.left = `${left}px`;
  }

  const activeId = currentTrip()?.id;
  const rows = tripList.map((t) => `
    <div class="trip-menu-row" data-trip-id="${escapeHtml(t.id)}">
      <button class="trip-menu-item${t.id === activeId ? ' is-active' : ''}" data-trip-id="${escapeHtml(t.id)}">
        <span class="trip-menu-dot" style="background:${escapeHtml(t.coverColor || '#f9b830')}"></span>
        <span class="trip-menu-name">${escapeHtml(t.name)}</span>
        ${t.id === activeId ? '<span class="trip-menu-check">✓</span>' : ''}
      </button>
      <button class="trip-menu-edit" data-trip-id="${escapeHtml(t.id)}" title="Rename trip" aria-label="Rename ${escapeHtml(t.name)}">✎</button>
      <button class="trip-menu-delete" data-trip-id="${escapeHtml(t.id)}" title="Delete trip" aria-label="Delete ${escapeHtml(t.name)}">🗑</button>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="trip-popover-header">My Trips</div>
    ${rows || '<div class="trip-menu-empty">No trips yet</div>'}
    <button class="trip-menu-new" id="trip-menu-new">+ New trip</button>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  panel.querySelectorAll<HTMLElement>('.trip-menu-item').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      tripMenuOpen = false;
      closeTripPopover();
      await switchTrip(btn.dataset.tripId!);
    });
  });

  panel.querySelectorAll<HTMLElement>('.trip-menu-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripId!;
      const trip = tripList.find(t => t.id === id);
      if (!trip) return;
      tripMenuOpen = false;
      closeTripPopover();
      buildSidebar();
      openRenameTripModal(trip);
    });
  });

  panel.querySelectorAll<HTMLElement>('.trip-menu-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripId!;
      const trip = tripList.find(t => t.id === id);
      if (!trip) return;
      tripMenuOpen = false;
      closeTripPopover();
      buildSidebar();
      openDeleteTripModal(trip);
    });
  });

  panel.querySelector<HTMLElement>('#trip-menu-new')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tripMenuOpen = false;
    closeTripPopover();
    openNewTripModal();
  });
}

function closeTripPopover() {
  document.getElementById('trip-popover-backdrop')?.remove();
  document.getElementById('trip-popover')?.remove();
}

// Each view registers an idempotent init fn. We keep the fn (never delete it)
// and track which views are currently mounted, so a trip switch can re-init
// the mounted ones — re-subscribing their stores under the new tripId.
let viewInits: Partial<Record<ViewId, () => void>> = {};
const mountedViews = new Set<ViewId>();
let sessionState: { user: User | null } = { user: null };
let sessionPrimaryAction: (() => void | Promise<void>) | null = null;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function initialsFor(user: User): string {
  const source = user.displayName?.trim() || user.email?.trim() || 'Traveler';
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'OT';
}

function primaryNameFor(user: User): string {
  const displayName = user.displayName?.trim();
  if (displayName) return displayName.split(/\s+/)[0] || displayName;
  const emailName = user.email?.split('@')[0]?.trim();
  return emailName || 'Traveler';
}

function renderNavIcon(item: NavItem): string {
  return `<img src="${item.iconSrc}" class="nav-icon-image" alt="" aria-hidden="true">`;
}

function buildSidebarHeader(): string {
  const { user } = sessionState;
  if (!user) {
    return `
      <div class="sidebar-header">
        <button type="button" class="sidebar-header-profile sidebar-auth-trigger" id="sidebar-auth-trigger">
          <div class="sidebar-profile-avatar">
            <img src="${profileIcon}" class="sidebar-profile-avatar-image" alt="" aria-hidden="true">
          </div>
          <div class="sidebar-profile-meta">
            <div class="sidebar-profile-title">On the Road</div>
            <div class="sidebar-profile-subtitle">Sign in with Google</div>
          </div>
        </button>
      </div>
    `;
  }

  const displayName = escapeHtml(primaryNameFor(user));
  const photo = user.photoURL?.trim();
  const avatar = photo
    ? `<img src="${escapeHtml(photo)}" alt="${displayName}" class="sidebar-profile-avatar-image">`
    : `<div class="sidebar-profile-avatar-fallback">${initialsFor(user)}</div>`;

  return `
    <div class="sidebar-header">
      <div class="sidebar-header-profile">
        <div class="sidebar-profile-avatar is-user">${avatar}</div>
        <div class="sidebar-profile-meta">
          <div class="sidebar-profile-title">${displayName}</div>
        </div>
      </div>
    </div>
  `;
}

function buildGuestPanel(): string {
  return '';
}

export function renderViewTitleMarkup(id: ViewId, title?: string): string {
  const item = NAV_ITEMS.find((navItem) => navItem.id === id)!;
  return `
    <span class="view-title-icon" aria-hidden="true">${renderNavIcon(item)}</span>
    <span>${escapeHtml(title?.trim() || item.label)}</span>
  `;
}

function decorateViewTitles() {
  NAV_ITEMS.forEach((item) => {
    const titleEl = document.querySelector<HTMLElement>(`#view-${item.id} .view-title`);
    if (!titleEl) return;
    const title = titleEl.dataset.title ?? titleEl.textContent?.trim() ?? item.label;
    titleEl.dataset.title = title;
    titleEl.innerHTML = renderViewTitleMarkup(item.id, title);
  });
}

export function registerView(id: ViewId, initFn: () => void) {
  viewInits[id] = initFn;
}

/**
 * Re-initialise the currently-active view after a trip switch. Mounted views'
 * init fns are idempotent (they clear prior store subscriptions, then
 * re-subscribe under the new tripId). Background views are simply dropped from
 * the mounted set so they re-init lazily next time they're opened.
 */
export function reinitForTripChange() {
  const active = (window.location.hash.replace('#', '') as ViewId) || undefined;
  for (const id of [...mountedViews]) {
    if (id === active && viewInits[id]) {
      viewInits[id]!();           // re-init now (visible) — re-subscribes
    } else {
      mountedViews.delete(id);    // re-init lazily on next open
    }
  }
}

export function navigateTo(id: ViewId) {
  // Hide all views
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));

  // Show target
  const el = document.getElementById(`view-${id}`);
  if (el) {
    el.classList.add('active');
    clearGuestStates();
    // Lazy init — run once per mount; init fns are idempotent so re-running
    // on a trip switch is safe.
    if (viewInits[id] && !mountedViews.has(id)) {
      viewInits[id]!();
      mountedViews.add(id);
    }
  }

  // Update nav highlight
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
    item.classList.toggle('active', (item as HTMLElement).dataset.view === id);
  });

  // Scroll active mobile tab into view
  const activeTab = document.querySelector<HTMLElement>(`.mobile-nav-item[data-view="${id}"]`);
  activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

  window.location.hash = id;
}

function clearGuestStates() {
  document.querySelectorAll('.view-guest-state').forEach((el) => el.remove());
}


function daysUntil(date: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

function buildTripPill(): string {
  const trip = currentTrip();
  const name = trip?.name ?? 'Loading…';
  const days = trip ? daysUntil(new Date(`${trip.startDate}T00:00:00`)) : null;

  // Collapsed badge: + if no trip, red countdown if pre-trip, green day-count if underway
  let compactBadge: string;
  let compactClass: string;
  if (days === null) {
    compactBadge = '+';
    compactClass = 'trip-pill-date--new';
  } else if (days > 0) {
    compactBadge = String(days);
    compactClass = 'trip-pill-date--pre';
  } else {
    compactBadge = String(Math.abs(days));
    compactClass = 'trip-pill-date--on';
  }

  const daysText = days === null
    ? ''
    : days > 0
    ? `Departing in <strong>${days} days</strong>`
    : days === 0
    ? `Departing <strong>today!</strong> 🎉`
    : `Trip started <strong>${Math.abs(days)} days</strong> ago`;

  return `
    <div class="trip-pill${tripMenuOpen ? ' is-open' : ''}" id="trip-pill" role="button" tabindex="0" aria-haspopup="true" aria-expanded="${tripMenuOpen}">
      <div class="trip-pill-label">Current Trip <span class="trip-pill-caret">▾</span></div>
      <div class="trip-pill-name">${escapeHtml(name)}</div>
      <div class="trip-pill-date ${compactClass}">${compactBadge}</div>
      <div class="trip-pill-days">${daysText}</div>
    </div>
  `;
}

function buildSidebar() {
  const sidebar = document.getElementById('sidebar')!;
  sidebar.innerHTML = `
    ${buildSidebarHeader()}
    ${sessionState.user ? buildTripPill() : buildGuestPanel()}
    <nav class="sidebar-nav" aria-label="Main navigation">
      ${buildNavSections('sidebar')}
    </nav>
  `;

  sidebar.querySelector<HTMLElement>('#sidebar-auth-trigger')?.addEventListener('click', () => {
    sessionPrimaryAction?.();
  });

  sidebar.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo((item as HTMLElement).dataset.view as ViewId));
  });

  if (sessionState.user) {
    wireTripSwitcher(sidebar);
  }
}

/** Wire the trip pill (open/close popover, switch trip, new-trip modal). */
function wireTripSwitcher(sidebar: HTMLElement) {
  const pill = sidebar.querySelector<HTMLElement>('#trip-pill');
  pill?.addEventListener('click', async () => {
    if (!currentTrip()) {
      openNewTripModal();
      return;
    }
    if (tripMenuOpen) {
      tripMenuOpen = false;
      closeTripPopover();
      buildSidebar();
      return;
    }
    tripMenuOpen = true;
    try { tripList = await listTrips(); } catch (e) { console.warn('listTrips failed:', e); }
    buildSidebar();
    openTripPopover();
  });
}

function buildMobileNav() {
  const mobileNav = document.getElementById('mobile-nav')!;
  mobileNav.innerHTML = `<div id="mobile-nav-inner">${NAV_ITEMS.map(item => {
    return `<div class="mobile-nav-item" data-view="${item.id}" role="button" tabindex="0">
      <span class="nav-icon" aria-hidden="true">${renderNavIcon(item)}</span>
      <span class="nav-label">${item.label.split(' ')[0]}</span>
    </div>`;
  }).join('')}</div>`;

  mobileNav.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo((item as HTMLElement).dataset.view as ViewId));
  });
}

function buildNavSections(_context: 'sidebar' | 'mobile'): string {
  const sections: ('before' | 'during' | 'after')[] = ['before', 'during', 'after'];
  return sections.map(section => {
    const items = NAV_ITEMS.filter(n => n.section === section);
    return `
      <div class="nav-section-label">${SECTION_LABELS[section]}</div>
      ${items.map(item => `
        <div class="nav-item" data-view="${item.id}" role="button" tabindex="0">
          <span class="nav-icon" aria-hidden="true">${renderNavIcon(item)}</span>
          <span class="nav-label">${item.label}</span>
        </div>
      `).join('')}
    `;
  }).join('');
}

export function renderSession(user: User | null, onPrimaryAction: () => void) {
  sessionState = { user };
  sessionPrimaryAction = onPrimaryAction;
  document.getElementById('app-topbar')!.innerHTML = '';
  buildSidebar();
  if (!user) {
    const hash = window.location.hash.replace('#', '') as ViewId;
    navigateTo(NAV_ITEMS.find((item) => item.id === hash) ? hash : 'prep');
  }
}

/* ── Rename / Delete trip modals ────────────────────────────────────────── */

function openRenameTripModal(trip: StoredTrip) {
  const backdrop = document.createElement('div');
  backdrop.className = 'trip-modal-backdrop';
  backdrop.innerHTML = `
    <div class="trip-modal" role="dialog" aria-modal="true" aria-label="Rename trip">
      <h3 class="trip-modal-title">Rename trip</h3>
      <label class="trip-modal-field">
        <span>Trip name</span>
        <input id="rt-name" class="input" value="${escapeHtml(trip.name)}" autocomplete="off">
      </label>
      <div class="trip-modal-actions">
        <button class="btn" id="rt-cancel">Cancel</button>
        <button class="btn btn-primary" id="rt-save">Save</button>
      </div>
      <div class="trip-modal-error" id="rt-error"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const nameInput = backdrop.querySelector<HTMLInputElement>('#rt-name')!;
  const errorEl = backdrop.querySelector<HTMLElement>('#rt-error')!;
  const close = () => backdrop.remove();

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#rt-cancel')!.addEventListener('click', close);

  nameInput.focus();
  nameInput.select();
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  async function save() {
    const name = nameInput.value.trim();
    if (!name) { errorEl.textContent = 'Name cannot be empty.'; return; }
    const btn = backdrop.querySelector<HTMLButtonElement>('#rt-save')!;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await updateTrip(trip.id, { name });
      tripList = await listTrips();
      close();
      buildSidebar();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Save';
      errorEl.textContent = e instanceof Error ? e.message : 'Could not rename trip.';
    }
  }

  backdrop.querySelector('#rt-save')!.addEventListener('click', save);
}

function openDeleteTripModal(trip: StoredTrip) {
  const backdrop = document.createElement('div');
  backdrop.className = 'trip-modal-backdrop';
  backdrop.innerHTML = `
    <div class="trip-modal" role="dialog" aria-modal="true" aria-label="Delete trip">
      <h3 class="trip-modal-title">Delete trip</h3>
      <p style="font-size:var(--fs-sm);color:var(--ink-2);margin:0 0 var(--sp-4)">
        Delete <strong>${escapeHtml(trip.name)}</strong>? The trip record will be removed.
        Your itinerary legs, journal entries, and other data are kept.
      </p>
      <div class="trip-modal-actions">
        <button class="btn" id="dt-cancel">Cancel</button>
        <button class="btn btn-danger" id="dt-confirm">Delete</button>
      </div>
      <div class="trip-modal-error" id="dt-error"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#dt-cancel')!.addEventListener('click', close);

  backdrop.querySelector('#dt-confirm')!.addEventListener('click', async () => {
    const btn = backdrop.querySelector<HTMLButtonElement>('#dt-confirm')!;
    const errorEl = backdrop.querySelector<HTMLElement>('#dt-error')!;
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      await removeTrip(trip.id);
      tripList = await listTrips();
      close();
      // If we just deleted the active trip, switch to the first remaining one
      // (or show onboarding if none left).
      if (currentTripId() === trip.id) {
        if (tripList.length > 0) {
          await switchTrip(tripList[0].id);
        } else {
          buildSidebar();
          openOnboarding();
        }
      } else {
        buildSidebar();
      }
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Delete';
      errorEl.textContent = e instanceof Error ? e.message : 'Could not delete trip.';
    }
  });
}

/* ── New-trip modal (shared builder) ────────────────────────────────────── */

const STYLE_LABELS: Record<TravelStyle, string> = {
  solo: 'Solo',
  couple: 'Couple',
  family: 'Family',
  friends: 'Friends',
  group: 'Group',
};

const COVER_COLORS = ['#f9b830', '#e07b54', '#5b9bd5', '#6abf69', '#9b7dd4', '#e05c7a'];

/**
 * Build and mount the full trip-creation form. Used both by the sidebar
 * "+ New trip" action and the first-run onboarding flow.
 *
 * @param opts.isOnboarding  Show welcome copy + hide Cancel button.
 * @param opts.onCreated     Called with the new trip id after creation.
 * @param opts.onCancel      Called when user dismisses (only shown when !isOnboarding).
 */
function openTripForm(opts: {
  onCreated: (id: string) => void;
  onCancel?: () => void;
}) {

  // State
  let selectedStyle: TravelStyle | null = null;
  let selectedColor = COVER_COLORS[0];
  let destPicker: DestinationInputInstance | null = null;

  const backdrop = document.createElement('div');
  backdrop.className = 'trip-modal-backdrop';

  function renderStylePills(): string {
    return TRAVEL_STYLES.map(s => `
      <button type="button" class="trip-style-btn${selectedStyle === s ? ' is-active' : ''}" data-style="${s}">
        ${STYLE_LABELS[s]}
      </button>
    `).join('');
  }

  function renderColorSwatches(): string {
    return COVER_COLORS.map(c => `
      <button type="button" class="trip-color-swatch${c === selectedColor ? ' is-active' : ''}"
        data-color="${c}" style="background:${c}" title="${c}"></button>
    `).join('');
  }

  function buildHtml(): string {
    return `
      <div class="trip-modal" role="dialog" aria-modal="true" aria-label="New trip">
        <h3 class="trip-modal-title">New trip</h3>

        <label class="trip-modal-field">
          <span>Trip name</span>
          <input id="nt-name" class="input" placeholder="e.g. Europe Summer 2026" autocomplete="off">
        </label>

        <div class="trip-modal-row">
          <label class="trip-modal-field">
            <span>Start date</span>
            <input id="nt-start" class="input" type="date">
          </label>
          <label class="trip-modal-field">
            <span>End date</span>
            <input id="nt-end" class="input" type="date">
          </label>
        </div>

        <label class="trip-modal-field">
          <span>Destinations <span style="font-weight:400;color:var(--ink-faint)">(optional)</span></span>
          <div id="nt-dest-mount"></div>
        </label>

        <label class="trip-modal-field">
          <span>Travelling as <span style="font-weight:400;color:var(--ink-faint)">(optional)</span></span>
          <div class="trip-style-group" id="nt-style-group">
            ${renderStylePills()}
          </div>
        </label>

        <div class="trip-modal-row">
          <label class="trip-modal-field">
            <span>Base currency</span>
            <input id="nt-currency" class="input" value="EUR" maxlength="3" style="text-transform:uppercase">
          </label>
          <label class="trip-modal-field">
            <span>Cover colour</span>
            <div class="trip-color-swatches" id="nt-colors">
              ${renderColorSwatches()}
            </div>
          </label>
        </div>

        <label class="trip-modal-field">
          <span>Notes <span style="font-weight:400;color:var(--ink-faint)">(optional)</span></span>
          <input id="nt-notes" class="input" placeholder="What's the vibe? Any goals for this trip?">
        </label>

        <div class="trip-modal-actions">
          <button class="btn" id="nt-cancel">Cancel</button>
          <button class="btn btn-primary" id="nt-create">Create trip</button>
        </div>
        <div class="trip-modal-error" id="nt-error"></div>
      </div>
    `;
  }

  function mount() {
    backdrop.innerHTML = buildHtml();
    document.body.appendChild(backdrop);
    // Mount destination picker into its slot
    const destMount = backdrop.querySelector<HTMLElement>('#nt-dest-mount');
    if (destMount) {
      destPicker = createDestinationInput({ container: destMount, placeholder: 'Search countries or cities…' });
    }
    backdrop.querySelector<HTMLInputElement>('#nt-name')?.focus();
    wireEvents();
  }

  function rerenderPart(selector: string, html: string) {
    const el = backdrop.querySelector<HTMLElement>(selector);
    if (el) el.innerHTML = html;
  }

  function wireEvents() {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) { backdrop.remove(); opts.onCancel?.(); }
    });
    backdrop.querySelector('#nt-cancel')?.addEventListener('click', () => {
      backdrop.remove(); opts.onCancel?.();
    });

    // Travel style pills — event delegation on the static wrapper; pills re-render inside it
    backdrop.querySelector('#nt-style-group')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.trip-style-btn');
      if (!btn) return;
      const s = btn.dataset.style as TravelStyle;
      selectedStyle = selectedStyle === s ? null : s;
      rerenderPart('#nt-style-group', renderStylePills());
    });

    // Color swatches
    backdrop.querySelector('#nt-colors')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
      if (!btn) return;
      selectedColor = btn.dataset.color!;
      rerenderPart('#nt-colors', renderColorSwatches());
    });

    // Create
    const errorEl = backdrop.querySelector<HTMLElement>('#nt-error')!;
    backdrop.querySelector('#nt-create')?.addEventListener('click', async () => {
      const name = backdrop.querySelector<HTMLInputElement>('#nt-name')!.value.trim();
      const startDate = backdrop.querySelector<HTMLInputElement>('#nt-start')!.value;
      const endDate = backdrop.querySelector<HTMLInputElement>('#nt-end')!.value;
      const baseCurrency = backdrop.querySelector<HTMLInputElement>('#nt-currency')!.value.trim().toUpperCase() || 'EUR';
      const notes = backdrop.querySelector<HTMLInputElement>('#nt-notes')!.value.trim() || undefined;

      if (!name || !startDate || !endDate) {
        errorEl.textContent = 'Trip name and dates are required.';
        return;
      }
      if (endDate < startDate) {
        errorEl.textContent = 'End date must be after the start date.';
        return;
      }

      const dests = destPicker?.getValues() ?? [];
      const input: NewTripInput = {
        name, startDate, endDate, baseCurrency,
        coverColor: selectedColor,
        travelStyle: selectedStyle ?? undefined,
        destinations: dests.length > 0 ? dests : undefined,
        notes,
      };

      const btn = backdrop.querySelector<HTMLButtonElement>('#nt-create')!;
      btn.disabled = true;
      btn.textContent = 'Creating…';
      try {
        const id = await createTrip(input);
        tripList = await listTrips();
        destPicker?.destroy();
        backdrop.remove();
        await switchTrip(id);
        opts.onCreated(id);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Create trip';
        errorEl.textContent = e instanceof Error ? e.message : 'Could not create trip.';
      }
    });

    // Destroy picker on cancel too
    backdrop.querySelector('#nt-cancel')?.addEventListener('click', () => {
      destPicker?.destroy();
    }, { once: true });
  }

  mount();
}

function openNewTripModal() {
  buildSidebar(); // close the menu first
  openTripForm({
    onCreated: () => { /* sidebar already rebuilt by switchTrip → onTripChange */ },
  });
}

/**
 * Called once for brand-new users who have no trips.
 * Delegates to the full-page onboarding screen (not a modal).
 */
export function openOnboarding() {
  import('../views/onboarding/onboarding.ts').then(({ showOnboarding }) => {
    showOnboarding(() => {
      // After the trip is created, rebuild the sidebar so it shows the new trip.
      buildSidebar();
    });
  });
}

export function initApp() {
  document.getElementById('app-topbar')!.innerHTML = '';
  buildSidebar();
  buildMobileNav();
  decorateViewTitles();

  // Trip switch: rebuild the sidebar (name/countdown) and re-init mounted views
  // so their stores re-subscribe under the new tripId. Registered once.
  onTripChange(() => {
    buildSidebar();
    reinitForTripChange();
  });

  // Route from hash
  const hash = window.location.hash.replace('#', '') as ViewId;
  const validHash = NAV_ITEMS.find(n => n.id === hash);
  navigateTo(validHash ? hash : 'prep');

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace('#', '') as ViewId;
    if (NAV_ITEMS.find(n => n.id === h)) navigateTo(h);
  });
}

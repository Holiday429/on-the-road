/* ==========================================================================
   On the Road · App Shell & Router
   ========================================================================== */

import type { User } from '../firebase/auth.ts';
import {
  currentTrip, listTrips, createTrip, switchTrip, onTripChange,
  type StoredTrip, type NewTripInput,
} from '../data/trip-context.ts';
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

// Each view registers an idempotent init fn. We keep the fn (never delete it)
// and track which views are currently mounted, so a trip switch can re-init
// the mounted ones — re-subscribing their stores under the new tripId.
let viewInits: Partial<Record<ViewId, () => void>> = {};
const mountedViews = new Set<ViewId>();
let sessionState: { user: User | null } = { user: null };

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
        <div class="sidebar-header-profile">
          <div class="sidebar-profile-avatar">
            <img src="${profileIcon}" class="sidebar-profile-avatar-image" alt="" aria-hidden="true">
          </div>
          <div class="sidebar-profile-meta">
            <div class="sidebar-profile-title">on the road</div>
          </div>
        </div>
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
        <div class="sidebar-profile-avatar">${avatar}</div>
        <div class="sidebar-profile-meta">
          <div class="sidebar-profile-title">${displayName}</div>
        </div>
      </div>
    </div>
  `;
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
  const days = trip ? daysUntil(new Date(`${trip.startDate}T00:00:00`)) : 0;
  const compactCountdown = days > 0 ? String(days) : String(Math.abs(days));
  const daysText = !trip
    ? ''
    : days > 0
    ? `Departing in <strong>${days} days</strong>`
    : days === 0
    ? `Departing <strong>today!</strong> 🎉`
    : `Trip started <strong>${Math.abs(days)} days</strong> ago`;

  const menu = tripMenuOpen ? buildTripMenu() : '';

  return `
    <div class="trip-pill${tripMenuOpen ? ' is-open' : ''}" id="trip-pill" role="button" tabindex="0" aria-haspopup="true" aria-expanded="${tripMenuOpen}">
      <div class="trip-pill-label">Current Trip <span class="trip-pill-caret">▾</span></div>
      <div class="trip-pill-name">${escapeHtml(name)}</div>
      <div class="trip-pill-date">${compactCountdown}</div>
      <div class="trip-pill-days">${daysText}</div>
    </div>
    ${menu}
  `;
}

function buildTripMenu(): string {
  const activeId = currentTrip()?.id;
  const rows = tripList.map((t) => `
    <button class="trip-menu-item${t.id === activeId ? ' is-active' : ''}" data-trip-id="${escapeHtml(t.id)}">
      <span class="trip-menu-dot" style="background:${escapeHtml(t.coverColor || '#f9b830')}"></span>
      <span class="trip-menu-name">${escapeHtml(t.name)}</span>
      ${t.id === activeId ? '<span class="trip-menu-check">✓</span>' : ''}
    </button>
  `).join('');

  return `
    <div class="trip-menu" id="trip-menu" role="menu">
      ${rows || '<div class="trip-menu-empty">No trips yet</div>'}
      <button class="trip-menu-new" id="trip-menu-new">+ New trip</button>
    </div>
  `;
}

function buildSidebar() {
  const sidebar = document.getElementById('sidebar')!;
  sidebar.innerHTML = `
    ${buildSidebarHeader()}
    ${buildTripPill()}
    <nav class="sidebar-nav" aria-label="Main navigation">
      ${buildNavSections('sidebar')}
    </nav>
  `;

  sidebar.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo((item as HTMLElement).dataset.view as ViewId));
  });

  wireTripSwitcher(sidebar);
}

/** Wire the trip pill (open/close menu, switch trip, new-trip modal). */
function wireTripSwitcher(sidebar: HTMLElement) {
  const pill = sidebar.querySelector<HTMLElement>('#trip-pill');
  pill?.addEventListener('click', async () => {
    tripMenuOpen = !tripMenuOpen;
    if (tripMenuOpen) {
      try { tripList = await listTrips(); } catch (e) { console.warn('listTrips failed:', e); }
    }
    buildSidebar();
  });

  sidebar.querySelectorAll<HTMLElement>('.trip-menu-item').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripId!;
      tripMenuOpen = false;
      await switchTrip(id);   // broadcasts → views re-init; rebuilds sidebar via onTripChange
    });
  });

  sidebar.querySelector<HTMLElement>('#trip-menu-new')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tripMenuOpen = false;
    openNewTripModal();
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

export function renderSession(user: User, _onSignOut: () => void) {
  sessionState = { user };
  document.getElementById('app-topbar')!.innerHTML = '';
  buildSidebar();
}

/* ── New-trip modal ──────────────────────────────────────────────────────── */

function openNewTripModal() {
  buildSidebar(); // close the menu first
  const backdrop = document.createElement('div');
  backdrop.className = 'trip-modal-backdrop';
  backdrop.innerHTML = `
    <div class="trip-modal" role="dialog" aria-modal="true" aria-label="New trip">
      <h3 class="trip-modal-title">New trip</h3>
      <label class="trip-modal-field">
        <span>Name</span>
        <input id="nt-name" class="input" placeholder="Australia 2027" autocomplete="off">
      </label>
      <div class="trip-modal-row">
        <label class="trip-modal-field">
          <span>Start</span>
          <input id="nt-start" class="input" type="date">
        </label>
        <label class="trip-modal-field">
          <span>End</span>
          <input id="nt-end" class="input" type="date">
        </label>
      </div>
      <label class="trip-modal-field">
        <span>Base currency</span>
        <input id="nt-currency" class="input" value="EUR" maxlength="3" style="text-transform:uppercase">
      </label>
      <div class="trip-modal-actions">
        <button class="btn" id="nt-cancel">Cancel</button>
        <button class="btn btn-primary" id="nt-create">Create trip</button>
      </div>
      <div class="trip-modal-error" id="nt-error"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#nt-cancel')!.addEventListener('click', close);

  const errorEl = backdrop.querySelector<HTMLElement>('#nt-error')!;
  backdrop.querySelector('#nt-create')!.addEventListener('click', async () => {
    const name = backdrop.querySelector<HTMLInputElement>('#nt-name')!.value.trim();
    const startDate = backdrop.querySelector<HTMLInputElement>('#nt-start')!.value;
    const endDate = backdrop.querySelector<HTMLInputElement>('#nt-end')!.value;
    const baseCurrency = backdrop.querySelector<HTMLInputElement>('#nt-currency')!.value.trim().toUpperCase() || 'EUR';
    if (!name || !startDate || !endDate) {
      errorEl.textContent = 'Name and dates are required.';
      return;
    }
    if (endDate < startDate) {
      errorEl.textContent = 'End date must be after the start date.';
      return;
    }
    const input: NewTripInput = { name, startDate, endDate, baseCurrency };
    try {
      const btn = backdrop.querySelector<HTMLButtonElement>('#nt-create')!;
      btn.disabled = true; btn.textContent = 'Creating…';
      const id = await createTrip(input);
      tripList = await listTrips();
      close();
      await switchTrip(id); // jump into the new (empty) trip
    } catch (e) {
      errorEl.textContent = e instanceof Error ? e.message : 'Could not create trip.';
    }
  });

  backdrop.querySelector<HTMLInputElement>('#nt-name')?.focus();
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

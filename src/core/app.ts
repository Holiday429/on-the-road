/* ==========================================================================
   On the Road · App Shell & Router
   ========================================================================== */

import type { User } from '../firebase/auth.ts';
import {
  currentTrip, currentTripId, listTrips, createTrip, switchTrip, onTripChange,
  updateTrip, removeTrip, currentRole, currentMemberPages, leaveTrip as leaveTripCtx,
  TripQuotaError,
  type StoredTrip, type NewTripInput,
} from '../data/trip-context.ts';
import { requireTripSlot, showTripQuotaPaywall } from './paywall.ts';
import { TRAVEL_STYLES, type TravelStyle } from '../data/schema.ts';
import { routeStore, type StoredLeg } from '../data/stores/route-store.ts';
import { createDestinationInput, type DestinationInputInstance } from './destination-input.ts';
import { escHtml as escapeHtml } from './utils.ts';
import { openModal } from './modal.ts';
import { t, onLocaleChange } from './i18n.ts';
import { track } from './analytics.ts';
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

export type ViewId = 'today' | 'prep' | 'route' | 'expenses' | 'pack' | 'cities' | 'budget' | 'safety' | 'journal' | 'map' | 'nomad' | 'calendar';

interface NavItem {
  id: ViewId;
  label: string;
  // Either a PNG asset path, or an emoji glyph when `emoji` is true.
  iconSrc: string;
  emoji?: boolean;
  // `pinned` items render above the Before/During/After sections (e.g. Today).
  section: 'pinned' | 'before' | 'during' | 'after';
}

const NAV_ITEMS: NavItem[] = [
  // Pinned
  { id: 'today',    label: 'Dashboard', iconSrc: '🏠',  emoji: true, section: 'pinned' },
  // Before
  { id: 'prep',     label: 'Checklist', iconSrc: checklistIcon, section: 'before' },
  { id: 'pack',     label: 'Pack',      iconSrc: packIcon,      section: 'before' },
  { id: 'budget',   label: 'Compare',   iconSrc: stayIcon,      section: 'before' },
  // During
  { id: 'route',    label: 'Itinerary', iconSrc: itineraryIcon, section: 'during' },
  { id: 'cities',   label: 'Guide',     iconSrc: guideIcon,     section: 'during' },
  { id: 'map',      label: 'Map',       iconSrc: mapsIcon,      section: 'during' },
  { id: 'nomad',    label: 'Nomad',     iconSrc: nomadIcon,     section: 'during' },
  { id: 'safety',   label: 'Safety',    iconSrc: safetyIcon,    section: 'during' },
  // After
  { id: 'expenses', label: 'Expenses',  iconSrc: paymentIcon,   section: 'after'  },
  { id: 'journal',  label: 'Journal',   iconSrc: journalIcon,   section: 'after'  },
];

/** Localized nav label for a view; falls back to the English NAV_ITEMS label. */
function navLabel(item: NavItem): string {
  return t(`nav.${item.id}`) || item.label;
}
function sectionLabel(section: 'before' | 'during' | 'after'): string {
  return t(`nav.section${section.charAt(0).toUpperCase()}${section.slice(1)}`);
}

// Page-level view restriction. When non-null, the nav + router only allow these
// view ids — used by viewer share links that expose a subset of pages. null =
// no restriction (full members see everything).
let _allowedViews: ViewId[] | null = null;

/** Restrict (or clear, with null) the views the current session may see. */
export function setAllowedViews(ids: ViewId[] | null) {
  // Keep only known view ids; ignore unknowns. Empty array → treat as no data.
  _allowedViews = ids && ids.length
    ? ids.filter((id) => NAV_ITEMS.some((n) => n.id === id))
    : (ids === null ? null : []);
}

/** Whether a view is navigable in the current session. */
export function isViewAllowed(id: ViewId): boolean {
  return !_allowedViews || _allowedViews.includes(id);
}

/** First view the current session is allowed to land on. */
export function firstAllowedView(): ViewId {
  if (_allowedViews && _allowedViews.length) {
    const inNav = NAV_ITEMS.find((n) => _allowedViews!.includes(n.id));
    if (inNav) return inNav.id;
  }
  return 'today';
}

// Trips loaded for the switcher (refreshed on open / after create).
let tripList: StoredTrip[] = [];
let tripMenuOpen = false;

// Owner-only live subscription to pending edit-access requests for the current
// trip. Drives the badge on the trip pill. Torn down + re-created on trip switch.
let _reqUnsub: (() => void) | null = null;
let _pendingRequestCount = 0;

function updateRequestBadge(count: number) {
  _pendingRequestCount = count;
  const badge = document.getElementById('trip-pill-reqbadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = `${count} request${count > 1 ? 's' : ''}`;
    badge.removeAttribute('hidden');
  } else {
    badge.setAttribute('hidden', '');
  }
}

/** (Re)subscribe to pending access requests for the current trip, owner-only. */
function refreshRequestSubscription() {
  if (_reqUnsub) { _reqUnsub(); _reqUnsub = null; }
  updateRequestBadge(0);
  if (currentRole() !== 'owner') return;
  const tripId = currentTripId();
  import('../data/access-requests.ts').then(({ subscribeAccessRequests }) => {
    // Trip may have switched again while the import resolved.
    if (currentTripId() !== tripId || currentRole() !== 'owner') return;
    _reqUnsub = subscribeAccessRequests(tripId, (rows) => updateRequestBadge(rows.length));
  }).catch(() => {});
}

// ── Trip popover (floating panel rendered into <body>) ────────────────────────
// `anchor` is the element to position the panel against. Defaults to the sidebar
// trip pill; the mobile dashboard banner passes its own anchor so the same menu
// works when the sidebar is hidden (PWA / phone).
function openTripPopover(anchor?: HTMLElement | null) {
  closeTripPopover();

  const pill = anchor ?? document.getElementById('trip-pill');
  const rect = pill?.getBoundingClientRect();

  const backdrop = document.createElement('div');
  backdrop.id = 'trip-popover-backdrop';
  backdrop.addEventListener('click', () => { tripMenuOpen = false; closeTripPopover(); buildSidebar(); });

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
  const myUid = sessionState.user?.uid;
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
      tripMenuOpen = false;
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
      tripMenuOpen = false;
      closeTripPopover();
      buildSidebar();
      import('./trip-share.ts').then(({ openShareModal }) => openShareModal(id));
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

  panel.querySelectorAll<HTMLElement>('.trip-menu-leave').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.tripId!;
      const trip = tripList.find(t => t.id === id);
      if (!trip) return;
      tripMenuOpen = false;
      closeTripPopover();
      buildSidebar();
      void leaveTrip(trip);
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

/** Open the trip switcher / share menu anchored to an arbitrary element.
   Used by the mobile dashboard banner so trip switching + sharing stay
   reachable when the sidebar (which hosts the pill) is hidden in the PWA. */
export function openTripSwitcher(anchor: HTMLElement) {
  if (!currentTrip()) { openNewTripModal(); return; }
  if (tripMenuOpen) { tripMenuOpen = false; closeTripPopover(); return; }
  tripMenuOpen = true;
  openTripPopover(anchor);
  listTrips()
    .then((trips) => {
      tripList = trips;
      if (tripMenuOpen && document.getElementById('trip-popover')) openTripPopover(anchor);
    })
    .catch((e) => console.warn('listTrips failed:', e));
}

// Each view registers an idempotent init fn — either eager (already imported)
// or a lazy loader that dynamic-imports the view module on first navigation
// and returns its init fn. We keep the resolved fn (never delete it) and track
// which views are currently mounted, so a trip switch can re-init the mounted
// ones — re-subscribing their stores under the new tripId. Once resolved, a
// lazy loader is replaced in-place with the plain fn so re-init never re-imports.
type ViewInit = (() => void) | (() => Promise<() => void>);
let viewInits: Partial<Record<ViewId, ViewInit>> = {};
const mountedViews = new Set<ViewId>();
let sessionState: { user: User | null } = { user: null };
let sessionPrimaryAction: (() => void | Promise<void>) | null = null;


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
  if (item.emoji) {
    return `<span class="nav-icon-emoji" aria-hidden="true">${item.iconSrc}</span>`;
  }
  return `<img src="${item.iconSrc}" class="nav-icon-image" alt="" aria-hidden="true">`;
}

function buildSidebarHeader(): string {
  const { user } = sessionState;
  // No user, OR an anonymous guest: both show the "Sign in with Google" prompt.
  // A guest is signed in for data purposes (real uid, trips persist) but is
  // nudged to sign in so their trips sync across devices and survive. Clicking
  // routes to sessionPrimaryAction → signInWithGoogle, which LINKS Google to the
  // anonymous account in place (data preserved). See signInWithGoogle in auth.ts.
  if (!user || user.isAnonymous) {
    const subtitle = user?.isAnonymous
      ? t('app.signInSync')
      : t('app.signInSubtitle');
    return `
      <div class="sidebar-header">
        <button type="button" class="sidebar-header-profile sidebar-auth-trigger" id="sidebar-auth-trigger">
          <div class="sidebar-profile-avatar">
            <img src="${profileIcon}" class="sidebar-profile-avatar-image" alt="" aria-hidden="true">
          </div>
          <div class="sidebar-profile-meta">
            <div class="sidebar-profile-title">${t('app.title')}</div>
            <div class="sidebar-profile-subtitle">${subtitle}</div>
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
      <button type="button" class="sidebar-header-profile sidebar-account-trigger" id="sidebar-account-trigger" title="${t('app.accountSubtitle')}">
        <div class="sidebar-profile-avatar is-user">${avatar}</div>
        <div class="sidebar-profile-meta">
          <div class="sidebar-profile-title">${displayName}</div>
          <div class="sidebar-profile-subtitle">${t('app.accountSubtitle')}</div>
        </div>
      </button>
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
    <span>${escapeHtml(title?.trim() || navLabel(item))}</span>
  `;
}

function decorateViewTitles() {
  NAV_ITEMS.forEach((item) => {
    const titleEl = document.querySelector<HTMLElement>(`#view-${item.id} .view-title`);
    if (!titleEl) return;
    // The static HTML seeds each title with its English nav label. Treat that as
    // "no custom title" so it localizes; only a title that differs from the
    // English default (set by a view) is pinned via data-title.
    const seeded = titleEl.dataset.title ?? titleEl.textContent?.trim();
    const custom = seeded && seeded !== item.label ? seeded : undefined;
    if (custom) titleEl.dataset.title = custom;
    titleEl.innerHTML = renderViewTitleMarkup(item.id, custom);
  });
}

export function registerView(id: ViewId, initFn: ViewInit) {
  viewInits[id] = initFn;
}

/** Resolve a view's init fn — importing its module on first call if it was
 *  registered lazily — then run it. Caches the resolved plain fn back into
 *  viewInits so subsequent (re-)inits never re-import. */
async function runViewInit(id: ViewId): Promise<void> {
  const fn = viewInits[id];
  if (!fn) return;
  const result = fn();
  if (result instanceof Promise) {
    const resolved = await result;
    viewInits[id] = resolved;
    resolved();
  }
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
      void runViewInit(id);       // re-init now (visible) — re-subscribes
    } else {
      mountedViews.delete(id);    // re-init lazily on next open
    }
  }
}

/* ── Navigation intent ──────────────────────────────────────────────────────
   A lightweight "deep-link payload" passed alongside navigateTo so an aggregator
   page (Today) can ask a destination view to scroll to / open a specific record
   (e.g. a route leg + day). The target view reads it once on activation via
   consumeNavIntent(view) and clears it, so a later plain navigateTo() is inert.
   Kept deliberately loose (Record) so any view can define its own keys without
   touching this file. */
export interface NavIntent {
  legId?: string;
  dayId?: string;
  [key: string]: string | undefined;
}

let _pendingIntent: { view: ViewId; intent: NavIntent } | null = null;

/** Read & clear the pending intent for `view`. Returns null if none targets it. */
export function consumeNavIntent(view: ViewId): NavIntent | null {
  if (_pendingIntent?.view === view) {
    const { intent } = _pendingIntent;
    _pendingIntent = null;
    return intent;
  }
  return null;
}

let _lastTrackedView: ViewId | null = null;

export async function navigateTo(id: ViewId, intent?: NavIntent) {
  // Page-level access guard: bounce disallowed views to the first allowed one.
  if (!isViewAllowed(id)) id = firstAllowedView();

  if (id !== _lastTrackedView) {
    track('view', { id });
    _lastTrackedView = id;
  }

  _pendingIntent = intent ? { view: id, intent } : null;

  // Hide all views
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));

  // Show target
  const el = document.getElementById(`view-${id}`);
  if (el) {
    el.classList.add('active');
    clearGuestStates();
    // Lazy init — run once per mount; init fns are idempotent so re-running
    // on a trip switch is safe. May dynamic-import the view module first.
    if (viewInits[id] && !mountedViews.has(id)) {
      mountedViews.add(id);
      await runViewInit(id);
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

  // Notify an already-mounted target view that it was (re-)activated with an
  // intent — fresh mounts pick it up via consumeNavIntent() in their init, but
  // a view that was mounted earlier won't re-init, so it listens for this.
  if (_pendingIntent?.view === id) {
    window.dispatchEvent(new CustomEvent('otr:nav-intent', { detail: { view: id } }));
  }
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
    ? t('app.departingIn', { n: days })
    : days === 0
    ? t('app.departingToday')
    : t('app.tripStarted', { n: Math.abs(days) });

  const role = currentRole();
  const roleBadge = role === 'viewer'
    ? `<div class="trip-pill-role trip-pill-role--viewer">${t('app.roleBadgeViewer')}</div>`
    : role === 'editor'
    ? `<div class="trip-pill-role trip-pill-role--editor">${t('app.roleBadgeEditor')}</div>`
    : '';

  // Owner-only: a pending-edit-request indicator. Count is filled live by the
  // access-request subscription (updateRequestBadge); hidden when zero.
  const reqBadge = role === 'owner'
    ? `<button class="trip-pill-reqbadge" id="trip-pill-reqbadge" hidden title="${t('app.requestBadge')}">0 requests</button>`
    : '';

  return `
    <div class="trip-pill${tripMenuOpen ? ' is-open' : ''}" id="trip-pill" role="button" tabindex="0" aria-haspopup="true" aria-expanded="${tripMenuOpen}">
      <div class="trip-pill-label">${t('app.currentTripPill')} <span class="trip-pill-caret">▾</span></div>
      <div class="trip-pill-name">${escapeHtml(name)}</div>
      <div class="trip-pill-date ${compactClass}">${compactBadge}</div>
      <div class="trip-pill-days">${daysText}</div>
      ${roleBadge}
      ${reqBadge}
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

  // Signed-in profile header → account & billing.
  sidebar.querySelector<HTMLElement>('#sidebar-account-trigger')?.addEventListener('click', () => {
    import('./account.ts').then(({ openAccountModal }) => openAccountModal());
  });

  sidebar.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo((item as HTMLElement).dataset.view as ViewId));
  });

  if (sessionState.user) {
    wireTripSwitcher(sidebar);
    // Re-apply the current request count (the pill was just rebuilt) and wire
    // the badge to open the Share modal (stopping the pill's own click).
    updateRequestBadge(_pendingRequestCount);
    const reqBadge = sidebar.querySelector<HTMLElement>('#trip-pill-reqbadge');
    reqBadge?.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = currentTripId();
      import('./trip-share.ts').then(({ openShareModal }) => openShareModal(id));
    });
  }
}

/** Wire the trip pill (open/close popover, switch trip, new-trip modal). */
function wireTripSwitcher(sidebar: HTMLElement) {
  const pill = sidebar.querySelector<HTMLElement>('#trip-pill');
  pill?.addEventListener('click', async () => {
    // Always dismiss the calendar tooltip before opening the action popover
    closeCalendarTooltip();
    if (calHoverTimer) { clearTimeout(calHoverTimer); calHoverTimer = null; }

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
    // Open instantly with whatever we already have cached, then refresh the
    // list in the background and re-render the popover when it lands.
    buildSidebar();
    openTripPopover();
    listTrips()
      .then((trips) => {
        tripList = trips;
        // Only repaint if the popover is still open for this trip menu.
        if (tripMenuOpen && document.getElementById('trip-popover')) {
          buildSidebar();
          openTripPopover();
        }
      })
      .catch((e) => console.warn('listTrips failed:', e));
  });

  // Calendar thumbnail hover — only show when no popover is open
  wireTripCalendarHover(pill);
}

let calHoverTimer: ReturnType<typeof setTimeout> | null = null;

function wireTripCalendarHover(pill: HTMLElement | null) {
  if (!pill) return;

  pill.addEventListener('mouseenter', () => {
    if (tripMenuOpen) return;
    calHoverTimer = setTimeout(() => {
      if (!tripMenuOpen) openCalendarTooltip(pill);
    }, 220);
  });
  pill.addEventListener('mouseleave', (e) => {
    if (calHoverTimer) { clearTimeout(calHoverTimer); calHoverTimer = null; }
    const related = e.relatedTarget as Node | null;
    const tooltip = document.getElementById('trip-cal-tooltip');
    if (tooltip && !tooltip.contains(related)) closeCalendarTooltip();
  });
}

function closeCalendarTooltip() {
  document.getElementById('trip-cal-tooltip')?.remove();
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

function buildMobileNav() {
  const mobileNav = document.getElementById('mobile-nav')!;
  const navItems = NAV_ITEMS.filter(item => isViewAllowed(item.id)).map(item => {
    return `<div class="mobile-nav-item" data-view="${item.id}" role="button" tabindex="0">
      <span class="nav-icon" aria-hidden="true">${renderNavIcon(item)}</span>
      <span class="nav-label">${navLabel(item).split(' ')[0]}</span>
    </div>`;
  }).join('');

  mobileNav.innerHTML = `<div id="mobile-nav-inner">${navItems}${buildMobileAccountItem()}</div>`;

  mobileNav.querySelectorAll<HTMLElement>('.mobile-nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.view as ViewId));
  });

  mobileNav.querySelector<HTMLElement>('#mobile-account-item')?.addEventListener('click', () => {
    // Real signed-in user → account & billing; guest (anonymous) or no user →
    // the sign-in flow (which upgrades a guest in place).
    if (sessionState.user && !sessionState.user.isAnonymous) {
      import('./account.ts').then(({ openAccountModal }) => openAccountModal());
    } else {
      sessionPrimaryAction?.();
    }
  });
}

/** Account/login entry pinned at the end of the mobile bottom nav.
   On phones the sidebar (which hosts the sign-in avatar) is hidden, so this is
   the only way to reach login / account on mobile. */
function buildMobileAccountItem(): string {
  const { user } = sessionState;
  // No user OR anonymous guest → "Sign in" (a guest is data-signed-in but should
  // still be prompted to sign in with Google to sync; see buildSidebarHeader).
  if (!user || user.isAnonymous) {
    return `<div class="mobile-nav-item mobile-nav-account" id="mobile-account-item" role="button" tabindex="0">
      <span class="nav-icon" aria-hidden="true"><img src="${profileIcon}" class="nav-icon-image" alt=""></span>
      <span class="nav-label">${t('common.signIn').split(' ')[0]}</span>
    </div>`;
  }
  const photo = user.photoURL?.trim();
  const avatar = photo
    ? `<img src="${escapeHtml(photo)}" class="mobile-nav-avatar-img" alt="">`
    : `<span class="mobile-nav-avatar-fallback">${initialsFor(user)}</span>`;
  return `<div class="mobile-nav-item mobile-nav-account" id="mobile-account-item" role="button" tabindex="0">
    <span class="nav-icon mobile-nav-avatar" aria-hidden="true">${avatar}</span>
    <span class="nav-label">Account</span>
  </div>`;
}

function navItemMarkup(item: NavItem): string {
  return `
    <div class="nav-item" data-view="${item.id}" role="button" tabindex="0">
      <span class="nav-icon" aria-hidden="true">${renderNavIcon(item)}</span>
      <span class="nav-label">${navLabel(item)}</span>
    </div>`;
}

function buildNavSections(_context: 'sidebar' | 'mobile'): string {
  // Pinned items (Today) sit above the labelled sections, with no header.
  const pinned = NAV_ITEMS
    .filter(n => n.section === 'pinned' && isViewAllowed(n.id))
    .map(navItemMarkup).join('');
  const sections: ('before' | 'during' | 'after')[] = ['before', 'during', 'after'];
  const grouped = sections.map(section => {
    const items = NAV_ITEMS.filter(n => n.section === section && isViewAllowed(n.id));
    if (!items.length) return ''; // hide an empty section label entirely
    return `
      <div class="nav-section-label">${sectionLabel(section)}</div>
      ${items.map(navItemMarkup).join('')}
    `;
  }).join('');
  return pinned + grouped;
}

export function renderSession(user: User | null, onPrimaryAction: () => void) {
  sessionState = { user };
  sessionPrimaryAction = onPrimaryAction;
  document.getElementById('app-topbar')!.innerHTML = '';
  buildSidebar();
  buildMobileNav();
  applyRoleState();
  if (!user) {
    const hash = window.location.hash.replace('#', '') as ViewId;
    navigateTo(NAV_ITEMS.find((item) => item.id === hash) ? hash : 'prep');
  }
}

/* ── Rename / Delete trip modals ────────────────────────────────────────── */

function openRenameTripModal(trip: StoredTrip) {
  const m = openModal({
    title: t('app.editTripTitle'),
    className: 'trip-edit-modal',
    body: `
      <label class="trip-modal-field">
        <span>${t('app.labelTripName')}</span>
        <input id="rt-name" class="input" value="${escapeHtml(trip.name)}" autocomplete="off">
      </label>
      <div class="trip-modal-row">
        <label class="trip-modal-field">
          <span>${t('app.labelHomeCity')} <span class="trip-modal-opt">(flying from)</span></span>
          <input id="rt-home" class="input" value="${escapeHtml(trip.homeCity ?? '')}" placeholder="${t('onboarding.homeCityPh')}" autocomplete="off">
        </label>
        <label class="trip-modal-field">
          <span>${t('app.labelReturnCity')} <span class="trip-modal-opt">(flying back to)</span></span>
          <input id="rt-return" class="input" value="${escapeHtml(trip.returnCity ?? '')}" placeholder="${t('onboarding.returnCityPh')}" autocomplete="off">
        </label>
      </div>
      <span class="trip-modal-hint">${t('app.homeReturnHint')}</span>
      <div class="trip-modal-error" id="rt-error"></div>`,
    footer: `
      <button class="btn" data-otr-close>${t('common.cancel')}</button>
      <button class="btn btn-primary" id="rt-save">${t('common.save')}</button>`,
  });

  const nameInput = m.root.querySelector<HTMLInputElement>('#rt-name')!;
  const homeInput = m.root.querySelector<HTMLInputElement>('#rt-home')!;
  const returnInput = m.root.querySelector<HTMLInputElement>('#rt-return')!;
  const errorEl = m.root.querySelector<HTMLElement>('#rt-error')!;

  nameInput.focus();
  nameInput.select();
  m.root.querySelectorAll('input').forEach((el) =>
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); }));

  async function save() {
    const name = nameInput.value.trim();
    if (!name) { errorEl.textContent = t('app.errorNameEmpty'); return; }
    // Empty string (not undefined) so clearing a field overwrites the stored
    // value — stripUndefined would otherwise drop the key and keep the old one.
    const homeCity = homeInput.value.trim();
    const returnCity = returnInput.value.trim();
    const btn = m.root.querySelector<HTMLButtonElement>('#rt-save')!;
    btn.disabled = true; btn.textContent = t('common.saving');
    try {
      await updateTrip(trip.id, { name, homeCity, returnCity });
      tripList = await listTrips();
      m.close();
      buildSidebar();
    } catch (e) {
      btn.disabled = false; btn.textContent = t('common.save');
      errorEl.textContent = e instanceof Error ? e.message : 'Could not save trip.';
    }
  }

  m.root.querySelector('#rt-save')!.addEventListener('click', save);
}

function openDeleteTripModal(trip: StoredTrip) {
  const m = openModal({
    title: t('app.deleteTripTitle'),
    className: 'trip-edit-modal',
    body: `
      <p style="font-size:var(--fs-sm);color:var(--ink-muted);margin:0">
        ${t('app.deleteTripWarning', { name: escapeHtml(trip.name) })}
      </p>
      <div class="trip-modal-error" id="dt-error"></div>`,
    footer: `
      <button class="btn" data-otr-close>${t('common.cancel')}</button>
      <button class="btn btn-danger" id="dt-confirm">${t('common.delete')}</button>`,
  });

  m.root.querySelector('#dt-confirm')!.addEventListener('click', async () => {
    const btn = m.root.querySelector<HTMLButtonElement>('#dt-confirm')!;
    const errorEl = m.root.querySelector<HTMLElement>('#dt-error')!;
    btn.disabled = true; btn.textContent = t('app.deleting');
    try {
      await removeTrip(trip.id);
      tripList = await listTrips();
      m.close();
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
      btn.disabled = false; btn.textContent = t('common.delete');
      errorEl.textContent = e instanceof Error ? e.message : 'Could not delete trip.';
    }
  });
}

function leaveTrip(trip: StoredTrip) {
  const m = openModal({
    title: t('app.leaveTripTitle'),
    className: 'trip-edit-modal',
    body: `
      <p style="font-size:var(--fs-sm);color:var(--ink-muted);margin:0">
        ${t('app.leaveTripWarning', { name: escapeHtml(trip.name) })}
      </p>
      <div class="trip-modal-error" id="lt-error"></div>`,
    footer: `
      <button class="btn" data-otr-close>${t('common.cancel')}</button>
      <button class="btn btn-danger" id="lt-confirm">${t('app.btnLeave')}</button>`,
  });

  m.root.querySelector('#lt-confirm')!.addEventListener('click', async () => {
    const btn = m.root.querySelector<HTMLButtonElement>('#lt-confirm')!;
    const errorEl = m.root.querySelector<HTMLElement>('#lt-error')!;
    btn.disabled = true; btn.textContent = t('app.leaving');
    try {
      const wasActive = currentTripId() === trip.id;
      await leaveTripCtx(trip.id);
      tripList = await listTrips();
      m.close();
      if (wasActive) {
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
      btn.disabled = false; btn.textContent = t('app.btnLeave');
      errorEl.textContent = e instanceof Error ? e.message : 'Could not leave trip.';
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
      <div class="trip-modal" role="dialog" aria-modal="true" aria-label="${t('app.newTripTitle')}">
        <h3 class="trip-modal-title">${t('app.newTripTitle')}</h3>

        <label class="trip-modal-field">
          <span>${t('app.labelTripName')}</span>
          <input id="nt-name" class="input" placeholder="${t('onboarding.namePh')}" autocomplete="off">
        </label>

        <div class="trip-modal-row">
          <label class="trip-modal-field">
            <span>${t('onboarding.labelStartDate')}</span>
            <input id="nt-start" class="input" type="date">
          </label>
          <label class="trip-modal-field">
            <span>${t('onboarding.labelEndDate')}</span>
            <input id="nt-end" class="input" type="date">
          </label>
        </div>

        <label class="trip-modal-field">
          <span>${t('onboarding.labelDests')} <span style="font-weight:400;color:var(--ink-faint)">(optional)</span></span>
          <div id="nt-dest-mount"></div>
        </label>

        <label class="trip-modal-field">
          <span>${t('onboarding.labelStyle')} <span style="font-weight:400;color:var(--ink-faint)">(optional)</span></span>
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
            <span>${t('onboarding.labelCoverColor')}</span>
            <div class="trip-color-swatches" id="nt-colors">
              ${renderColorSwatches()}
            </div>
          </label>
        </div>

        <label class="trip-modal-field">
          <span>Notes <span style="font-weight:400;color:var(--ink-faint)">(optional)</span></span>
          <input id="nt-notes" class="input" placeholder="${t('onboarding.notesPh')}">
        </label>

        <div class="trip-modal-actions">
          <button class="btn" id="nt-cancel">${t('common.cancel')}</button>
          <button class="btn btn-primary" id="nt-create">${t('app.btnCreateTrip')}</button>
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
        errorEl.textContent = t('onboarding.errorDates');
        return;
      }
      if (endDate < startDate) {
        errorEl.textContent = t('onboarding.errorEndDate');
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
      btn.textContent = t('onboarding.creating');
      try {
        const id = await createTrip(input);
        tripList = await listTrips();
        destPicker?.destroy();
        backdrop.remove();
        await switchTrip(id);
        opts.onCreated(id);
      } catch (e) {
        // Safety net: if the quota gate fired (e.g. a slot was used in another
        // tab after this form opened), close the form and show the paywall
        // instead of a dead-end error inside the create dialog.
        if (e instanceof TripQuotaError) {
          destPicker?.destroy();
          backdrop.remove();
          showTripQuotaPaywall();
          return;
        }
        btn.disabled = false;
        btn.textContent = t('app.btnCreateTrip');
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
  // Pre-gate: out of owned-trip slots → show the paywall, not the form.
  if (!requireTripSlot()) return;
  openTripForm({
    onCreated: () => { /* sidebar already rebuilt by switchTrip → onTripChange */ },
  });
}

/** Public entry-point: open the New Trip form from any view. */
export function openNewTrip(): void {
  openNewTripModal();
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

/**
 * Reflect the user's role on the active trip onto the app root as a data
 * attribute. Viewer mode flips a flag that CSS uses to disable write controls;
 * the security rules are the real guard, this just avoids silent write failures.
 */
export function applyRoleState() {
  const role = currentRole();
  const root = document.getElementById('app');
  if (root) root.dataset.role = role ?? '';
  // Owners get a live pending-request badge; (re)subscribe for the active trip.
  refreshRequestSubscription();
}

export function initApp() {
  document.getElementById('app-topbar')!.innerHTML = '';
  buildSidebar();
  buildMobileNav();
  decorateViewTitles();
  applyRoleState();

  // Trip switch: re-apply the member's page restriction for the new trip (an
  // editor may be limited to some pages on one trip but not another), rebuild
  // the sidebar, and re-init mounted views so stores re-subscribe. Registered
  // once. Skipped in viewer mode (the invite owns the restriction there).
  onTripChange(() => {
    if (sessionState.user) {
      setAllowedViews(currentMemberPages() as ViewId[] | null);
    }
    buildSidebar();
    applyRoleState();
    reinitForTripChange();
  });

  // Language switch: re-render the nav chrome and view-title labels in place.
  // Each view re-renders itself via its own onLocaleChange subscription.
  onLocaleChange(() => {
    buildSidebar();
    buildMobileNav();
    decorateViewTitles();
    applyRoleState();
  });

  // Route from hash (navigateTo applies the page-level access guard).
  const hash = window.location.hash.replace('#', '') as ViewId;
  const validHash = NAV_ITEMS.find(n => n.id === hash);
  navigateTo(validHash ? hash : firstAllowedView());

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace('#', '') as ViewId;
    if (NAV_ITEMS.find(n => n.id === h)) navigateTo(h);
  });
}

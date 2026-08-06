/* ==========================================================================
   On the Road · App Shell & Router
   ========================================================================== */

import type { User } from '../firebase/auth.ts';
import { currentMemberPages, currentRole, onTripChange } from '../data/trip-context.ts';
import { t, onLocaleChange } from './i18n.ts';
import { track } from './analytics.ts';
import checklistIcon from '../../icon/Checklist.png';
import guideIcon from '../../icon/Guide.png';
import itineraryIcon from '../../icon/Itinerary.png';
import journalIcon from '../../icon/Journal.png';
import paymentIcon from '../../icon/payment.png';
import stayIcon from '../../icon/stay.png';
import mapsIcon from '../../icon/maps.png';
import {
  type ViewId, type NavItem,
  initSidebar, buildSidebar, buildMobileNav, decorateViewTitles,
  renderViewTitleMarkup, refreshRequestSubscription,
  getTripMenuOpen, setTripMenuOpen,
} from './sidebar.ts';
import { initTripModals, openNewTripModal } from './trip-modals.ts';
import { initTripPopover, openTripSwitcher, setTripList } from './trip-popover.ts';

export type { ViewId } from './sidebar.ts';
export { renderViewTitleMarkup, openTripSwitcher };

const NAV_ITEMS: NavItem[] = [
  // Pinned
  { id: 'today',    label: 'Dashboard', iconSrc: '🏠',  emoji: true, section: 'pinned' },
  // Before
  { id: 'prep',     label: 'Prepare',   iconSrc: checklistIcon, section: 'before' },
  { id: 'budget',   label: 'Compare',   iconSrc: stayIcon,      section: 'before' },
  // During
  { id: 'route',    label: 'Itinerary', iconSrc: itineraryIcon, section: 'during' },
  { id: 'cities',   label: 'Guide',     iconSrc: guideIcon,     section: 'during' },
  { id: 'map',      label: 'Map',       iconSrc: mapsIcon,      section: 'during' },
  // After
  { id: 'expenses', label: 'Expenses',  iconSrc: paymentIcon,   section: 'after'  },
  { id: 'journal',  label: 'Journal',   iconSrc: journalIcon,   section: 'after'  },
];

// Views that used to have their own NAV_ITEMS entry and are now folded into
// another view. A stale hash, bookmark, or share-link page id resolves here
// before anything else, so old links keep working instead of dead-ending.
const LEGACY_VIEW_MAP: Partial<Record<string, ViewId>> = {
  nomad: 'cities',
  safety: 'cities',
  pack: 'prep',
};

function resolveLegacyView(id: string): ViewId {
  return (LEGACY_VIEW_MAP[id] ?? id) as ViewId;
}

// Page-level view restriction. When non-null, the nav + router only allow these
// view ids — used by viewer share links that expose a subset of pages. null =
// no restriction (full members see everything).
let _allowedViews: ViewId[] | null = null;

/** Restrict (or clear, with null) the views the current session may see. */
export function setAllowedViews(ids: ViewId[] | null) {
  // Keep only known view ids; ignore unknowns. Empty array → treat as no data.
  // Old invites may carry a since-removed page id (e.g. "nomad") — remap it
  // to its replacement so those invites don't silently lose the page.
  const mapped = ids?.map(resolveLegacyView);
  _allowedViews = mapped && mapped.length
    ? mapped.filter((id) => NAV_ITEMS.some((n) => n.id === id))
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

/** Whether `id` names a real, mounted view — including one with no
 *  NAV_ITEMS entry (calendar, profile). Ground truth is the DOM: every view
 *  has a static #view-<id> shell in app.html regardless of nav visibility. */
function isRoutableView(id: string): id is ViewId {
  return !!document.getElementById(`view-${id}`);
}

// Each view registers an idempotent init fn — either eager (already imported)
// or a lazy loader that dynamic-imports the view module on first navigation
// and returns its init fn. We keep the resolved fn (never delete it) and track
// which views are currently mounted, so a trip switch can re-init the mounted
// ones — re-subscribing their stores under the new tripId. Once resolved, a
// lazy loader is replaced in-place with the plain fn so re-init never re-imports.
type ViewInit = (() => void) | (() => Promise<() => void>);
const viewInits: Partial<Record<ViewId, ViewInit>> = {};
const mountedViews = new Set<ViewId>();
let sessionState: { user: User | null } = { user: null };
let sessionPrimaryAction: (() => void | Promise<void>) | null = null;

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

// A theme switch is a repaint of the same data: JS-drawn colors (amCharts map
// fills, inline sticky-note tints) only refresh on re-render, so reuse the
// trip-switch re-init — the visible view redraws now, the rest lazily.
window.addEventListener('otr:theme-change', () => reinitForTripChange());

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

export function renderSession(user: User | null, onPrimaryAction: () => void) {
  sessionState = { user };
  sessionPrimaryAction = onPrimaryAction;
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  document.getElementById('app-topbar')!.innerHTML = '';
  buildSidebar();
  buildMobileNav();
  applyRoleState();
  if (!user) {
    const hash = resolveLegacyView(window.location.hash.replace('#', ''));
    navigateTo(isRoutableView(hash) ? hash : firstAllowedView());
  }
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

// Wire the sidebar/trip-modals/trip-popover modules to this module's session
// state and router, once, before any of them are used.
initSidebar({
  navItems: () => NAV_ITEMS,
  isViewAllowed,
  navigateTo: (id) => { void navigateTo(id); },
  sessionUser: () => sessionState.user,
  sessionPrimaryAction: () => { void sessionPrimaryAction?.(); },
});
initTripModals({
  setTripList,
  buildSidebar,
  openOnboarding,
});
initTripPopover({
  currentUserId: () => sessionState.user?.uid,
  buildSidebar,
  getTripMenuOpen,
  setTripMenuOpen,
});

export function initApp() {
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
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
  // Validate against the DOM (any registered #view-<id>), not NAV_ITEMS —
  // views like 'calendar' and 'profile' are intentionally routable without
  // a nav entry, and NAV_ITEMS-only validation would reject their own hash.
  const hash = resolveLegacyView(window.location.hash.replace('#', ''));
  navigateTo(isRoutableView(hash) ? hash : firstAllowedView());

  window.addEventListener('hashchange', () => {
    const h = resolveLegacyView(window.location.hash.replace('#', ''));
    // A hash that matches no view (including one with no legacy mapping)
    // used to be a silent no-op, leaving the previously-active view on
    // screen with a dead URL. Route it to the default instead. Note:
    // navigateTo() itself sets window.location.hash, which re-fires this
    // listener — isRoutableView (not NAV_ITEMS) must accept nav-less views
    // like 'profile', or navigating to one immediately bounces to Dashboard.
    navigateTo(isRoutableView(h) ? h : firstAllowedView());
  });

  initOfflineBanner();
}

/* ── Offline banner ────────────────────────────────────────────────────────
   A persistent bar while offline (Firestore's local cache keeps the app
   usable — this just tells the user why writes look instant but haven't
   round-tripped), plus a brief "back online" confirmation on reconnect. */
let _offlineBannerEl: HTMLElement | null = null;

function initOfflineBanner(): void {
  if (_offlineBannerEl) return; // already wired (guards a stray double-call)

  const el = document.createElement('div');
  el.className = 'offline-banner';
  el.hidden = true;
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;text-align:center;padding:.5rem 1rem;font-size:.85rem;font-weight:600;color:#fff;transition:background-color .2s';
  document.body.appendChild(el);
  _offlineBannerEl = el;

  function render() {
    if (navigator.onLine) {
      if (el.hidden) return; // was never shown — nothing to confirm
      el.textContent = t('app.backOnline');
      el.style.backgroundColor = '#16a34a';
      setTimeout(() => { el.hidden = true; }, 2500);
    } else {
      el.hidden = false;
      el.textContent = t('app.offlineBanner');
      el.style.backgroundColor = '#78716c';
    }
  }

  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  onLocaleChange(() => { if (!el.hidden) render(); });
  if (!navigator.onLine) render();
}

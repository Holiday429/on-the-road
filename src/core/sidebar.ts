/* ==========================================================================
   On the Road · Sidebar — header, trip pill, nav sections, mobile bottom nav
   ========================================================================== */

import type { User } from '../firebase/auth.ts';
import { currentTrip, currentRole, currentTripId } from '../data/trip-context.ts';
import { escHtml as escapeHtml } from './utils.ts';
import { t } from './i18n.ts';
import { openTripPopover, closeTripPopover, wireTripCalendarHover, cancelCalendarHover, setTripList } from './trip-popover.ts';
import { openNewTripModal } from './trip-modals.ts';
import profileIcon from '../../icon/profile.png';

export type ViewId = 'today' | 'prep' | 'route' | 'expenses' | 'pack' | 'cities' | 'budget' | 'safety' | 'journal' | 'map' | 'nomad' | 'calendar';

export interface NavItem {
  id: ViewId;
  label: string;
  // Either a PNG asset path, or an emoji glyph when `emoji` is true.
  iconSrc: string;
  emoji?: boolean;
  // `pinned` items render above the Before/During/After sections (e.g. Today).
  section: 'pinned' | 'before' | 'during' | 'after';
}

// Injected by app.ts to avoid a circular import (sidebar needs to navigate,
// check view allowance, and reach the request-badge / account-modal flows).
export interface SidebarHost {
  navItems(): NavItem[];
  isViewAllowed(id: ViewId): boolean;
  navigateTo(id: ViewId): void;
  sessionUser(): User | null;
  sessionPrimaryAction(): void;
}
let host: SidebarHost | null = null;
export function initSidebar(h: SidebarHost): void {
  host = h;
}

/** Localized nav label for a view; falls back to the English NAV_ITEMS label. */
export function navLabel(item: NavItem): string {
  return t(`nav.${item.id}`) || item.label;
}
function sectionLabel(section: 'before' | 'during' | 'after'): string {
  return t(`nav.section${section.charAt(0).toUpperCase()}${section.slice(1)}`);
}

let tripMenuOpen = false;
export function getTripMenuOpen(): boolean { return tripMenuOpen; }
export function setTripMenuOpen(open: boolean): void { tripMenuOpen = open; }

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

export function renderNavIcon(item: NavItem): string {
  if (item.emoji) {
    return `<span class="nav-icon-emoji" aria-hidden="true">${item.iconSrc}</span>`;
  }
  return `<img src="${item.iconSrc}" class="nav-icon-image" alt="" aria-hidden="true">`;
}

function buildSidebarHeader(): string {
  const user = host!.sessionUser();
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
  const item = host!.navItems().find((navItem) => navItem.id === id)!;
  return `
    <span class="view-title-icon" aria-hidden="true">${renderNavIcon(item)}</span>
    <span>${escapeHtml(title?.trim() || navLabel(item))}</span>
  `;
}

export function decorateViewTitles() {
  host!.navItems().forEach((item) => {
    const titleEl = document.querySelector<HTMLElement>(`#view-${item.id} .view-title`);
    if (!titleEl) return;
    // The static HTML seeds each title with its English nav label. Treat that as
    // "no custom title" so it localizes; only a title that differs from the
    // English default (set by a view) is pinned via data-title.
    const seeded = titleEl.dataset.title ?? titleEl.textContent?.trim();
    const custom = seeded && seeded !== item.label ? seeded : undefined;
    if (custom) titleEl.dataset.title = custom;
    // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
    titleEl.innerHTML = renderViewTitleMarkup(item.id, custom);
  });
}

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
export function refreshRequestSubscription() {
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

export function buildSidebar() {
  const sidebar = document.getElementById('sidebar')!;
  const user = host!.sessionUser();
  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  sidebar.innerHTML = `
    ${buildSidebarHeader()}
    ${user ? buildTripPill() : buildGuestPanel()}
    <nav class="sidebar-nav" aria-label="Main navigation">
      ${buildNavSections()}
    </nav>
  `;

  sidebar.querySelector<HTMLElement>('#sidebar-auth-trigger')?.addEventListener('click', () => {
    host!.sessionPrimaryAction();
  });

  // Signed-in profile header → account & billing.
  sidebar.querySelector<HTMLElement>('#sidebar-account-trigger')?.addEventListener('click', () => {
    import('./account.ts').then(({ openAccountModal }) => openAccountModal());
  });

  sidebar.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => host!.navigateTo((item as HTMLElement).dataset.view as ViewId));
  });

  if (user) {
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
    closeTripPopover();
    cancelCalendarHover();

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
    const { listTrips } = await import('../data/trip-context.ts');
    listTrips()
      .then((trips) => {
        setTripList(trips);
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

export function buildMobileNav() {
  const mobileNav = document.getElementById('mobile-nav')!;
  const navItems = host!.navItems().filter(item => host!.isViewAllowed(item.id)).map(item => {
    return `<div class="mobile-nav-item" data-view="${item.id}" role="button" tabindex="0">
      <span class="nav-icon" aria-hidden="true">${renderNavIcon(item)}</span>
      <span class="nav-label">${navLabel(item).split(' ')[0]}</span>
    </div>`;
  }).join('');

  // eslint-disable-next-line no-restricted-syntax -- audited: interpolations escaped via escHtml/safeUrl (N5)
  mobileNav.innerHTML = `<div id="mobile-nav-inner">${navItems}${buildMobileAccountItem()}</div>`;

  mobileNav.querySelectorAll<HTMLElement>('.mobile-nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => host!.navigateTo(item.dataset.view as ViewId));
  });

  mobileNav.querySelector<HTMLElement>('#mobile-account-item')?.addEventListener('click', () => {
    // Real signed-in user → account & billing; guest (anonymous) or no user →
    // the sign-in flow (which upgrades a guest in place).
    const user = host!.sessionUser();
    if (user && !user.isAnonymous) {
      import('./account.ts').then(({ openAccountModal }) => openAccountModal());
    } else {
      host!.sessionPrimaryAction();
    }
  });
}

/** Account/login entry pinned at the end of the mobile bottom nav.
   On phones the sidebar (which hosts the sign-in avatar) is hidden, so this is
   the only way to reach login / account on mobile. */
function buildMobileAccountItem(): string {
  const user = host!.sessionUser();
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

function buildNavSections(): string {
  // Pinned items (Today) sit above the labelled sections, with no header.
  const pinned = host!.navItems()
    .filter(n => n.section === 'pinned' && host!.isViewAllowed(n.id))
    .map(navItemMarkup).join('');
  const sections: ('before' | 'during' | 'after')[] = ['before', 'during', 'after'];
  const grouped = sections.map(section => {
    const items = host!.navItems().filter(n => n.section === section && host!.isViewAllowed(n.id));
    if (!items.length) return ''; // hide an empty section label entirely
    return `
      <div class="nav-section-label">${sectionLabel(section)}</div>
      ${items.map(navItemMarkup).join('')}
    `;
  }).join('');
  return pinned + grouped;
}

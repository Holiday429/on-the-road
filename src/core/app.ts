/* ==========================================================================
   On the Road · App Shell & Router
   ========================================================================== */

import type { User } from '../firebase/auth.ts';
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

const TRIP = {
  name: 'Europe Summer 2026',
  departure: new Date('2026-06-25T00:00:00'),
};

let viewInits: Partial<Record<ViewId, () => void>> = {};
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

export function navigateTo(id: ViewId) {

  // Hide all views
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));

  // Show target
  const el = document.getElementById(`view-${id}`);
  if (el) {
    el.classList.add('active');
    // Lazy init
    if (viewInits[id]) {
      viewInits[id]!();
      delete viewInits[id];
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

function buildSidebar() {
  const sidebar = document.getElementById('sidebar')!;
  const days = daysUntil(TRIP.departure);
  const compactCountdown = days > 0 ? String(days) : String(Math.abs(days));
  const daysText = days > 0
    ? `Departing in <strong>${days} days</strong>`
    : days === 0
    ? `Departing <strong>today!</strong> 🎉`
    : `Trip started <strong>${Math.abs(days)} days</strong> ago`;

  sidebar.innerHTML = `
    ${buildSidebarHeader()}
    <div class="trip-pill">
      <div class="trip-pill-label">Current Trip</div>
      <div class="trip-pill-name">${TRIP.name}</div>
      <div class="trip-pill-date">${compactCountdown}</div>
      <div class="trip-pill-days">${daysText}</div>
    </div>
    <nav class="sidebar-nav" aria-label="Main navigation">
      ${buildNavSections('sidebar')}
    </nav>
  `;

  sidebar.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo((item as HTMLElement).dataset.view as ViewId));
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

export function initApp() {
  document.getElementById('app-topbar')!.innerHTML = '';
  buildSidebar();
  buildMobileNav();
  decorateViewTitles();

  // Route from hash
  const hash = window.location.hash.replace('#', '') as ViewId;
  const validHash = NAV_ITEMS.find(n => n.id === hash);
  navigateTo(validHash ? hash : 'prep');

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace('#', '') as ViewId;
    if (NAV_ITEMS.find(n => n.id === h)) navigateTo(h);
  });
}

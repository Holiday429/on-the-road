/* ==========================================================================
   On the Road · App Shell & Router
   ========================================================================== */

import type { User } from '../firebase/auth.ts';

export type ViewId = 'prep' | 'route' | 'expenses' | 'pack' | 'cities' | 'budget' | 'safety' | 'journal' | 'map';

interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  section: 'before' | 'during' | 'after';
}

const NAV_ITEMS: NavItem[] = [
  // Before
  { id: 'prep',     label: 'Prep checklist', icon: '✅', section: 'before' },
  { id: 'pack',     label: 'Pack formula',   icon: '🎒', section: 'before' },
  { id: 'budget',   label: 'Stay finder',    icon: '🏠', section: 'before' },
  // During
  { id: 'route',    label: 'Itinerary',      icon: '🗺️', section: 'during' },
  { id: 'cities',   label: 'City intel',     icon: '🏛️', section: 'during' },
  { id: 'safety',   label: 'Safety kit',     icon: '🛡️', section: 'during' },
  { id: 'expenses', label: 'Expenses',       icon: '💰', section: 'during' },
  // After
  { id: 'journal',  label: 'Journal',        icon: '📓', section: 'after'  },
  { id: 'map',      label: 'My map',         icon: '🌍', section: 'after'  },
];

const SECTION_LABELS = { before: 'Before', during: 'On the road', after: 'After' };

// Trip meta — will come from Firebase later
const TRIP = {
  name: 'Europe Summer 2025',
  departure: new Date('2025-06-25'),
};

let viewInits: Partial<Record<ViewId, () => void>> = {};

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
  const daysText = days > 0
    ? `Departing in <strong>${days} days</strong>`
    : days === 0
    ? `Departing <strong>today!</strong> 🎉`
    : `Trip started <strong>${Math.abs(days)} days</strong> ago`;

  sidebar.innerHTML = `
    <div class="sidebar-header">
      <img src="/logo.svg" class="sidebar-logo" alt="On the Road">
      <div class="sidebar-wordmark">On the <span>Road</span></div>
    </div>
    <div class="trip-pill">
      <div class="trip-pill-label">Current trip</div>
      <div class="trip-pill-name">${TRIP.name}</div>
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
  // Show only 5 most important on mobile
  const mobileItems = ['prep', 'route', 'expenses', 'cities', 'pack'] as ViewId[];
  mobileNav.innerHTML = mobileItems.map(id => {
    const item = NAV_ITEMS.find(n => n.id === id)!;
    return `<div class="mobile-nav-item" data-view="${id}" role="button" tabindex="0">
      <span class="nav-icon" aria-hidden="true">${item.icon}</span>
      <span class="nav-label">${item.label.split(' ')[0]}</span>
    </div>`;
  }).join('');

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
          <span class="nav-icon" aria-hidden="true">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
        </div>
      `).join('')}
    `;
  }).join('');
}

export function renderSession(user: User, onSignOut: () => void) {
  const topbar = document.getElementById('app-topbar');
  if (!topbar) return;

  const displayName = escapeHtml(user.displayName?.trim() || 'Traveler');
  const email = escapeHtml(user.email?.trim() || '');
  const photo = user.photoURL?.trim();
  const avatar = photo
    ? `<img src="${escapeHtml(photo)}" alt="${displayName}" class="session-avatar-image">`
    : `<div class="session-avatar-fallback">${initialsFor(user)}</div>`;

  topbar.innerHTML = `
    <div class="app-topbar-inner">
      <div class="app-topbar-copy">
        <div class="app-topbar-label">Signed in</div>
        <div class="app-topbar-title">${displayName}</div>
        ${email ? `<div class="app-topbar-subtitle">${email}</div>` : ''}
      </div>
      <div class="session-card">
        <div class="session-avatar">${avatar}</div>
        <button id="sign-out-btn" class="btn btn-ghost session-signout-btn" type="button">Sign out</button>
      </div>
    </div>
  `;

  topbar.querySelector<HTMLButtonElement>('#sign-out-btn')?.addEventListener('click', onSignOut);
}

export function initApp() {
  buildSidebar();
  buildMobileNav();

  // Route from hash
  const hash = window.location.hash.replace('#', '') as ViewId;
  const validHash = NAV_ITEMS.find(n => n.id === hash);
  navigateTo(validHash ? hash : 'prep');

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace('#', '') as ViewId;
    if (NAV_ITEMS.find(n => n.id === h)) navigateTo(h);
  });
}

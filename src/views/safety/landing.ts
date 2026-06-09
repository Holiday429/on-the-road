/* ==========================================================================
   On the Road · Safety landing — quick-info card, entry buttons, city grid
   ========================================================================== */

import type { StoredCitySafety } from '../../data/stores/safety-store.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';

export interface LandingCallbacks {
  onCityClick: (card: StoredCitySafety) => void;
  onCityGenerate: (city: string, country: string, flag: string) => void;
  onProfileOpen: () => void;
  onEssentialsOpen: () => void;
  onSearch: (city: string) => void;
  onLocationRefresh: () => void;
}

function esc(v: string): string {
  return v
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function slugId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function mapSearchUrl(name: string, city: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${city}`)}`;
}

/* ── Current-location quick card ─────────────────────────────────────────── */
export interface LocationState {
  city: string;
  country: string;
  flag: string;
  source: 'gps' | 'itinerary' | 'none';
  card: StoredCitySafety | null;
  loading: boolean;
}

function renderLocationCard(loc: LocationState): string {
  if (loc.loading) {
    return `<div class="sfy-loc-card sfy-loc-loading">
      <span class="sfy-spinner"></span> Locating…
    </div>`;
  }
  if (loc.source === 'none') return '';

  const { city, country, flag, card } = loc;
  const emergency = card?.generalEmergency || '112';
  const hospital = card?.hospitals?.[0];
  const embassyName = card?.embassy?.name;

  const quickLinks = `
    <div class="sfy-loc-links">
      <a class="sfy-loc-link" href="tel:${emergency.replace(/[^+0-9]/g, '')}">
        <span class="sfy-loc-link-icon">☎</span>
        <span>${esc(emergency)}</span>
      </a>
      ${hospital ? `<a class="sfy-loc-link" href="${mapSearchUrl(hospital.name, city)}" target="_blank" rel="noopener">
        <span class="sfy-loc-link-icon">🏥</span>
        <span>Hospital</span>
      </a>` : ''}
      ${embassyName ? `<a class="sfy-loc-link" href="${mapSearchUrl(embassyName, city)}" target="_blank" rel="noopener">
        <span class="sfy-loc-link-icon">🏛</span>
        <span>Embassy</span>
      </a>` : ''}
      ${card ? `<button class="sfy-loc-link sfy-loc-link-btn" data-open-city="${esc(card.id)}">
        <span class="sfy-loc-link-icon">🛡</span>
        <span>Full card</span>
      </button>` : ''}
    </div>`;

  const badge = loc.source === 'gps'
    ? `<span class="sfy-loc-badge sfy-loc-badge-gps">📍 Live</span>`
    : `<span class="sfy-loc-badge sfy-loc-badge-itinerary">🗓 Itinerary</span>`;

  return `
    <div class="sfy-loc-card">
      <div class="sfy-loc-head">
        <div class="sfy-loc-place">
          <span class="sfy-loc-flag">${esc(flag) || '📍'}</span>
          <div>
            <div class="sfy-loc-city">${esc(city)}</div>
            <div class="sfy-loc-country">${esc(country)}</div>
          </div>
        </div>
        <div class="sfy-loc-meta">
          ${badge}
          ${!card ? `<span class="sfy-loc-hint">Tap a city card below to generate</span>` : ''}
        </div>
      </div>
      ${quickLinks}
    </div>`;
}

/* ── Profile + Essentials entry row ──────────────────────────────────────── */
function renderEntryRow(hasProfile: boolean): string {
  return `
    <div class="sfy-entry-row">
      <button class="sfy-entry-btn" id="sfy-profile-open">
        <div class="sfy-entry-icon">🆘</div>
        <div class="sfy-entry-text">
          <div class="sfy-entry-title">My emergency card</div>
          <div class="sfy-entry-sub">${hasProfile ? 'Tap to view or edit' : 'Not set up yet'}</div>
        </div>
        <span class="sfy-entry-arrow">›</span>
      </button>
      <button class="sfy-entry-btn" id="sfy-essentials-open">
        <div class="sfy-entry-icon">🧳</div>
        <div class="sfy-entry-text">
          <div class="sfy-entry-title">Before you go</div>
          <div class="sfy-entry-sub">Solo travel checklist</div>
        </div>
        <span class="sfy-entry-arrow">›</span>
      </button>
    </div>`;
}

/* ── City grid ───────────────────────────────────────────────────────────── */
function renderCityGrid(cards: StoredCitySafety[], legs: StoredLeg[]): string {
  const haveSlugs = new Set(cards.map((c) => c.id));
  const pending = legs
    .filter((l) => !haveSlugs.has(slugId(l.city)))
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  const cardTiles = cards.map((c) => `
    <button class="sfy-tile" data-city-id="${esc(c.id)}">
      <div class="sfy-tile-flag">${esc(c.flag) || '🛡️'}</div>
      <div class="sfy-tile-name">${esc(c.city)}</div>
      <div class="sfy-tile-country">${esc(c.country)}</div>
      <div class="sfy-tile-icons">
        <span title="Emergency">🚨</span>
        <span title="Embassy">🏛</span>
        <span title="Hospital">🏥</span>
        <span title="Phrases">💬</span>
      </div>
    </button>`).join('');

  const pendingTiles = pending.map((l) => `
    <button class="sfy-tile sfy-tile-pending"
      data-gen-city="${esc(l.city)}"
      data-gen-country="${esc(l.country)}"
      data-gen-flag="${esc(l.flag)}">
      <div class="sfy-tile-flag">${esc(l.flag) || '📍'}</div>
      <div class="sfy-tile-name">${esc(l.city)}</div>
      <div class="sfy-tile-country">${esc(l.country)}</div>
      <div class="sfy-tile-icons sfy-tile-icons-dim">
        <span>🚨</span><span>🏛</span><span>🏥</span><span>💬</span>
      </div>
    </button>`).join('');

  if (!cardTiles && !pendingTiles) {
    return `<div class="sfy-grid-empty">
      <div class="empty-icon">🛡️</div>
      <p>Add cities to your itinerary, or search below, to build safety cards.</p>
    </div>`;
  }
  return cardTiles + pendingTiles;
}

/* ── Full landing render ─────────────────────────────────────────────────── */
export function renderLanding(
  loc: LocationState,
  cards: StoredCitySafety[],
  legs: StoredLeg[],
  hasProfile: boolean,
  generating: boolean,
  generateStatus: string,
): string {
  return `
    <div class="sfy-landing">
      <div class="sfy-loc-wrap" id="sfy-loc-wrap">
        ${renderLocationCard(loc)}
      </div>

      ${renderEntryRow(hasProfile)}

      <div class="sfy-section-head sfy-section-head-row">
        <h2>City safety cards</h2>
        <div class="sfy-search-row">
          <input class="input sfy-search-input" id="sfy-search-input" placeholder="Search a city…" autocomplete="off">
          <button class="btn btn-primary sfy-sm" id="sfy-search-btn">
            ${generating ? '<span class="sfy-spinner sfy-spinner-sm"></span>' : 'Generate'}
          </button>
        </div>
      </div>
      ${generateStatus ? `<div class="sfy-gen-status">${generateStatus}</div>` : ''}
      <div class="sfy-city-grid" id="sfy-city-grid">
        ${renderCityGrid(cards, legs)}
      </div>
    </div>`;
}

/* ── Landing wire (event delegation) ────────────────────────────────────── */
export function wireLanding(root: HTMLElement, cb: LandingCallbacks, cards: StoredCitySafety[]): void {
  // Profile / essentials entry buttons
  const profileBtn = root.querySelector<HTMLButtonElement>('#sfy-profile-open');
  if (profileBtn && !profileBtn.dataset.wired) {
    profileBtn.dataset.wired = '1';
    profileBtn.addEventListener('click', cb.onProfileOpen);
  }
  const essBtn = root.querySelector<HTMLButtonElement>('#sfy-essentials-open');
  if (essBtn && !essBtn.dataset.wired) {
    essBtn.dataset.wired = '1';
    essBtn.addEventListener('click', cb.onEssentialsOpen);
  }

  // Location card "Full card" button
  root.querySelectorAll<HTMLButtonElement>('[data-open-city]').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const id = btn.dataset.openCity!;
      const card = cards.find((c) => c.id === id);
      if (card) cb.onCityClick(card);
    });
  });

  // City tile clicks
  root.querySelectorAll<HTMLButtonElement>('.sfy-tile[data-city-id]').forEach((t) => {
    if (t.dataset.wired) return;
    t.dataset.wired = '1';
    t.addEventListener('click', () => {
      const card = cards.find((c) => c.id === t.dataset.cityId);
      if (card) cb.onCityClick(card);
    });
  });

  // Pending tile clicks (generate)
  root.querySelectorAll<HTMLButtonElement>('.sfy-tile-pending').forEach((t) => {
    if (t.dataset.wired) return;
    t.dataset.wired = '1';
    t.addEventListener('click', () => cb.onCityGenerate(
      t.dataset.genCity!,
      t.dataset.genCountry ?? '',
      t.dataset.genFlag ?? '',
    ));
  });

  // Search
  const searchInput = root.querySelector<HTMLInputElement>('#sfy-search-input');
  const searchBtn = root.querySelector<HTMLButtonElement>('#sfy-search-btn');
  if (searchInput && searchBtn && !searchBtn.dataset.wired) {
    searchBtn.dataset.wired = '1';
    const go = () => {
      const q = searchInput.value.trim();
      if (q) { cb.onSearch(q); searchInput.value = ''; }
    };
    searchBtn.addEventListener('click', go);
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
}

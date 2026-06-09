/* ==========================================================================
   On the Road · Safety landing — quick-info card, entry buttons, city grid
   ========================================================================== */

import type { StoredCitySafety } from '../../data/stores/safety-store.ts';
import type { StoredLeg } from '../../data/stores/route-store.ts';
import { escHtml as esc, slugId } from '../../core/utils.ts';

export interface LandingCallbacks {
  onCityClick: (card: StoredCitySafety) => void;
  onCityGenerate: (city: string, country: string, flag: string) => void;
  onProfileOpen: () => void;
  onEssentialsOpen: () => void;
  onSearch: (city: string) => void;
  onLocationRefresh: () => void;
}

/* ── LocationState (exported, used by safety.ts SOS bar) ─────────────────── */
export interface LocationState {
  city: string;
  country: string;
  flag: string;
  source: 'gps' | 'itinerary' | 'none' | 'manual';
  card: StoredCitySafety | null;
  loading: boolean;
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
  const seenPending = new Set<string>();
  const pending = legs
    .filter((l) => {
      const id = slugId(l.city);
      if (haveSlugs.has(id) || seenPending.has(id)) return false;
      seenPending.add(id);
      return true;
    })
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  // Prefer the itinerary leg's flag (always correct); fall back to card's stored flag
  const legFlagFor = (cityId: string): string => {
    const match = legs.find((l) => slugId(l.city) === cityId);
    return match?.flag ?? '';
  };

  const cardTiles = cards.map((c) => {
    const flag = legFlagFor(c.id) || c.flag || '🛡️';
    return `
    <button class="sfy-tile" data-city-id="${esc(c.id)}">
      <div class="sfy-tile-flag">${esc(flag)}</div>
      <div class="sfy-tile-name">${esc(c.city)}</div>
      <div class="sfy-tile-country">${esc(c.country)}</div>
      <div class="sfy-tile-icons">
        <span title="Emergency">🚨</span>
        <span title="Embassy">🏛</span>
        <span title="Hospital">🏥</span>
        <span title="Phrases">💬</span>
      </div>
    </button>`;
  }).join('');

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
  cards: StoredCitySafety[],
  legs: StoredLeg[],
  hasProfile: boolean,
  generating: boolean,
  generateStatus: string,
): string {
  return `
    <div class="sfy-landing">
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

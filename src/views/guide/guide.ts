/* ==========================================================================
   On the Road · Guide — AI city travel guide
   ========================================================================== */

import './guide.css';
import { cityStore, type StoredCityIntel } from '../../data/stores/city-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { searchDestinations, COUNTRIES } from '../../data/destinations.ts';
import type { GuideCard, CityWalk, GuideTip, CityIntel } from '../../data/schema.ts';

// ── State ─────────────────────────────────────────────────────────────────────

let _cities: StoredCityIntel[] = [];
let _legs: StoredLeg[] = [];
let _activeCityId: string | null = null;
let _activeTab: TabKey = 'intro';
let _unsubCities: (() => void) | null = null;
let _unsubLegs: (() => void) | null = null;
let _wired = false;
// Selected city from autocomplete (before generate is pressed)
let _selectedCity: { label: string; country: string } | null = null;
// Transient sample shown when the API is unreachable — never persisted.
let _previewIntel: (CityIntel & { id: string }) | null = null;
// History panel visibility
let _historyOpen = false;

type TabKey = 'intro' | 'attractions' | 'cityWalks' | 'restaurants' | 'cafes' | 'experiences' | 'know' | 'moneyTips';

interface Tab { key: TabKey; label: string; icon: string; isDo: boolean; }

const TABS: Tab[] = [
  { key: 'intro',       label: 'Overview',    icon: '🏙️',  isDo: false },
  { key: 'attractions', label: 'Attractions', icon: '🏛️',  isDo: true  },
  { key: 'cityWalks',   label: 'City Walk',   icon: '🚶',  isDo: true  },
  { key: 'restaurants', label: 'Restaurants', icon: '🍽️',  isDo: true  },
  { key: 'cafes',       label: 'Cafés',       icon: '☕',  isDo: true  },
  { key: 'experiences', label: 'Experiences', icon: '✨',  isDo: true  },
  { key: 'know',        label: 'Culture',     icon: '💡',  isDo: false },
  { key: 'moneyTips',   label: 'Budget',      icon: '💸',  isDo: false },
];

function slugId(city: string) {
  return city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── API call + SSE streaming ──────────────────────────────────────────────────

async function generateGuide(city: string, country: string, query: string): Promise<void> {
  const root = document.getElementById('view-cities')!;
  const id = slugId(city);
  _previewIntel = null;
  const statusEl0 = document.getElementById('guide-search-status');
  if (statusEl0) statusEl0.textContent = '';

  showSkeleton(root, city, country);

  try {
    const apiBase = window.location.hostname.includes('github.io')
      ? 'https://easy-on-the-road.vercel.app'
      : '';
    const res = await fetch(`${apiBase}/api/guide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, country, query }),
    });

    if (!res.ok || !res.body) throw new Error(`API error ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const intel: Partial<CityIntel> & { id: string } = {
      id, city, country,
      bannerColor: '#fde68a',
      generatedQuery: query,
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const { section, payload } = JSON.parse(line.slice(6));
          applySection(intel, section, payload);
          await cityStore.save(intel as CityIntel & { id: string });
          _activeCityId = id;
          renderCityDetail(root);
        } catch { /* partial JSON */ }
      }
    }
  } catch (err) {
    // API failed — show a sample preview WITHOUT persisting it to Firestore,
    // so a transient outage never poisons the cache with mock data.
    console.warn('Guide API unavailable, showing sample (not saved):', err);
    const statusEl = document.getElementById('guide-search-status');
    if (statusEl) {
      statusEl.textContent = 'Couldn’t reach the AI service — showing a sample. Try Regen in a moment.';
    }
    const mock = getMockIntel(city, country) as CityIntel & { id: string };
    mock.id = id;
    _previewIntel = mock;
    _activeCityId = id;
    renderHistoryBar(root);
    renderCityDetail(root);
  }
}

function applySection(intel: Partial<CityIntel> & { id: string }, section: string, payload: unknown) {
  const p = payload as Record<string, unknown>;
  switch (section) {
    case 'meta':
      Object.assign(intel, { flag: p.flag, bannerColor: p.bannerColor, intro: p.intro, funFacts: p.funFacts });
      break;
    case 'know':
      Object.assign(intel, {
        greetings: p.greetings, customs: p.customs, taboos: p.taboos,
        neighborhoods: p.neighborhoods, safetyTips: p.safetyTips, transport: p.transport,
      });
      break;
    case 'attractions': intel.attractions = payload as GuideCard[]; break;
    case 'cityWalks':   intel.cityWalks   = payload as CityWalk[];  break;
    case 'restaurants': intel.restaurants = payload as GuideCard[]; break;
    case 'cafes':       intel.cafes       = payload as GuideCard[]; break;
    case 'experiences': intel.experiences = payload as GuideCard[]; break;
    case 'moneyTips':   intel.moneyTips   = payload as GuideTip[];  break;
  }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function showSkeleton(_root: HTMLElement, city: string, country: string) {
  const detail = document.querySelector<HTMLElement>('#view-cities .guide-detail')!;
  detail.innerHTML = `
    <div class="guide-detail-header guide-skeleton-header">
      <div class="guide-skeleton guide-skeleton-flag"></div>
      <div class="guide-detail-header-text">
        <div class="guide-skeleton guide-skeleton-title"></div>
        <div class="guide-skeleton guide-skeleton-sub"></div>
      </div>
    </div>
    <div class="guide-generating-msg">
      <div class="city-loading-spinner"></div>
      <span>Generating guide for <strong>${city}, ${country || 'finding country…'}</strong></span>
    </div>
    <div class="guide-skeleton-cards">
      ${Array(4).fill('<div class="guide-skeleton guide-skeleton-card"></div>').join('')}
    </div>
  `;
  detail.classList.add('active');
}

// ── History (collapsible panel behind the 🕘 button) ──────────────────────────

function renderHistoryBar(root: HTMLElement) {
  const toggle = document.getElementById('guide-history-toggle');
  const panel  = document.getElementById('guide-history-panel');
  if (!toggle || !panel) return;

  // Toggle label shows the count; hide entirely when empty.
  const wrap = toggle.closest<HTMLElement>('.guide-history-wrap');
  if (!_cities.length) {
    if (wrap) wrap.style.display = 'none';
    panel.classList.remove('open');
    _historyOpen = false;
    return;
  }
  if (wrap) wrap.style.display = '';
  toggle.innerHTML = `🕘 History <span class="guide-history-count">${_cities.length}</span>`;

  panel.classList.toggle('open', _historyOpen);
  panel.innerHTML = _cities.map(c => `
    <div class="guide-history-row ${c.id === _activeCityId ? 'active' : ''}" data-id="${c.id}">
      <span class="guide-history-row-flag">${c.flag || '🗺️'}</span>
      <div class="guide-history-row-text">
        <div class="guide-history-row-name">${c.city}</div>
        <div class="guide-history-row-country">${c.country}</div>
      </div>
      <button class="guide-history-del" data-id="${c.id}" title="Remove">×</button>
    </div>
  `).join('');

  panel.querySelectorAll<HTMLElement>('.guide-history-row').forEach(el => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('guide-history-del')) return;
      _activeCityId = el.dataset.id!;
      _activeTab = 'intro';
      _historyOpen = false;
      renderHistoryBar(root);
      renderCityDetail(root);
    });
  });

  panel.querySelectorAll<HTMLElement>('.guide-history-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id!;
      cityStore.remove(id);
      if (_activeCityId === id) {
        _activeCityId = _cities.find(c => c.id !== id)?.id ?? null;
        renderCityDetail(root);
      }
    });
  });
}

// kept for compatibility — now delegates to renderHistoryBar
function renderCityList(root: HTMLElement) { renderHistoryBar(root); }

// ── Main detail view ──────────────────────────────────────────────────────────

function renderCityDetail(_root: HTMLElement) {
  const detail = document.querySelector<HTMLElement>('#view-cities .guide-detail')!;
  // Stored cities win; fall back to a transient preview if the API failed.
  const intel = _cities.find(c => c.id === _activeCityId)
    ?? (_previewIntel?.id === _activeCityId ? _previewIntel as StoredCityIntel : undefined);

  if (!intel) {
    detail.innerHTML = `
      <div class="guide-empty-detail">
        <div class="empty-icon">🗺️</div>
        <p>Select a city or search for a new one above</p>
      </div>
    `;
    detail.classList.remove('active');
    return;
  }

  detail.classList.add('active');
  detail.innerHTML = `
    <div class="guide-detail-header" style="background:${intel.bannerColor}20;border-color:${intel.bannerColor}60">
      <div class="guide-detail-flag">${intel.flag || '🗺️'}</div>
      <div class="guide-detail-header-text">
        <div class="guide-detail-city">${intel.city}</div>
        <div class="guide-detail-country">${intel.country}</div>
        ${intel.generatedQuery ? `<div class="guide-detail-query">🔍 "${intel.generatedQuery}"</div>` : ''}
      </div>
      <button class="btn btn-ghost guide-regen-btn" data-id="${intel.id}" style="font-size:var(--fs-sm);white-space:nowrap">↺ Regen</button>
    </div>

    <div class="guide-tabs" role="tablist">
      ${TABS.map(t => `
        <button class="guide-tab ${_activeTab === t.key ? 'active' : ''} ${t.isDo ? 'tab-do' : 'tab-know'}"
          data-tab="${t.key}" role="tab">
          <span>${t.icon}</span><span class="guide-tab-label">${t.label}</span>
        </button>
      `).join('')}
    </div>

    <div class="guide-tab-content" id="guide-tab-content">
      ${renderTabContent(intel)}
    </div>

    <div class="guide-ai-notice">✦ AI-generated · verify details before travel</div>
  `;

  detail.querySelectorAll<HTMLElement>('.guide-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _activeTab = tab.dataset.tab as TabKey;
      detail.querySelectorAll('.guide-tab').forEach(t => t.classList.toggle('active', t === tab));
      const content = detail.querySelector<HTMLElement>('#guide-tab-content')!;
      content.innerHTML = renderTabContent(intel);
      wireTabContent(detail, intel);
    });
  });

  detail.querySelector('.guide-regen-btn')?.addEventListener('click', () => {
    const queryBox = document.getElementById('guide-refine-input') as HTMLInputElement | null;
    generateGuide(intel.city, intel.country, queryBox?.value.trim() ?? '');
  });

  wireTabContent(detail, intel);
}

// ── Tab renderers ─────────────────────────────────────────────────────────────

function renderTabContent(intel: StoredCityIntel): string {
  switch (_activeTab) {
    case 'intro':       return renderIntroTab(intel);
    case 'attractions': return renderCardGrid(intel.attractions ?? [], intel.city, 'attraction');
    case 'cityWalks':   return renderWalkGrid(intel.cityWalks ?? [], intel.city);
    case 'restaurants': return renderCardGrid(intel.restaurants ?? [], intel.city, 'restaurant');
    case 'cafes':       return renderCardGrid(intel.cafes ?? [], intel.city, 'cafe');
    case 'experiences': return renderCardGrid(intel.experiences ?? [], intel.city, 'experience');
    case 'know':        return renderKnowTab(intel);
    case 'moneyTips':   return renderMoneyTab(intel.moneyTips ?? []);
    default: return '';
  }
}

function renderIntroTab(intel: StoredCityIntel): string {
  if (!intel.intro && !intel.funFacts?.length) return renderSectionLoading('Overview is being generated…');
  return `
    <div class="guide-intro">
      ${intel.intro ? `<p class="guide-intro-text">${intel.intro}</p>` : ''}
      ${intel.funFacts?.length ? `
        <div class="guide-fun-facts">
          ${intel.funFacts.map(f => `<div class="guide-fun-fact">⚡ ${f}</div>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderCardGrid(cards: GuideCard[], city: string, type: string): string {
  if (!cards.length) return renderSectionLoading(`Loading ${type} recommendations…`);
  return `<div class="guide-card-grid">${cards.map((c, i) => renderFlipCard(c, city, type, i)).join('')}</div>`;
}

function renderFlipCard(card: GuideCard, _city: string, type: string, _i: number): string {
  const s = card.saved;
  return `
    <div class="guide-flip-wrap ${s ? 'saved' : ''}" data-card-id="${card.id}" data-card-type="${type}">
      <div class="guide-flip-inner">
        <div class="guide-flip-front">
          <div class="guide-card-badge">${typeEmoji(type)}</div>
          <div class="guide-card-title">${card.title}</div>
          <div class="guide-card-highlight">${card.highlight}</div>
          <div class="guide-card-meta">
            ${card.duration ? `<span>⏱ ${card.duration}</span>` : ''}
            ${card.cost ? `<span>💰 ${card.cost}</span>` : ''}
          </div>
          <div class="guide-card-hint">tap to flip</div>
          <div class="guide-card-btns">
            <button class="guide-icon-btn guide-save-btn ${s ? 'saved' : ''}" data-card-id="${card.id}" data-card-type="${type}" title="Bookmark">${s ? '★' : '☆'}</button>
            <button class="guide-icon-btn guide-commit-btn" data-card-id="${card.id}" data-card-type="${type}" title="Add to itinerary">＋</button>
          </div>
        </div>
        <div class="guide-flip-back">
          <div class="guide-card-title">${card.title}</div>
          <p class="guide-card-detail">${card.detail}</p>
          ${card.background ? `<div class="guide-card-bg">💡 ${card.background}</div>` : ''}
          ${card.address ? `<div class="guide-card-addr">📍 ${card.address}</div>` : ''}
          ${card.searchUrl ? `<a class="guide-card-link" href="${card.searchUrl}" target="_blank" rel="noopener">🔍 Google</a>` : ''}
          <div class="guide-card-btns">
            <button class="guide-icon-btn guide-save-btn ${s ? 'saved' : ''}" data-card-id="${card.id}" data-card-type="${type}" title="Bookmark">${s ? '★' : '☆'}</button>
            <button class="guide-icon-btn guide-commit-btn" data-card-id="${card.id}" data-card-type="${type}" title="Add to itinerary">＋ Add to trip</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderWalkGrid(walks: CityWalk[], city: string): string {
  if (!walks.length) return renderSectionLoading('City walk routes are being generated…');
  return `<div class="guide-card-grid">${walks.map((w, i) => renderWalkCard(w, city, i)).join('')}</div>`;
}

function renderWalkCard(walk: CityWalk, _city: string, _i: number): string {
  const s = walk.saved;
  return `
    <div class="guide-flip-wrap walk-card ${s ? 'saved' : ''}" data-card-id="${walk.id}" data-card-type="cityWalk">
      <div class="guide-flip-inner">
        <div class="guide-flip-front">
          <div class="guide-card-badge">🚶</div>
          <div class="guide-card-title">${walk.title}</div>
          <div class="guide-card-highlight">${walk.highlight}</div>
          <div class="guide-card-meta">
            ${walk.duration ? `<span>⏱ ${walk.duration}</span>` : ''}
            ${walk.distance ? `<span>📏 ${walk.distance}</span>` : ''}
          </div>
          <div class="guide-card-hint">tap to flip</div>
          <div class="guide-card-btns">
            <button class="guide-icon-btn guide-save-btn ${s ? 'saved' : ''}" data-card-id="${walk.id}" data-card-type="cityWalk" title="Bookmark">${s ? '★' : '☆'}</button>
            <button class="guide-icon-btn guide-commit-btn" data-card-id="${walk.id}" data-card-type="cityWalk" title="Add to itinerary">＋</button>
          </div>
        </div>
        <div class="guide-flip-back">
          <div class="guide-card-title">${walk.title}</div>
          <p class="guide-card-detail" style="white-space:pre-line">${walk.detail}</p>
          ${walk.background ? `<div class="guide-card-bg">💡 ${walk.background}</div>` : ''}
          ${walk.searchUrl ? `<a class="guide-card-link" href="${walk.searchUrl}" target="_blank" rel="noopener">🔍 Google</a>` : ''}
          <div class="guide-card-btns">
            <button class="guide-icon-btn guide-save-btn ${s ? 'saved' : ''}" data-card-id="${walk.id}" data-card-type="cityWalk" title="Bookmark">${s ? '★' : '☆'}</button>
            <button class="guide-icon-btn guide-commit-btn" data-card-id="${walk.id}" data-card-type="cityWalk" title="Add to itinerary">＋ Add to trip</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderKnowTab(intel: StoredCityIntel): string {
  if (!intel.greetings?.length && !intel.customs?.length) return renderSectionLoading('Cultural notes are being generated…');
  return `
    <div class="guide-know-grid">
      ${intel.greetings?.length ? `
        <div class="guide-know-section">
          <div class="guide-know-title">🗣️ Greetings</div>
          ${intel.greetings.map(g => `
            <div class="guide-know-item">
              <strong>${g.phrase}</strong>${g.pronunciation ? `<span class="muted"> · ${g.pronunciation}</span>` : ''}
              ${g.meaning ? `<div class="guide-know-meaning">${g.meaning}</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${intel.customs?.length ? `
        <div class="guide-know-section">
          <div class="guide-know-title">🤝 Customs</div>
          <ul>${intel.customs.map(c => `<li>${c}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${intel.taboos?.length ? `
        <div class="guide-know-section">
          <div class="guide-know-title">⚠️ Avoid</div>
          <ul>${intel.taboos.map(t => `<li>${t}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${intel.neighborhoods?.length ? `
        <div class="guide-know-section">
          <div class="guide-know-title">🏘️ Neighbourhoods</div>
          ${intel.neighborhoods.map(n => `
            <div class="guide-know-item">
              <strong>${n.name}</strong>
              <div class="guide-know-meaning">${n.vibe}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${intel.safetyTips?.length ? `
        <div class="guide-know-section guide-safety-section">
          <div class="guide-know-title">🛡️ Safety</div>
          <ul>${intel.safetyTips.map(t => `<li>${t}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${intel.transport?.length ? `
        <div class="guide-know-section">
          <div class="guide-know-title">🚌 Getting Around</div>
          <ul>${intel.transport.map(t => `<li>${t}</li>`).join('')}</ul>
        </div>
      ` : ''}
    </div>
  `;
}

function renderMoneyTab(tips: GuideTip[]): string {
  if (!tips.length) return renderSectionLoading('Budget tips are being generated…');
  return `
    <div class="guide-money-list">
      ${tips.map(t => `
        <div class="guide-money-tip">
          <span class="guide-money-icon">💸</span>
          <span class="guide-money-text">${t.text}</span>
          <button class="guide-icon-btn guide-tip-save ${t.saved ? 'saved' : ''}" data-tip-id="${t.id}" title="Save">${t.saved ? '★' : '☆'}</button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSectionLoading(msg: string): string {
  return `
    <div class="guide-section-loading">
      <div class="city-loading-spinner"></div>
      <span>${msg}</span>
    </div>
  `;
}

function typeEmoji(type: string): string {
  const map: Record<string, string> = { attraction: '🏛️', restaurant: '🍽️', cafe: '☕', experience: '✨' };
  return map[type] ?? '📍';
}

// ── Interactions ──────────────────────────────────────────────────────────────

function wireTabContent(detail: HTMLElement, intel: StoredCityIntel) {
  // Flip on card click (not button/link)
  detail.querySelectorAll<HTMLElement>('.guide-flip-wrap').forEach(wrap => {
    wrap.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.guide-icon-btn, a')) return;
      wrap.classList.toggle('flipped');
    });
  });

  // Save bookmark
  detail.querySelectorAll<HTMLElement>('.guide-save-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      toggleSaved(intel, btn.dataset.cardId!, btn.dataset.cardType!);
      await cityStore.save(intel);
      // Update all matching buttons for this card (front + back)
      const card = findCard(intel, btn.dataset.cardId!, btn.dataset.cardType!);
      const saved = card?.saved ?? false;
      detail.querySelectorAll<HTMLElement>(`.guide-save-btn[data-card-id="${btn.dataset.cardId}"]`).forEach(b => {
        b.textContent = saved ? '★' : '☆';
        b.classList.toggle('saved', saved);
      });
      detail.querySelector<HTMLElement>(`.guide-flip-wrap[data-card-id="${btn.dataset.cardId}"]`)?.classList.toggle('saved', saved);
    });
  });

  // Commit to itinerary
  detail.querySelectorAll<HTMLElement>('.guide-commit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCommitModal(intel, btn.dataset.cardId!, btn.dataset.cardType!);
    });
  });

  // Save money tip
  detail.querySelectorAll<HTMLElement>('.guide-tip-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tip = intel.moneyTips?.find(t => t.id === btn.dataset.tipId);
      if (tip) {
        tip.saved = !tip.saved;
        await cityStore.save(intel);
        btn.classList.toggle('saved', tip.saved);
        btn.textContent = tip.saved ? '★' : '☆';
      }
    });
  });
}

function toggleSaved(intel: StoredCityIntel, cardId: string, cardType: string) {
  const listKey: Record<string, (GuideCard | CityWalk)[] | undefined> = {
    attraction: intel.attractions, cityWalk: intel.cityWalks,
    restaurant: intel.restaurants, cafe: intel.cafes, experience: intel.experiences,
  };
  const card = listKey[cardType]?.find(c => c.id === cardId);
  if (card) card.saved = !card.saved;
}

function findCard(intel: StoredCityIntel, cardId: string, cardType: string): GuideCard | CityWalk | null {
  const listKey: Record<string, (GuideCard | CityWalk)[] | undefined> = {
    attraction: intel.attractions, cityWalk: intel.cityWalks,
    restaurant: intel.restaurants, cafe: intel.cafes, experience: intel.experiences,
  };
  return listKey[cardType]?.find(c => c.id === cardId) ?? null;
}

// ── Commit modal ──────────────────────────────────────────────────────────────

function openCommitModal(intel: StoredCityIntel, cardId: string, cardType: string) {
  const card = findCard(intel, cardId, cardType);
  if (!card) return;

  const matchedLegs = _legs.filter(l =>
    l.city.toLowerCase().includes(intel.city.toLowerCase()) ||
    intel.city.toLowerCase().includes(l.city.toLowerCase())
  );
  const otherLegs = _legs.filter(l => !matchedLegs.includes(l));

  document.getElementById('guide-commit-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'guide-commit-modal';
  modal.className = 'guide-modal-overlay';
  modal.innerHTML = `
    <div class="guide-modal">
      <div class="guide-modal-header">
        <div class="guide-modal-title">Add to itinerary</div>
        <button class="guide-modal-close btn btn-ghost" style="padding:6px 10px">×</button>
      </div>
      <div class="guide-modal-body">
        <div class="guide-modal-card-preview">
          <span>${typeEmoji(cardType)}</span>
          <strong>${card.title}</strong>
        </div>
        <label class="guide-modal-label">Choose leg</label>
        <select class="input guide-modal-leg-select" ${!_legs.length ? 'disabled' : ''}>
          ${matchedLegs.length ? `
            <optgroup label="📍 Matching — ${intel.city}">
              ${matchedLegs.map(l => `<option value="${l.id}">${l.flag || ''} ${l.city} · ${l.dateFrom} – ${l.dateTo}</option>`).join('')}
            </optgroup>
          ` : ''}
          ${otherLegs.length ? `
            <optgroup label="Other legs">
              ${otherLegs.map(l => `<option value="${l.id}">${l.flag || ''} ${l.city} · ${l.dateFrom} – ${l.dateTo}</option>`).join('')}
            </optgroup>
          ` : ''}
          ${!_legs.length ? `<option value="">No legs yet — add destinations in Itinerary first</option>` : ''}
        </select>
        <label class="guide-modal-label" style="margin-top:var(--sp-4)">Note (optional)</label>
        <input class="input guide-modal-note" placeholder="Your notes…" value="${('highlight' in card ? (card as GuideCard).highlight : '') || ''}">
      </div>
      <div class="guide-modal-footer">
        <button class="btn btn-ghost guide-modal-cancel">Cancel</button>
        <button class="btn btn-primary guide-modal-confirm" ${!_legs.length ? 'disabled' : ''}>Add to itinerary</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('.guide-modal-close')?.addEventListener('click', () => modal.remove());
  modal.querySelector('.guide-modal-cancel')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('.guide-modal-confirm')?.addEventListener('click', async () => {
    const legId = (modal.querySelector('.guide-modal-leg-select') as HTMLSelectElement).value;
    const note = (modal.querySelector('.guide-modal-note') as HTMLInputElement).value.trim();
    if (!legId) return;
    await commitToItinerary(legId, card, cardType, note);
    modal.remove();
    showCommitToast(card.title);
  });
}

async function commitToItinerary(legId: string, card: GuideCard | CityWalk, cardType: string, note: string) {
  const leg = _legs.find(l => l.id === legId);
  if (!leg) return;

  const categoryMap: Record<string, string> = {
    attraction: 'museum', restaurant: 'food', cafe: 'cafe', experience: 'experience', cityWalk: 'walk',
  };

  const newItem = {
    id: `guide-${card.id}-${Date.now()}`,
    title: card.title,
    note: note || ('detail' in card ? card.detail : ''),
    category: categoryMap[cardType] ?? '',
    done: false,
    order: leg.plans?.length ?? 0,
    dayId: null as string | null,
    duration: 'duration' in card ? card.duration : undefined,
    cost: 'cost' in card ? (card as GuideCard).cost : undefined,
    address: 'address' in card ? (card as GuideCard).address : undefined,
  };

  await routeStore.update(legId, { plans: [...(leg.plans ?? []), newItem] });
}

function showCommitToast(title: string) {
  const toast = document.createElement('div');
  toast.className = 'guide-toast';
  toast.textContent = `✓ "${title}" added to itinerary`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ── Mock fallback (when API key not set) ──────────────────────────────────────

function getMockIntel(city: string, country: string): Omit<CityIntel, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'> {
  const enc = (s: string) => encodeURIComponent(s);
  return {
    city, country, flag: '🗺️', bannerColor: '#fde68a', generatedQuery: '',
    intro: `${city} is a city full of character waiting to be explored. From its historic streets to its vibrant food scene, there's always something to discover around each corner.`,
    funFacts: [
      'Local markets open at sunrise and are gone by noon',
      'The old town dates back over 800 years',
      'There are more bicycles than cars in the city centre',
    ],
    greetings: [{ phrase: 'Hello', pronunciation: 'heh-LOH', meaning: 'Standard greeting' }],
    customs: ['Greet shopkeepers when entering small shops', 'Tipping customs vary — check local norms'],
    taboos: ['Loud phone calls on public transport are frowned upon'],
    neighborhoods: [{ name: 'Old Town', vibe: 'Historically rich, walkable, tourist-heavy' }],
    safetyTips: ['Trust your gut — leave any situation that feels off', 'Share your location with a trusted contact'],
    transport: ['Public transport is almost always cheapest', 'Bolt / Uber are safer than random taxis'],
    moneyTips: [
      { id: 'tip-0', text: 'Lunch menus (plat du jour) are 30–50% cheaper than the same dinner menu.', saved: false },
      { id: 'tip-1', text: 'Museum free days are usually the first Sunday of the month.', saved: false },
    ],
    attractions: [{
      id: 'attr-0', title: 'Historic City Centre', highlight: 'The beating heart of the old town',
      detail: 'Wander the cobbled streets and discover centuries of history. Allow 2-3 hours to truly soak it in.',
      background: 'Founded in the medieval era, the centre has been UNESCO-listed since 1995.',
      searchUrl: `https://www.google.com/search?q=${enc(`Historic City Centre ${city}`)}`,
      address: 'City Centre', duration: '2–3h', cost: 'Free', category: 'landmark', saved: false,
    }],
    cityWalks: [{
      id: 'walk-0', title: 'Old Town Morning Walk', highlight: 'See the city before the crowds arrive',
      detail: '1. Main Square\n2. Cathedral\n3. Old Bridge\n4. Riverside Market\n5. Artisan Quarter',
      background: 'This route follows the original medieval trade route through the city.',
      searchUrl: `https://www.google.com/search?q=${enc(`Old Town walking tour ${city}`)}`,
      duration: '2h', distance: '3 km', saved: false,
    }],
    restaurants: [{
      id: 'rest-0', title: 'Local Market Restaurant', highlight: 'Freshest ingredients, authentic local flavours',
      detail: 'Sit at communal tables and order whatever the kitchen is making that day. Arrive early.',
      background: 'Market restaurants have fed locals here for generations.',
      searchUrl: `https://www.google.com/search?q=${enc(`best local restaurant ${city}`)}`,
      address: 'Central Market', duration: '', cost: '€€', category: 'food', saved: false,
    }],
    cafes: [{
      id: 'cafe-0', title: 'Corner Espresso Bar', highlight: 'Standing espresso, no laptop crowd',
      detail: 'The best espresso in town, drunk the local way — standing at the bar. Cash only.',
      background: 'Café culture here dates to the 19th century when these bars were neighbourhood gathering points.',
      searchUrl: `https://www.google.com/search?q=${enc(`best coffee cafe ${city}`)}`,
      address: 'Old Quarter', duration: '', cost: '€2–4', category: 'cafe', saved: false,
    }],
    experiences: [{
      id: 'exp-0', title: 'Sunday Flea Market', highlight: 'Vintage finds and local life',
      detail: 'Every Sunday morning, locals sell everything from antiques to street food. Go early for the best finds.',
      background: 'This market tradition has run continuously since the 1920s.',
      searchUrl: `https://www.google.com/search?q=${enc(`flea market antique market ${city}`)}`,
      address: 'Market Square', duration: '2–3h', cost: 'Free entry', category: 'experience', saved: false,
    }],
  };
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initCities() {
  _unsubCities?.();
  _unsubLegs?.();
  _cities = [];
  _activeCityId = null;

  _unsubCities = cityStore.subscribe((rows) => {
    _cities = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
    const root = document.getElementById('view-cities');
    if (!root) return;
    renderCityList(root);
    if (_activeCityId && _cities.find(c => c.id === _activeCityId)) {
      renderCityDetail(root);
    } else if (!_activeCityId && _cities.length) {
      _activeCityId = _cities[0].id;
      renderCityDetail(root);
    }
  });

  _unsubLegs = routeStore.subscribe((legs) => { _legs = legs; });

  if (_wired) return;
  _wired = true;

  const root = document.getElementById('view-cities')!;

  const cityInput   = root.querySelector<HTMLInputElement>('#guide-city-input')!;
  const dropdown    = root.querySelector<HTMLElement>('#guide-city-dropdown')!;
  const generateBtn = root.querySelector<HTMLButtonElement>('#guide-generate-btn')!;
  const refineToggle = root.querySelector<HTMLButtonElement>('#guide-refine-toggle')!;
  const refineRow   = root.querySelector<HTMLElement>('#guide-refine-row')!;
  const refineInput = root.querySelector<HTMLInputElement>('#guide-refine-input')!;
  const statusEl    = root.querySelector<HTMLElement>('#guide-search-status')!;
  const historyToggle = root.querySelector<HTMLButtonElement>('#guide-history-toggle')!;

  // ── History toggle ───────────────────────────────────────────────────────
  historyToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    _historyOpen = !_historyOpen;
    renderHistoryBar(root);
  });
  // Close history when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!_historyOpen) return;
    if (!(e.target as HTMLElement).closest('.guide-history-wrap')) {
      _historyOpen = false;
      renderHistoryBar(root);
    }
  });

  // ── City autocomplete ────────────────────────────────────────────────────
  let _dropdownOpen = false;

  function showDropdown(q: string) {
    const results = searchDestinations(q, 8);
    if (!results.length) { hideDropdown(); return; }

    const cities   = results.filter(d => d.type === 'city');
    const countries = results.filter(d => d.type === 'country');

    const renderGroup = (label: string, items: typeof results) => items.length ? `
      <div class="guide-dd-section-label">${label}</div>
      ${items.map(d => `
        <div class="guide-dd-item" data-label="${d.label}" data-country="${d.country}">
          <span>${d.flag}</span><span>${d.label}</span>
        </div>
      `).join('')}
    ` : '';

    dropdown.innerHTML = renderGroup('Cities', cities) + renderGroup('Countries', countries);
    dropdown.classList.add('open');
    _dropdownOpen = true;

    dropdown.querySelectorAll<HTMLElement>('.guide-dd-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const label   = item.dataset.label!;
        const countryCode = item.dataset.country!;
        const countryEntry = COUNTRIES.find(c => c.country === countryCode);
        _selectedCity = { label, country: countryEntry?.label ?? '' };
        cityInput.value = label;
        hideDropdown();
      });
    });
  }

  function hideDropdown() {
    dropdown.classList.remove('open');
    dropdown.innerHTML = '';
    _dropdownOpen = false;
  }

  cityInput.addEventListener('input', () => {
    _selectedCity = null;
    const q = cityInput.value.trim();
    if (q.length >= 1) showDropdown(q); else hideDropdown();
  });

  cityInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideDropdown();
    if (e.key === 'Enter') { hideDropdown(); doGenerate(); }
    if (e.key === 'ArrowDown' && _dropdownOpen) {
      e.preventDefault();
      (dropdown.querySelector('.guide-dd-item') as HTMLElement)?.focus();
    }
  });

  cityInput.addEventListener('blur', () => setTimeout(hideDropdown, 150));

  // ── Refine toggle ────────────────────────────────────────────────────────
  refineToggle.addEventListener('click', () => {
    const open = refineRow.style.display !== 'none';
    refineRow.style.display = open ? 'none' : 'flex';
    refineToggle.classList.toggle('active', !open);
    if (!open) refineInput.focus();
  });

  // ── Generate ─────────────────────────────────────────────────────────────
  async function doGenerate() {
    statusEl.textContent = '';
    const cityLabel = _selectedCity?.label || cityInput.value.trim();
    if (!cityLabel) { statusEl.textContent = 'Please select a city first.'; return; }

    // If not picked from dropdown, do a best-effort match
    if (!_selectedCity) {
      const match = searchDestinations(cityLabel, 1)[0];
      const countryEntry = match ? COUNTRIES.find(c => c.country === match.country) : null;
      _selectedCity = { label: match?.label ?? cityLabel, country: countryEntry?.label ?? '' };
    }

    const { label: city, country } = _selectedCity;
    const id    = slugId(city);
    const query = refineInput.value.trim();
    const existing = _cities.find(c => c.id === id);

    if (existing && !query) {
      _activeCityId = id;
      _activeTab = 'intro';
      renderHistoryBar(root);
      renderCityDetail(root);
      cityInput.value = '';
      _selectedCity = null;
      return;
    }

    _activeCityId = id;
    _activeTab = 'intro';
    generateBtn.disabled = true;
    generateBtn.textContent = '…';

    await generateGuide(city, country, query);

    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate';
    cityInput.value = '';
    _selectedCity = null;
    refineInput.value = '';
    refineRow.style.display = 'none';
    refineToggle.classList.remove('active');
    renderHistoryBar(root);
  }

  generateBtn.addEventListener('click', doGenerate);

  renderHistoryBar(root);
  renderCityDetail(root);
}

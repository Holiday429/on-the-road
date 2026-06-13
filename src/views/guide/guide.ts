/* ==========================================================================
   On the Road · Guide — AI city travel guide
   ========================================================================== */

import './guide.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import travelGif from '../../../assets/travel.gif';
import locationGif from '../../../assets/location.gif';
import logoGif from '../../../assets/logo.gif';
import { cityStore, type StoredCityIntel } from '../../data/stores/city-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { searchDestinations, COUNTRIES } from '../../data/destinations.ts';
import { geocode } from '../map/geocode.ts';
import { aiLanguage } from '../../core/i18n.ts';
import type { GuideCard, CityWalk, GuideTip, CityIntel, Waypoint } from '../../data/schema.ts';
import { slugId } from '../../core/utils.ts';
import { openModal } from '../../core/modal.ts';
import { apiUrl, authHeaders } from '../../core/api.ts';
import { handleAiError } from '../../core/paywall.ts';
import { emptyState } from '../../core/empty-state.ts';
import { prefetchSafetyForCity } from '../safety/safety.ts';
import { nomadStore } from '../../data/stores/nomad-store.ts';

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
// Block store-subscriber re-renders while the GIF splash is showing
let _generating = false;
// Live intel being assembled during streaming — renderCityDetail prefers this
// over the Firestore snapshot, which lags behind by an async save round-trip.
let _liveIntel: (Partial<CityIntel> & { id: string }) | null = null;

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

// ── API call + SSE streaming ──────────────────────────────────────────────────

async function generateGuide(city: string, country: string, query: string): Promise<void> {
  const root = document.getElementById('view-cities')!;
  const id = slugId(city);
  _previewIntel = null;
  const statusEl0 = document.getElementById('guide-search-status');
  if (statusEl0) statusEl0.textContent = '';

  _generating = true;
  showSkeleton(root, city, country);

  try {
    const res = await fetch(apiUrl('/api/guide'), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ city, country, query, lang: aiLanguage() }),
    });

    if (res.status === 401 || res.status === 402) {
      const data = await res.json().catch(() => ({})) as { error?: string; plan?: string; upgrade?: boolean; message?: string };
      const { QuotaError, AuthError } = await import('../../core/api.ts');
      const err = res.status === 402
        ? new QuotaError(data.plan ?? 'free', data.upgrade ?? true, data.message ?? 'AI features require a Trip Pass.')
        : new AuthError(data.message ?? 'Sign in to use AI features.');
      throw err;
    }

    if (!res.ok) throw new Error(`API error ${res.status}`);

    const intel: Partial<CityIntel> & { id: string } = {
      id, city, country,
      bannerColor: '#fde68a',
      generatedQuery: query,
    };
    _liveIntel = intel;

    // Keep the GIF splash up until the overview (meta) lands; only then swap to
    // the detail view. Other sections lazy-load behind their own tabs, so a
    // section arriving before meta must NOT tear down the splash early.
    let _overviewShown = false;

    // Apply one SSE "data: {...}" line: parse, merge, persist, re-render.
    // cityStore.save failures must NOT bubble to the outer catch (which would
    // wrongly show the mock) — they only mean this chunk didn't persist yet.
    const applyLine = async (line: string) => {
      if (!line.startsWith('data: ')) return;
      let parsed: { section: string; payload: unknown };
      try { parsed = JSON.parse(line.slice(6)); } catch { return; }
      // Server reported a fatal generation error (e.g. DeepSeek out of balance).
      // If nothing has rendered yet, bail to the catch so the user sees why.
      if (parsed.section === 'error' && !_overviewShown) {
        const msg = (parsed.payload as { message?: string })?.message ?? 'generation failed';
        throw new Error(msg);
      }
      applySection(intel, parsed.section, parsed.payload);
      _activeCityId = id;

      // First render only once meta (intro/overview) is present. After that,
      // re-render on every chunk so each tab fills in as its section arrives.
      if (!_overviewShown) {
        if (intel.intro || intel.overviewSections?.length) {
          _overviewShown = true;
          _generating = false;
          renderCityDetail(root);
        }
      } else {
        renderCityDetail(root);
      }

      try { await cityStore.save(intel as CityIntel & { id: string }); }
      catch (e) { console.warn('cityStore.save failed for a chunk:', e); }
    };

    if (res.body) {
      // Streaming path — render sections as they arrive.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let gotAny = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) gotAny = true;
          await applyLine(line);
        }
      }
      if (buf.trim()) await applyLine(buf.trim());
      if (!gotAny) throw new Error('Empty stream');
    } else {
      // No readable stream (some HTTP/2 environments) — read the whole text.
      const text = await res.text();
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      if (!lines.length) throw new Error('Empty response');
      for (const line of lines) await applyLine(line);
    }

    _generating = false;
    // Stream finished — if meta never arrived (so the splash is still up),
    // fall through to the detail view anyway so the user isn't stuck.
    if (!_overviewShown) renderCityDetail(root);
    // Hand off to the Firestore snapshot now that the stream is complete.
    _liveIntel = null;
    // Background-prefetch a safety card — OFF by default to avoid an extra
    // silent LLM call. Opt in with VITE_PREFETCH_CROSS=1.
    if (import.meta.env.VITE_PREFETCH_CROSS === '1') {
      void prefetchSafetyForCity(city, country);
    }
  } catch (err) {
    _generating = false;
    _liveIntel = null;
    if (handleAiError(err)) {
      // Paywall/auth error — clear the skeleton and return without showing mock.
      const detail = root.querySelector<HTMLElement>('.guide-detail');
      if (detail) { detail.innerHTML = ''; detail.classList.remove('active'); }
      return;
    }
    // API failed — show a sample preview WITHOUT persisting it to Firestore.
    console.warn('Guide API unavailable, showing sample (not saved):', err);
    const statusEl = document.getElementById('guide-search-status');
    if (statusEl) {
      const reason = (err as Error)?.message ? ` (${(err as Error).message})` : '';
      statusEl.textContent = `Couldn't reach the AI service${reason} — showing a sample. Try Regen in a moment.`;
    }
    const mock = getMockIntel(city, country) as CityIntel & { id: string };
    mock.id = id;
    _previewIntel = mock;
    _activeCityId = id;
    renderHistoryBar(root);
    renderCityDetail(root);
  }
}

/**
 * Headless guide generation for cross-module prefetch (called by Safety after
 * it generates a city). Persists to cityStore without touching the DOM, and
 * does nothing if an intel doc for this city already exists. Fire-and-forget.
 */
export async function prefetchGuideForCity(city: string, country: string): Promise<void> {
  const id = slugId(city);
  if (_cities.some((c) => c.id === id)) return;

  try {
    const res = await fetch(apiUrl('/api/guide'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, country, query: '', lang: aiLanguage() }),
    });
    if (!res.ok) return;

    const intel: Partial<CityIntel> & { id: string } = {
      id, city, country, bannerColor: '#fde68a', generatedQuery: '',
    };
    const applyLine = async (line: string) => {
      if (!line.startsWith('data: ')) return;
      let parsed: { section: string; payload: unknown };
      try { parsed = JSON.parse(line.slice(6)); } catch { return; }
      applySection(intel, parsed.section, parsed.payload);
      try { await cityStore.save(intel as CityIntel & { id: string }); } catch { /* chunk */ }
    };

    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) await applyLine(line);
      }
      if (buf.trim()) await applyLine(buf.trim());
    } else {
      const text = await res.text();
      for (const line of text.split('\n').filter((l) => l.startsWith('data: '))) await applyLine(line);
    }
  } catch {
    // Silent — background prefetch, failures acceptable.
  }
}

function applySection(intel: Partial<CityIntel> & { id: string }, section: string, payload: unknown) {
  const p = payload as Record<string, unknown>;
  switch (section) {
    case 'meta':
      Object.assign(intel, {
        flag: p.flag, bannerColor: p.bannerColor, intro: p.intro,
        funFacts: p.funFacts, overviewSections: p.overviewSections,
      });
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

function showSkeleton(_root: HTMLElement, city: string, _country: string) {
  const detail = document.querySelector<HTMLElement>('#view-cities .guide-detail')!;
  detail.innerHTML = `
    <div class="guide-gen-splash">
      <div class="guide-gen-gifs">
        <img class="guide-gen-gif guide-gen-gif--active" src="${travelGif}" alt="">
        <img class="guide-gen-gif" src="${locationGif}" alt="">
        <img class="guide-gen-gif" src="${logoGif}" alt="">
      </div>
      <div class="guide-gen-label">
        Planning your <strong>${city}</strong> guide — this takes a moment…
      </div>
    </div>
  `;
  detail.classList.add('active');

  // Cycle through the three GIFs
  const imgs = detail.querySelectorAll<HTMLImageElement>('.guide-gen-gif');
  let idx = 0;
  const interval = setInterval(() => {
    imgs[idx].classList.remove('guide-gen-gif--active');
    idx = (idx + 1) % imgs.length;
    imgs[idx].classList.add('guide-gen-gif--active');
  }, 2000);
  (detail as HTMLElement & { _gifInterval?: ReturnType<typeof setInterval> })._gifInterval = interval;
}

// ── History (right-side drawer with filter + scroll) ──────────────────────────

let _historyFilter = '';

function renderHistoryBar(root: HTMLElement) {
  const toggle  = document.getElementById('guide-history-toggle');
  const drawer  = document.getElementById('guide-history-drawer');
  const overlay = document.getElementById('guide-history-overlay');
  const panel   = document.getElementById('guide-history-panel');
  if (!toggle || !drawer || !overlay || !panel) return;

  // Toggle button: show count, hide when empty.
  if (!_cities.length) {
    toggle.style.display = 'none';
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    _historyOpen = false;
    return;
  }
  toggle.style.display = '';
  toggle.innerHTML = `🕘 History <span class="guide-history-count">${_cities.length}</span>`;

  drawer.classList.toggle('open', _historyOpen);
  overlay.classList.toggle('open', _historyOpen);

  const f = _historyFilter.toLowerCase();
  const rows = _cities.filter(c =>
    !f || c.city.toLowerCase().includes(f) || c.country.toLowerCase().includes(f)
  );

  panel.innerHTML = rows.length ? rows.map(c => `
    <div class="guide-history-row ${c.id === _activeCityId ? 'active' : ''}" data-id="${c.id}">
      <span class="guide-history-row-flag">${c.flag || '🗺️'}</span>
      <div class="guide-history-row-text">
        <div class="guide-history-row-name">${c.city}</div>
        <div class="guide-history-row-country">${c.country}</div>
      </div>
      <button class="guide-history-del" data-id="${c.id}" title="Remove">×</button>
    </div>
  `).join('') : `<div class="guide-history-empty">No matching guides</div>`;

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
  const detail = document.querySelector<HTMLElement>('#view-cities .guide-detail')! as HTMLElement & { _gifInterval?: ReturnType<typeof setInterval> };
  if (detail._gifInterval) { clearInterval(detail._gifInterval); detail._gifInterval = undefined; }
  // Live streaming intel wins (it's ahead of the Firestore snapshot), then the
  // stored doc, then a transient preview if the API failed.
  const intel = (_liveIntel?.id === _activeCityId ? _liveIntel as StoredCityIntel : undefined)
    ?? _cities.find(c => c.id === _activeCityId)
    ?? (_previewIntel?.id === _activeCityId ? _previewIntel as StoredCityIntel : undefined);

  if (!intel) {
    detail.replaceChildren(emptyState({
      icon: '🗺️',
      title: 'Build a city guide',
      desc: 'Search any city above to generate attractions, food, culture and more — then bookmark anything or send it to your itinerary.',
      cta: {
        label: 'Search a city',
        onClick: () => document.getElementById('guide-city-input')?.focus(),
      },
    }));
    detail.classList.remove('active');
    return;
  }

  detail.classList.add('active');
  detail.innerHTML = `
    <div class="guide-detail-header">
      <span class="guide-detail-flag">${intel.flag || '🗺️'}</span>
      <div class="guide-detail-header-text">
        <span class="guide-detail-city">${intel.city}</span>
        <span class="guide-detail-country">${intel.country}</span>
        ${intel.generatedQuery ? `<span class="guide-detail-query">🔍 "${intel.generatedQuery}"</span>` : ''}
      </div>
      <button class="btn btn-ghost guide-regen-btn" data-id="${intel.id}">↺ Regen</button>
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
  const sections = intel.overviewSections ?? [];
  return `
    <div class="guide-intro">
      ${intel.intro ? `<p class="guide-intro-lede">${intel.intro}</p>` : ''}

      ${sections.length ? `
        <div class="guide-overview-grid">
          ${sections.map(s => `
            <div class="guide-overview-card">
              <div class="guide-overview-card-head">
                <span class="guide-overview-icon">${s.icon || '📌'}</span>
                <span class="guide-overview-title">${s.title}</span>
              </div>
              <p class="guide-overview-body">${s.body}</p>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${intel.funFacts?.length ? `
        <div class="guide-funfacts-block">
          <div class="guide-funfacts-label">💡 Did you know?</div>
          <div class="guide-fun-facts">
            ${intel.funFacts.map(f => `<div class="guide-fun-fact">${f}</div>`).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// "Generate more" footer — shown under Do/Budget tabs to append fresh items.
function moreFooter(label: string): string {
  return `
    <div class="guide-more-footer">
      <button class="btn btn-ghost guide-more-btn" data-more-section="${_activeTab}">✨ ${label}</button>
    </div>
  `;
}

function renderCardGrid(cards: GuideCard[], city: string, type: string): string {
  if (!cards.length) return renderSectionLoading(`Loading ${type} recommendations…`);
  return `
    <div class="guide-card-grid">${cards.map((c, i) => renderFlipCard(c, city, type, i)).join('')}</div>
    ${moreFooter('Generate more')}
  `;
}

// Build a Google Maps search/place URL for a card (view details + navigate).
function mapsUrl(card: { title: string; address?: string }, city: string): string {
  const q = [card.title, card.address, city].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// Multi-stop Google Maps walking-directions URL built from waypoint NAMES (no
// coordinates needed) — always valid, used as the initial link before geocoding
// upgrades it to a precise lat/lng version.
function walkRouteUrlByName(waypoints: Waypoint[], city: string): string {
  const pts = waypoints.map(w => encodeURIComponent(`${w.name}, ${city}`));
  if (pts.length < 2) return `https://www.google.com/maps/search/?api=1&query=${pts[0] ?? ''}`;
  const origin = pts[0];
  const destination = pts[pts.length - 1];
  const mids = pts.slice(1, -1).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${origin}&destination=${destination}`;
  if (mids) url += `&waypoints=${mids}`;
  return url;
}

// Inline Google "G" mark for buttons.
function googleIcon(): string {
  return `<svg class="g-icon" width="14" height="14" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/><path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"/><path fill="#EA4335" d="M24 9.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 3.18 29.93 1 24 1 15.4 1 7.96 5.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/></svg>`;
}

// Image-led card. Photo (or colour-block + emoji fallback) on top, info below.
// Clicking the body opens a detail modal — no flip, no scroll-in-card.
function renderFlipCard(card: GuideCard, city: string, type: string, idx: number): string {
  const s = card.saved;
  const maps = mapsUrl(card, city);
  const hasImg = !!card.imageUrl;
  const bannerColor = CARD_TINTS[idx % CARD_TINTS.length];

  const media = hasImg
    ? `<div class="guide-card-photo" style="background-image:url('${card.imageUrl}')"></div>`
    : `<div class="guide-card-tint" style="--tint:${bannerColor}"><span class="guide-card-tint-emoji">${typeEmoji(type)}</span></div>`;

  return `
    <div class="guide-card ${s ? 'saved' : ''}" data-card-id="${card.id}" data-card-type="${type}">
      <div class="guide-card-media">
        ${media}
        <button class="guide-card-fav guide-save-btn ${s ? 'saved' : ''}" data-card-id="${card.id}" data-card-type="${type}" title="Bookmark">${s ? '★' : '☆'}</button>
      </div>
      <div class="guide-card-body" data-open-detail="${card.id}" data-card-type="${type}">
        <div class="guide-card-title">${card.title}</div>
        <div class="guide-card-highlight">${card.highlight}</div>
        <div class="guide-card-meta">
          ${card.duration ? `<span>⏱ ${card.duration}</span>` : ''}
          ${card.cost ? `<span>💰 ${card.cost}</span>` : ''}
        </div>
      </div>
      <div class="guide-card-actions">
        <a class="guide-icon-btn guide-map-btn" href="${maps}" target="_blank" rel="noopener" title="Open in Google Maps">📍 Map</a>
        ${(type === 'cafe' || type === 'restaurant') ? `<button class="guide-icon-btn guide-nomad-btn" data-card-id="${card.id}" data-card-type="${type}" title="Save as a work-friendly spot">☕ Nomad</button>` : ''}
        <button class="guide-icon-btn guide-commit-btn" data-card-id="${card.id}" data-card-type="${type}" title="Add to itinerary">＋ Add</button>
      </div>
    </div>
  `;
}

function renderWalkGrid(walks: CityWalk[], city: string): string {
  if (!walks.length) return renderSectionLoading('City walk routes are being generated…');
  return `
    <div class="guide-card-grid">${walks.map((w, i) => renderWalkCard(w, city, i)).join('')}</div>
    ${moreFooter('More routes')}
  `;
}

function renderWalkCard(walk: CityWalk, _city: string, idx: number): string {
  const s = walk.saved;
  const hasImg = !!walk.imageUrl;
  const bannerColor = CARD_TINTS[idx % CARD_TINTS.length];
  const media = hasImg
    ? `<div class="guide-card-photo" style="background-image:url('${walk.imageUrl}')"></div>`
    : `<div class="guide-card-tint" style="--tint:${bannerColor}"><span class="guide-card-tint-emoji">🚶</span></div>`;

  return `
    <div class="guide-card walk-card ${s ? 'saved' : ''}" data-card-id="${walk.id}" data-card-type="cityWalk">
      <div class="guide-card-media">
        ${media}
        <button class="guide-card-fav guide-save-btn ${s ? 'saved' : ''}" data-card-id="${walk.id}" data-card-type="cityWalk" title="Bookmark">${s ? '★' : '☆'}</button>
      </div>
      <div class="guide-card-body" data-open-detail="${walk.id}" data-card-type="cityWalk">
        <div class="guide-card-title">${walk.title}</div>
        <div class="guide-card-highlight">${walk.highlight}</div>
        <div class="guide-card-meta">
          ${walk.duration ? `<span>⏱ ${walk.duration}</span>` : ''}
          ${walk.distance ? `<span>📏 ${walk.distance}</span>` : ''}
        </div>
      </div>
      <div class="guide-card-actions">
        ${walk.searchUrl ? `<a class="guide-icon-btn guide-map-btn" href="${walk.searchUrl}" target="_blank" rel="noopener" title="Search route">🔍 Route</a>` : ''}
        <button class="guide-icon-btn guide-commit-btn" data-card-id="${walk.id}" data-card-type="cityWalk" title="Add to itinerary">＋ Add</button>
      </div>
    </div>
  `;
}

// Soft pastel tints for imageless cards (restaurants/cafés or photo misses).
const CARD_TINTS = ['#fef3c7', '#dbeafe', '#dcfce7', '#fae8ff', '#fee2e2', '#ffedd5', '#cffafe', '#fce7f3'];

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
    ${moreFooter('More tips')}
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
  const map: Record<string, string> = { attraction: '🏛️', restaurant: '🍽️', cafe: '☕', experience: '✨', cityWalk: '🚶' };
  return map[type] ?? '📍';
}

const TYPE_LABEL: Record<string, string> = {
  attraction: 'Attraction', restaurant: 'Restaurant', cafe: 'Café',
  experience: 'Experience', cityWalk: 'City walk',
};

// ── Interactions ──────────────────────────────────────────────────────────────

function wireTabContent(detail: HTMLElement, intel: StoredCityIntel) {
  // Open detail modal when the card body is clicked.
  detail.querySelectorAll<HTMLElement>('[data-open-detail]').forEach(el => {
    el.addEventListener('click', () => {
      openDetailModal(intel, el.dataset.openDetail!, el.dataset.cardType!);
    });
  });

  // Save bookmark
  detail.querySelectorAll<HTMLElement>('.guide-save-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      toggleSaved(intel, btn.dataset.cardId!, btn.dataset.cardType!);
      await cityStore.save(intel);
      const card = findCard(intel, btn.dataset.cardId!, btn.dataset.cardType!);
      const saved = card?.saved ?? false;
      detail.querySelectorAll<HTMLElement>(`.guide-save-btn[data-card-id="${btn.dataset.cardId}"]`).forEach(b => {
        b.textContent = saved ? '★' : '☆';
        b.classList.toggle('saved', saved);
      });
      detail.querySelector<HTMLElement>(`.guide-card[data-card-id="${btn.dataset.cardId}"]`)?.classList.toggle('saved', saved);
    });
  });

  // Commit to itinerary
  detail.querySelectorAll<HTMLElement>('.guide-commit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCommitModal(intel, btn.dataset.cardId!, btn.dataset.cardType!);
    });
  });

  // Save a café/restaurant straight into Nomad spots
  detail.querySelectorAll<HTMLElement>('.guide-nomad-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = findCard(intel, btn.dataset.cardId!, btn.dataset.cardType!);
      if (!card || !('title' in card)) return;
      const c = card as GuideCard;
      await nomadStore.add({
        name: c.title,
        city: intel.city,
        country: intel.country,
        type: 'Café',
        ratings: { wifi: 0, power: 0, restroom: 0, coffee: 0, service: 0 },
        comment: c.highlight || '',
        photos: [],
        address: c.address || '',
        mapsUrl: mapsUrl(c, intel.city),
        visibility: 'private',
        ownerId: '',
      });
      btn.textContent = '✓ Saved';
      btn.classList.add('saved');
      showCommitToast(`${c.title} → Nomad`);
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

  // Generate more (append fresh items to the current section)
  detail.querySelector<HTMLElement>('.guide-more-btn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    loadMore(intel, btn.dataset.moreSection as TabKey, btn);
  });
}

// Section key → schema array field on the intel doc.
const SECTION_FIELD: Record<string, keyof CityIntel> = {
  attractions: 'attractions', cityWalks: 'cityWalks', restaurants: 'restaurants',
  cafes: 'cafes', experiences: 'experiences', moneyTips: 'moneyTips',
};

async function loadMore(intel: StoredCityIntel, section: TabKey, btn: HTMLButtonElement) {
  const field = SECTION_FIELD[section];
  if (!field) return;

  const existing = (intel[field] as { title?: string; text?: string }[] | undefined) ?? [];
  const existingTitles = existing.map(it => it.title ?? it.text ?? '').filter(Boolean);

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '✨ Generating…';

  try {
    const res = await fetch(apiUrl('/api/guide-more'), {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        city: intel.city, country: intel.country, section,
        existingTitles, query: intel.generatedQuery ?? '', lang: aiLanguage(),
      }),
    });
    if (res.status === 401 || res.status === 402) {
      const data = await res.json().catch(() => ({})) as { error?: string; plan?: string; upgrade?: boolean; message?: string };
      const { QuotaError, AuthError } = await import('../../core/api.ts');
      throw res.status === 402
        ? new QuotaError(data.plan ?? 'free', data.upgrade ?? true, data.message ?? 'AI features require a Trip Pass.')
        : new AuthError(data.message ?? 'Sign in to use AI features.');
    }
    if (!res.ok) throw new Error(`API ${res.status}`);
    const { items } = await res.json() as { items: unknown[] };

    if (Array.isArray(items) && items.length) {
      // Dedupe again client-side against current titles, then append.
      const seen = new Set(existingTitles.map(t => t.toLowerCase().trim()));
      const fresh = (items as { title?: string; text?: string }[]).filter(it => {
        const t = (it.title ?? it.text ?? '').toLowerCase().trim();
        if (!t || seen.has(t)) return false;
        seen.add(t);
        return true;
      });
      (intel[field] as unknown[]) = [...existing, ...fresh];
      await cityStore.save(intel);
      // Re-render the current tab to show appended items.
      const content = document.getElementById('guide-tab-content');
      if (content) {
        content.innerHTML = renderTabContent(intel);
        wireTabContent(content.closest('.guide-detail') as HTMLElement, intel);
      }
    } else {
      btn.textContent = '✓ No new ones found';
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1800);
      return;
    }
  } catch (err) {
    if (handleAiError(err)) { btn.textContent = original; btn.disabled = false; return; }
    console.warn('guide-more failed:', err);
    btn.textContent = '⚠ Failed — retry';
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1800);
  }
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

// ── Detail modal (replaces the card back) ─────────────────────────────────────

function openDetailModal(intel: StoredCityIntel, cardId: string, cardType: string) {
  const card = findCard(intel, cardId, cardType);
  if (!card) return;

  const isWalk = cardType === 'cityWalk';
  const g = card as GuideCard;
  const w = card as CityWalk;
  const maps = mapsUrl({ title: card.title, address: g.address }, intel.city);
  const hasImg = !!card.imageUrl;
  const waypoints = isWalk ? (w.waypoints ?? []) : [];

  document.getElementById('guide-detail-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'guide-detail-modal';
  modal.className = 'guide-modal-overlay';
  modal.innerHTML = `
    <div class="guide-detail-modal">
      ${hasImg ? `
        <div class="guide-detail-modal-photo" style="background-image:url('${card.imageUrl}')">
          <button class="guide-detail-modal-close">×</button>
          ${card.photographer ? `<a class="guide-detail-modal-credit" href="${card.photographerUrl || '#'}" target="_blank" rel="noopener">Photo · ${card.photographer} / Unsplash</a>` : ''}
        </div>
      ` : `
        <div class="guide-detail-modal-bar">
          <span>${typeEmoji(cardType)}</span>
          <button class="guide-detail-modal-close">×</button>
        </div>
      `}
      <div class="guide-detail-modal-body">
        <div class="guide-detail-modal-kicker">${typeEmoji(cardType)} ${TYPE_LABEL[cardType] ?? ''}</div>
        <h3 class="guide-detail-modal-title">${card.title}</h3>
        ${card.highlight ? `<p class="guide-detail-modal-lede">${card.highlight}</p>` : ''}
        <div class="guide-detail-modal-meta">
          ${g.duration ? `<span>⏱ ${g.duration}</span>` : ''}
          ${g.cost ? `<span>💰 ${g.cost}</span>` : ''}
          ${isWalk && w.distance ? `<span>📏 ${w.distance}</span>` : ''}
          ${g.category && !isWalk ? `<span>🏷️ ${g.category}</span>` : ''}
        </div>

        ${card.detail ? `
          <div class="guide-detail-modal-block">
            <div class="guide-detail-modal-block-label">About</div>
            <p class="guide-detail-modal-text">${card.detail}</p>
          </div>
        ` : ''}

        ${card.background ? `
          <div class="guide-detail-modal-block">
            <div class="guide-detail-modal-block-label">Good to know</div>
            <div class="guide-detail-modal-bg">💡 ${card.background}</div>
          </div>
        ` : ''}

        ${g.address && !isWalk ? `
          <a class="guide-detail-modal-addr" href="${maps}" target="_blank" rel="noopener">📍 ${g.address} · open in Maps</a>
        ` : ''}

        ${isWalk && waypoints.length ? `
          <div class="guide-walk-section">
            <div class="guide-detail-modal-block-label">Route · ${waypoints.length} stops</div>
            <div class="guide-walk-map" id="guide-walk-map"></div>
            <div class="guide-walk-stops">
              ${waypoints.map((wp, i) => `
                <div class="guide-walk-stop">
                  <span class="guide-walk-stop-num">${i + 1}</span>
                  <div class="guide-walk-stop-text">
                    <div class="guide-walk-stop-name">${wp.name}</div>
                    ${wp.note ? `<div class="guide-walk-stop-note">${wp.note}</div>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
      <div class="guide-detail-modal-footer">
        ${isWalk && waypoints.length
          ? `<a class="btn btn-ghost guide-walk-route-link" href="${walkRouteUrlByName(waypoints, intel.city)}" target="_blank" rel="noopener">🗺️ Open route in Maps</a>`
          : `<a class="btn btn-ghost" href="${card.searchUrl || maps}" target="_blank" rel="noopener">${googleIcon()} Search in Google</a>`}
        <button class="btn btn-primary guide-detail-modal-commit">＋ Add to itinerary</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.guide-detail-modal-close')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('.guide-detail-modal-commit')?.addEventListener('click', () => {
    close();
    openCommitModal(intel, cardId, cardType);
  });

  // City walk: geocode waypoints, draw the route on a Leaflet map, and wire the
  // Google Maps multi-stop directions deep link.
  if (isWalk && waypoints.length) {
    setupWalkMap(intel, waypoints, modal);
  }
}

// Geocode each waypoint (cached), persist coords back onto the walk, then draw a
// numbered Leaflet route and build the Google Maps directions link.
async function setupWalkMap(
  intel: StoredCityIntel,
  waypoints: Waypoint[],
  modal: HTMLElement,
) {
  const mapEl = modal.querySelector<HTMLElement>('#guide-walk-map');
  const routeLink = modal.querySelector<HTMLAnchorElement>('.guide-walk-route-link');
  if (!mapEl) return;

  // Resolve coordinates: use cached ones, else geocode "name, city".
  const resolved: { name: string; lat: number; lng: number }[] = [];
  let coordsChanged = false;
  for (const wp of waypoints) {
    if (wp.lat != null && wp.lng != null) {
      resolved.push({ name: wp.name, lat: wp.lat, lng: wp.lng });
      continue;
    }
    const hit = await geocode(wp.name, intel.city);
    if (hit) {
      wp.lat = hit.lat; wp.lng = hit.lng;
      coordsChanged = true;
      resolved.push({ name: wp.name, lat: hit.lat, lng: hit.lng });
    }
  }

  // Persist any newly geocoded coords so we don't re-resolve next time.
  if (coordsChanged) { try { await cityStore.save(intel); } catch { /* best-effort */ } }

  if (!resolved.length) { mapEl.style.display = 'none'; return; }

  // Build the Google Maps multi-stop directions deep link (origin → … → dest).
  if (routeLink) {
    const origin = resolved[0];
    const dest = resolved[resolved.length - 1];
    const mids = resolved.slice(1, -1);
    const params = new URLSearchParams({
      api: '1', travelmode: 'walking',
      origin: `${origin.lat},${origin.lng}`,
      destination: `${dest.lat},${dest.lng}`,
    });
    if (mids.length) params.set('waypoints', mids.map(m => `${m.lat},${m.lng}`).join('|'));
    routeLink.href = `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  // Draw the Leaflet route once layout settles.
  requestAnimationFrame(() => drawWalkRoute(mapEl, resolved));
}

function drawWalkRoute(mapEl: HTMLElement, stops: { name: string; lat: number; lng: number }[]) {
  const map = L.map(mapEl, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  L.control.attribution({ prefix: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>' }).addTo(map);

  const latlngs = stops.map(s => [s.lat, s.lng] as [number, number]);

  // Dashed route line.
  if (latlngs.length >= 2) {
    L.polyline(latlngs, { color: '#f59e0b', weight: 3, opacity: 0.85, dashArray: '6 5' }).addTo(map);
  }

  // Numbered pins.
  stops.forEach((s, i) => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="guide-walk-pin">${i + 1}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    L.marker([s.lat, s.lng], { icon }).addTo(map).bindPopup(`<b>${i + 1}. ${s.name}</b>`);
  });

  map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  setTimeout(() => map.invalidateSize(), 60);
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
  const highlight = ('highlight' in card ? (card as GuideCard).highlight : '') || '';

  const m = openModal({
    title: 'Add to itinerary',
    variant: 'sheet',
    body: `
      <div class="guide-modal-card-preview">
        <span>${typeEmoji(cardType)}</span>
        <strong>${card.title}</strong>
      </div>
      <label class="guide-modal-label">Choose leg</label>
      <select class="input guide-modal-leg-select" id="gcm-leg" ${!_legs.length ? 'disabled' : ''}>
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
      <input class="input" id="gcm-note" placeholder="Your notes…" value="${highlight}">
    `,
    footer: `
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
      <button class="btn btn-primary" data-act="confirm" ${!_legs.length ? 'disabled' : ''}>Add to itinerary</button>
    `,
  });

  m.root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => m.close());
  m.root.querySelector('[data-act="confirm"]')?.addEventListener('click', async () => {
    const legId = (m.root.querySelector<HTMLSelectElement>('#gcm-leg'))!.value;
    const note = (m.root.querySelector<HTMLInputElement>('#gcm-note'))!.value.trim();
    if (!legId) return;
    await commitToItinerary(legId, card, cardType, note);
    m.close();
    showCommitToast(card.title);
  });
}

async function commitToItinerary(legId: string, card: GuideCard | CityWalk, cardType: string, note: string) {
  const leg = _legs.find(l => l.id === legId);
  if (!leg) return;

  const categoryMap: Record<string, string> = {
    attraction: 'museum', restaurant: 'food', cafe: 'cafe', experience: 'experience', cityWalk: 'walk',
  };

  // For a city walk, fold the ordered stops into the note so the itinerary item
  // carries the full route, not just the title.
  let baseNote = note || ('detail' in card ? card.detail : '');
  if (cardType === 'cityWalk') {
    const wps = (card as CityWalk).waypoints ?? [];
    if (wps.length) {
      const stops = wps.map((wp, i) => `${i + 1}. ${wp.name}${wp.note ? ` — ${wp.note}` : ''}`).join('\n');
      baseNote = baseNote ? `${baseNote}\n\n${stops}` : stops;
    }
  }

  const newItem = {
    id: `guide-${card.id}-${Date.now()}`,
    title: card.title,
    note: baseNote,
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
    overviewSections: [
      { icon: '🏛️', title: 'History', body: `${city} has centuries of layered history, from medieval roots to its modern-day character.` },
      { icon: '🗺️', title: 'Geography & Layout', body: 'A walkable historic core surrounded by lively residential districts and green spaces.' },
      { icon: '🎭', title: 'Culture & Vibe', body: 'A blend of tradition and contemporary creativity — markets, cafés, and street life.' },
      { icon: '📅', title: 'When to Visit', body: 'Spring and early autumn offer the best weather and fewer crowds.' },
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
      imageUrl: '', photographer: '', photographerUrl: '',
    }],
    cityWalks: [{
      id: 'walk-0', title: 'Old Town Morning Walk', highlight: 'See the city before the crowds arrive',
      detail: 'A gentle loop through the medieval heart of the city, best done early before the crowds.',
      waypoints: [
        { name: 'Main Square', note: 'Start here for the morning light' },
        { name: 'Cathedral', note: 'Step inside before the tour groups' },
        { name: 'Old Bridge', note: 'Best river views' },
        { name: 'Riverside Market', note: 'Grab a coffee and pastry' },
        { name: 'Artisan Quarter', note: 'Workshops and small galleries' },
      ],
      background: 'This route follows the original medieval trade route through the city.',
      searchUrl: `https://www.google.com/search?q=${enc(`Old Town walking tour ${city}`)}`,
      duration: '2h', distance: '3 km', saved: false,
      imageUrl: '', photographer: '', photographerUrl: '',
    }],
    restaurants: [{
      id: 'rest-0', title: 'Local Market Restaurant', highlight: 'Freshest ingredients, authentic local flavours',
      detail: 'Sit at communal tables and order whatever the kitchen is making that day. Arrive early.',
      background: 'Market restaurants have fed locals here for generations.',
      searchUrl: `https://www.google.com/search?q=${enc(`best local restaurant ${city}`)}`,
      address: 'Central Market', duration: '', cost: '€€', category: 'food', saved: false,
      imageUrl: '', photographer: '', photographerUrl: '',
    }],
    cafes: [{
      id: 'cafe-0', title: 'Corner Espresso Bar', highlight: 'Standing espresso, no laptop crowd',
      detail: 'The best espresso in town, drunk the local way — standing at the bar. Cash only.',
      background: 'Café culture here dates to the 19th century when these bars were neighbourhood gathering points.',
      searchUrl: `https://www.google.com/search?q=${enc(`best coffee cafe ${city}`)}`,
      address: 'Old Quarter', duration: '', cost: '€2–4', category: 'cafe', saved: false,
      imageUrl: '', photographer: '', photographerUrl: '',
    }],
    experiences: [{
      id: 'exp-0', title: 'Sunday Flea Market', highlight: 'Vintage finds and local life',
      detail: 'Every Sunday morning, locals sell everything from antiques to street food. Go early for the best finds.',
      background: 'This market tradition has run continuously since the 1920s.',
      searchUrl: `https://www.google.com/search?q=${enc(`flea market antique market ${city}`)}`,
      address: 'Market Square', duration: '2–3h', cost: 'Free entry', category: 'experience', saved: false,
      imageUrl: '', photographer: '', photographerUrl: '',
    }],
  };
}

// ── Deep-link from Map ────────────────────────────────────────────────────────

/**
 * Called by the Map view when the user clicks a city pin.
 * If the city has a saved intel record, open it; otherwise pre-fill the search
 * input so the user can trigger generation with one click.
 */
export function openGuideCity(city: string): void {
  const id = slugId(city);
  const root = document.getElementById('view-cities');
  if (!root) return;

  const existing = _cities.find((c) => c.id === id);
  if (existing) {
    _activeCityId = id;
    const detail = root.querySelector<HTMLElement>('.guide-detail');
    if (detail) renderCityDetail(root);
    return;
  }

  // Pre-fill the search box and scroll to it so generation is one tap away.
  const input = root.querySelector<HTMLInputElement>('#guide-city-input');
  if (input) {
    input.value = city;
    input.dispatchEvent(new Event('input'));
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
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
    // Don't overwrite the GIF splash while generation is in progress
    if (_generating) return;
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
  const historyToggle  = root.querySelector<HTMLButtonElement>('#guide-history-toggle')!;
  const historyClose   = root.querySelector<HTMLButtonElement>('#guide-history-close')!;
  const historyOverlay = root.querySelector<HTMLElement>('#guide-history-overlay')!;
  const historySearch  = root.querySelector<HTMLInputElement>('#guide-history-search-input')!;

  // ── History drawer ───────────────────────────────────────────────────────
  const closeHistory = () => { _historyOpen = false; renderHistoryBar(root); };
  historyToggle.addEventListener('click', () => {
    _historyOpen = !_historyOpen;
    renderHistoryBar(root);
  });
  historyClose.addEventListener('click', closeHistory);
  historyOverlay.addEventListener('click', closeHistory);
  historySearch.addEventListener('input', () => {
    _historyFilter = historySearch.value.trim();
    renderHistoryBar(root);
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

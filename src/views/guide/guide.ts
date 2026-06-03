/* ==========================================================================
   On the Road · City Intel (AI) — Firestore-backed
   ========================================================================== */

import './guide.css';
import { cityStore, type StoredCityIntel } from '../../data/stores/city-store.ts';

const BANNER_COLORS = [
  '#fde68a', '#bae6fd', '#bbf7d0', '#e9d5ff',
  '#fecaca', '#fed7aa', '#cffafe', '#fce7f3',
];

let _cities: StoredCityIntel[] = [];
let openCityId: string | null = null;
let _unsubCities: (() => void) | null = null;
let _citiesWired = false;

function slugId(city: string): string {
  return city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function fetchCityIntel(cityName: string): Promise<Omit<StoredCityIntel, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'> | null> {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
  if (!apiKey) return getMockIntel(cityName);

  const prompt = `You are a local guide for solo female travellers. Generate a detailed cultural intel card for ${cityName}.

Return ONLY valid JSON matching this exact shape:
{
  "city": "${cityName}",
  "country": "country name",
  "flag": "flag emoji",
  "greetings": [{"phrase": "local greeting", "pronunciation": "how to say it", "meaning": "what it means"}],
  "customs": ["custom 1", "custom 2", "custom 3", "custom 4"],
  "taboos": ["taboo 1", "taboo 2", "taboo 3"],
  "neighborhoods": [{"name": "area name", "vibe": "1-sentence description"}, ...],
  "localFood": ["dish or drink 1", "dish or drink 2", "dish or drink 3", "dish or drink 4"],
  "hiddenGems": ["non-touristy place or tip 1", "tip 2", "tip 3"],
  "safetyTips": ["safety tip specific to solo women 1", "tip 2", "tip 3"],
  "transport": ["getting around tip 1", "tip 2"]
}`;

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    });

    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    return {
      ...parsed,
      bannerColor: BANNER_COLORS[_cities.length % BANNER_COLORS.length],
    };
  } catch (e) {
    console.error('DeepSeek error:', e);
    return null;
  }
}

function getMockIntel(cityName: string): Omit<StoredCityIntel, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'> {
  return {
    city: cityName,
    country: 'Europe',
    flag: '🗺️',
    bannerColor: BANNER_COLORS[_cities.length % BANNER_COLORS.length],
    greetings: [{ phrase: 'Hello / Bonjour / Hola', pronunciation: 'varies', meaning: 'Hello' }],
    customs: [
      'Greet shopkeepers when entering small shops',
      'Lunch is a serious affair — avoid scheduling meetings then',
      'Tipping customs vary — check local norms',
      'Public displays of affection are generally accepted',
    ],
    taboos: [
      'Asking about salary or age is considered rude',
      'Arriving exactly on time can be seen as too eager in some cultures',
      'Loud phone calls on public transport are frowned upon',
    ],
    neighborhoods: [
      { name: 'Old Town / Historic Centre', vibe: 'Tourist-heavy but historically rich, walkable' },
      { name: 'Local residential district', vibe: 'Where residents actually live — markets and cafés' },
    ],
    localFood: [
      'Ask locals for their current favourite spot — menus change seasonally',
      'Street markets usually have the freshest and cheapest food',
      'Grocery stores are great for picnic ingredients',
      'Lunch menus (plat du jour) are much cheaper than dinner',
    ],
    hiddenGems: [
      'Walk away from the main tourist square by just 3 streets',
      'Check local Facebook groups or resident Reddit communities',
      'Ask your accommodation host for their personal recommendations',
    ],
    safetyTips: [
      'Keep a small decoy wallet with old cards and minimal cash',
      'Trust your gut — leave any situation that feels uncomfortable',
      'Share your location with a trusted contact',
    ],
    transport: [
      'Public transport is almost always the cheapest option',
      'Ride-hailing apps (Uber / Bolt / FreeNow) are safer than random taxis',
    ],
  };
}

function renderCityDetail(intel: StoredCityIntel): string {
  return `
    <div class="city-detail ${openCityId === intel.id ? 'open' : ''}" id="city-detail-${intel.id}">
      <div class="city-detail-header">
        <div class="city-detail-flag">${intel.flag}</div>
        <div class="city-detail-title">
          <div class="city-detail-name">${intel.city}</div>
          <div class="city-detail-country">${intel.country}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost close-detail" data-id="${intel.id}">Close</button>
          <button class="btn btn-danger delete-city" data-id="${intel.id}" style="padding:8px 14px">Delete</button>
        </div>
      </div>
      <div class="city-detail-grid">
        <div class="city-section">
          <div class="city-section-title">👋 Greetings</div>
          <div class="city-section-content">
            ${intel.greetings.map(g => `
              <div style="margin-bottom:8px">
                <strong>${g.phrase}</strong>
                ${g.pronunciation ? `<span style="color:var(--ink-muted)"> · ${g.pronunciation}</span>` : ''}
                ${g.meaning ? `<div style="font-size:var(--fs-sm);color:var(--ink-muted)">${g.meaning}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="city-section">
          <div class="city-section-title">🤝 Customs</div>
          <div class="city-section-content">
            <ul>${intel.customs.map(c => `<li>${c}</li>`).join('')}</ul>
          </div>
        </div>

        <div class="city-section">
          <div class="city-section-title">⚠️ Avoid</div>
          <div class="city-section-content">
            <ul>${intel.taboos.map(t => `<li>${t}</li>`).join('')}</ul>
          </div>
        </div>

        <div class="city-section">
          <div class="city-section-title">🏘️ Neighborhoods</div>
          <div class="city-section-content">
            ${intel.neighborhoods.map(n => `
              <div style="margin-bottom:8px">
                <strong>${n.name}</strong>
                <div style="font-size:var(--fs-sm);color:var(--ink-muted)">${n.vibe}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="city-section">
          <div class="city-section-title">🍜 Local food</div>
          <div class="city-section-content">
            <ul>${intel.localFood.map(f => `<li>${f}</li>`).join('')}</ul>
          </div>
        </div>

        <div class="city-section">
          <div class="city-section-title">💎 Hidden gems</div>
          <div class="city-section-content">
            <ul>${intel.hiddenGems.map(g => `<li>${g}</li>`).join('')}</ul>
          </div>
        </div>

        <div class="city-section" style="background:var(--amber-50);border:1px solid var(--amber-200)">
          <div class="city-section-title" style="color:var(--amber-700)">🛡️ Solo safety</div>
          <div class="city-section-content">
            <ul>${intel.safetyTips.map(t => `<li>${t}</li>`).join('')}</ul>
          </div>
        </div>

        <div class="city-section">
          <div class="city-section-title">🚌 Getting around</div>
          <div class="city-section-content">
            <ul>${intel.transport.map(t => `<li>${t}</li>`).join('')}</ul>
          </div>
        </div>
      </div>
      <div style="font-size:var(--fs-xs);color:var(--ink-faint);margin-top:var(--sp-5)">
        Generated ${new Date(intel.updatedAt).toLocaleDateString()}
      </div>
    </div>
  `;
}

function render() {
  const root = document.getElementById('view-cities');
  if (!root) return;

  const grid = root.querySelector<HTMLElement>('.cities-grid')!;
  const detailWrap = root.querySelector<HTMLElement>('.city-details-wrap')!;

  grid.innerHTML = _cities.length === 0 ? `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🏛️</div>
      <p>Search for a city above to generate your first intel card</p>
    </div>
  ` : _cities.map(c => `
    <div class="city-card" data-id="${c.id}">
      <div class="city-card-banner" style="background:${c.bannerColor}">${c.flag}</div>
      <div class="city-card-body">
        <div class="city-card-name">${c.city}</div>
        <div class="city-card-country">${c.country}</div>
        <div class="city-card-tags">
          <span class="city-card-tag">👋 Greetings</span>
          <span class="city-card-tag">🏘️ Hoods</span>
          <span class="city-card-tag">🛡️ Safety</span>
        </div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.city-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.id!;
      openCityId = openCityId === id ? null : id;
      render();
      if (openCityId) {
        document.getElementById(`city-detail-${openCityId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  detailWrap.innerHTML = _cities.map(renderCityDetail).join('');

  detailWrap.querySelectorAll('.close-detail').forEach(btn => {
    btn.addEventListener('click', () => { openCityId = null; render(); });
  });

  detailWrap.querySelectorAll('.delete-city').forEach(btn => {
    btn.addEventListener('click', () => cityStore.remove((btn as HTMLElement).dataset.id!));
  });
}

export function initCities() {
  // Subscribe: Firestore snapshots drive all re-renders. Idempotent so a trip
  // switch re-subscribes under the new tripId.
  _unsubCities?.();
  _cities = [];
  openCityId = null;
  _unsubCities = cityStore.subscribe((rows) => {
    _cities = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
    render();
  });

  // DOM event wiring runs once (the elements persist across trip switches).
  if (_citiesWired) return;
  _citiesWired = true;

  const root = document.getElementById('view-cities')!;
  const input = root.querySelector<HTMLInputElement>('#cities-search-input')!;
  const btn = root.querySelector<HTMLButtonElement>('#cities-search-btn')!;
  const status = root.querySelector<HTMLElement>('#cities-search-status')!;

  async function doSearch() {
    const q = input.value.trim();
    if (!q) return;

    // Already exists — just open it
    const existing = _cities.find(c => c.city.toLowerCase() === q.toLowerCase());
    if (existing) {
      openCityId = existing.id;
      render();
      document.getElementById(`city-detail-${existing.id}`)?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    btn.disabled = true;
    btn.textContent = '…';
    status.innerHTML = `<div class="city-loading"><div class="city-loading-spinner"></div><p>Generating intel for ${q}…</p></div>`;

    const intel = await fetchCityIntel(q);

    status.innerHTML = '';
    btn.disabled = false;
    btn.textContent = 'Generate';

    if (intel) {
      const id = slugId(q);
      await cityStore.save({ id, ...intel });
      openCityId = id;
      input.value = '';
      // render() will be triggered by the Firestore subscription
    } else {
      status.innerHTML = `<p style="color:var(--coral-500);font-size:var(--fs-sm)">Failed to generate intel. Check your API key in .env</p>`;
    }
  }

  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
}

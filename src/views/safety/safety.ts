/* ==========================================================================
   On the Road · Safety — orchestrator
   --------------------------------------------------------------------------
   Layout (top to bottom):
     1. SOS bar          — always visible, current-city emergency + share
     2. Landing          — location card, entry buttons, city grid + search
   Personal card and "Before you go" open as sheets/drawers.
   City safety cards open as modal popups with real AI content.
   ========================================================================== */

import './safety.css';
import { safetyStore, type StoredCitySafety } from '../../data/stores/safety-store.ts';
import { safetyProfileStore } from '../../data/stores/safety-profile-store.ts';
import { routeStore, type StoredLeg } from '../../data/stores/route-store.ts';
import { nationalityLabel } from '../../data/nationalities.ts';
import { renderLanding, wireLanding, type LocationState } from './landing.ts';
import { openCityModal } from './city-modal.ts';
import { openProfileSheet } from './profile-sheet.ts';
import { openEssentialsSheet } from './essentials-sheet.ts';
import { fetchCitySafety } from './generate.ts';
import { escHtml as esc, slugId } from '../../core/utils.ts';
import { openModal } from '../../core/modal.ts';

// ── State ─────────────────────────────────────────────────────────────────────
let _cards: StoredCitySafety[] = [];
let _legs: StoredLeg[] = [];
let _nationality = '';
let _hasProfile = false;
let _loc: LocationState = { city: '', country: '', flag: '', source: 'none', card: null, loading: false };
let _generating = false;
let _genStatus = '';

let _unsubCards: (() => void) | null = null;
let _unsubLegs: (() => void) | null = null;
let _unsubProfile: (() => void) | null = null;
let _gpsAttempted = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function telHref(number: string): string {
  return `tel:${number.replace(/[^+0-9]/g, '')}`;
}
function apiBase(): string {
  return window.location.hostname.includes('github.io')
    ? 'https://easy-on-the-road.vercel.app'
    : '';
}

// ── Current leg (for itinerary fallback) ──────────────────────────────────────
function currentLeg(): StoredLeg | null {
  if (!_legs.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const here = sorted.find((l) => l.dateFrom <= today && l.dateTo >= today);
  return here ?? sorted.find((l) => l.dateFrom >= today) ?? sorted[sorted.length - 1];
}

function cardFor(city: string): StoredCitySafety | null {
  return _cards.find((c) => c.id === slugId(city)) ?? null;
}

// ── GPS + geocode ─────────────────────────────────────────────────────────────
async function detectLocation(): Promise<void> {
  if (_gpsAttempted) return;
  _gpsAttempted = true;

  if (!navigator.geolocation) { applyItineraryFallback(); return; }

  _loc = { ..._loc, loading: true };
  renderAll();

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const res = await fetch(`${apiBase()}/api/safety`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'geocode', lat: pos.coords.latitude, lng: pos.coords.longitude }),
        });
        if (!res.ok) throw new Error('geocode failed');
        const geo = await res.json() as { city: string; country: string; countryCode: string };
        if (geo.city) {
          _loc = {
            city: geo.city,
            country: geo.country,
            flag: countryFlag(geo.countryCode),
            source: 'gps',
            card: cardFor(geo.city),
            loading: false,
          };
          renderAll();
          return;
        }
      } catch { /* fall through */ }
      applyItineraryFallback();
    },
    () => applyItineraryFallback(),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
  );
}

function countryFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return String.fromCodePoint(
    ...countryCode.toUpperCase().split('').map((c) => 0x1F1E6 + c.charCodeAt(0) - 65),
  );
}

function applyItineraryFallback(): void {
  const leg = currentLeg();
  if (!leg) { _loc = { city: '', country: '', flag: '', source: 'none', card: null, loading: false }; renderAll(); return; }
  _loc = {
    city: leg.city,
    country: leg.country,
    flag: leg.flag,
    source: 'itinerary',
    card: cardFor(leg.city),
    loading: false,
  };
  renderAll();
}

// ── SOS bar (merged with location card) ──────────────────────────────────────
function renderSos(): string {
  const cityName = _loc.city || currentLeg()?.city || 'your destination';
  const flag = _loc.flag || currentLeg()?.flag || '';
  const country = _loc.country || currentLeg()?.country || '';
  const card = _loc.card ?? cardFor(cityName);
  const general = card?.generalEmergency || '112';

  // Only show a badge when GPS is actively confirmed; itinerary is the default, no need to label it
  const locBadge = _loc.source === 'gps'
    ? `<span class="sos-loc-badge sos-loc-badge-gps">📍 Live</span>`
    : _loc.source === 'manual'
      ? `<span class="sos-loc-badge sos-loc-badge-manual">✏️ Manual</span>`
      : '';

  const nums = (card?.emergencyNumbers ?? []).filter((n) => n.number).slice(0, 4);
  const numChips = nums.length
    ? nums.map((n) => `
        <a class="sos-num" href="${telHref(n.number)}">
          <span class="sos-num-label">${esc(n.label)}</span>
          <span class="sos-num-value">${esc(n.number)}</span>
        </a>`).join('')
    : `<div class="sos-hint">Tap a city card to generate local emergency numbers.</div>`;

  return `
    <div class="sos-bar">
      <div class="sos-main">
        <div class="sos-loc-row">
          ${flag ? `<span class="sos-loc-flag">${esc(flag)}</span>` : ''}
          <div>
            <div class="sos-label">
              ${esc(cityName)}${country && country !== cityName ? ` <span class="sos-label-country">· ${esc(country)}</span>` : ''}
              <button class="sos-city-edit-btn" id="sos-city-edit" title="Change city">✏️</button>
            </div>
            ${locBadge}
          </div>
        </div>
        <a class="sos-dial" href="${telHref(general)}">
          <span class="sos-dial-icon">☎</span>
          <span class="sos-dial-num">${esc(general)}</span>
          <span class="sos-dial-sub">tap to call</span>
        </a>
      </div>
      <div class="sos-nums">${numChips}</div>
      <button class="btn sos-share" id="sos-share">📍 Share location</button>
    </div>`;
}

// ── City generation ───────────────────────────────────────────────────────────
async function generateForCity(city: string, country: string): Promise<void> {
  if (_generating || !city.trim()) return;
  _generating = true;
  _genStatus = `Building safety card for ${city}…`;
  renderAll();

  const data = await fetchCitySafety(
    city.trim(),
    country,
    _nationality ? nationalityLabel(_nationality) : '',
  );

  if (!data) {
    _genStatus = 'Could not generate card — check API key or connection.';
    _generating = false;
    renderAll();
    return;
  }

  const id = slugId(city);
  await safetyStore.save({ id, ...data, source: 'ai' });

  // Background-prefetch a city guide for the same place if one doesn't exist yet.
  void import('../guide/guide.ts').then(({ prefetchGuideForCity }) =>
    prefetchGuideForCity(city, country));

  _genStatus = '';
  _generating = false;

  // Open the modal immediately after Firestore write (store subscriber will update _cards)
  setTimeout(() => {
    const stored = _cards.find((c) => c.id === id);
    if (stored) openCityModal(stored, (card) => void generateForCity(card.city, card.country), () => {});
  }, 300);
}

// ── Full render ───────────────────────────────────────────────────────────────
function renderAll(): void {
  const root = document.getElementById('view-safety');
  if (!root) return;

  root.querySelector('.sfy-sos-wrap')!.innerHTML = renderSos();

  const landingWrap = root.querySelector<HTMLElement>('.sfy-landing-wrap')!;
  landingWrap.innerHTML = renderLanding(_cards, _legs, _hasProfile, _generating, _genStatus);

  wireAll(root);
}

function wireAll(root: HTMLElement): void {
  // SOS share
  const shareBtn = root.querySelector<HTMLButtonElement>('#sos-share');
  if (shareBtn && !shareBtn.dataset.wired) {
    shareBtn.dataset.wired = '1';
    shareBtn.addEventListener('click', shareLocation);
  }

  // Manual city override
  const cityEditBtn = root.querySelector<HTMLButtonElement>('#sos-city-edit');
  if (cityEditBtn && !cityEditBtn.dataset.wired) {
    cityEditBtn.dataset.wired = '1';
    cityEditBtn.addEventListener('click', openCityPicker);
  }

  wireLanding(root, {
    onCityClick: (card) => openCityModal(card, (c) => void generateForCity(c.city, c.country), () => {}),
    onCityGenerate: (city, country) => void generateForCity(city, country),
    onProfileOpen: openProfileSheet,
    onEssentialsOpen: openEssentialsSheet,
    onSearch: (city) => void generateForCity(city, ''),
    onLocationRefresh: () => { _gpsAttempted = false; void detectLocation(); },
  }, _cards);
}

// ── Manual city picker ────────────────────────────────────────────────────────
function openCityPicker(): void {
  const legs = [..._legs].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  if (!legs.length) return;

  const items = legs.map((l) =>
    `<button class="sos-picker-item${_loc.city === l.city ? ' active' : ''}" data-city="${esc(l.city)}" data-country="${esc(l.country)}" data-flag="${esc(l.flag)}">
      <span class="sos-picker-flag">${esc(l.flag)}</span>
      <span class="sos-picker-city">${esc(l.city)}</span>
      <span class="sos-picker-dates">${esc(l.dateFrom)} – ${esc(l.dateTo)}</span>
    </button>`
  ).join('');

  const m = openModal({
    title: 'Select city for SOS',
    body: `<div class="sos-picker-list">${items}</div>`,
    variant: 'sheet',
  });

  m.root.querySelectorAll<HTMLButtonElement>('.sos-picker-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const city = btn.dataset.city!;
      const country = btn.dataset.country!;
      const flag = btn.dataset.flag!;
      _loc = { city, country, flag, source: 'manual', card: cardFor(city), loading: false };
      renderAll();
      m.close();
    });
  });
}

// ── Share location ────────────────────────────────────────────────────────────
async function shareLocation(): Promise<void> {
  const btn = document.getElementById('sos-share') as HTMLButtonElement | null;
  if (!btn) return;
  if (!navigator.geolocation) { alert('Location not available on this device.'); return; }
  btn.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const url = `https://maps.google.com/?q=${latitude},${longitude}`;
      const text = `📍 My location right now: ${url}`;
      try {
        if (navigator.share) await navigator.share({ title: 'My location', text, url });
        else { await navigator.clipboard.writeText(text); btn.textContent = '✓ Copied'; }
      } catch { /* dismissed */ }
      setTimeout(() => { btn.textContent = '📍 Share location'; }, 2500);
    },
    () => { btn.textContent = 'Location blocked'; setTimeout(() => { btn.textContent = '📍 Share location'; }, 2500); },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

// ── Background prefetch (called by Guide after a city is generated) ───────────
/**
 * Silently generate a safety card for `city` if one doesn't already exist.
 * Fires and forgets — Guide doesn't need to await it.
 */
export async function prefetchSafetyForCity(city: string, country: string): Promise<void> {
  const id = slugId(city);
  const already = _cards.find((c) => c.id === id);
  if (already) return;

  try {
    const data = await fetchCitySafety(city.trim(), country, _nationality ? nationalityLabel(_nationality) : '');
    if (!data) return;
    await safetyStore.save({ id, ...data, source: 'ai' });
  } catch {
    // Silent — this is a background prefetch, failures are acceptable
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
export function initSafety(): void {
  const root = document.getElementById('view-safety')!;
  root.querySelector('.safety-body')!.innerHTML = `
    <div class="sfy-sos-wrap"></div>
    <div class="sfy-landing-wrap"></div>
  `;

  _unsubCards?.();
  _unsubLegs?.();
  _unsubProfile?.();
  _cards = []; _legs = []; _nationality = ''; _hasProfile = false;
  _loc = { city: '', country: '', flag: '', source: 'none', card: null, loading: false };
  _gpsAttempted = false;
  _generating = false;
  _genStatus = '';

  _unsubProfile = safetyProfileStore.subscribe((p) => {
    _nationality = p?.nationality ?? '';
    _hasProfile = !!p && !!(p.nationality || (p.emergencyContacts?.length ?? 0) || p.bloodType);
    renderAll();
  });

  _unsubLegs = routeStore.subscribe((legs) => {
    _legs = legs;
    // Refresh itinerary fallback location if GPS wasn't used
    if (_loc.source === 'itinerary' || _loc.source === 'none') applyItineraryFallback();
    renderAll();
  });

  _unsubCards = safetyStore.subscribe((rows) => {
    _cards = [...rows].sort((a, b) => a.city.localeCompare(b.city));
    // Update location card reference if city matches
    if (_loc.city) _loc = { ..._loc, card: cardFor(_loc.city) };
    renderAll();
  });

  // Attempt GPS after first render (non-blocking)
  void detectLocation();
}

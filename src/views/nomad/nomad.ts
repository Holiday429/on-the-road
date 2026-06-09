/* ==========================================================================
   On the Road · Nomad — Digital nomad spots
   ========================================================================== */

import './nomad.css';
import { nomadStore, type StoredNomadSpot } from '../../data/stores/nomad-store.ts';
import { currentTripId } from '../../data/trip-context.ts';
import { currentUser } from '../../firebase/auth.ts';
import { type NomadSpot, composite, scoreClass } from './nomad-types.ts';
import { openAddModal, openDetailModal } from './nomad-modal.ts';
import { routeStore } from '../../data/stores/route-store.ts';

/* ── State ───────────────────────────────────────────────────────────────── */

let spots: (NomadSpot | StoredNomadSpot)[] = [];
let scope: 'trip' | 'all' = 'trip';
let activeCountry: string | null = null;
let searchQuery = '';
let _unsubNomad: (() => void) | null = null;
let _refresh: (() => void) | null = null;

/* ── Filter helpers ──────────────────────────────────────────────────────── */

function getCountries(): { country: string; count: number }[] {
  const map = new Map<string, number>();
  spots.forEach(s => map.set(s.country, (map.get(s.country) ?? 0) + 1));
  return [...map.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => a.country.localeCompare(b.country));
}

function filteredSpots(): NomadSpot[] {
  return spots.filter(s => {
    const matchesCountry = !activeCountry || s.country === activeCountry;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q
      || s.name.toLowerCase().includes(q)
      || s.city.toLowerCase().includes(q)
      || s.country.toLowerCase().includes(q);
    return matchesCountry && matchesSearch;
  });
}

/* ── Card rendering ──────────────────────────────────────────────────────── */

function renderCardPhoto(spot: NomadSpot): string {
  const src = spot.photos[0] ?? spot.placePhotoUrl ?? '';
  if (src) return `<img src="${src}" alt="${spot.name}" loading="lazy">`;
  const emoji = spot.type === 'Café' ? '☕' : spot.type === 'Co-working' ? '💻' : spot.type === 'Library' ? '📚' : '🏨';
  return `<div class="nomad-card-photo-placeholder">${emoji}<span>No photo yet</span></div>`;
}

function renderAmenities(r: NomadSpot['ratings']): string {
  const items: string[] = [];
  if (r.wifi >= 4) items.push('📶 Fast WiFi');
  else if (r.wifi <= 2) items.push('📶 Weak WiFi');
  if (r.power >= 4) items.push('🔌 Outlets');
  if (r.coffee >= 4) items.push('☕ Good coffee');
  return items.map(i => `<span class="nomad-amenity-dot">${i}</span>`).join('');
}

function renderCard(spot: NomadSpot): string {
  const score = composite(spot.ratings);
  return `
    <div class="nomad-card" data-id="${spot.id}">
      <div class="nomad-card-photo">
        ${renderCardPhoto(spot)}
        <span class="nomad-card-type-badge">${spot.type}</span>
        <span class="nomad-card-score-badge ${scoreClass(score)}">${score.toFixed(1)}</span>
      </div>
      <div class="nomad-card-body">
        <div class="nomad-card-name">${spot.name}</div>
        <div class="nomad-card-location">📍 ${spot.city}, ${spot.country}</div>
        <div class="nomad-card-amenities">${renderAmenities(spot.ratings)}</div>
        ${spot.comment ? `<div class="nomad-card-comment">${spot.comment}</div>` : ''}
        ${spot.mapsUrl ? `<a class="nomad-card-map-link" href="${spot.mapsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🗺 View on Google Maps</a>` : ''}
      </div>
    </div>
  `;
}

function renderGallery(container: HTMLElement) {
  const visible = filteredSpots();
  if (visible.length === 0) {
    const isFiltered = !!activeCountry || !!searchQuery;
    container.innerHTML = `
      <div class="nomad-empty">
        <div class="nomad-empty-icon">💻</div>
        <div class="nomad-empty-title">${isFiltered ? 'No spots match your filter' : 'No spots yet'}</div>
        <div class="nomad-empty-text">${isFiltered ? 'Try a different country or search term.' : 'Hit "+ Add spot" to log the first work-friendly place you find.'}</div>
      </div>
    `;
    return;
  }
  container.innerHTML = visible.map(renderCard).join('');
}

/* ── Country chips ───────────────────────────────────────────────────────── */

function renderChips(container: HTMLElement) {
  const countries = getCountries();
  const allChip = `<div class="nomad-chip${!activeCountry ? ' active' : ''}" data-country="">All <span class="nomad-chip-count">${spots.length}</span></div>`;
  const chips = countries.map(({ country, count }) =>
    `<div class="nomad-chip${activeCountry === country ? ' active' : ''}" data-country="${country}">${country} <span class="nomad-chip-count">${count}</span></div>`
  ).join('');
  container.innerHTML = allChip + chips;
}

/* ── Init ────────────────────────────────────────────────────────────────── */

function subscribeSpots() {
  _unsubNomad?.();
  const tripId = scope === 'all' ? null : currentTripId();
  _unsubNomad = nomadStore.subscribeForTrip(tripId, (rows) => {
    spots = rows;
    _refresh?.();
  });
}

export function initNomad() {
  const body = document.querySelector<HTMLElement>('#view-nomad .nomad-body');
  if (!body) return;

  body.innerHTML = `
    <div class="nomad-toolbar">
      <div class="nomad-scope">
        <button class="nomad-scope-btn${scope === 'trip' ? ' active' : ''}" data-scope="trip">This trip</button>
        <button class="nomad-scope-btn${scope === 'all' ? ' active' : ''}" data-scope="all">All trips</button>
      </div>
      <div class="nomad-search-wrap">
        <span class="nomad-search-icon">🔍</span>
        <input class="input" id="nomad-search" placeholder="Search spots or cities…">
      </div>
      <div class="nomad-filter-chips" id="nomad-chips"></div>
      <button class="btn btn-primary" id="nomad-add-btn" style="white-space:nowrap;flex-shrink:0">+ Add spot</button>
    </div>
    <div class="nomad-gallery" id="nomad-gallery"></div>
  `;

  const gallery = body.querySelector<HTMLElement>('#nomad-gallery')!;
  const chipsEl = body.querySelector<HTMLElement>('#nomad-chips')!;
  const searchInput = body.querySelector<HTMLInputElement>('#nomad-search')!;
  const addBtn = body.querySelector<HTMLElement>('#nomad-add-btn')!;
  const scopeBtns = body.querySelectorAll<HTMLElement>('.nomad-scope-btn');

  function refresh() {
    renderGallery(gallery);
    renderChips(chipsEl);
  }
  _refresh = refresh;

  subscribeSpots();
  refresh();

  scopeBtns.forEach((btn) => btn.addEventListener('click', () => {
    scope = (btn.dataset.scope as 'trip' | 'all');
    scopeBtns.forEach((b) => b.classList.toggle('active', b === btn));
    activeCountry = null;
    subscribeSpots();
    refresh();
  }));

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    renderGallery(gallery);
  });

  chipsEl.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.nomad-chip');
    if (!chip) return;
    activeCountry = chip.dataset.country || null;
    renderChips(chipsEl);
    renderGallery(gallery);
  });

  gallery.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.nomad-card');
    if (!card) return;
    const spot = spots.find(s => s.id === card.dataset.id);
    if (!spot) return;
    openDetailModal(spot, () => {});
  });

  addBtn.addEventListener('click', () => {
    const tripId = currentTripId();
    const legCities = tripId
      ? routeStore.peek().filter(l => l.tripId === tripId).map(l => ({ city: l.city, country: l.country }))
      : [];
    openAddModal(
      (newSpot) => {
        void nomadStore.add({
          name: newSpot.name,
          city: newSpot.city,
          country: newSpot.country,
          type: newSpot.type,
          ratings: newSpot.ratings,
          comment: newSpot.comment,
          photos: newSpot.photos,
          placeId: newSpot.placeId,
          mapsUrl: newSpot.mapsUrl,
          address: newSpot.address,
          placePhotoUrl: newSpot.placePhotoUrl,
          visibility: 'private',
          ownerId: currentUser()?.uid ?? '',
        });
      },
      () => {},
      undefined,
      legCities,
    );
  });
}


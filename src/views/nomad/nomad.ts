/* ==========================================================================
   On the Road · Nomad — Digital nomad spots
   ========================================================================== */

import './nomad.css';

/* ── Types ───────────────────────────────────────────────────────────────── */

interface NomadRatings {
  wifi: number;       // 1–5
  power: number;      // 1–5
  restroom: number;   // 1–5
  coffee: number;     // 1–5
  service: number;    // 1–5
}

interface NomadSpot {
  id: string;
  name: string;
  city: string;
  country: string;
  type: 'Café' | 'Co-working' | 'Library' | 'Hotel lobby';
  ratings: NomadRatings;
  comment?: string;
  photos: string[];          // data URLs or blob URLs
  placeId?: string;          // Google Places place_id
  mapsUrl?: string;          // direct maps link
  address?: string;
  placePhotoUrl?: string;    // cached first photo from Places API
}

/* ── Rating dimensions ───────────────────────────────────────────────────── */

const RATING_DIMS: { key: keyof NomadRatings; label: string; emoji: string }[] = [
  { key: 'wifi',     label: 'WiFi',          emoji: '📶' },
  { key: 'power',    label: 'Power outlets', emoji: '🔌' },
  { key: 'restroom', label: 'Restroom',      emoji: '🚻' },
  { key: 'coffee',   label: 'Coffee',        emoji: '☕' },
  { key: 'service',  label: 'Service',       emoji: '🤝' },
];

/* ── Score helpers ───────────────────────────────────────────────────────── */

function composite(r: NomadRatings): number {
  const vals = RATING_DIMS.map(d => r[d.key]);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(avg * 10) / 10;
}

function scoreClass(score: number): string {
  if (score >= 4.2) return 'score-great';
  if (score >= 3.2) return 'score-good';
  if (score >= 2.2) return 'score-ok';
  return 'score-poor';
}

/* ── Seed data ───────────────────────────────────────────────────────────── */

const SEED_SPOTS: NomadSpot[] = [
  {
    id: '1',
    name: 'Federal Café',
    city: 'Barcelona',
    country: 'Spain',
    type: 'Café',
    ratings: { wifi: 5, power: 4, restroom: 4, coffee: 5, service: 4 },
    comment: 'Fantastic flat whites and plenty of outlets. Gets busy 11am–1pm but quiets down after 2.',
    photos: [],
    mapsUrl: 'https://maps.google.com/?q=Federal+Café+Barcelona',
    address: 'Carrer del Parlament, 39, Barcelona',
  },
  {
    id: '2',
    name: 'Betahaus',
    city: 'Barcelona',
    country: 'Spain',
    type: 'Co-working',
    ratings: { wifi: 5, power: 5, restroom: 5, coffee: 3, service: 4 },
    comment: 'Day passes available. Quiet floor upstairs has phone booths. Community events on Thursdays.',
    photos: [],
    mapsUrl: 'https://maps.google.com/?q=Betahaus+Barcelona',
    address: 'Carrer de Viladomat, 174, Barcelona',
  },
  {
    id: '3',
    name: 'Café Hawelka',
    city: 'Vienna',
    country: 'Austria',
    type: 'Café',
    ratings: { wifi: 2, power: 1, restroom: 3, coffee: 5, service: 4 },
    comment: 'Old Viennese coffeehouse atmosphere. Wifi is minimal but 4G coverage compensates. Cash only.',
    photos: [],
    mapsUrl: 'https://maps.google.com/?q=Café+Hawelka+Vienna',
    address: 'Dorotheergasse 6, Vienna',
  },
  {
    id: '4',
    name: 'WeWork Neue Donau',
    city: 'Vienna',
    country: 'Austria',
    type: 'Co-working',
    ratings: { wifi: 5, power: 5, restroom: 5, coffee: 3, service: 4 },
    comment: 'Drop-in hot desks from €30/day. Reliable gigabit wifi, great for long video calls.',
    photos: [],
    mapsUrl: 'https://maps.google.com/?q=WeWork+Neue+Donau+Vienna',
    address: 'Wagramer Str. 19, Vienna',
  },
  {
    id: '5',
    name: 'Anticafé',
    city: 'Paris',
    country: 'France',
    type: 'Café',
    ratings: { wifi: 4, power: 5, restroom: 4, coffee: 3, service: 5 },
    comment: 'Pay by the hour, unlimited coffee and tea included. Multiple Paris locations. Very nomad-friendly policy.',
    photos: [],
    mapsUrl: 'https://maps.google.com/?q=Anticafé+Paris',
    address: '79 Rue Quincampoix, Paris',
  },
];

/* ── State ───────────────────────────────────────────────────────────────── */

let spots: NomadSpot[] = [...SEED_SPOTS];
let activeCountry: string | null = null;
let searchQuery = '';
let pendingPhotos: string[] = [];

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

function renderScoreBadge(score: number): string {
  const cls = scoreClass(score);
  return `<span class="nomad-card-score-badge ${cls}">${score.toFixed(1)}</span>`;
}

function renderCardPhoto(spot: NomadSpot): string {
  const src = spot.photos[0] ?? spot.placePhotoUrl ?? '';
  if (src) {
    return `<img src="${src}" alt="${spot.name}" loading="lazy">`;
  }
  const emoji = spot.type === 'Café' ? '☕' : spot.type === 'Co-working' ? '💻' : spot.type === 'Library' ? '📚' : '🏨';
  return `<div class="nomad-card-photo-placeholder">${emoji}<span>No photo yet</span></div>`;
}

function renderAmenities(r: NomadRatings): string {
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
        ${renderScoreBadge(score)}
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
    container.innerHTML = `
      <div class="nomad-empty">
        <div class="nomad-empty-icon">☕</div>
        <div class="nomad-empty-title">No spots found</div>
        <div class="nomad-empty-text">Try a different filter or add the first spot for this area.</div>
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

/* ── Google Places autocomplete ──────────────────────────────────────────── */

interface PlaceCandidate {
  description: string;
  mainText: string;
  secondaryText: string;
  placeId: string;
}

let placesDebounce: ReturnType<typeof setTimeout> | null = null;
let placesSession: string = String(Date.now());

async function fetchPlaceSuggestions(query: string): Promise<PlaceCandidate[]> {
  if (query.length < 3) return [];
  const key = (window as any).__GOOGLE_PLACES_KEY as string | undefined;
  if (!key) return [];

  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=establishment&key=${key}&sessiontoken=${placesSession}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return (data.predictions ?? []).slice(0, 5).map((p: any) => ({
      description: p.description,
      mainText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? '',
      placeId: p.place_id,
    }));
  } catch {
    return [];
  }
}

async function fetchPlaceDetail(placeId: string): Promise<{ address: string; mapsUrl: string; lat: number; lng: number; photoRef?: string } | null> {
  const key = (window as any).__GOOGLE_PLACES_KEY as string | undefined;
  if (!key) return null;

  const fields = 'formatted_address,geometry,url,photos';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${key}&sessiontoken=${placesSession}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const r = data.result;
    if (!r) return null;
    placesSession = String(Date.now());
    return {
      address: r.formatted_address ?? '',
      mapsUrl: r.url ?? `https://maps.google.com/?place_id=${placeId}`,
      lat: r.geometry?.location?.lat ?? 0,
      lng: r.geometry?.location?.lng ?? 0,
      photoRef: r.photos?.[0]?.photo_reference,
    };
  } catch {
    return null;
  }
}

function buildPlacePhotoUrl(photoRef: string): string {
  const key = (window as any).__GOOGLE_PLACES_KEY as string | undefined;
  if (!key) return '';
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(photoRef)}&key=${key}`;
}

function buildMapsEmbedUrl(spot: NomadSpot): string {
  const key = (window as any).__GOOGLE_PLACES_KEY as string | undefined;
  if (key && spot.placeId) {
    return `https://www.google.com/maps/embed/v1/place?key=${key}&q=place_id:${spot.placeId}`;
  }
  const q = encodeURIComponent(spot.address || `${spot.name} ${spot.city}`);
  return `https://www.google.com/maps/embed/v1/place?key=${key || ''}&q=${q}`;
}

/* ── Add spot modal ──────────────────────────────────────────────────────── */

function openAddModal(
  onAdd: (spot: NomadSpot) => void,
  onClose: () => void
) {
  const ratings: NomadRatings = { wifi: 3, power: 3, restroom: 3, coffee: 3, service: 3 };
  let selectedPlaceId = '';
  let selectedMapsUrl = '';
  let selectedAddress = '';
  let selectedPlacePhotoUrl = '';
  pendingPhotos = [];

  const backdrop = document.createElement('div');
  backdrop.className = 'nomad-modal-backdrop';
  backdrop.innerHTML = `
    <div class="nomad-modal nomad-add-modal" role="dialog" aria-modal="true" aria-label="Add a spot">
      <div class="nomad-modal-header">
        <div class="nomad-modal-title">Add a spot</div>
        <button class="nomad-modal-close" aria-label="Close">✕</button>
      </div>
      <div class="nomad-modal-body">

        <div>
          <div class="nomad-form-section-title">Location</div>
          <div class="nomad-form-row" style="gap:var(--sp-3);margin-bottom:var(--sp-3)">
            <div class="nomad-field">
              <label>Country</label>
              <input class="input" id="na-country" placeholder="Spain" required>
            </div>
            <div class="nomad-field">
              <label>City</label>
              <input class="input" id="na-city" placeholder="Barcelona" required>
            </div>
          </div>
          <div class="nomad-field">
            <label>Spot name</label>
            <div class="nomad-place-wrap">
              <input class="input" id="na-name" placeholder="Federal Café" required autocomplete="off">
              <div class="nomad-place-suggestions" id="na-suggestions" hidden></div>
            </div>
            <div id="na-place-info" style="margin-top:var(--sp-2);font-size:var(--fs-xs);color:var(--ink-muted);display:none"></div>
          </div>
          <div class="nomad-field" style="margin-top:var(--sp-3)">
            <label>Type</label>
            <select class="input" id="na-type">
              <option>Café</option>
              <option>Co-working</option>
              <option>Library</option>
              <option>Hotel lobby</option>
            </select>
          </div>
        </div>

        <div>
          <div class="nomad-form-section-title">Ratings</div>
          <div class="nomad-ratings-grid" id="na-ratings">
            ${RATING_DIMS.map(d => `
              <div class="nomad-rating-row">
                <div class="nomad-rating-label"><span>${d.emoji}</span>${d.label}</div>
                <input type="range" class="nomad-slider" id="na-r-${d.key}" name="${d.key}" min="1" max="5" value="3" step="1">
                <div class="nomad-rating-value" id="na-v-${d.key}">3</div>
              </div>
            `).join('')}
          </div>
          <div class="nomad-score-preview" style="margin-top:var(--sp-4)">
            <div class="nomad-score-preview-label">Composite score</div>
            <div class="nomad-score-preview-value" id="na-composite">3.0</div>
          </div>
        </div>

        <div>
          <div class="nomad-form-section-title">Comment</div>
          <div class="nomad-field">
            <label>Your experience</label>
            <textarea class="input" id="na-comment" rows="3" placeholder="Best time to visit, what to order, tips for remote work…" style="resize:vertical"></textarea>
          </div>
        </div>

        <div>
          <div class="nomad-form-section-title">Photos</div>
          <div class="nomad-photo-upload" id="na-upload-zone">
            <input type="file" id="na-photos" accept="image/*" multiple>
            <div class="nomad-photo-upload-icon">📸</div>
            <div class="nomad-photo-upload-text">Click to add photos</div>
            <div class="nomad-photo-upload-sub">JPG, PNG — up to 5 images</div>
          </div>
          <div class="nomad-photo-preview" id="na-photo-preview"></div>
        </div>

        <button class="btn btn-primary" id="na-submit" style="width:100%;justify-content:center;min-height:44px">
          Add spot
        </button>

      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const modal = backdrop.querySelector('.nomad-modal')!;
  const nameInput = backdrop.querySelector<HTMLInputElement>('#na-name')!;
  const suggestionsEl = backdrop.querySelector<HTMLElement>('#na-suggestions')!;
  const placeInfoEl = backdrop.querySelector<HTMLElement>('#na-place-info')!;
  const compositeEl = backdrop.querySelector<HTMLElement>('#na-composite')!;
  const photoPreviewEl = backdrop.querySelector<HTMLElement>('#na-photo-preview')!;
  const photoInput = backdrop.querySelector<HTMLInputElement>('#na-photos')!;

  function updateComposite() {
    compositeEl.textContent = composite(ratings).toFixed(1);
  }

  // Rating sliders
  RATING_DIMS.forEach(d => {
    const slider = backdrop.querySelector<HTMLInputElement>(`#na-r-${d.key}`)!;
    const val = backdrop.querySelector<HTMLElement>(`#na-v-${d.key}`)!;
    slider.addEventListener('input', () => {
      ratings[d.key] = Number(slider.value);
      val.textContent = slider.value;
      updateComposite();
    });
  });

  // Places autocomplete
  nameInput.addEventListener('input', () => {
    const q = nameInput.value.trim();
    selectedPlaceId = '';
    selectedMapsUrl = '';
    selectedAddress = '';
    selectedPlacePhotoUrl = '';
    placeInfoEl.style.display = 'none';

    if (placesDebounce) clearTimeout(placesDebounce);
    if (q.length < 3) { suggestionsEl.hidden = true; return; }

    placesDebounce = setTimeout(async () => {
      const results = await fetchPlaceSuggestions(q);
      if (results.length === 0) {
        suggestionsEl.hidden = true;
        return;
      }
      suggestionsEl.hidden = false;
      suggestionsEl.innerHTML = results.map(r => `
        <div class="nomad-place-item" data-place-id="${r.placeId}" data-description="${r.description}">
          <div class="nomad-place-item-main">${r.mainText}</div>
          <div class="nomad-place-item-sub">${r.secondaryText}</div>
        </div>
      `).join('');
    }, 320);
  });

  suggestionsEl.addEventListener('click', async (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.nomad-place-item');
    if (!item) return;
    const pid = item.dataset.placeId!;
    nameInput.value = item.querySelector('.nomad-place-item-main')!.textContent!;
    suggestionsEl.hidden = true;
    selectedPlaceId = pid;

    placeInfoEl.style.display = 'block';
    placeInfoEl.textContent = 'Fetching details from Google Maps…';

    const detail = await fetchPlaceDetail(pid);
    if (detail) {
      selectedMapsUrl = detail.mapsUrl;
      selectedAddress = detail.address;
      if (detail.photoRef) {
        selectedPlacePhotoUrl = buildPlacePhotoUrl(detail.photoRef);
      }
      placeInfoEl.innerHTML = `📍 ${detail.address}`;
    } else {
      selectedMapsUrl = `https://maps.google.com/?q=${encodeURIComponent(nameInput.value)}`;
      placeInfoEl.textContent = '📍 Address not found — a Maps link will be generated from the name.';
    }
  });

  // Photo upload
  photoInput.addEventListener('change', () => {
    const files = Array.from(photoInput.files ?? []).slice(0, 5);
    pendingPhotos = [];
    photoPreviewEl.innerHTML = '';
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string;
        pendingPhotos.push(url);
        const img = document.createElement('img');
        img.className = 'nomad-photo-thumb';
        img.src = url;
        photoPreviewEl.appendChild(img);
      };
      reader.readAsDataURL(file);
    });
  });

  // Submit
  backdrop.querySelector('#na-submit')!.addEventListener('click', () => {
    const country = (backdrop.querySelector<HTMLInputElement>('#na-country')!).value.trim();
    const city = (backdrop.querySelector<HTMLInputElement>('#na-city')!).value.trim();
    const name = nameInput.value.trim();
    const type = (backdrop.querySelector<HTMLSelectElement>('#na-type')!).value as NomadSpot['type'];
    const comment = (backdrop.querySelector<HTMLTextAreaElement>('#na-comment')!).value.trim();

    if (!country || !city || !name) {
      nameInput.focus();
      return;
    }

    const mapsUrl = selectedMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(name + ' ' + city)}`;

    const spot: NomadSpot = {
      id: String(Date.now()),
      name, city, country, type,
      ratings: { ...ratings },
      comment: comment || undefined,
      photos: [...pendingPhotos],
      placeId: selectedPlaceId || undefined,
      mapsUrl,
      address: selectedAddress || undefined,
      placePhotoUrl: selectedPlacePhotoUrl || undefined,
    };

    onAdd(spot);
    closeModal();
  });

  // Close
  function closeModal() {
    backdrop.remove();
    onClose();
  }

  backdrop.querySelector('.nomad-modal-close')!.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
  });

  // Trap click outside suggestions
  document.addEventListener('click', (e) => {
    if (!modal.contains(e.target as Node)) suggestionsEl.hidden = true;
  }, { once: false });
}

/* ── Detail modal (split-pane: info left, map right) ─────────────────────── */

function openDetailModal(spot: NomadSpot, onClose: () => void) {
  const score = composite(spot.ratings);
  const scoreLabel = scoreClass(score);

  const heroSrc = spot.photos[0] ?? spot.placePhotoUrl ?? '';
  const heroContent = heroSrc
    ? `<img src="${heroSrc}" alt="${spot.name}">`
    : `<div class="nomad-detail-hero-placeholder">${spot.type === 'Café' ? '☕' : spot.type === 'Co-working' ? '💻' : '📍'}</div>`;

  const ratingsHtml = RATING_DIMS.map(d => `
    <div class="nomad-detail-rating-row">
      <div class="nomad-detail-rating-label"><span>${d.emoji}</span>${d.label}</div>
      <div class="nomad-detail-rating-bar-track">
        <div class="nomad-detail-rating-bar-fill" style="width:${(spot.ratings[d.key] / 5) * 100}%"></div>
      </div>
      <div class="nomad-detail-rating-score">${spot.ratings[d.key]}</div>
    </div>
  `).join('');

  const photosHtml = (() => {
    const all = [...spot.photos];
    if (spot.placePhotoUrl && all.length === 0) all.push(spot.placePhotoUrl);
    return all.length > 1
      ? `<div class="nomad-section-label">Photos</div>
         <div class="nomad-detail-photos">${all.map(p => `<img class="nomad-detail-photo" src="${p}" alt="">`).join('')}</div>`
      : '';
  })();

  const embedUrl = buildMapsEmbedUrl(spot);

  const backdrop = document.createElement('div');
  backdrop.className = 'nomad-modal-backdrop nomad-split-backdrop';
  backdrop.innerHTML = `
    <div class="nomad-modal nomad-split-modal" role="dialog" aria-modal="true" aria-label="${spot.name}">

      <!-- Left: info pane -->
      <div class="nomad-split-info">
        <div class="nomad-detail-hero">
          ${heroContent}
          <div class="nomad-detail-hero-badges">
            <span class="nomad-card-type-badge">${spot.type}</span>
            <span class="nomad-card-score-badge ${scoreLabel}">${score.toFixed(1)}</span>
          </div>
          <button class="nomad-modal-close" style="position:absolute;top:var(--sp-3);right:var(--sp-3);background:rgba(255,255,255,0.9)" aria-label="Close">✕</button>
        </div>
        <div class="nomad-detail-body">

          <div class="nomad-detail-title-row">
            <div>
              <div class="nomad-detail-name">${spot.name}</div>
              <div class="nomad-detail-location">📍 ${spot.address || `${spot.city}, ${spot.country}`}</div>
            </div>
            <a class="nomad-detail-map-btn" href="${spot.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(spot.name + ' ' + spot.city)}`}" target="_blank" rel="noopener" title="Open in Google Maps">↗</a>
          </div>

          <div>
            <div class="nomad-section-label">Ratings</div>
            <div class="nomad-detail-ratings">${ratingsHtml}</div>
          </div>

          ${spot.comment ? `
          <div>
            <div class="nomad-section-label">Comment</div>
            <div class="nomad-detail-comment">${spot.comment}</div>
          </div>` : ''}

          ${photosHtml}

        </div>
      </div>

      <!-- Right: map pane -->
      <div class="nomad-split-map">
        <iframe
          class="nomad-map-iframe"
          src="${embedUrl}"
          allowfullscreen
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          title="Map: ${spot.name}"
        ></iframe>
        <div class="nomad-map-no-key" id="nomad-map-notice" hidden>
          <div>🗺</div>
          <div>Add a Google Maps API key to enable the embedded map.</div>
          <a href="${spot.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(spot.name + ' ' + spot.city)}`}" target="_blank" rel="noopener" class="btn btn-ghost" style="margin-top:var(--sp-3)">Open in Google Maps ↗</a>
        </div>
      </div>

    </div>
  `;

  document.body.appendChild(backdrop);

  // Without an API key, fall back to a keyless embed URL
  if (!(window as any).__GOOGLE_PLACES_KEY) {
    const iframe = backdrop.querySelector<HTMLIFrameElement>('.nomad-map-iframe')!;
    iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(spot.address || spot.name + ' ' + spot.city)}&output=embed`;
  }

  function closeModal() {
    backdrop.remove();
    onClose();
  }

  backdrop.querySelector('.nomad-modal-close')!.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
  });
}

/* ── Init ────────────────────────────────────────────────────────────────── */

export function initNomad() {
  const body = document.querySelector<HTMLElement>('#view-nomad .nomad-body');
  if (!body) return;

  body.innerHTML = `
    <div class="nomad-toolbar">
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

  function refresh() {
    renderGallery(gallery);
    renderChips(chipsEl);
  }

  refresh();

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
    openAddModal(
      (newSpot) => {
        spots = [newSpot, ...spots];
        refresh();
      },
      () => {}
    );
  });
}

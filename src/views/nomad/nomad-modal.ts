/* ==========================================================================
   On the Road · Nomad — Add & Detail modals
   ========================================================================== */

import type { NomadRatings, NomadSpot } from './nomad-types.ts';
import { RATING_DIMS, composite, scoreClass } from './nomad-types.ts';

/* ── Google Places helpers ───────────────────────────────────────────────── */

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

export function openAddModal(
  onAdd: (spot: NomadSpot) => void,
  onClose: () => void,
  prefill?: { city?: string; country?: string },
  legCities?: Array<{ city: string; country: string }>,
) {
  const ratings: NomadRatings = { wifi: 3, power: 3, restroom: 3, coffee: 3, service: 3 };
  let selectedPlaceId = '';
  let selectedMapsUrl = '';
  let selectedAddress = '';
  let selectedPlacePhotoUrl = '';
  let pendingPhotos: string[] = [];

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
              <input class="input" id="na-country" placeholder="Spain" required value="">
            </div>
            <div class="nomad-field">
              <label>City</label>
              <input class="input" id="na-city" placeholder="Barcelona" required list="na-city-list" value="">
              <datalist id="na-city-list"></datalist>
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

  // Populate city datalist from trip legs and apply prefill
  const cityInput = backdrop.querySelector<HTMLInputElement>('#na-city')!;
  const countryInput = backdrop.querySelector<HTMLInputElement>('#na-country')!;
  const cityDatalist = backdrop.querySelector<HTMLDataListElement>('#na-city-list')!;

  if (legCities?.length) {
    legCities.forEach(({ city }) => {
      const opt = document.createElement('option');
      opt.value = city;
      cityDatalist.appendChild(opt);
    });
    // Auto-fill country when a leg city is selected
    cityInput.addEventListener('change', () => {
      const match = legCities.find((l) => l.city.toLowerCase() === cityInput.value.trim().toLowerCase());
      if (match && !countryInput.value.trim()) countryInput.value = match.country;
    });
  }

  if (prefill?.city) cityInput.value = prefill.city;
  if (prefill?.country) countryInput.value = prefill.country;

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

  RATING_DIMS.forEach(d => {
    const slider = backdrop.querySelector<HTMLInputElement>(`#na-r-${d.key}`)!;
    const val = backdrop.querySelector<HTMLElement>(`#na-v-${d.key}`)!;
    slider.addEventListener('input', () => {
      ratings[d.key] = Number(slider.value);
      val.textContent = slider.value;
      updateComposite();
    });
  });

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
      if (results.length === 0) { suggestionsEl.hidden = true; return; }
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
      if (detail.photoRef) selectedPlacePhotoUrl = buildPlacePhotoUrl(detail.photoRef);
      placeInfoEl.innerHTML = `📍 ${detail.address}`;
    } else {
      selectedMapsUrl = `https://maps.google.com/?q=${encodeURIComponent(nameInput.value)}`;
      placeInfoEl.textContent = '📍 Address not found — a Maps link will be generated from the name.';
    }
  });

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

  backdrop.querySelector('#na-submit')!.addEventListener('click', () => {
    const country = (backdrop.querySelector<HTMLInputElement>('#na-country')!).value.trim();
    const city = (backdrop.querySelector<HTMLInputElement>('#na-city')!).value.trim();
    const name = nameInput.value.trim();
    const type = (backdrop.querySelector<HTMLSelectElement>('#na-type')!).value as NomadSpot['type'];
    const comment = (backdrop.querySelector<HTMLTextAreaElement>('#na-comment')!).value.trim();

    if (!country || !city || !name) { nameInput.focus(); return; }

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

  function closeModal() { backdrop.remove(); onClose(); }

  backdrop.querySelector('.nomad-modal-close')!.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
  });
  document.addEventListener('click', (e) => {
    if (!modal.contains(e.target as Node)) suggestionsEl.hidden = true;
  }, { once: false });
}

/* ── Detail modal ────────────────────────────────────────────────────────── */

export function openDetailModal(spot: NomadSpot, onClose: () => void) {
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

  if (!(window as any).__GOOGLE_PLACES_KEY) {
    const iframe = backdrop.querySelector<HTMLIFrameElement>('.nomad-map-iframe')!;
    iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(spot.address || spot.name + ' ' + spot.city)}&output=embed`;
  }

  function closeModal() { backdrop.remove(); onClose(); }

  backdrop.querySelector('.nomad-modal-close')!.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
  });
}

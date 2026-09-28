import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredLeg } from '../../../data/stores/route-store.ts';
import {
  BUILTIN_TEMPLATE_KINDS,
  builtinTemplate,
  templates,
  template,
  type JournalTemplate,
  type TemplateId,
} from '../templates.ts';
import type { CaptureState } from './types.ts';
import {
  MAX_JOURNAL_IMAGES,
  MOODS,
  OTHER_DESTINATION,
  coverAspect,
  entryCover,
  entryImages,
  escHtml,
  excerpt,
  moodEmoji,
  photoGridColumns,
  prettyDate,
  suggestedDestinations,
  titleFor,
  tripCities,
} from '../shared/utils.ts';

export interface PlaceGroup {
  key: string;
  label: string;
  summary: string;
  entries: StoredJournalEntry[];
}

export interface TemplateGroup {
  templateId: TemplateId;
  entries: StoredJournalEntry[];
  topTags: string[];
}

export interface TagGroup {
  tag: string;
  entries: StoredJournalEntry[];
}

export interface MapPoint {
  key: string;
  label: string;
  count: number;
  lat: number;
  lng: number;
  left: number;
  top: number;
  entries: StoredJournalEntry[];
}

export interface CalendarCell {
  iso: string;
  day: number;
  inMonth: boolean;
  entries: StoredJournalEntry[];
}

interface CaptureRenderModel {
  state: CaptureState;
  allEntries: StoredJournalEntry[];
  visibleEntries: StoredJournalEntry[];
  allTags: string[];
  destinations: string[];
  placeGroups: PlaceGroup[];
  templateGroups: TemplateGroup[];
  tagGroups: TagGroup[];
  mapPoints: MapPoint[];
  mapRoute: Array<{ left: number; top: number }>;
  calendarCells: CalendarCell[];
  currentMonthLabel: string;
  legs: StoredLeg[];
  savedGuidePlaces?: Array<{ id: string; title: string; type: string }>;
}


function renderFirstTimeGuide(): string {
  // Find the Quick Log template (lightest one)
  const quickLog = templates().find((t) => t.id === 'quick') ?? templates()[0];
  if (!quickLog) return '';
  return `
    <div class="journal-first-guide">
      <div class="journal-first-guide-icon">${quickLog.emoji}</div>
      <div class="journal-first-guide-text">
        <strong>Start here</strong> — tap <em>${escHtml(quickLog.label)}</em> above to capture your first moment.
        Pick any stamp that fits your mood.
      </div>
    </div>
  `;
}

export function renderCapture(model: CaptureRenderModel): string {
  const readingEntry = model.state.readingId
    ? model.allEntries.find((e) => e.id === model.state.readingId)
    : undefined;

  return `
    <div class="journal-shell">
      ${renderStamps(model.state)}
      ${model.allEntries.length === 0 && !model.state.composerOpen ? renderFirstTimeGuide() : ''}

      ${model.state.templateBuilderOpen ? renderTemplateBuilder(model.state) : ''}
      ${model.state.composerOpen ? `<div class="journal-composer-overlay" data-journal-overlay><div class="journal-composer-drawer">${renderComposer(model.state, model.allEntries, model.legs, model.savedGuidePlaces ?? [])}</div></div>` : ''}
      ${readingEntry ? `<div class="journal-reader-overlay" data-journal-reader-overlay><div class="journal-reader-drawer">${renderReader(readingEntry)}</div></div>` : ''}

      <div class="journal-view-surface">
        ${renderActiveView(model)}
      </div>
    </div>
  `;
}

function renderActiveView(model: CaptureRenderModel): string {
  if (model.state.view === 'places') return renderPlacesView(model.placeGroups);
  if (model.state.view === 'categories') return renderCategoriesView(model.templateGroups, model.tagGroups);
  if (model.state.view === 'gallery') return renderGalleryView(model.visibleEntries, model.state);
  if (model.state.view === 'map') return renderMapView(model.mapPoints, model.mapRoute);
  if (model.state.view === 'calendar') return renderCalendarView(model.calendarCells, model.currentMonthLabel);
  return renderFeedWithFilters(model);
}

function renderStamps(state: CaptureState): string {
  const items = templates();
  return `
    <div class="journal-stamps">
      ${items.map((item) => `
        <button class="journal-stamp ${state.composerOpen && !state.editingId && state.draft.template === item.id ? 'active' : ''}"
                data-stamp="${item.id}" type="button">
          <span class="journal-stamp-emoji">${item.emoji}</span>
          <span class="journal-stamp-label">${escHtml(item.label)}</span>
          ${item.builtin ? '' : '<span class="journal-stamp-custom">custom</span>'}
        </button>
      `).join('')}
      <button class="journal-stamp journal-stamp-add" data-open-template-builder type="button">
        <span class="journal-stamp-emoji">＋</span>
        <span class="journal-stamp-label">Custom</span>
      </button>
    </div>
  `;
}

function renderTemplateBuilder(state: CaptureState): string {
  const active = builtinTemplate(state.templateBuilder.kind);
  return `
    <section class="journal-template-builder card">
      <div class="journal-template-builder-head">
        <div>
          <span class="journal-section-kicker">Custom Template</span>
          <h4>Build from one of the four capture types.</h4>
          <p>The functional fields stay anchored to the base type, while label, emoji, prompts, and placeholder become yours.</p>
        </div>
        <button class="journal-icon-btn" data-close-template-builder type="button" title="Close">✕</button>
      </div>

      <div class="journal-template-builder-grid">
        <div class="journal-template-builder-main">
          <div class="journal-template-kind-row">
            ${BUILTIN_TEMPLATE_KINDS.map((kind) => {
              const item = builtinTemplate(kind);
              return `
                <label class="journal-template-kind-chip ${state.templateBuilder.kind === kind ? 'active' : ''}" style="--tint:${item.tint}">
                  <input type="radio" name="journal-template-kind" value="${kind}" ${state.templateBuilder.kind === kind ? 'checked' : ''}>
                  <span>${item.emoji}</span>
                  <span>${escHtml(item.label)}</span>
                </label>
              `;
            }).join('')}
          </div>

          <div class="journal-template-builder-form">
            <div class="journal-template-builder-row">
              <input class="input" id="journal-template-label" maxlength="28" placeholder="Template label" value="${escHtml(state.templateBuilder.label)}">
              <input class="input journal-template-emoji-input" id="journal-template-emoji" maxlength="4" placeholder="Emoji" value="${escHtml(state.templateBuilder.emoji)}">
            </div>
            <input class="input" id="journal-template-placeholder" maxlength="120" placeholder="Composer placeholder" value="${escHtml(state.templateBuilder.placeholder)}">
            <textarea class="input journal-template-prompts" id="journal-template-prompts" placeholder="Prompts, one per line">${escHtml(state.templateBuilder.promptsText)}</textarea>
          </div>
        </div>

        <aside class="journal-template-builder-side">
          <div class="journal-subsection-title">Base behavior</div>
          <div class="journal-template-preview-card" style="--tint:${active.tint}">
            <div class="journal-template-preview-title">${active.emoji} ${escHtml(active.label)}</div>
            <p>${escHtml(active.focus)}</p>
            <div class="journal-template-preview-fields">
              <span>${escHtml(active.bodyLabel)}</span>
              ${active.fields.destination ? `<span>${escHtml(active.destinationLabel)}</span>` : ''}
              ${active.fields.mood ? '<span>Mood</span>' : ''}
              ${active.fields.tags ? `<span>${escHtml(active.tagsLabel)}</span>` : ''}
              <span>${escHtml(active.imageLabel)}</span>
            </div>
          </div>
          <div class="journal-template-builder-actions">
            <button class="btn btn-primary" data-save-template type="button">Save template</button>
            <button class="btn btn-ghost" data-close-template-builder type="button">Cancel</button>
          </div>
        </aside>
      </div>
    </section>
  `;
}

/**
 * Composer photo tray — a WeChat-Moments style thumbnail grid plus an add tile.
 *
 * The first thumbnail is marked as the cover because it decides both the feed
 * hero and the card's aspect ratio, so the reorder arrows are how you choose it.
 */
function renderImageZone(state: CaptureState, imageLabel: string): string {
  const photos = state.draft.images;
  const full = photos.length >= MAX_JOURNAL_IMAGES;
  return `
    <div class="journal-image-zone">
      ${photos.length ? `
        <div class="journal-image-tray">
          ${photos.map((src, index) => `
            <figure class="journal-image-thumb${index === 0 ? ' is-cover' : ''}">
              <img src="${escHtml(src)}" alt="Photo ${index + 1}" loading="lazy">
              ${index === 0 ? '<figcaption class="journal-image-cover-tag">Cover</figcaption>' : ''}
              <div class="journal-image-thumb-tools">
                ${index > 0 ? `<button class="journal-image-move" data-move-image="${index}" data-move-dir="back" type="button" title="Move earlier" aria-label="Move photo ${index + 1} earlier">‹</button>` : ''}
                ${index < photos.length - 1 ? `<button class="journal-image-move" data-move-image="${index}" data-move-dir="fwd" type="button" title="Move later" aria-label="Move photo ${index + 1} later">›</button>` : ''}
              </div>
              <button class="journal-image-remove" data-remove-image="${index}" type="button" title="Remove" aria-label="Remove photo ${index + 1}">✕</button>
            </figure>
          `).join('')}
          ${full ? '' : `
            <label class="journal-image-add" for="journal-image-input" title="Add photos">
              <span class="journal-image-add-icon">＋</span>
              <span class="journal-image-add-count">${photos.length}/${MAX_JOURNAL_IMAGES}</span>
            </label>
          `}
        </div>
      ` : `
        <label class="journal-image-placeholder" for="journal-image-input">
          <span class="journal-image-placeholder-icon">🖼</span>
          <span>${escHtml(imageLabel)}</span>
          <span class="journal-image-placeholder-hint">up to ${MAX_JOURNAL_IMAGES}</span>
        </label>
      `}
      <input class="journal-image-input" type="file" id="journal-image-input" accept="image/*" multiple>
      ${state.draft.uploading ? '<p class="journal-image-uploading">Uploading photos…</p>' : ''}
    </div>
  `;
}

function renderComposer(
  state: CaptureState,
  entries: StoredJournalEntry[],
  legs: StoredLeg[],
  savedGuidePlaces: Array<{ id: string; title: string; type: string }> = [],
): string {
  const item = template(state.draft.template);
  const prompt = item.prompts[state.promptIndex % item.prompts.length];
  const destinations = suggestedDestinations(entries, legs);
  const cities = tripCities(legs);
  const currentDestination = state.draft.destination.trim();
  const isCustomDestination = currentDestination !== '' && !cities.includes(currentDestination);

  return `
    <section class="journal-composer journal-fmt-${item.format}" style="--tint:${item.tint}">
      <div class="journal-composer-head">
        <span class="journal-composer-emoji">${item.emoji}</span>
        <div class="journal-composer-headings">
          <span class="journal-composer-format">${escHtml(item.label)}</span>
          <span class="journal-composer-prompt">${escHtml(prompt)}</span>
        </div>
        <button class="journal-icon-btn" data-journal-shuffle type="button" title="Another prompt">↻</button>
        <button class="journal-icon-btn" data-journal-close type="button" title="Close">✕</button>
      </div>

      ${item.fields.image ? renderImageZone(state, item.imageLabel) : ''}

      <div class="journal-write-area">
        <textarea class="journal-textarea" id="journal-body" placeholder="${escHtml(item.placeholder)}">${escHtml(state.draft.body)}</textarea>
      </div>

      <div class="journal-composer-meta">
        <div class="journal-meta-row">
          <input class="input journal-meta-title" id="journal-title" maxlength="80" placeholder="Title (optional)" value="${escHtml(state.draft.title)}">
          <input class="input journal-meta-date" type="date" id="journal-date" value="${escHtml(state.draft.happenedOn)}">
        </div>
        ${item.fields.destination ? `
          <div class="journal-meta-row-single">
            ${cities.length ? `
              <select class="select input" id="journal-destination-select">
                ${cities.map((city) => `<option value="${escHtml(city)}" ${!isCustomDestination && city === currentDestination ? 'selected' : ''}>${escHtml(city)}</option>`).join('')}
                <option value="${OTHER_DESTINATION}" ${isCustomDestination ? 'selected' : ''}>Other place…</option>
              </select>
            ` : ''}
            <input
              class="input"
              id="journal-destination"
              list="journal-dest-list"
              placeholder="${escHtml(item.destinationLabel)}"
              value="${escHtml(state.draft.destination)}"
              style="${cities.length && !isCustomDestination ? 'display:none' : ''}"
            >
            <datalist id="journal-dest-list">
              ${destinations.map((destination) => `<option value="${escHtml(destination)}"></option>`).join('')}
            </datalist>
          </div>
        ` : ''}
      </div>

      ${renderTypeExtras(item, state)}
      ${savedGuidePlaces.length ? renderGuidePlacesPicker(savedGuidePlaces, state.draft.linkedPlaces) : ''}

      <div class="journal-composer-actions">
        <button class="btn btn-ghost" data-journal-cancel type="button">Cancel</button>
        <button class="btn btn-primary" data-journal-save type="button">${state.editingId ? 'Save' : 'Add to capture'}</button>
      </div>
    </section>
  `;
}

function typeIcon(type: string): string {
  const map: Record<string, string> = { attraction: '🏛️', restaurant: '🍽️', cafe: '☕', experience: '🎭' };
  return map[type] ?? '📍';
}

function renderGuidePlacesPicker(
  places: Array<{ id: string; title: string; type: string }>,
  linked: string[],
): string {
  return `
    <details class="journal-guide-places">
      <summary class="journal-guide-places-toggle">
        📌 Saved places${linked.length ? ` · ${linked.length} linked` : ''}
      </summary>
      <div class="journal-guide-places-list">
        ${places.map((p) => `
          <label class="journal-guide-place-item ${linked.includes(p.id) ? 'is-linked' : ''}">
            <input type="checkbox" name="journal-linked-place" value="${escHtml(p.id)}" ${linked.includes(p.id) ? 'checked' : ''}>
            <span class="journal-guide-place-icon">${typeIcon(p.type)}</span>
            <span class="journal-guide-place-title">${escHtml(p.title)}</span>
          </label>
        `).join('')}
      </div>
    </details>
  `;
}

function renderTypeExtras(item: JournalTemplate, state: CaptureState): string {
  const parts: string[] = [];

  if (item.fields.mood) {
    parts.push(`
      <div class="journal-extras-row">
        <div class="journal-mood-row">
          ${MOODS.map((mood) => `
            <label class="journal-mood-chip ${state.draft.mood === mood.value ? 'active' : ''}" title="${mood.value}">
              <input type="radio" name="journal-mood" value="${mood.value}" ${state.draft.mood === mood.value ? 'checked' : ''}>
              <span>${mood.emoji}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `);
  }

  if (item.fields.tags) {
    parts.push(`
      <div class="journal-extras-row">
        <input class="input" id="journal-tags" placeholder="${escHtml(item.tagsLabel)}" value="${escHtml(state.draft.tagsText)}">
      </div>
    `);
  }

  // Per-type quick chips
  const quickChips = typeQuickChips(item.kind);
  if (quickChips) {
    parts.push(`<div class="journal-quick-chips">${quickChips}</div>`);
  }

  return parts.length ? `<div class="journal-composer-extras">${parts.join('')}</div>` : '';
}

function typeQuickChips(kind: string): string {
  if (kind === 'moment') {
    return `
      <span class="journal-quick-label">时段</span>
      ${['清晨','午后','傍晚','夜晚'].map((t) => `<button class="journal-quick-chip" data-append-body="${escHtml(t)}" type="button">${t}</button>`).join('')}
    `;
  }
  if (kind === 'note') {
    return `
      ${[['💰','价格'],['🕐','开放时间'],['🎫','订票']].map(([icon, label]) => `<button class="journal-quick-chip" data-append-body="${escHtml(icon + ' ' + label + '：')}" type="button">${icon} ${label}</button>`).join('')}
    `;
  }
  if (kind === 'interesting') {
    return `
      <span class="journal-quick-label">反差类型</span>
      ${['意料之外','颠覆认知','想分享'].map((t) => `<button class="journal-quick-chip" data-append-body="${escHtml(t + '：')}" type="button">${t}</button>`).join('')}
    `;
  }
  if (kind === 'place') {
    return `
      ${['☕ 咖啡','🏛 景点','🍜 餐厅','🛍 购物'].map((t) => `<button class="journal-quick-chip" data-append-body="${escHtml(t + ' ')}" type="button">${t}</button>`).join('')}
    `;
  }
  return '';
}

function renderFeedWithFilters(model: CaptureRenderModel): string {
  const hasFilters = model.allTags.length > 0 || model.destinations.length > 0;
  const filterBar = hasFilters ? `
    <div class="journal-feed-filter-bar">
      <div class="journal-filter-group">
        <button class="journal-filter-chip journal-filter-pin ${model.state.filter.favoritesOnly ? 'active' : ''}" data-filter-favorites type="button" title="Pinned only">📌</button>
        ${model.allTags.slice(0, 8).map((tag) => `
          <button class="journal-filter-chip ${model.state.filter.tag === tag ? 'active' : ''}" data-filter-tag="${escHtml(tag)}" type="button">#${escHtml(tag)}</button>
        `).join('')}
      </div>
      ${model.destinations.length ? `
        <select class="select input journal-dest-select" data-filter-destination>
          <option value="all" ${model.state.filter.destination === 'all' ? 'selected' : ''}>All places</option>
          ${model.destinations.map((destination) => `
            <option value="${escHtml(destination)}" ${model.state.filter.destination === destination ? 'selected' : ''}>${escHtml(destination)}</option>
          `).join('')}
        </select>
      ` : ''}
    </div>
  ` : '';

  if (model.visibleEntries.length === 0) {
    return filterBar + renderEmpty('Filtered', 'No entries match this filter', 'Try clearing a tag or place filter.');
  }
  return filterBar + renderMagazineFeed(model.visibleEntries, model.state.editingId);
}

/**
 * Magazine feed — a Xiaohongshu-style masonry of cards instead of one full-width
 * strip per entry.
 *
 * Two things drive the look. The grid is column-based (CSS `columns`) so cards
 * of different heights pack without gaps, and each card's hero is sized from its
 * first photo's orientation — portrait shots get a tall 3:4 frame, landscape ones
 * a wide 4:3 — so neither gets cropped into the other's shape. Date headers are
 * dropped from the grid (they'd break the columns) and shown per-card instead.
 */
function renderMagazineFeed(entries: StoredJournalEntry[], editingId: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  return `<div class="journal-mag-feed">
    ${entries.map((entry) => renderMagazineCard(entry, editingId, today)).join('')}
  </div>`;
}

function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function renderMagazineCard(
  entry: StoredJournalEntry,
  readingId: string | null,
  today: string,
): string {
  const item = template(entry.template);
  const isOpen = entry.id === readingId;
  const photos = entryImages(entry);
  const extra = photos.length - 1;
  const title = titleFor(entry);
  const hasTitle = entry.title.trim().length > 0;

  // Feed cards are a preview tile, not a reading surface: cover + title +
  // meta only. Body text and the extra-photos grid used to render here too,
  // which made card height depend on how much someone wrote — a 3-line note
  // sat next to a 40-word paragraph and the masonry lost its rhythm. Both now
  // live in the reader that opens on tap (renderReaderOverlay).
  return `
    <article class="journal-mag-card${photos.length ? ' has-photo' : ' is-text'}${isOpen ? ' is-open' : ''}"
             data-open-entry="${entry.id}" style="--tint:${item.tint}">
      ${photos.length ? `
        <div class="journal-mag-cover" style="aspect-ratio:${coverAspect(entry.imageRatio)}">
          <img src="${escHtml(photos[0])}" alt="${escHtml(title)}" class="journal-mag-cover-img" loading="lazy">
          ${extra > 0 ? `<span class="journal-mag-count" title="${extra + 1} photos">▦ ${extra + 1}</span>` : ''}
          ${entry.favorite ? '<span class="journal-mag-pin" title="Pinned">📌</span>' : ''}
        </div>
      ` : ''}

      <div class="journal-mag-body">
        ${hasTitle
          ? `<h3 class="journal-mag-title">${escHtml(title)}</h3>`
          : `<p class="journal-mag-text">${escHtml(excerpt(entry.body, 90))}</p>`}

        <footer class="journal-mag-foot">
          <span class="journal-mag-stamp" style="background:color-mix(in srgb,${item.tint} 22%,#fff);color:color-mix(in srgb,${item.tint} 80%,#333)">${item.emoji}</span>
          <span class="journal-mag-where">${escHtml(entry.destination || item.label)}</span>
          <span class="journal-mag-date">${escHtml(dayLabel(entry.happenedOn, today))}</span>
        </footer>
      </div>
    </article>
  `;
}

/**
 * All of an entry's photos as a WeChat-Moments grid: a single photo gets its
 * real aspect ratio (not forced square — this is the reading surface, so it
 * should look like the actual picture), 2/3 sit in one row, 4 as 2x2, more in
 * rows of 3 up to MAX_JOURNAL_IMAGES. Square tiles from the second photo on
 * keep the grid calm; a lone photo skips that so a tall or wide shot isn't
 * cropped into a square it was never framed for.
 */
function renderReaderGallery(photos: string[], entryId: string, ratio: number | undefined): string {
  const shown = photos.slice(0, MAX_JOURNAL_IMAGES);
  if (shown.length === 0) return '';
  if (shown.length === 1) {
    return `
      <div class="journal-reader-single" style="aspect-ratio:${coverAspect(ratio)}">
        <img src="${escHtml(shown[0])}" alt="" loading="lazy">
      </div>
    `;
  }
  const cols = photoGridColumns(shown.length);
  return `
    <div class="journal-photo-grid journal-reader-grid" style="--cols:${cols}" data-photo-grid="${entryId}">
      ${shown.map((src, index) => `
        <div class="journal-photo-cell">
          <img src="${escHtml(src)}" alt="Photo ${index + 1}" loading="lazy">
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Read-only entry view — what opens when a feed/gallery/calendar card is
 * tapped. Full photo gallery, then title, then body, then meta; editing is a
 * single explicit button here rather than the default action, so opening an
 * entry to read it never drops you into an editable textarea.
 */
function renderReader(entry: StoredJournalEntry): string {
  const item = template(entry.template);
  const photos = entryImages(entry);
  const title = titleFor(entry);
  const isPublic = entry.visibility === 'public';

  return `
    <article class="journal-reader" style="--tint:${item.tint}">
      <header class="journal-reader-head">
        <span class="journal-reader-stamp" style="background:color-mix(in srgb,${item.tint} 22%,#fff);color:color-mix(in srgb,${item.tint} 80%,#333)">${item.emoji} ${escHtml(item.label)}</span>
        <div class="journal-reader-head-actions">
          <button class="journal-reader-pill" data-open-reader-edit="${entry.id}" type="button">✎ Edit</button>
          <button class="journal-icon-btn" data-reader-close type="button" title="Close">✕</button>
        </div>
      </header>

      ${photos.length ? renderReaderGallery(photos, entry.id, entry.imageRatio) : ''}

      <div class="journal-reader-body">
        ${entry.title.trim() ? `<h2 class="journal-reader-title">${escHtml(title)}</h2>` : ''}
        ${entry.body.trim() ? `<p class="journal-reader-text">${escHtml(entry.body)}</p>` : ''}

        ${entry.tags.length ? `<div class="journal-mag-tags">${entry.tags.map((tag) => `<span class="journal-tag">#${escHtml(tag)}</span>`).join('')}</div>` : ''}

        <footer class="journal-reader-meta">
          ${entry.destination ? `<span class="journal-reader-where">📍 ${escHtml(entry.destination)}</span>` : ''}
          <span class="journal-reader-date">${escHtml(prettyDate(entry.happenedOn))}</span>
          ${entry.mood ? `<span class="journal-reader-mood">${moodEmoji(entry.mood)}</span>` : ''}
        </footer>

        <div class="journal-reader-actions">
          <button class="journal-reader-pill" data-card-entry="${entry.id}" type="button">🖼 Card</button>
          <button class="journal-reader-pill ${isPublic ? 'is-on' : ''}" data-share-entry="${entry.id}" type="button">↗ Share</button>
          <button class="journal-reader-pill ${entry.favorite ? 'is-on' : ''}" data-favorite-entry="${entry.id}" type="button">📌 Pin</button>
          <button class="journal-reader-pill is-danger" data-delete-entry="${entry.id}" type="button">✕ Delete</button>
        </div>
      </div>
    </article>
  `;
}

function renderPlacesView(groups: PlaceGroup[]): string {
  if (groups.length === 0) {
    return renderEmpty('Places', 'No places yet', 'Add destination-aware entries and this view will group them here.');
  }
  return `
    <div class="journal-places-grid">
      ${groups.map((group) => {
        const coverEntry = group.entries.find((e) => entryCover(e));
        const hasImage = !!coverEntry && !!entryCover(coverEntry);
        const tmpl = template(group.entries[0].template);
        return `
          <article class="journal-place-tile" data-place-filter="${escHtml(group.label)}" style="--tint:${tmpl.tint}">
            <div class="journal-place-tile-cover">
              ${hasImage
                ? `<img src="${escHtml(entryCover(coverEntry!))}" alt="${escHtml(group.label)}" class="journal-place-tile-img">`
                : `<div class="journal-place-tile-fallback">
                    ${group.entries.slice(0, 3).map((e) => `<span>${template(e.template).emoji}</span>`).join('')}
                  </div>`}
              <div class="journal-place-tile-count">${group.entries.length}</div>
            </div>
            <div class="journal-place-tile-info">
              <span class="journal-place-tile-name">${escHtml(group.label)}</span>
              <span class="journal-place-tile-meta">${group.entries.length} ${group.entries.length === 1 ? 'entry' : 'entries'}</span>
            </div>
          </article>
        `;
      }).join('')}
      <button class="journal-place-tile journal-place-tile-add" data-stamp="place" type="button">
        <div class="journal-place-tile-cover journal-place-tile-cover-add">
          <span>＋</span>
        </div>
        <div class="journal-place-tile-info">
          <span class="journal-place-tile-name">Add Place</span>
        </div>
      </button>
    </div>
  `;
}

function renderCategoriesView(templateGroups: TemplateGroup[], tagGroups: TagGroup[]): string {
  if (!templateGroups.length && !tagGroups.length) {
    return renderEmpty('Categories', 'Nothing to group yet', 'Once you add a few entries and tags, this view will cluster them.');
  }

  return `
    <div class="journal-category-shell">
      ${templateGroups.length ? `
        <div class="journal-category-grid">
          ${templateGroups.map((group) => {
            const item = template(group.templateId);
            const coverEntry = group.entries.find((e) => entryCover(e));
            return `
              <article class="journal-category-tile" data-filter-template="${item.id}" style="--tint:${item.tint}">
                <div class="journal-category-tile-cover">
                  ${coverEntry && entryCover(coverEntry)
                    ? `<img src="${escHtml(entryCover(coverEntry))}" alt="" class="journal-category-tile-img">`
                    : `<div class="journal-category-tile-bg"></div>`}
                  <div class="journal-category-tile-emoji">${item.emoji}</div>
                </div>
                <div class="journal-category-tile-body">
                  <div class="journal-category-title">${escHtml(item.label)}</div>
                  <div class="journal-category-meta">${group.entries.length} entries</div>
                  ${group.topTags.length ? `
                    <div class="journal-category-tags">
                      ${group.topTags.map((tag) => `<span class="journal-tag">#${escHtml(tag)}</span>`).join('')}
                    </div>
                  ` : ''}
                </div>
              </article>
            `;
          }).join('')}
          <button class="journal-category-tile journal-category-tile-add" data-open-template-builder type="button">
            <div class="journal-category-tile-cover journal-category-tile-cover-add">
              <span>＋</span>
            </div>
            <div class="journal-category-tile-body">
              <div class="journal-category-title">Create Category</div>
            </div>
          </button>
        </div>
      ` : ''}

      ${tagGroups.length ? `
        <div class="journal-tag-groups">
          ${tagGroups.map((group) => `
            <article class="card journal-tag-group">
              <div class="journal-tag-group-head">
                <button class="journal-filter-chip active" data-filter-tag="${escHtml(group.tag)}" type="button">#${escHtml(group.tag)}</button>
                <span class="journal-category-meta">${group.entries.length} entries</span>
              </div>
              <div class="journal-mini-list">
                ${group.entries.slice(0, 3).map(renderMiniEntry).join('')}
              </div>
            </article>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

const PRESET_RATIOS: Array<{ label: string; ratio: number }> = [
  { label: '16:9', ratio: 16 / 9 },
  { label: '3:2',  ratio: 3 / 2 },
  { label: '4:3',  ratio: 4 / 3 },
  { label: '1:1',  ratio: 1 },
  { label: '3:4',  ratio: 3 / 4 },
  { label: '2:3',  ratio: 2 / 3 },
];

function closestPresetRatio(ratio: number): number {
  return PRESET_RATIOS.reduce((best, preset) =>
    Math.abs(preset.ratio - ratio) < Math.abs(best.ratio - ratio) ? preset : best
  ).ratio;
}

function renderGalleryView(entries: StoredJournalEntry[], state: CaptureState): string {
  if (entries.length === 0) {
    return renderEmpty('Gallery', 'No gallery items yet', 'As you capture more moments, they will show up here as a richer wall.');
  }
  const square = state.gallerySquare;
  return `
    <div class="journal-gallery-header">
      <button class="journal-filter-chip ${square ? '' : 'active'}" data-gallery-square type="button">Proportional</button>
      <button class="journal-filter-chip ${square ? 'active' : ''}" data-gallery-square type="button">1:1</button>
    </div>
    <div class="journal-gallery-grid">
      ${entries.map((entry) => {
        const item = template(entry.template);
        const rawRatio = entry.imageRatio;
        const ratio = square ? 1 : (rawRatio ? closestPresetRatio(rawRatio) : 3 / 4);
        const paddingTop = `${(1 / ratio) * 100}%`;
        return `
          <article class="journal-gallery-tile${entryCover(entry) ? ' has-image' : ''}" data-open-entry="${entry.id}" style="--tint:${item.tint}">
            <div class="journal-gallery-media" style="padding-top:${paddingTop}">
              <div class="journal-gallery-media-inner">
                ${entryCover(entry)
                  ? `<img src="${escHtml(entryCover(entry))}" alt="${escHtml(titleFor(entry))}" class="journal-gallery-image">`
                  : `<div class="journal-gallery-fallback"><span>${item.emoji}</span><p>${escHtml(excerpt(entry.body, 88))}</p></div>`}
              </div>
            </div>
            <div class="journal-gallery-foot">
              <span class="journal-gallery-label">${escHtml(titleFor(entry))}</span>
              <span class="journal-gallery-meta">${escHtml(entry.destination || prettyDate(entry.happenedOn))}</span>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderMapView(points: MapPoint[], _route: Array<{ left: number; top: number }>): string {
  if (points.length === 0) {
    return renderEmpty('Map', 'No mapped entries yet', 'Entries with destinations that match your route will pin themselves here.');
  }
  const totalEntries = points.reduce((sum, p) => sum + p.count, 0);
  return `
    <div class="journal-map-layout">
      <div class="journal-map-tile" id="journal-leaflet-map"
           data-points="${escHtml(JSON.stringify(points.map(p => ({ key: p.key, label: p.label, lat: p.lat, lng: p.lng, count: p.count }))))}"
      ></div>
      <aside class="journal-map-panel">
        <div class="journal-map-panel-stats">
          <span class="journal-map-panel-count">${totalEntries}</span>
          <span class="journal-map-panel-label">entries across ${points.length} places</span>
        </div>
        <div class="journal-map-list">
          ${points.map((point) => `
            <button class="journal-map-list-item" data-place-filter="${escHtml(point.label)}" data-map-focus="${escHtml(point.key)}" type="button">
              <span class="journal-map-list-name">${escHtml(point.label)}</span>
              <span class="journal-map-list-meta">${point.count} ${point.count === 1 ? 'entry' : 'entries'}</span>
            </button>
          `).join('')}
        </div>
        <button class="btn btn-ghost journal-map-open-btn" data-open-map-view type="button">Open full map →</button>
      </aside>
    </div>
  `;
}

function renderCalendarView(cells: CalendarCell[], monthLabel: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const usedTemplates = new Set(cells.flatMap((c) => c.entries.map((e) => e.template)));
  const legendItems = [...usedTemplates].map((tid) => {
    const item = template(tid);
    return `<span class="journal-cal-legend-item"><span class="journal-cal-legend-dot" style="background:${item.tint}"></span>${escHtml(item.label)}</span>`;
  });

  return `
    <div class="journal-calendar-shell">
      <div class="journal-calendar-head">
        <button class="journal-filter-chip" data-calendar-shift="-1" type="button">‹</button>
        <div class="journal-calendar-month">${escHtml(monthLabel)}</div>
        <button class="journal-filter-chip" data-calendar-shift="1" type="button">›</button>
      </div>
      <div class="journal-calendar-grid">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => `
          <div class="journal-calendar-dow">${label}</div>
        `).join('')}
        ${cells.map((cell) => {
          const isToday = cell.iso === today;
          return `
            <article class="journal-calendar-cell ${cell.inMonth ? '' : 'is-muted'} ${isToday ? 'is-today' : ''}">
              <div class="journal-calendar-day ${isToday ? 'is-today' : ''}">${cell.day}</div>
              <div class="journal-calendar-items">
                ${cell.entries.slice(0, 3).map((entry) => {
                  const item = template(entry.template);
                  return `
                    <button class="journal-calendar-pill" data-open-entry="${entry.id}" type="button" style="background:color-mix(in srgb,${item.tint} 25%,#fff);color:color-mix(in srgb,${item.tint} 80%,#333)">
                      <span>${item.emoji}</span>
                      <span class="journal-calendar-pill-text">${escHtml(titleFor(entry))}</span>
                    </button>
                  `;
                }).join('')}
                ${cell.entries.length > 3 ? `<div class="journal-calendar-more">+${cell.entries.length - 3}</div>` : ''}
              </div>
            </article>
          `;
        }).join('')}
      </div>
      ${legendItems.length ? `
        <div class="journal-cal-legend">
          ${legendItems.join('')}
          <span class="journal-cal-legend-item journal-cal-legend-all">All Entries</span>
        </div>
      ` : ''}
    </div>
  `;
}

function renderEmpty(mark: string, title: string, copy: string): string {
  return `
    <div class="journal-empty">
      <div class="journal-empty-mark">${mark}</div>
      <div class="journal-empty-title">${title}</div>
      <div class="journal-empty-copy">${copy}</div>
    </div>
  `;
}

function renderMiniEntry(entry: StoredJournalEntry): string {
  const item = template(entry.template);
  return `
    <button class="journal-mini-entry" data-open-entry="${entry.id}" type="button">
      <span class="journal-mini-entry-mark" style="--tint:${item.tint}">${item.emoji}</span>
      <span class="journal-mini-entry-copy">
        <span class="journal-mini-entry-title">${escHtml(titleFor(entry))}</span>
        <span class="journal-mini-entry-body">${escHtml(excerpt(entry.body, 72))}</span>
      </span>
      <span class="journal-mini-entry-meta">
        ${entry.destination ? `<span>${escHtml(entry.destination)}</span>` : ''}
        <span>${prettyDate(entry.happenedOn)}</span>
      </span>
    </button>
  `;
}


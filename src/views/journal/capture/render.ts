import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import type { StoredLeg } from '../../../data/stores/route-store.ts';
import type { CaptureState } from './types.ts';
import { renderFeedGrid } from '../scenes/feed.ts';
import { renderGallery } from '../scenes/gallery.ts';
import { renderPlaces } from '../scenes/places.ts';
import { renderBook, renderShelf } from '../scenes/albums.ts';
import type { PlaceStop } from '../scenes/places-model.ts';
import {
  MAX_JOURNAL_IMAGES,
  MOODS,
  OTHER_DESTINATION,
  coverAspect,
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

export interface TagGroup {
  tag: string;
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
  stops: PlaceStop[];
  /** The trip's name, set on the gallery's plate. */
  galleryTitle: string;
  tagGroups: TagGroup[];
  calendarCells: CalendarCell[];
  currentMonthLabel: string;
  legs: StoredLeg[];
  savedGuidePlaces?: Array<{ id: string; title: string; type: string }>;
  albums: StoredJournalAlbum[];
  /** Shown inside the Dashboard's side drawer: only the existing albums, opened as a feed,
   *  with no create / rename / delete controls. */
  albumDrawer?: boolean;
}


function renderFirstTimeGuide(): string {
  return `
    <div class="journal-first-guide">
      <div class="journal-first-guide-icon">✍️</div>
      <div class="journal-first-guide-text">
        <strong>从这里开始</strong> — 点「记一笔」，传张照片或写一句话就行，之后再整理。
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
      ${renderComposeButton()}
      ${model.allEntries.length === 0 && !model.state.composerOpen ? renderFirstTimeGuide() : ''}

      ${model.state.composerOpen ? `<div class="journal-composer-overlay" data-journal-overlay><div class="journal-composer-drawer">${renderComposer(model.state, model.allEntries, model.legs, model.savedGuidePlaces ?? [])}</div></div>` : ''}
      ${readingEntry ? `<div class="journal-reader-overlay" data-journal-reader-overlay><div class="journal-reader-drawer">${renderReader(readingEntry, model.albums)}</div></div>` : ''}

      <div class="journal-view-surface">
        ${renderActiveView(model)}
      </div>
    </div>
  `;
}

function renderActiveView(model: CaptureRenderModel): string {
  if (model.state.view === 'places') {
    return renderPlaces(model.stops, model.legs, model.state.placeKey, model.state.placeFlip,
      renderEmpty('Places', 'No places yet', 'Add destination-aware entries and this view will line them up here.'));
  }
  if (model.state.view === 'albums') return renderAlbumsView(model);
  if (model.state.view === 'gallery') {
    return renderGallery(model.visibleEntries, {
      title: model.galleryTitle, square: model.state.gallerySquare, selection: model.state.selection,
      drifting: model.state.galleryDrift, albums: model.albums,
    }, renderEmpty('Gallery', 'No photographs yet', 'Entries with photos hang here as a wall that drifts past you.'));
  }
  if (model.state.view === 'calendar') return renderCalendarView(model.calendarCells, model.currentMonthLabel);
  return renderFeedWithFilters(model);
}

/**
 * The single way into the composer.
 *
 * This used to be a row of category "stamps", which forced a classification
 * decision before the user had written anything. Category is inferred on save
 * now (see classify.ts), so there is one button and no decision.
 */
function renderComposeButton(): string {
  return `
    <div class="journal-compose-bar">
      <button class="journal-compose-btn" data-journal-new type="button">
        <span class="journal-compose-icon">✍️</span>
        <span class="journal-compose-label">记一笔</span>
      </button>
      <div class="journal-export" title="导出当前范围内的全部记录">
        <button class="journal-export-btn" data-journal-export="md" type="button">⬇ Markdown</button>
        <button class="journal-export-btn" data-journal-export="json" type="button">⬇ JSON</button>
      </div>
    </div>
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
              <span class="journal-image-add-icon">+</span>
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
  const destinations = suggestedDestinations(entries, legs);
  const cities = tripCities(legs);
  const currentDestination = state.draft.destination.trim();
  const isCustomDestination = currentDestination !== '' && !cities.includes(currentDestination);

  return `
    <section class="journal-composer">
      <div class="journal-composer-head">
        <span class="journal-composer-title">${state.editingId ? '编辑记录' : '记一笔'}</span>
        <button class="journal-icon-btn" data-journal-close type="button" title="Close">✕</button>
      </div>

      ${renderImageZone(state, '加照片')}

      <div class="journal-write-area">
        <textarea class="journal-textarea" id="journal-body" placeholder="写点什么，或只放张照片">${escHtml(state.draft.body)}</textarea>
      </div>

      ${renderComposerMeta(state, cities, destinations, currentDestination, isCustomDestination)}
      ${renderMoreFields(state, savedGuidePlaces)}

      <div class="journal-composer-actions">
        <button class="btn btn-ghost" data-journal-cancel type="button">Cancel</button>
        <button class="btn btn-primary" data-journal-save type="button">保存</button>
      </div>
    </section>
  `;
}

/**
 * L2 of the composer: place + date.
 *
 * Both are pre-filled (current city, today), so by default they collapse to a
 * single read-only line — the common case needs no interaction at all. Tapping
 * it swaps in the real controls.
 */
function renderComposerMeta(
  state: CaptureState,
  cities: string[],
  destinations: string[],
  currentDestination: string,
  isCustomDestination: boolean,
): string {
  if (!state.metaEditing) {
    return `
      <button class="journal-meta-summary" data-meta-edit type="button">
        <span class="journal-meta-summary-place">📍 ${escHtml(currentDestination || '未定地点')}</span>
        <span class="journal-meta-summary-sep">·</span>
        <span class="journal-meta-summary-date">${escHtml(prettyDate(state.draft.happenedOn))}</span>
      </button>
    `;
  }

  return `
    <div class="journal-composer-meta">
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
          placeholder="Where were you?"
          value="${escHtml(state.draft.destination)}"
          style="${cities.length && !isCustomDestination ? 'display:none' : ''}"
        >
        <datalist id="journal-dest-list">
          ${destinations.map((destination) => `<option value="${escHtml(destination)}"></option>`).join('')}
        </datalist>
        <input class="input journal-meta-date" type="date" id="journal-date" value="${escHtml(state.draft.happenedOn)}">
      </div>
    </div>
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

/**
 * L3 of the composer: everything optional, behind one disclosure.
 *
 * Every field renders unconditionally now. They used to be gated on the chosen
 * template's `fields` map, which meant picking a category silently took options
 * away — a `place` entry could not carry a mood. Nothing is taken away here.
 */
function renderMoreFields(
  state: CaptureState,
  savedGuidePlaces: Array<{ id: string; title: string; type: string }>,
): string {
  return `
    <details class="journal-composer-more" data-journal-more ${state.moreOpen ? 'open' : ''}>
      <summary class="journal-composer-more-toggle">更多</summary>
      <div class="journal-composer-extras">
        <div class="journal-extras-row">
          <input class="input journal-meta-title" id="journal-title" maxlength="80" placeholder="标题（可选）" value="${escHtml(state.draft.title)}">
        </div>
        <div class="journal-extras-row">
          <input class="input" id="journal-tags" placeholder="标签，逗号分隔" value="${escHtml(state.draft.tagsText)}">
        </div>
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
        ${savedGuidePlaces.length ? renderGuidePlacesPicker(savedGuidePlaces, state.draft.linkedPlaces) : ''}
      </div>
    </details>
  `;
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

/** The feed: planned editorial blocks (scenes/feed-plan.ts), not equal cards. */
function renderMagazineFeed(entries: StoredJournalEntry[], editingId: string | null): string {
  return renderFeedGrid(entries, editingId);
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
function renderReader(entry: StoredJournalEntry, albums: StoredJournalAlbum[]): string {
  const photos = entryImages(entry);
  const title = titleFor(entry);
  const isPublic = entry.visibility === 'public';

  return `
    <article class="journal-reader">
      <header class="journal-reader-head">
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

        ${renderReaderAlbums(entry, albums)}

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

/** Album membership for one entry, editable inline — the per-entry way to file something. */
function renderReaderAlbums(entry: StoredJournalEntry, albums: StoredJournalAlbum[]): string {
  const inAlbums = albums.filter((album) => album.entryIds.includes(entry.id));
  const available = albums.filter((album) => !album.entryIds.includes(entry.id));
  return `
    <div class="journal-reader-albums">
      <span class="journal-reader-albums-label">Album</span>
      ${inAlbums.length ? inAlbums.map((album) => `
        <span class="journal-album-chip">
          ${escHtml(album.emoji)} ${escHtml(album.title)}
          <button class="journal-album-chip-x" data-album-remove-entry="${escHtml(album.id)}:${escHtml(entry.id)}" type="button" title="移出">✕</button>
        </span>
      `).join('') : '<span class="journal-reader-albums-none">—</span>'}
      <select class="select input journal-album-add" data-album-add-entry="${escHtml(entry.id)}">
        <option value="">+ 加入…</option>
        ${available.map((album) => `<option value="${escHtml(album.id)}">${escHtml(album.emoji)} ${escHtml(album.title)}</option>`).join('')}
        <option value="__new__">+ 新建 album…</option>
      </select>
    </div>
  `;
}

/**
 * Albums: the groupings the user actually made.
 *
 * This replaced the Categories view, which showed inferred template buckets as
 * if they were the user's own organisation. Only tag groups survive, below the
 * albums.
 */
function renderAlbumsView(model: CaptureRenderModel): string {
  const open = model.state.openAlbumId
    ? model.albums.find((a) => a.id === model.state.openAlbumId)
    : undefined;
  if (open) {
    return model.albumDrawer
      ? renderAlbumFeed(open, model.allEntries, model.state.readingId)
      : renderBook(open, albumEntries(open, model.allEntries), {
        spread: model.state.albumSpread, turn: model.state.albumTurn, dir: model.state.albumDir, opening: model.state.albumOpening,
      });
  }

  return `
    <div class="journal-album-shell">
      ${model.albumDrawer ? '' : `<div class="journal-album-head">
        <div>
          <div class="journal-section-kicker">Albums</div>
          <p class="journal-album-hint">先随手记，之后把相关的几条放进一个 album。</p>
        </div>
        <div class="journal-album-head-actions">
          <button class="btn btn-ghost" data-album-tidy type="button" ${model.state.tidyLoading ? 'disabled' : ''}>
            ${model.state.tidyLoading ? '整理中…' : '✨ AI 整理'}
          </button>
          <button class="btn btn-ghost" data-album-create type="button">+ 新建 album</button>
        </div>
      </div>`}

      ${model.albumDrawer ? '' : renderTidySuggestions(model)}

      ${model.albums.length
        ? renderShelf(model.albums, (a) => albumEntries(a, model.allEntries), !model.albumDrawer)
        : `<div class="journal-album-empty">${model.albumDrawer ? '还没有 album。' : '还没有 album。到 Gallery 里选几张，或点上面新建一个。'}</div>`}

      ${model.albumDrawer ? '' : renderAutoGroups(model.tagGroups)}
    </div>
  `;
}

/**
 * The AI tidy pass's output, as a review list.
 *
 * Every suggestion needs an explicit yes. Nothing here has been written — the
 * point of grouping after the fact is that the user stays the one deciding
 * what belongs together, and an AI that silently refiled things would take
 * that back while looking helpful.
 */
function renderTidySuggestions(model: CaptureRenderModel): string {
  const tidy = model.state.tidy;
  if (!tidy) return '';
  if (!tidy.albums.length) {
    return `<div class="journal-tidy-empty">没找到明显可以成组的记录 —— 现在这样就挺好。</div>`;
  }
  return `
    <section class="journal-tidy">
      <div class="journal-tidy-head">
        <span class="journal-section-kicker">建议的分组</span>
        <button class="journal-icon-btn" data-tidy-dismiss type="button" title="Dismiss">✕</button>
      </div>
      ${tidy.albums.map((album, index) => `
        <article class="journal-tidy-card">
          <div class="journal-tidy-card-main">
            <div class="journal-tidy-title">${escHtml(album.emoji)} ${escHtml(album.title)}</div>
            <div class="journal-tidy-reason">${escHtml(album.reason)}</div>
            <div class="journal-tidy-entries">
              ${album.entryIds.map((id) => {
                const entry = model.allEntries.find((e) => e.id === id);
                return entry ? `<span class="journal-tag">${escHtml(titleFor(entry))}</span>` : '';
              }).join('')}
            </div>
          </div>
          <button class="btn btn-primary" data-tidy-accept="${index}" type="button">建立</button>
        </article>
      `).join('')}
    </section>
  `;
}

/** Entries of an album, in the album's order, skipping ones since deleted. */
function albumEntries(album: StoredJournalAlbum, all: StoredJournalEntry[]): StoredJournalEntry[] {
  return album.entryIds
    .map((id) => all.find((e) => e.id === id))
    .filter((e): e is StoredJournalEntry => Boolean(e));
}

/** An album opened in the Dashboard drawer: back arrow, title and count on one line, then
 *  the entries as the Journal's feed. Read-only — renaming, deleting and removing entries
 *  stay on the Journal page. */
function renderAlbumFeed(album: StoredJournalAlbum, all: StoredJournalEntry[], readingId: string | null): string {
  const entries = albumEntries(album, all);
  return `
    <div class="journal-album-shell">
      <div class="journal-album-bar">
        <button class="journal-icon-btn" data-album-back type="button" title="Albums" aria-label="Albums">←</button>
        <h3 class="journal-album-detail-title">${escHtml(album.emoji)} ${escHtml(album.title)}</h3>
        <span class="journal-category-meta">${entries.length} entries</span>
      </div>
      ${entries.length
        ? renderMagazineFeed(entries, readingId)
        : '<div class="journal-album-empty">这个 album 还是空的。</div>'}
    </div>
  `;
}

/** Tag groupings, below the user's own albums. Type buckets are gone — see classify.ts. */
function renderAutoGroups(tagGroups: TagGroup[]): string {
  if (!tagGroups.length) return '';
  return `
    <details class="journal-auto-groups">
      <summary class="journal-auto-groups-toggle">按标签</summary>
      <div class="journal-category-shell">
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
      </div>
    </details>
  `;
}

function renderCalendarView(cells: CalendarCell[], monthLabel: string): string {
  const today = new Date().toISOString().slice(0, 10);
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
                  return `
                    <button class="journal-calendar-pill" data-open-entry="${entry.id}" type="button">
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
  return `
    <button class="journal-mini-entry" data-open-entry="${entry.id}" type="button">
      <span class="journal-mini-entry-mark">${moodEmoji(entry.mood) || '📖'}</span>
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


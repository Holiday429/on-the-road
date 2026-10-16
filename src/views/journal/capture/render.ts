import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import type { StoredLeg } from '../../../data/stores/route-store.ts';
import type { CaptureState } from './types.ts';
import { getLocale, t } from '../../../core/i18n.ts';
import { renderFeedGrid } from '../scenes/feed.ts';
import { renderGallery } from '../scenes/gallery.ts';
import { renderPlaces } from '../scenes/places.ts';
import { buildStops, countryName, type PlaceStop } from '../scenes/places-model.ts';
import { albumEntries, renderBook, renderShelf } from '../scenes/albums.ts';
import { renderReadLetter, renderWriteLetter } from '../scenes/letter.ts';
import { ratioFor } from '../shared/ratio-cache.ts';
import { renderCoverEditor } from '../scenes/album-cover-edit.ts';
import {
  escHtml,
  entryImages,
  excerpt,
  moodEmoji,
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
        <strong>${escHtml(t('journal.firstGuide.lead'))}</strong> — ${escHtml(t('journal.firstGuide.text'))}
      </div>
    </div>
  `;
}

export function renderCapture(model: CaptureRenderModel): string {
  const readingAt = model.state.readingId
    ? model.allEntries.findIndex((e) => e.id === model.state.readingId)
    : -1;
  const readingEntry = readingAt >= 0 ? model.allEntries[readingAt] : undefined;
  // The reader turns pages through the entries in the order the feed shows them
  // (newest first), so ‹ goes back in time and › forward.
  const neighbours = {
    prevId: readingAt > 0 ? model.allEntries[readingAt - 1].id : null,
    nextId: readingAt >= 0 && readingAt < model.allEntries.length - 1 ? model.allEntries[readingAt + 1].id : null,
  };

  return `
    <div class="journal-shell">
      ${model.allEntries.length === 0 && !model.state.composerOpen ? renderFirstTimeGuide() : ''}

      ${model.state.composerOpen ? `<div class="journal-composer-overlay" data-journal-overlay><div class="journal-composer-drawer">${renderComposer(model.state, model.allEntries, model.legs, model.savedGuidePlaces ?? [])}</div></div>` : ''}
      ${readingEntry ? `<div class="journal-reader-overlay" data-journal-reader-overlay><div class="journal-reader-drawer">${renderReader(readingEntry, model, neighbours)}</div></div>` : ''}

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
  return renderFeed(model);
}


function renderComposer(
  state: CaptureState,
  entries: StoredJournalEntry[],
  legs: StoredLeg[],
  savedGuidePlaces: Array<{ id: string; title: string; type: string }> = [],
): string {
  const destinations = suggestedDestinations(entries, legs);
  const cities = tripCities(legs);

  // The optional extras that are not part of the notebook's own furniture.
  const extras = savedGuidePlaces.length
    ? renderGuidePlacesPicker(savedGuidePlaces, state.draft.linkedPlaces)
    : '';

  // The stamp wants the country; work it out from the place the way the reader does.
  const draft = state.draft;
  const stop = draft.destination.trim()
    ? buildStops([{ id: 'draft', destination: draft.destination, happenedOn: draft.happenedOn, updatedAt: 0 } as unknown as StoredJournalEntry], legs)[0]
    : undefined;
  const iso = stop?.iso ?? null;
  return renderWriteLetter({ state, cities, destinations, extras, iso, country: iso ? countryName(iso) : '', locale: getLocale() });
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
 * The feed is the magazine and nothing else.
 *
 * The tag chips and the place dropdown that used to sit above it are gone: Places
 * already answers "what did I write in Lisbon", and the strip cost a whole row of
 * chrome on every visit. A tag filter can still be set from the Albums view's tag
 * groups, so the filtered-empty state stays reachable and keeps its way out.
 */
function renderFeed(model: CaptureRenderModel): string {
  const filtered = model.state.filter.tag !== 'all'
    || model.state.filter.destination !== 'all'
    || model.state.filter.favoritesOnly;

  if (model.visibleEntries.length === 0 && filtered) {
    return `
      <div class="journal-feed-filtered">
        <button class="journal-filter-chip active" data-filter-clear type="button">✕ ${escHtml(t('journal.view.feed'))}</button>
        ${renderEmpty('Filtered', 'No entries match this filter', 'Clear the filter to see every entry again.')}
      </div>`;
  }
  if (filtered) {
    return `
      <div class="journal-feed-filtered">
        <button class="journal-filter-chip active" data-filter-clear type="button">✕ ${escHtml(filterLabel(model.state))}</button>
      </div>
      ${renderMagazineFeed(model.visibleEntries, model.state.editingId)}`;
  }
  return renderMagazineFeed(model.visibleEntries, model.state.editingId);
}

/** What the one "filtering by…" chip above the feed says. */
function filterLabel(state: CaptureState): string {
  if (state.filter.tag !== 'all') return `#${state.filter.tag}`;
  if (state.filter.destination !== 'all') return state.filter.destination;
  return '📌';
}

/** The feed: planned editorial blocks (scenes/feed-plan.ts), not equal cards. */
function renderMagazineFeed(entries: StoredJournalEntry[], editingId: string | null): string {
  return renderFeedGrid(entries, editingId);
}


/**
 * Read-only entry view — what opens when a feed/gallery/calendar card is
 * tapped: the entry as a letter with postcards (scenes/letter.ts). Editing is a
 * single explicit button in the bar under it, so opening an entry to read it
 * never drops you into an editable textarea.
 */
function renderReader(
  entry: StoredJournalEntry,
  model: CaptureRenderModel,
  neighbours: { prevId: string | null; nextId: string | null },
): string {
  // The stamp wants the country; the places model already knows how to work it out
  // from the place's name, the itinerary and the date.
  const stop = buildStops([entry], model.legs)[0];
  const iso = stop?.iso ?? null;
  return renderReadLetter({
    entry,
    albums: model.albums,
    prevId: neighbours.prevId,
    nextId: neighbours.nextId,
    dir: model.state.readerTurn,
    ratios: entryImages(entry).map((_, i) => ratioFor(entry, i)),
    iso,
    country: iso ? countryName(iso) : '',
    locale: getLocale(),
    focus: model.state.letter,
  });
}

/**
 * Albums: the groupings the user actually made.
 *
 * This replaced the Categories view, which showed inferred template buckets as
 * if they were the user's own organisation. Only tag groups survive, below the
 * albums.
 */
function renderAlbumsView(model: CaptureRenderModel): string {
  // Designing a cover takes the whole view: the proof needs the room, and there
  // is nothing useful to do behind it.
  const designing = model.state.coverEdit
    ? model.albums.find((a) => a.id === model.state.coverEdit!.albumId)
    : undefined;
  if (designing && model.state.coverEdit) {
    return renderCoverEditor(designing, albumEntries(designing, model.allEntries), model.state.coverEdit.draft);
  }

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
          <p class="journal-album-hint">${escHtml(t('journal.album.hint'))}</p>
        </div>
        <div class="journal-album-head-actions">
          <button class="btn btn-ghost" data-album-tidy type="button" ${model.state.tidyLoading ? 'disabled' : ''}>
            ${escHtml(t(model.state.tidyLoading ? 'journal.tidying' : 'journal.tidy'))}
          </button>
          <button class="btn btn-ghost" data-album-create type="button">${escHtml(t('journal.album.create'))}</button>
        </div>
      </div>`}

      ${model.albumDrawer ? '' : renderTidySuggestions(model)}

      ${model.albums.length
        ? renderShelf(model.albums, (a) => albumEntries(a, model.allEntries), !model.albumDrawer)
        : `<div class="journal-album-empty">${escHtml(t(model.albumDrawer ? 'journal.album.none' : 'journal.album.noneHint'))}</div>`}

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
    return `<div class="journal-tidy-empty">${escHtml(t('journal.tidy.none'))}</div>`;
  }
  return `
    <section class="journal-tidy">
      <div class="journal-tidy-head">
        <span class="journal-section-kicker">${escHtml(t('journal.tidy.suggested'))}</span>
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
          <button class="btn btn-primary" data-tidy-accept="${index}" type="button">${escHtml(t('journal.tidy.accept'))}</button>
        </article>
      `).join('')}
    </section>
  `;
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
        : `<div class="journal-album-empty">${escHtml(t('journal.album.empty'))}</div>`}
    </div>
  `;
}

/** Tag groupings, below the user's own albums. Type buckets are gone — see classify.ts. */
function renderAutoGroups(tagGroups: TagGroup[]): string {
  if (!tagGroups.length) return '';
  return `
    <details class="journal-auto-groups">
      <summary class="journal-auto-groups-toggle">${escHtml(t('journal.album.byTag'))}</summary>
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


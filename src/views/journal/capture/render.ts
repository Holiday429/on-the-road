import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredLeg } from '../../../data/stores/route-store.ts';
import {
  BUILTIN_TEMPLATE_KINDS,
  builtinTemplate,
  templates,
  template,
  type TemplateId,
} from '../templates.ts';
import type { CaptureState, CaptureView } from './types.ts';
import {
  MOODS,
  escHtml,
  excerpt,
  prettyDate,
  suggestedDestinations,
  titleFor,
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
}

const VIEW_META: Record<CaptureView, { label: string }> = {
  feed:       { label: 'Feed' },
  places:     { label: 'Places' },
  categories: { label: 'Categories' },
  gallery:    { label: 'Gallery' },
  map:        { label: 'Map' },
  calendar:   { label: 'Calendar' },
};

export function renderCapture(model: CaptureRenderModel): string {
  const placeCount = model.placeGroups.filter((group) => group.label !== 'No place yet').length;
  const pinnedCount = model.allEntries.filter((entry) => entry.favorite).length;

  return `
    <div class="journal-shell">
      <div class="journal-capture-bar">
        <div class="journal-capture-stats">
          <div class="journal-capture-stat">
            <span class="journal-capture-stat-num">${model.allEntries.length}</span>
            <span class="journal-capture-stat-label">entries</span>
          </div>
          <div class="journal-capture-stat">
            <span class="journal-capture-stat-num">${placeCount}</span>
            <span class="journal-capture-stat-label">places</span>
          </div>
          <div class="journal-capture-stat">
            <span class="journal-capture-stat-num">${pinnedCount}</span>
            <span class="journal-capture-stat-label">pinned</span>
          </div>
        </div>
        <button class="btn btn-primary" data-new-entry type="button">+ New entry</button>
      </div>

      ${renderStamps(model.state)}

      <div class="journal-layout-bar">
        ${Object.entries(VIEW_META).map(([id, meta]) => `
          <button class="journal-layout-tab ${model.state.view === id ? 'active' : ''}" data-journal-view="${id}" type="button">
            <span>${meta.label}</span>
          </button>
        `).join('')}
      </div>
      ${model.state.templateBuilderOpen ? renderTemplateBuilder(model.state) : ''}
      ${model.state.composerOpen ? renderComposer(model.state, model.allEntries, model.legs) : ''}

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
        <button class="journal-stamp journal-fmt-${item.format} ${state.composerOpen && !state.editingId && state.draft.template === item.id ? 'active' : ''}"
                style="--tint:${item.tint}" data-stamp="${item.id}" type="button" title="${escHtml(item.label)}">
          <span class="journal-stamp-emoji">${item.emoji}</span>
          <span class="journal-stamp-label">${escHtml(item.label)}</span>
          ${item.builtin ? '' : '<span class="journal-stamp-custom">custom</span>'}
        </button>
      `).join('')}
      <button class="journal-stamp journal-stamp-add" data-open-template-builder type="button" title="New custom template">
        <span class="journal-stamp-emoji">＋</span>
        <span class="journal-stamp-label">Custom template</span>
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

function renderComposer(
  state: CaptureState,
  entries: StoredJournalEntry[],
  legs: StoredLeg[],
): string {
  const item = template(state.draft.template);
  const prompt = item.prompts[state.promptIndex % item.prompts.length];
  const destinations = suggestedDestinations(entries, legs);

  return `
    <section class="journal-composer journal-fmt-${item.format}" style="--tint:${item.tint}">
      <div class="journal-composer-head">
        <span class="journal-composer-emoji">${item.emoji}</span>
        <div class="journal-composer-headings">
          <span class="journal-composer-format">${escHtml(item.label)}</span>
          <span class="journal-composer-prompt">${escHtml(prompt)}</span>
          <span class="journal-composer-focus">${escHtml(item.focus)}</span>
        </div>
        <button class="journal-icon-btn" data-journal-shuffle type="button" title="Another prompt">↻</button>
        <button class="journal-icon-btn" data-journal-close type="button" title="Close">✕</button>
      </div>

      <div class="journal-composer-block">
        <div class="journal-composer-block-title">Core capture</div>
        <div class="journal-write-area">
          <label class="journal-body-label" for="journal-body">${escHtml(item.bodyLabel)}</label>
          <textarea class="journal-textarea" id="journal-body" placeholder="${escHtml(item.placeholder)}">${escHtml(state.draft.body)}</textarea>
        </div>
      </div>

      <div class="journal-composer-block">
        <div class="journal-composer-block-title">Context</div>
        <div class="journal-meta-row">
          <input class="input journal-meta-title" id="journal-title" maxlength="80" placeholder="Title (optional)" value="${escHtml(state.draft.title)}">
          <input class="input journal-meta-date" type="date" id="journal-date" value="${escHtml(state.draft.happenedOn)}">
        </div>
        <div class="journal-meta-grid">
          ${item.fields.destination ? `
            <input class="input" id="journal-destination" list="journal-dest-list" placeholder="${escHtml(item.destinationLabel)}" value="${escHtml(state.draft.destination)}">
            <datalist id="journal-dest-list">
              ${destinations.map((destination) => `<option value="${escHtml(destination)}"></option>`).join('')}
            </datalist>
          ` : ''}
        </div>
      </div>

      <div class="journal-composer-block">
        <div class="journal-composer-block-title">Extra texture</div>
        <div class="journal-meta-grid">
          ${item.fields.tags ? `
            <input class="input" id="journal-tags" placeholder="${escHtml(item.tagsLabel)}" value="${escHtml(state.draft.tagsText)}">
          ` : ''}
          ${item.fields.image ? `
            <label class="journal-upload-chip" for="journal-image-input">
              <span>🖼️</span>
              <span>${escHtml(item.imageLabel)}</span>
            </label>
            <input class="journal-image-input" type="file" id="journal-image-input" accept="image/*">
          ` : ''}
        </div>
        ${state.draft.coverImage ? `
          <div class="journal-image-preview-wrap">
            <img src="${escHtml(state.draft.coverImage)}" alt="Preview" class="journal-image-preview">
            <button class="journal-filter-chip" data-remove-image type="button">Remove image</button>
          </div>
        ` : ''}
        ${item.fields.mood ? `
          <div class="journal-mood-field">
            <span class="journal-mood-label">Mood</span>
            <div class="journal-mood-row">
              ${MOODS.map((mood) => `
                <label class="journal-mood-chip ${state.draft.mood === mood.value ? 'active' : ''}" title="${mood.value}">
                  <input type="radio" name="journal-mood" value="${mood.value}" ${state.draft.mood === mood.value ? 'checked' : ''}>
                  <span>${mood.emoji}</span>
                </label>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="journal-composer-actions">
        <button class="btn btn-primary" data-journal-save type="button">${state.editingId ? 'Save' : 'Add to capture'}</button>
        <button class="btn btn-ghost" data-journal-cancel type="button">Cancel</button>
        <span class="journal-shortcut">⌘↵ to save</span>
      </div>
    </section>
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
  return filterBar + renderTimelineFeed(model.visibleEntries, model.state.editingId);
}

function renderTimelineFeed(entries: StoredJournalEntry[], editingId: string | null): string {
  // Group by happenedOn date
  const groups = new Map<string, StoredJournalEntry[]>();
  for (const entry of entries) {
    const day = entry.happenedOn;
    const list = groups.get(day) ?? [];
    list.push(entry);
    groups.set(day, list);
  }
  const today = new Date().toISOString().slice(0, 10);

  return `<div class="journal-timeline">
    ${[...groups.entries()].map(([day, dayEntries]) => {
      const isToday = day === today;
      const dateLabel = isToday ? 'Today' : new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `
        <div class="journal-timeline-group">
          <div class="journal-timeline-date">
            <span class="journal-timeline-date-label ${isToday ? 'is-today' : ''}">${escHtml(dateLabel)}</span>
          </div>
          <div class="journal-timeline-entries">
            ${dayEntries.map((entry) => renderTimelineEntry(entry, editingId)).join('')}
          </div>
        </div>
      `;
    }).join('')}
  </div>`;
}

function renderTimelineEntry(entry: StoredJournalEntry, editingId: string | null): string {
  const item = template(entry.template);
  const isEditing = entry.id === editingId;
  const where = entry.destination || titleFor(entry);
  const isPublic = entry.visibility === 'public';

  return `
    <div class="journal-timeline-entry ${isEditing ? 'is-editing' : ''}" data-open-entry="${entry.id}" style="--tint:${item.tint}">
      <div class="journal-timeline-dot" style="background:${item.tint}"></div>
      <div class="journal-timeline-card">
        <div class="journal-timeline-card-head">
          <div class="journal-timeline-card-meta">
            <span class="journal-timeline-badge" style="background:color-mix(in srgb,${item.tint} 22%,#fff);color:color-mix(in srgb,${item.tint} 80%,#333)">${item.emoji} ${escHtml(item.label)}</span>
            <span class="journal-timeline-where">${escHtml(where)}</span>
          </div>
          <div class="journal-timeline-actions">
            <button class="journal-icon-btn ${isPublic ? 'is-on' : ''}" data-share-entry="${entry.id}" type="button" title="Share">↗</button>
            <button class="journal-icon-btn ${entry.favorite ? 'is-on' : ''}" data-favorite-entry="${entry.id}" type="button" title="Pin">📌</button>
            <button class="journal-icon-btn" data-delete-entry="${entry.id}" type="button" title="Delete">✕</button>
          </div>
        </div>
        <p class="journal-timeline-body">${escHtml(excerpt(entry.body, 160))}</p>
        ${entry.coverImage ? `<img src="${escHtml(entry.coverImage)}" alt="" class="journal-timeline-img">` : ''}
        ${entry.tags.length ? `<div class="journal-timeline-tags">${entry.tags.map((tag) => `<span class="journal-tag">#${escHtml(tag)}</span>`).join('')}</div>` : ''}
      </div>
    </div>
  `;
}

function renderPlacesView(groups: PlaceGroup[]): string {
  if (groups.length === 0) {
    return renderEmpty('Places', 'No places yet', 'Add destination-aware entries and this view will group them here.');
  }
  return `
    <div class="journal-places-grid">
      ${groups.map((group) => {
        const coverEntry = group.entries.find((e) => e.coverImage);
        const hasImage = !!coverEntry?.coverImage;
        const tmpl = template(group.entries[0].template);
        return `
          <article class="journal-place-tile" data-place-filter="${escHtml(group.label)}" style="--tint:${tmpl.tint}">
            <div class="journal-place-tile-cover">
              ${hasImage
                ? `<img src="${escHtml(coverEntry!.coverImage!)}" alt="${escHtml(group.label)}" class="journal-place-tile-img">`
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
      <button class="journal-place-tile journal-place-tile-add" data-new-entry type="button">
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
            const coverEntry = group.entries.find((e) => e.coverImage);
            return `
              <article class="journal-category-tile" data-filter-template="${item.id}" style="--tint:${item.tint}">
                <div class="journal-category-tile-cover">
                  ${coverEntry?.coverImage
                    ? `<img src="${escHtml(coverEntry.coverImage)}" alt="" class="journal-category-tile-img">`
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
          <article class="journal-gallery-tile${entry.coverImage ? ' has-image' : ''}" data-open-entry="${entry.id}" style="--tint:${item.tint}">
            <div class="journal-gallery-media" style="padding-top:${paddingTop}">
              <div class="journal-gallery-media-inner">
                ${entry.coverImage
                  ? `<img src="${escHtml(entry.coverImage)}" alt="${escHtml(titleFor(entry))}" class="journal-gallery-image">`
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


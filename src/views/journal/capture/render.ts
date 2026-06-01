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
  moodEmoji,
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

const VIEW_META: Record<CaptureView, { label: string; note: string }> = {
  feed: { label: 'Feed', note: 'A running stream of little things worth keeping.' },
  places: { label: 'Places', note: 'Group entries by city so a stop feels like a chapter.' },
  categories: { label: 'Categories', note: 'Review your trip through recurring themes and tags.' },
  gallery: { label: 'Gallery', note: 'A more visual wall for moments with texture and mood.' },
  map: { label: 'Map', note: 'Pin entries back onto the route and see where memory clusters.' },
  calendar: { label: 'Calendar', note: 'Scan the trip day by day without rewriting it as a diary.' },
};

export function renderCapture(model: CaptureRenderModel): string {
  const placeCount = model.placeGroups.filter((group) => group.label !== 'No place yet').length;
  const pinnedCount = model.allEntries.filter((entry) => entry.favorite).length;
  const activeView = VIEW_META[model.state.view];

  return `
    <div class="journal-shell">
      <section class="card journal-capture-head">
        <div class="journal-capture-copy">
          <span class="journal-section-kicker">Quick Capture</span>
          <h3>${activeView.label}</h3>
          <p>${activeView.note}</p>
        </div>
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
        <button class="btn btn-primary journal-capture-cta" data-new-entry type="button">+ New entry</button>
      </section>

      <div class="journal-layout-bar">
        ${Object.entries(VIEW_META).map(([id, meta]) => `
          <button class="journal-layout-tab ${model.state.view === id ? 'active' : ''}" data-journal-view="${id}" type="button">
            <span>${meta.label}</span>
          </button>
        `).join('')}
      </div>

      ${renderStamps(model.state)}
      ${model.state.templateBuilderOpen ? renderTemplateBuilder(model.state) : ''}
      ${model.state.composerOpen ? renderComposer(model.state, model.allEntries, model.legs) : ''}
      ${renderFilters(model)}

      <section class="journal-view-surface">
        ${renderActiveView(model)}
      </section>
    </div>
  `;
}

function renderActiveView(model: CaptureRenderModel): string {
  if (model.state.view === 'places') return renderPlacesView(model.placeGroups);
  if (model.state.view === 'categories') return renderCategoriesView(model.templateGroups, model.tagGroups);
  if (model.state.view === 'gallery') return renderGalleryView(model.visibleEntries);
  if (model.state.view === 'map') return renderMapView(model.mapPoints, model.mapRoute);
  if (model.state.view === 'calendar') return renderCalendarView(model.calendarCells, model.currentMonthLabel);
  return renderFeed(model.visibleEntries, model.state.editingId);
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

function renderFilters(model: CaptureRenderModel): string {
  const items = templates();
  if (model.allEntries.length === 0) return '';
  return `
    <div class="journal-filter-bar">
      <div class="journal-filter-stack">
        <div class="journal-filter-group">
          <button class="journal-filter-chip ${model.state.filter.template === 'all' ? 'active' : ''}" data-filter-template="all" type="button">All</button>
          ${items.map((item) => `
            <button class="journal-filter-chip ${model.state.filter.template === item.id ? 'active' : ''}"
                    style="--tint:${item.tint}" data-filter-template="${item.id}" type="button">
              <span class="journal-filter-emoji">${item.emoji}</span>${escHtml(item.label)}
            </button>
          `).join('')}
          <button class="journal-filter-chip journal-filter-pin ${model.state.filter.favoritesOnly ? 'active' : ''}" data-filter-favorites type="button" title="Pinned only">📌</button>
        </div>
        ${model.allTags.length ? `
          <div class="journal-filter-group journal-filter-tags">
            <button class="journal-filter-chip ${model.state.filter.tag === 'all' ? 'active' : ''}" data-filter-tag="all" type="button">All tags</button>
            ${model.allTags.slice(0, 8).map((tag) => `
              <button class="journal-filter-chip ${model.state.filter.tag === tag ? 'active' : ''}" data-filter-tag="${escHtml(tag)}" type="button">#${escHtml(tag)}</button>
            `).join('')}
          </div>
        ` : ''}
      </div>
      <div class="journal-filter-side">
        ${model.destinations.length ? `
          <select class="select input journal-dest-select" data-filter-destination>
            <option value="all" ${model.state.filter.destination === 'all' ? 'selected' : ''}>All places</option>
            ${model.destinations.map((destination) => `
              <option value="${escHtml(destination)}" ${model.state.filter.destination === destination ? 'selected' : ''}>${escHtml(destination)}</option>
            `).join('')}
          </select>
        ` : ''}
      </div>
    </div>
  `;
}

function renderFeed(entries: StoredJournalEntry[], editingId: string | null): string {
  if (entries.length === 0) {
    return renderEmpty('Filtered', 'No entries match this slice', 'Try “All” or clear a tag/place filter.');
  }
  return `<section class="journal-feed">${entries.map((entry, index) => renderCard(entry, index, editingId)).join('')}</section>`;
}

function renderPlacesView(groups: PlaceGroup[]): string {
  if (groups.length === 0) {
    return renderEmpty('Places', 'No places yet', 'Add destination-aware entries and this view will group them here.');
  }
  return `
    <div class="journal-places-grid">
      ${groups.map((group) => `
        <article class="card journal-place-card">
          <div class="journal-place-head">
            <div>
              <div class="journal-place-title">${escHtml(group.label)}</div>
              <div class="journal-place-meta">${group.entries.length} entries · ${escHtml(group.summary)}</div>
            </div>
            <button class="journal-filter-chip" data-place-filter="${escHtml(group.label)}" type="button">Open slice</button>
          </div>
          <div class="journal-mini-list">
            ${group.entries.slice(0, 3).map(renderMiniEntry).join('')}
          </div>
        </article>
      `).join('')}
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
        <section>
          <div class="journal-subsection-title">By template</div>
          <div class="journal-category-grid">
            ${templateGroups.map((group) => {
              const item = template(group.templateId);
              return `
                <article class="card journal-category-card" style="--tint:${item.tint}">
                  <div class="journal-category-card-head">
                    <div class="journal-category-badge">${item.emoji}</div>
                    <div>
                      <div class="journal-category-title">${escHtml(item.label)}</div>
                      <div class="journal-category-meta">${group.entries.length} entries</div>
                    </div>
                  </div>
                  ${group.topTags.length ? `
                    <div class="journal-category-tags">
                      ${group.topTags.map((tag) => `<button class="journal-tag" data-filter-tag="${escHtml(tag)}" type="button">#${escHtml(tag)}</button>`).join('')}
                    </div>
                  ` : ''}
                  <div class="journal-mini-list">
                    ${group.entries.slice(0, 2).map(renderMiniEntry).join('')}
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        </section>
      ` : ''}

      ${tagGroups.length ? `
        <section>
          <div class="journal-subsection-title">By tag</div>
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
        </section>
      ` : ''}
    </div>
  `;
}

function renderGalleryView(entries: StoredJournalEntry[]): string {
  if (entries.length === 0) {
    return renderEmpty('Gallery', 'No gallery items yet', 'As you capture more moments, they will show up here as a richer wall.');
  }
  return `
    <div class="journal-gallery-grid">
      ${entries.map((entry, index) => {
        const item = template(entry.template);
        const classes = [
          'journal-gallery-tile',
          index % 5 === 0 ? 'is-tall' : '',
          entry.coverImage ? 'has-image' : '',
        ].filter(Boolean).join(' ');
        return `
          <article class="${classes}" data-open-entry="${entry.id}" style="--tint:${item.tint}">
            <div class="journal-gallery-media">
              ${entry.coverImage
                ? `<img src="${escHtml(entry.coverImage)}" alt="${escHtml(titleFor(entry))}" class="journal-gallery-image">`
                : `<div class="journal-gallery-fallback"><span>${item.emoji}</span><p>${escHtml(excerpt(entry.body, 88))}</p></div>`}
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

function renderMapView(points: MapPoint[], route: Array<{ left: number; top: number }>): string {
  if (points.length === 0) {
    return renderEmpty('Map', 'No mapped entries yet', 'Entries with destinations that match your route will pin themselves here.');
  }
  return `
    <div class="journal-map-layout">
      <div class="journal-map-stage">
        <svg class="journal-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${route.length > 1 ? `<polyline points="${route.map((point) => `${point.left},${point.top}`).join(' ')}"></polyline>` : ''}
        </svg>
        ${points.map((point) => `
          <button class="journal-map-pin" data-place-filter="${escHtml(point.label)}" type="button" style="left:${point.left}%;top:${point.top}%">
            <span class="journal-map-pin-count">${point.count}</span>
            <span class="journal-map-pin-label">${escHtml(point.label)}</span>
          </button>
        `).join('')}
      </div>
      <aside class="journal-map-panel">
        <div class="journal-map-panel-head">
          <div>
            <div class="journal-subsection-title">Pinned places</div>
            <p>Open a city slice here, or jump into the full Map view.</p>
          </div>
          <button class="btn btn-ghost" data-open-map-view type="button">Open map</button>
        </div>
        <div class="journal-map-list">
          ${points.map((point) => `
            <button class="journal-map-list-item" data-place-filter="${escHtml(point.label)}" type="button">
              <span class="journal-map-list-name">${escHtml(point.label)}</span>
              <span class="journal-map-list-meta">${point.count} entries</span>
            </button>
          `).join('')}
        </div>
      </aside>
    </div>
  `;
}

function renderCalendarView(cells: CalendarCell[], monthLabel: string): string {
  return `
    <div class="journal-calendar-shell">
      <div class="journal-calendar-head">
        <div>
          <div class="journal-subsection-title">Daily recall</div>
          <div class="journal-calendar-month">${escHtml(monthLabel)}</div>
        </div>
        <div class="journal-calendar-actions">
          <button class="journal-filter-chip" data-calendar-shift="-1" type="button">← Prev</button>
          <button class="journal-filter-chip" data-calendar-shift="1" type="button">Next →</button>
        </div>
      </div>
      <div class="journal-calendar-grid">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => `
          <div class="journal-calendar-dow">${label}</div>
        `).join('')}
        ${cells.map((cell) => `
          <article class="journal-calendar-cell ${cell.inMonth ? '' : 'is-muted'}">
            <div class="journal-calendar-day">${cell.day}</div>
            <div class="journal-calendar-items">
              ${cell.entries.slice(0, 2).map((entry) => `
                <button class="journal-calendar-pill journal-template-${template(entry.template).id}" data-open-entry="${entry.id}" type="button">
                  <span>${template(entry.template).emoji}</span>
                  <span>${escHtml(titleFor(entry))}</span>
                </button>
              `).join('')}
              ${cell.entries.length > 2 ? `<div class="journal-calendar-more">+${cell.entries.length - 2} more</div>` : ''}
            </div>
          </article>
        `).join('')}
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

function renderCardFrame(entry: StoredJournalEntry, format: string): string {
  const body = escHtml(excerpt(entry.body));
  const where = escHtml(entry.destination || titleFor(entry));
  const image = entry.coverImage
    ? `<img src="${escHtml(entry.coverImage)}" alt="${escHtml(titleFor(entry))}" class="journal-card-cover-image">`
    : '';

  if (format === 'postcard') {
    const initials = where.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'OTR';
    return `
      <div class="journal-postcard-grid">
        <div class="journal-postcard-msg-wrap">${image}<div class="journal-postcard-msg">${body}</div></div>
        <div class="journal-postcard-side">
          <div class="journal-postcard-stamp">${initials}</div>
          <div class="journal-postcard-lines"><span></span><span></span><span></span></div>
        </div>
      </div>
    `;
  }

  if (format === 'ticket') {
    return `
      <div class="journal-ticket-grid">
        <div class="journal-ticket-stub">
          <span class="journal-ticket-stub-label">Note</span>
          <span class="journal-ticket-stub-date">${prettyDate(entry.happenedOn)}</span>
        </div>
        <div class="journal-ticket-body">${image}${body}</div>
      </div>
    `;
  }

  return `<div class="journal-card-frame">${image}<p class="journal-card-body">${body}</p></div>`;
}

function renderCard(entry: StoredJournalEntry, index: number, editingId: string | null): string {
  const item = template(entry.template);
  const tilt = [-1.2, 0.9, -0.5, 1.1, 0.4][index % 5];
  const isEditing = entry.id === editingId;
  const isPublic = entry.visibility === 'public';
  const showFoot = item.format !== 'ticket';

  return `
    <article class="journal-card journal-fmt-${item.format} ${isEditing ? 'is-editing' : ''}"
             data-open-entry="${entry.id}" style="--tint:${item.tint}; --card-tilt:${tilt}deg">
      <div class="journal-card-actions">
        <button class="journal-icon-btn ${isPublic ? 'is-on' : ''}" data-share-entry="${entry.id}" type="button" title="${isPublic ? 'Copy link' : 'Share'}">↗</button>
        <button class="journal-icon-btn ${entry.favorite ? 'is-on' : ''}" data-favorite-entry="${entry.id}" type="button" title="Pin">📌</button>
        <button class="journal-icon-btn" data-delete-entry="${entry.id}" type="button" title="Delete">✕</button>
      </div>

      ${renderCardFrame(entry, item.format)}

      ${showFoot ? `
        <div class="journal-card-foot">
          <span class="journal-card-emoji">${item.emoji}</span>
          <span class="journal-card-where">${escHtml(entry.destination || titleFor(entry))}</span>
          ${entry.mood ? `<span class="journal-card-mood">${moodEmoji(entry.mood)}</span>` : ''}
          <span class="journal-card-date">${prettyDate(entry.happenedOn)}</span>
        </div>
      ` : `
        <div class="journal-card-foot journal-ticket-foot">
          <span class="journal-card-emoji">${item.emoji}</span>
          <span class="journal-card-where">${escHtml(entry.destination || titleFor(entry))}</span>
        </div>
      `}

      ${entry.tags.length ? `<div class="journal-card-tags">${entry.tags.map((tag) => `<span class="journal-tag">#${escHtml(tag)}</span>`).join('')}</div>` : ''}
    </article>
  `;
}

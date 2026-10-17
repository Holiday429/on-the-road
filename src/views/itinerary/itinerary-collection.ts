/* ==========================================================================
   On the Road · Itinerary — Collection (clips + notes on one board)
   --------------------------------------------------------------------------
   Everything you gather for a city that isn't scheduled yet: links and
   screenshots (clips) and your own sticky notes. One section, one grid, one
   filter bar (All / Clips / Notes, plus a category chip per clip category).
   Clips and notes stay two arrays in Firestore (the iOS app and the
   cross-visit sharing both read them); only the page puts them together.
   Pure markup + the filter wiring; every other action is wired in itinerary.ts
   through the data-act attributes, as before.
   ========================================================================== */

import { t as tr } from '../../core/i18n.ts';
import { escHtml as esc } from '../../core/utils.ts';
import type { Clip, NoteCard } from '../../data/schema.ts';
import type { StoredCityShared } from '../../data/stores/city-shared-store.ts';
import { allCategories, categoryById, type Leg } from './itinerary-shared.ts';
import { clipImages, legNoteCardsOf, resolveNoteColor, NOTE_COLORS } from './itinerary-utils.ts';
import { renderFastenerFor } from '../../core/paper/fastener.ts';
import { cityShareContext, sharedClips, sharedNoteCards } from './itinerary-city-shared.ts';

type ClipEntry = { clip: Clip; srcLegId: string };
type NoteEntry = { card: NoteCard; srcLegId: string };

function clipCard({ clip: c, srcLegId }: ClipEntry, leg: Leg, legs: Leg[], visitIndex: (id: string) => number): string {
  // Category colour resolves against the clip's own leg (categories are per-leg).
  const srcLeg = legs.find((l) => l.id === srcLegId) ?? leg;
  const cat = c.category ? categoryById(srcLeg, c.category) : undefined;
  const color = cat?.color ?? '#ebebeb';
  const imgs = clipImages(c);
  const foreign = srcLegId !== leg.id;
  const vIdx = foreign ? visitIndex(srcLegId) : 0;
  return `
    <div class="rd-clip-card rd-clip-card--expandable${foreign ? ' rd-clip-card--shared' : ''}" data-kind="clip" data-clip="${esc(c.id)}" data-src-leg="${esc(srcLegId)}" data-clip-cat="${esc(c.category ?? '')}" data-act="preview-clip" data-clip-preview="${esc(c.id)}">
      <div class="rd-clip-card-color" style="background:${esc(color)}"></div>
      <div class="rd-clip-card-body">
        ${imgs.length ? `<div class="rd-clip-card-imgs">${imgs.slice(0, 3).map((u, i) => `<div class="rd-clip-card-img-wrap">${i === 2 && imgs.length > 3 ? `<img class="rd-clip-card-img" src="${esc(u)}" alt=""><div class="rd-clip-card-img-more">+${imgs.length - 2}</div>` : `<img class="rd-clip-card-img" src="${esc(u)}" alt="">`}</div>`).join('')}</div>` : ''}
        <div class="rd-clip-card-top">
          ${cat ? `<span class="rd-cat-badge rd-cat-badge--sm" style="background:${esc(color)}">${esc(cat.label)}</span>` : ''}
          ${foreign ? `<span class="rd-share-tag" title="${tr('route.shareFromVisitTitle')}">${tr('route.shareFromVisit', { n: vIdx })}</span>` : ''}
          <div class="rd-clip-card-actions">
            <button class="rd-icon-btn" data-act="clip-to-plan" data-clip="${esc(c.id)}" data-src-leg="${esc(srcLegId)}" title="Convert to plan item">→✨</button>
            <button class="rd-icon-btn" data-act="edit-clip" data-clip="${esc(c.id)}" data-src-leg="${esc(srcLegId)}" title="Edit">✎</button>
            <button class="rd-icon-btn rd-danger" data-act="del-clip" data-clip="${esc(c.id)}" data-src-leg="${esc(srcLegId)}" title="Remove">✕</button>
          </div>
        </div>
        ${c.url
          ? `<a class="rd-clip-card-title" href="${esc(/^https?:\/\//i.test(c.url) ? c.url : 'https://' + c.url)}" target="_blank" rel="noopener">${esc(c.title || c.url)}</a>`
          : `<div class="rd-clip-card-title">${esc(c.title || 'Note')}</div>`}
        ${c.body ? `<div class="rd-clip-card-body-text">${esc(c.body)}</div>` : ''}
      </div>
    </div>`;
}

function noteCard({ card: c, srcLegId }: NoteEntry, i: number, leg: Leg, visitIndex: (id: string) => number): string {
  const color = resolveNoteColor(c.color, i);
  const foreign = srcLegId !== leg.id;
  return `
    <div class="rd-note-card${foreign ? ' rd-note-card--shared' : ''}" data-kind="note" data-note-id="${esc(c.id)}" data-src-leg="${esc(srcLegId)}" style="background:${esc(color)}">
      ${renderFastenerFor(c.id)}
      <div class="rd-note-card-head">
        <input class="rd-note-title-input" data-note-id="${esc(c.id)}" value="${esc(c.title)}" placeholder="Title…">
        <div class="rd-note-card-actions">
          ${foreign ? `<span class="rd-share-tag" title="${tr('route.shareFromVisitTitle')}">${tr('route.shareFromVisit', { n: visitIndex(srcLegId) })}</span>` : ''}
          <button class="rd-note-expand-btn" data-act="expand-note" data-note-id="${esc(c.id)}" title="View full note">↗</button>
          <div class="rd-note-color-wrap" data-note-id="${esc(c.id)}">
            <button class="rd-note-color-trigger" data-act="toggle-color" data-note-id="${esc(c.id)}" title="Note colour" style="background:${esc(color)}"></button>
            <div class="rd-note-color-popover" data-note-id="${esc(c.id)}" hidden>
              ${NOTE_COLORS.map((col) => `<button class="rd-note-color-swatch${col === color ? ' is-active' : ''}" data-color="${col}" data-note-id="${esc(c.id)}" style="background:${col}"></button>`).join('')}
            </div>
          </div>
          <button class="rd-note-del" data-act="del-note" data-note-id="${esc(c.id)}" title="Delete note">✕</button>
        </div>
      </div>
      <div class="rd-note-body-wrap">
        <textarea class="rd-note-body" data-note-id="${esc(c.id)}" placeholder="Write anything…">${esc(c.body)}</textarea>
      </div>
    </div>`;
}

/** Clips and notes merge across every visit to this city (same trip); each card is
 *  tagged with the leg it lives in so edits patch the right document. */
export function renderCollectionSection(leg: Leg, legs: Leg[], sharedCities: StoredCityShared[]): string {
  const ctx = cityShareContext(leg, legs, sharedCities);
  const clips: ClipEntry[] = ctx
    ? sharedClips(ctx)
    : [...(leg.clips ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((c) => ({ clip: c, srcLegId: leg.id }));
  const notes: NoteEntry[] = ctx
    ? sharedNoteCards(ctx)
    : legNoteCardsOf(leg).map((c) => ({ card: c, srcLegId: leg.id }));
  const visitIndex = (legId: string) => (ctx ? ctx.siblings.findIndex((s) => s.id === legId) + 1 : 0);

  const kindChip = (kind: string, label: string, n: number) =>
    `<button class="rd-filter-chip${kind === '' ? ' is-active' : ''}" data-kind="${kind}">${esc(label)}${kind ? ` <span class="rd-filter-n">${n}</span>` : ''}</button>`;
  const bar = `
    <div class="rd-filter-bar" id="rd-clip-filter-bar">
      ${kindChip('', tr('route.filterAll'), 0)}
      ${kindChip('clip', tr('route.collClips'), clips.length)}
      ${kindChip('note', tr('route.collNotes'), notes.length)}
      <span class="rd-filter-sep" aria-hidden="true"></span>
      ${allCategories(leg).filter((c) => clips.some((e) => e.clip.category === c.id)).map((c) =>
        `<button class="rd-filter-chip" data-filter="${esc(c.id)}" style="--chip-color:${esc(c.color)}">${esc(c.label)}</button>`).join('')}
      <button class="rd-filter-chip rd-filter-chip--add" data-act="add-clip-category" title="New category">${tr('route.btnAddCategory')}</button>
    </div>`;

  const cards = clips.map((e) => clipCard(e, leg, legs, visitIndex)).join('')
    + notes.map((e, i) => noteCard(e, i, leg, visitIndex)).join('');
  const total = clips.length + notes.length;
  return `
    <section class="rd-section rd-section--collection" id="rd-clips-section">
      <div class="rd-section-head">
        <h3>${tr('route.sectionClips')} <span class="rd-coll-count">${total}</span></h3>
        <button class="btn btn-ghost rd-sm" data-act="open-add-clip">${tr('route.btnAddClip')}</button>
        <button class="btn btn-ghost rd-sm" data-act="add-note">${tr('route.btnAddNote')}</button>
      </div>
      ${bar}
      ${total
        ? `<div class="rd-clip-grid rd-coll-grid">${cards}</div>`
        : `<div class="rd-placeholder rd-placeholder-soft"><span>${tr('route.collEmpty')}</span></div>`}
    </section>`;
}

/** Filter chips: one kind (All / Clips / Notes) and optionally one clip category.
 *  A category only matches clips, so picking one hides the notes. */
export function wireCollectionFilter(timeline: HTMLElement): void {
  const bar = timeline.querySelector<HTMLElement>('#rd-clip-filter-bar');
  const grid = timeline.querySelector<HTMLElement>('.rd-coll-grid');
  if (!bar || !grid) return;
  let kind = '', cat = '';
  const apply = () => {
    bar.querySelectorAll<HTMLElement>('.rd-filter-chip[data-kind]').forEach((c) => c.classList.toggle('is-active', c.dataset.kind === kind));
    bar.querySelectorAll<HTMLElement>('.rd-filter-chip[data-filter]').forEach((c) => c.classList.toggle('is-active', c.dataset.filter === cat));
    grid.querySelectorAll<HTMLElement>('[data-kind]').forEach((card) => {
      const k = card.dataset.kind;
      card.hidden = (kind !== '' && k !== kind) || (cat !== '' && (k === 'note' || card.dataset.clipCat !== cat));
    });
  };
  bar.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.rd-filter-chip');
    if (!chip) return;
    if (chip.dataset.kind !== undefined) { kind = chip.dataset.kind; if (kind === 'note') cat = ''; }
    else if (chip.dataset.filter !== undefined) { cat = cat === chip.dataset.filter ? '' : chip.dataset.filter; if (cat && kind === 'note') kind = ''; }
    else return;
    apply();
  });
}

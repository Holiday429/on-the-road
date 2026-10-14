/* ==========================================================================
   On the Road · Journal gallery — markup
   --------------------------------------------------------------------------
   A dark room with a slowly drifting wall of photographs (see gallery-flow.ts):
   every photo of every entry, three columns wide, grey until you look at it.
   Beside it, a plate in the manner of a gallery's wall text: the trip's name in
   letter-spaced type, and the numbers of what hangs here. Select mode and the
   Original / Square switch from the old gallery are kept.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { escHtml, entryImages, prettyDate, titleFor } from '../shared/utils.ts';

export interface WallPhoto { src: string; entry: StoredJournalEntry; index: number }

/** Every photo of every entry, in entry order — entries without a photo hang nothing. */
export function wallPhotos(entries: StoredJournalEntry[]): WallPhoto[] {
  const out: WallPhoto[] = [];
  for (const entry of entries) entryImages(entry).forEach((src, index) => out.push({ src, entry, index }));
  return out;
}

export interface WallStats { photos: number; places: number; from: string; to: string }

export function wallStats(entries: StoredJournalEntry[]): WallStats {
  const withPhotos = entries.filter((e) => entryImages(e).length);
  const dates = withPhotos.map((e) => e.happenedOn).sort();
  return {
    photos: withPhotos.reduce((n, e) => n + entryImages(e).length, 0),
    places: new Set(withPhotos.map((e) => e.destination.trim().toLowerCase()).filter(Boolean)).size,
    from: dates[0] ?? '',
    to: dates[dates.length - 1] ?? '',
  };
}

export interface GalleryOpts {
  title: string;
  square: boolean;
  selection: string[] | null;
  drifting: boolean;
  albums: StoredJournalAlbum[];
}

function range(s: WallStats): string {
  if (!s.from) return '';
  return s.from === s.to ? prettyDate(s.from) : `${prettyDate(s.from)} — ${prettyDate(s.to)}`;
}

export function renderGallery(entries: StoredJournalEntry[], o: GalleryOpts, empty: string): string {
  const photos = wallPhotos(entries);
  if (!photos.length) return empty;
  const stats = wallStats(entries);
  const sel = o.selection;
  const selecting = sel !== null;
  const lead = photos[0];

  const tiles = photos.map((p, i) => {
    const picked = selecting && sel.includes(p.entry.id);
    const action = selecting ? `data-gallery-pick="${escHtml(p.entry.id)}"` : `data-open-entry="${escHtml(p.entry.id)}"`;
    const where = p.entry.destination.trim();
    return `
      <figure class="jg-tile${picked ? ' is-picked' : ''}" ${action} role="button" tabindex="0" style="--i:${i % 6}">
        <span class="jg-frame" aria-hidden="true"></span>
        ${selecting ? `<span class="jg-check">${picked ? '✓' : ''}</span>` : ''}
        <img class="jg-img${o.square ? ' is-square' : ''}" src="${escHtml(p.src)}" alt="${escHtml(titleFor(p.entry))}" loading="lazy" draggable="false">
        <figcaption class="jg-placard">
          <span class="jg-placard-title">${escHtml(titleFor(p.entry))}</span>
          <span class="jg-placard-meta">${escHtml(where ? `${where} · ` : '')}${escHtml(prettyDate(p.entry.happenedOn))}</span>
        </figcaption>
      </figure>`;
  }).join('');

  return `
    <div class="jg-room">
      <aside class="jg-plate">
        <div class="jg-lead">
          <span class="jg-lead-frame" aria-hidden="true"></span>
          <img class="jg-lead-img" src="${escHtml(lead.src)}" alt="" draggable="false">
        </div>
        <h2 class="jg-name">${escHtml(o.title)}</h2>
        <p class="jg-stats">
          <span><b>${stats.photos}</b> ${stats.photos === 1 ? 'photograph' : 'photographs'}</span>
          ${stats.places ? `<span><b>${stats.places}</b> ${stats.places === 1 ? 'place' : 'places'}</span>` : ''}
          ${range(stats) ? `<span class="jg-range">${escHtml(range(stats))}</span>` : ''}
        </p>
        <div class="jg-controls">
          ${selecting ? '' : `
            <button class="jg-chip ${o.square ? '' : 'is-on'}" data-gallery-square type="button">Original</button>
            <button class="jg-chip ${o.square ? 'is-on' : ''}" data-gallery-square type="button">Square</button>
            <button class="jg-chip" data-gallery-drift type="button" aria-pressed="${o.drifting}">${o.drifting ? '⏸ Drifting' : '▶ Drift'}</button>`}
          <button class="jg-chip ${selecting ? 'is-on' : ''}" data-gallery-select type="button">${selecting ? `Selected ${sel.length}` : '☑ Select'}</button>
        </div>
        ${selecting ? `
          <div class="jg-select">
            <select class="select input journal-select-album" data-album-target ${sel.length ? '' : 'disabled'} aria-label="Add to album">
              <option value="">Add to album…</option>
              ${o.albums.map((a) => `<option value="${escHtml(a.id)}">${escHtml(a.emoji)} ${escHtml(a.title)}</option>`).join('')}
              <option value="__new__">+ New album…</option>
            </select>
            <button class="jg-chip" data-gallery-select-cancel type="button">Cancel</button>
          </div>` : ''}
      </aside>
      <div class="jg-wall" data-gallery-wall tabindex="0" aria-label="Photo wall">
        <div class="jg-cols">${tiles}</div>
      </div>
    </div>`;
}

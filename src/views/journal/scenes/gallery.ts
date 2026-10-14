/* ==========================================================================
   On the Road · Journal gallery — markup
   --------------------------------------------------------------------------
   Just the photographs: every photo of every entry in a wall of columns that
   drifts slowly upward on its own (see gallery-flow.ts) until you touch it.
   The controls — drift, Original / Square, select — sit in one small bar above
   the wall; there is no side plate and no room around it, so nothing competes
   with the pictures.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { escHtml, entryImages, titleFor } from '../shared/utils.ts';

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

export function renderGallery(entries: StoredJournalEntry[], o: GalleryOpts, empty: string): string {
  const photos = wallPhotos(entries);
  if (!photos.length) return empty;
  const stats = wallStats(entries);
  const sel = o.selection;
  const selecting = sel !== null;

  const tiles = photos.map((p, i) => {
    const picked = selecting && sel.includes(p.entry.id);
    const pick = selecting ? ` data-gallery-pick="${escHtml(p.entry.id)}" role="button" tabindex="0"` : '';
    return `
      <figure class="jg-tile${picked ? ' is-picked' : ''}"${pick} style="--i:${i % 6}">
        ${selecting ? `<span class="jg-check">${picked ? '✓' : ''}</span>` : ''}
        <img class="jg-img${o.square ? ' is-square' : ''}" src="${escHtml(p.src)}" alt="${escHtml(titleFor(p.entry))}" loading="lazy" draggable="false">
      </figure>`;
  }).join('');

  return `
    <div class="jg">
      <div class="jg-bar">
        <span class="jg-count"><b>${stats.photos}</b> ${stats.photos === 1 ? 'photo' : 'photos'}${stats.places ? ` · <b>${stats.places}</b> ${stats.places === 1 ? 'place' : 'places'}` : ''}</span>
        <span class="jg-sp"></span>
        ${selecting ? '' : `
          <button class="jg-chip" data-gallery-drift type="button" aria-pressed="${o.drifting}">${o.drifting ? '⏸ Drifting' : '▶ Drift'}</button>
          <button class="jg-chip ${o.square ? '' : 'is-on'}" data-gallery-square type="button">Original</button>
          <button class="jg-chip ${o.square ? 'is-on' : ''}" data-gallery-square type="button">Square</button>`}
        ${selecting ? `
          <select class="select input journal-select-album jg-album" data-album-target ${sel.length ? '' : 'disabled'} aria-label="Add to album">
            <option value="">Add to album…</option>
            ${o.albums.map((a) => `<option value="${escHtml(a.id)}">${escHtml(a.emoji)} ${escHtml(a.title)}</option>`).join('')}
            <option value="__new__">+ New album…</option>
          </select>
          <button class="jg-chip" data-gallery-select-cancel type="button">Cancel</button>` : ''}
        <button class="jg-chip ${selecting ? 'is-on' : ''}" data-gallery-select type="button">${selecting ? `Selected ${sel.length}` : '☑ Select'}</button>
      </div>
      <div class="jg-wall" data-gallery-wall tabindex="0" aria-label="Photo wall">
        <div class="jg-cols">${tiles}</div>
      </div>
    </div>`;
}

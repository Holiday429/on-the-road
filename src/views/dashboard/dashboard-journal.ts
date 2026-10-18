/* ==========================================================================
   On the Road · Dashboard — Journal card
   --------------------------------------------------------------------------
   City photos as Polaroid prints (the place written on the white strip in hand, entry
   count beneath), three at a time — with more than three they rotate. A + to their right opens the real composer;
   the corner expand button opens the album view in the side drawer. Tapping a
   thumbnail opens that city's photos and entries. With no photos yet it falls
   back to the latest entries as rows.

   Looking back at a day (time travel): the same card shows what was written on
   that day instead — one print per entry (photo, or a mood/text print) — and a
   quiet note when there was none. Same size either way.
   ========================================================================== */

import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { buildPlaceGroups, journalTiles, TILE_COUNT, type PlaceGroup } from './journal-places.ts';
import { entryCover, entryImages, excerpt, moodEmoji, prettyDate, titleFor } from '../journal/shared/utils.ts';
import { entriesOn } from '../../data/as-of.ts';
import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';

import { WIDGET_ICON } from '../../core/icons.ts';
function entriesLabel(n: number): string {
  return n === 1 ? t('dash.journal.entry1') : t('dash.journal.entries', { n });
}

/** Each print hangs a little off true, in a fixed pattern (so a re-render never re-shuffles them). */
const TILTS = [-1.8, 1.3, -0.9, 1.7, -1.3];
const tiltFor = (i: number) => TILTS[i % TILTS.length];

/** Three tiles are visible at a time; with more the track slides (see wireJournal). */
function carousel(tiles: string[]): string {
  return `<div class="jr-carousel" data-jr-carousel${tiles.length > TILE_COUNT ? ' data-rotates' : ''}><div class="jr-track">${tiles.join('')}</div></div>`;
}

function renderTiles(groups: PlaceGroup[]): string {
  const tiles = journalTiles(groups);
  return carousel(tiles.map((tile, i) => {
    const g = tile.group;
    const place = [g.flag, g.city].filter(Boolean).join(' ');
    return `
      <button type="button" class="jr-tile" data-jr-place="${groups.indexOf(g)}" aria-label="${esc(place)}" style="--tilt:${tiltFor(i)}deg">
        <span class="jr-photo-win"><img src="${esc(tile.image)}" alt="" loading="lazy" decoding="async"></span>
        <span class="jr-cap">
          ${place ? `<span class="jr-place">${esc(place)}</span>` : ''}
        </span>
      </button>`;
  }));
}

function renderRecentRows(entries: StoredJournalEntry[]): string {
  const recent = [...entries]
    .sort((a, b) => b.happenedOn.localeCompare(a.happenedOn) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 2);
  if (!recent.length) return `<div class="td-jq-hint">${esc(t('dash.journal.hint'))}</div>`;
  const rows = recent.map((e) => {
    const cover = entryCover(e);
    const hasTitle = e.title.trim().length > 0;
    return `
      <button class="td-jq-row" data-nav="journal" type="button">
        <span class="td-jq-thumb">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : esc(moodEmoji(e.mood) || '📖')}</span>
        <span class="td-jq-copy">
          <span class="td-jq-title">${esc(hasTitle ? titleFor(e) : excerpt(e.body, 40) || titleFor(e))}</span>
          <span class="td-jq-meta">${esc(e.destination ? `${e.destination} · ` : '')}${esc(prettyDate(e.happenedOn))}</span>
        </span>
      </button>`;
  }).join('');
  return `<div class="td-jq-recent">${rows}</div>`;
}

/* ── Day view (time travel) ──────────────────────────────────────────────── */

function renderDayTiles(day: StoredJournalEntry[], iso: string): string {
  if (!day.length) {
    const when = new Date(`${iso}T00:00:00`).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
    return `<div class="jr-day-empty">${esc(t('dash.journal.dayNone', { date: when }))}</div>`;
  }
  return carousel(day.map((e, i) => {
    const cover = safeUrl(entryCover(e));
    const title = e.title.trim() ? titleFor(e) : excerpt(e.body, 40) || titleFor(e);
    const face = cover
      ? `<img src="${cover}" alt="" loading="lazy" decoding="async">`
      : `<span class="jr-face"><span class="jr-face-emoji">${esc(moodEmoji(e.mood) || '📖')}</span><span class="jr-face-text">${esc(excerpt(e.body, 70))}</span></span>`;
    return `
      <button type="button" class="jr-tile" data-jr-entry="${esc(e.id)}" aria-label="${esc(title)}" style="--tilt:${tiltFor(i)}deg">
        <span class="jr-photo-win">${face}</span>
        <span class="jr-cap"><span class="jr-place">${esc(title)}</span>${e.destination ? `<span class="jr-sub">${esc(e.destination)}</span>` : ''}</span>
      </button>`;
  }));
}

function openEntryDrawer(e: StoredJournalEntry, trigger: HTMLElement | null): void {
  const photos = entryImages(e).map((src) => {
    const url = safeUrl(src);
    return url ? `<a class="jr-photo" href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="" loading="lazy" decoding="async"></a>` : '';
  }).join('');
  const d = openDrawer({
    title: `${moodEmoji(e.mood) ? `${moodEmoji(e.mood)} ` : ''}${titleFor(e)}`,
    subtitle: [prettyDate(e.happenedOn), e.destination].filter(Boolean).join(' · '),
    body: `${photos ? `<div class="jr-grid">${photos}</div>` : ''}<p class="jr-body">${esc(e.body.trim())}</p>`,
    footer: `<button type="button" class="btn btn-ghost" data-d-open>${esc(t('dash.link.allEntries'))}</button>`,
    returnFocus: trigger,
  });
  d.root.querySelector('[data-d-open]')?.addEventListener('click', () => { closeDrawer(); navigateTo('journal'); });
}

export function renderJournalWidget(entries: StoredJournalEntry[], legs: StoredLeg[], dayIso: string | null = null): string {
  const groups = buildPlaceGroups(entries, legs);
  const body = dayIso ? renderDayTiles(entriesOn(entries, dayIso), dayIso)
    : groups.length ? renderTiles(groups) : renderRecentRows(entries);
  return `
    <div class="td-widget td-w-journal" data-widget-id="journal">
      <div class="td-widget-header">
        <div class="td-widget-label">${WIDGET_ICON.journal} ${esc(t('dash.widget.journal'))}${entries.length ? ` <span class="td-jq-count">${entries.length}</span>` : ''}</div>
        <button type="button" class="td-expand" data-journal-expand title="${esc(t('dash.journal.albums'))}" aria-label="${esc(t('dash.journal.albums'))}">⤢</button>
      </div>
      <div class="jr-row">
        <div class="jr-main">${body}</div>
        <button type="button" class="td-plus td-plus--lg" data-journal-new title="${esc(t('dash.journal.compose'))}" aria-label="${esc(t('dash.journal.compose'))}">+</button>
      </div>
    </div>`;
}

/* ── City drawer ─────────────────────────────────────────────────────────── */

function openPlaceDrawer(g: PlaceGroup, trigger: HTMLElement | null): void {
  const photos = g.images.map((src) => {
    const url = safeUrl(src);
    return url ? `<a class="jr-photo" href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="" loading="lazy" decoding="async"></a>` : '';
  }).join('');
  const rows = g.entries.map((e) => {
    const hasTitle = e.title.trim().length > 0;
    return `<div class="td-dr"><span class="td-dr-k">${esc(prettyDate(e.happenedOn))}</span><span class="td-dr-v">${esc(hasTitle ? titleFor(e) : excerpt(e.body, 60) || titleFor(e))}</span></div>`;
  }).join('');
  const d = openDrawer({
    title: [g.flag, g.city].filter(Boolean).join(' ') || t('dash.widget.journal'),
    subtitle: entriesLabel(g.entries.length),
    body: `<div class="jr-grid">${photos}</div><section class="td-dcard">${rows}</section>`,
    footer: `<button type="button" class="btn btn-ghost" data-d-open>${esc(t('dash.link.allEntries'))}</button>`,
    returnFocus: trigger,
  });
  d.root.querySelector('[data-d-open]')?.addEventListener('click', () => { closeDrawer(); navigateTo('journal'); });
}

/* ── Rotation ────────────────────────────────────────────────────────────── */
// The dashboard re-renders wholesale on store changes, so the position lives
// here and the timer is re-attached on each wire — a Firestore tick must not
// snap the carousel back to the first tile.

const INTERVAL_MS = 4000;
let _idx = 0;
let _timer: number | undefined;
let _paused = false;

function stopRotation(): void {
  if (_timer !== undefined) { window.clearInterval(_timer); _timer = undefined; }
}

function wireCarousel(body: HTMLElement): void {
  stopRotation();
  const root = body.querySelector<HTMLElement>('[data-jr-carousel]');
  const track = root?.querySelector<HTMLElement>('.jr-track');
  const tiles = track ? [...track.children] as HTMLElement[] : [];
  if (!root || !track || tiles.length <= TILE_COUNT) { _idx = 0; return; }
  const last = tiles.length - TILE_COUNT;            // furthest the window can slide
  const show = (i: number, animate: boolean) => {
    _idx = i > last ? 0 : i;
    const step = tiles[1].offsetLeft - tiles[0].offsetLeft;   // tile width + gap
    track.style.transition = animate ? '' : 'none';
    track.style.transform = `translateX(${-_idx * step}px)`;
  };
  show(Math.min(_idx, last), false);
  root.addEventListener('mouseenter', () => { _paused = true; });
  root.addEventListener('mouseleave', () => { _paused = false; });
  root.addEventListener('focusin', () => { _paused = true; });
  root.addEventListener('focusout', () => { _paused = false; });
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;   // no auto-advance
  _timer = window.setInterval(() => {
    if (!root.isConnected) { stopRotation(); return; }
    if (_paused || document.hidden) return;
    show(_idx + 1, _idx + 1 <= last);
  }, INTERVAL_MS);
}

/** Dashboard teardown / new trip. */
export function resetJournalCarousel(): void { stopRotation(); _idx = 0; _paused = false; }

/** `get` is read at click time so the drawer reflects the latest entries. */
export function wireJournal(body: HTMLElement, get: () => { entries: StoredJournalEntry[]; legs: StoredLeg[] }): void {
  wireCarousel(body);
  body.querySelector<HTMLElement>('[data-journal-expand]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    void import('./journal-album-drawer.ts').then((m) => m.openJournalAlbumDrawer(e.currentTarget as HTMLElement));
  });
  body.querySelectorAll<HTMLElement>('[data-jr-place]').forEach((tile) => {
    tile.addEventListener('click', () => {
      const { entries, legs } = get();
      const g = buildPlaceGroups(entries, legs)[Number(tile.dataset.jrPlace)];
      if (g) openPlaceDrawer(g, tile);
    });
  });
  body.querySelectorAll<HTMLElement>('[data-jr-entry]').forEach((tile) => {
    tile.addEventListener('click', () => {
      const e = get().entries.find((x) => x.id === tile.dataset.jrEntry);
      if (e) openEntryDrawer(e, tile);
    });
  });
}

/* ==========================================================================
   On the Road · Dashboard — Journal card
   --------------------------------------------------------------------------
   Up to three square city thumbnails (name + entry count bottom-left, +N for
   further cities bottom-right). Tapping one opens that city's photos and
   entries in the side drawer. With no photos yet it falls back to the latest
   entries as rows. The write buttons open the real composer.

   Looking back at a day (time travel): the same card shows what was written on
   that day instead — one tile per entry (photo, or a mood/text tile) — and a
   quiet note when there was none. Same size either way.
   ========================================================================== */

import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { buildPlaceGroups, journalTiles, type PlaceGroup } from './journal-places.ts';
import { entryCover, entryImages, excerpt, moodEmoji, prettyDate, titleFor } from '../journal/shared/utils.ts';
import { entriesOn } from '../../data/as-of.ts';
import { openDrawer, closeDrawer } from '../../core/drawer.ts';
import { navigateTo } from '../../core/app.ts';
import { escHtml as esc, safeUrl } from '../../core/utils.ts';
import { t, getLocale } from '../../core/i18n.ts';

function entriesLabel(n: number): string {
  return n === 1 ? t('dash.journal.entry1') : t('dash.journal.entries', { n });
}

function renderTiles(groups: PlaceGroup[]): string {
  const { tiles, more } = journalTiles(groups);
  const single = groups.length === 1;
  const html = tiles.map((tile, i) => {
    const g = tile.group;
    const place = [g.flag, g.city].filter(Boolean).join(' ');
    const isLast = i === tiles.length - 1;
    return `
      <button type="button" class="jr-tile" data-jr-place="${groups.indexOf(g)}" aria-label="${esc(place)}">
        <img src="${esc(tile.image)}" alt="" loading="lazy" decoding="async">
        <span class="jr-shade"></span>
        <span class="jr-cap">
          ${place ? `<span class="jr-place">${esc(place)}</span>` : ''}
          ${!single || i === 0 ? `<span class="jr-sub">${esc(entriesLabel(g.entries.length))}</span>` : ''}
        </span>
        ${more > 0 && isLast ? `<span class="jr-more">+${more}</span>` : ''}
      </button>`;
  }).join('');
  return `<div class="jr-tiles">${html}</div>`;
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

const TILE_MAX = 3;

function renderDayTiles(day: StoredJournalEntry[], iso: string): string {
  if (!day.length) {
    const when = new Date(`${iso}T00:00:00`).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
    return `<div class="jr-day-empty">${esc(t('dash.journal.dayNone', { date: when }))}</div>`;
  }
  const shown = day.slice(0, TILE_MAX);
  const more = day.length - shown.length;
  const tiles = shown.map((e, i) => {
    const cover = safeUrl(entryCover(e));
    const title = e.title.trim() ? titleFor(e) : excerpt(e.body, 40) || titleFor(e);
    const face = cover
      ? `<img src="${cover}" alt="" loading="lazy" decoding="async">`
      : `<span class="jr-face"><span class="jr-face-emoji">${esc(moodEmoji(e.mood) || '📖')}</span><span class="jr-face-text">${esc(excerpt(e.body, 70))}</span></span>`;
    return `
      <button type="button" class="jr-tile" data-jr-entry="${esc(e.id)}" aria-label="${esc(title)}">
        ${face}
        <span class="jr-shade"></span>
        <span class="jr-cap"><span class="jr-place">${esc(title)}</span>${e.destination ? `<span class="jr-sub">${esc(e.destination)}</span>` : ''}</span>
        ${more > 0 && i === shown.length - 1 ? `<span class="jr-more">+${more}</span>` : ''}
      </button>`;
  }).join('');
  return `<div class="jr-tiles">${tiles}</div>`;
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
        <div class="td-widget-label">📔 ${esc(t('dash.widget.journal'))}${entries.length ? ` <span class="td-jq-count">${entries.length}</span>` : ''}</div>
        <button class="td-link" data-nav="journal">${esc(t('dash.link.allEntries'))}</button>
        <button type="button" class="td-plus" data-journal-new title="${esc(t('dash.journal.compose'))}" aria-label="${esc(t('dash.journal.compose'))}">+</button>
      </div>
      ${body}
      <button class="td-jq-btn btn btn-primary" data-journal-new>
        <span class="td-jq-icon">✍️</span>
        <span class="td-jq-label">${esc(t('dash.journal.compose'))}</span>
      </button>
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

/** `get` is read at click time so the drawer reflects the latest entries. */
export function wireJournal(body: HTMLElement, get: () => { entries: StoredJournalEntry[]; legs: StoredLeg[] }): void {
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

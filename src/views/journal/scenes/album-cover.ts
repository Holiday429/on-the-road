/* ==========================================================================
   On the Road · Journal albums — the printed cover
   --------------------------------------------------------------------------
   Four covers to choose between, after the magazines on a Japanese/Nordic
   newsstand. They differ in STRUCTURE, not in decoration, so a photo moved from
   one to another is genuinely re-laid-out rather than re-tinted:

     wordmark  the name set huge across the top, photo filling the rest
     masthead  a white band of titling above the photo, as a cover story
     banner    the name reversed out over a full-bleed photo, billings down one side
     frame     a wide paper margin with the photo held in the middle

   Pure markup over `JournalAlbumCover`; every field is optional and falls back
   to the album's own title and photos, so an album saved before covers existed
   prints the default and nothing has to be backfilled.
   ========================================================================== */

import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import type { JournalAlbumCover } from '../../../data/schema.ts';
import { escHtml } from '../shared/utils.ts';

export type CoverTemplate = JournalAlbumCover['template'];
export type CoverTone = JournalAlbumCover['tone'];

export const COVER_TEMPLATES: CoverTemplate[] = ['wordmark', 'masthead', 'banner', 'frame'];
export const COVER_TONES: CoverTone[] = ['paper', 'ink', 'amber', 'sky', 'sage', 'coral'];

/** The cover an album prints, with every default filled in. */
export function coverOf(album: StoredJournalAlbum): JournalAlbumCover {
  const c = album.cover;
  return {
    template: c?.template ?? 'wordmark',
    headline: (c?.headline ?? '').trim() || album.title,
    kicker: c?.kicker ?? '',
    lines: c?.lines ?? [],
    tone: c?.tone ?? 'paper',
    focalY: c?.focalY ?? 0.5,
  };
}

/**
 * The issue line a magazine carries: VOL.03 · SEP 2026.
 *
 * The volume is how many entries the album holds; the date is the month of its
 * newest entry, which is what the issue is "about".
 */
export function issueLine(count: number, newestIso: string, locale = 'en-US'): string {
  const vol = `VOL.${String(Math.max(1, count)).padStart(2, '0')}`;
  if (!newestIso) return vol;
  const d = new Date(`${newestIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return vol;
  return `${vol} · ${d.toLocaleDateString(locale, { month: 'short', year: 'numeric' }).toUpperCase()}`;
}

export interface CoverArt {
  /** The cover photo, or '' for a cover with no picture. */
  photo: string;
  /** How many entries the album holds. */
  count: number;
  /** ISO date of the newest entry, for the issue line. */
  newest: string;
  /** Headlines of a few entries, offered as the cover billings when none are set. */
  suggested: string[];
}

/**
 * One cover, at whatever size its container gives it.
 *
 * Everything inside is sized in `cqw` (percentages of the cover's own width), so
 * the same markup prints as a thumbnail on the shelf and as a full page when the
 * album is open, without a second set of styles.
 */
export function renderCover(cover: JournalAlbumCover, art: CoverArt, opts: { interactive?: boolean } = {}): string {
  const lines = (cover.lines.length ? cover.lines : art.suggested).filter(Boolean).slice(0, 3);
  const photo = art.photo
    ? `<img class="jc-photo" src="${escHtml(art.photo)}" alt="" loading="lazy" draggable="false" style="object-position:50% ${Math.round(cover.focalY * 100)}%">`
    : '<span class="jc-photo jc-photo--none" aria-hidden="true"></span>';
  const issue = issueLine(art.count, art.newest);
  const body = TEMPLATES[cover.template](cover, { photo, issue, lines });

  return `<div class="jc jc--${cover.template} jc-tone--${cover.tone}${opts.interactive ? ' is-interactive' : ''}">${body}</div>`;
}

interface Parts { photo: string; issue: string; lines: string[] }

const billings = (lines: string[]) => lines.length
  ? `<ul class="jc-lines">${lines.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul>`
  : '';

const TEMPLATES: Record<CoverTemplate, (c: JournalAlbumCover, p: Parts) => string> = {
  /** The name set huge across the top, the photo taking everything below it. */
  wordmark: (c, p) => `
    <div class="jc-top">
      ${c.kicker ? `<span class="jc-kicker">${escHtml(c.kicker)}</span>` : ''}
      <h3 class="jc-headline">${escHtml(c.headline)}</h3>
      <span class="jc-issue">${escHtml(p.issue)}</span>
    </div>
    <div class="jc-well">${p.photo}</div>
    ${billings(p.lines)}`,

  /** A white band of titling above the picture — the cover-story look. */
  masthead: (c, p) => `
    <div class="jc-band">
      <h3 class="jc-headline">${escHtml(c.headline)}</h3>
      <div class="jc-band-foot">
        <span class="jc-issue">${escHtml(p.issue)}</span>
        ${c.kicker ? `<span class="jc-kicker">${escHtml(c.kicker)}</span>` : ''}
      </div>
    </div>
    <div class="jc-well">${p.photo}${billings(p.lines)}</div>`,

  /** Full-bleed photo, the name reversed out of it, billings down one side. */
  banner: (c, p) => `
    <div class="jc-well jc-well--full">
      ${p.photo}
      <div class="jc-scrim" aria-hidden="true"></div>
      <h3 class="jc-headline">${escHtml(c.headline)}</h3>
      ${c.kicker ? `<span class="jc-kicker">${escHtml(c.kicker)}</span>` : ''}
      <span class="jc-issue">${escHtml(p.issue)}</span>
      ${billings(p.lines)}
    </div>`,

  /** A wide paper margin with the photo held in the middle of it. */
  frame: (c, p) => `
    <div class="jc-top">
      <h3 class="jc-headline">${escHtml(c.headline)}</h3>
      ${c.kicker ? `<span class="jc-kicker">${escHtml(c.kicker)}</span>` : ''}
    </div>
    <div class="jc-well">${p.photo}</div>
    <div class="jc-foot">
      <span class="jc-issue">${escHtml(p.issue)}</span>
      ${billings(p.lines)}
    </div>`,
};

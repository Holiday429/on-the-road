/* ==========================================================================
   On the Road · Dashboard — journal widget
   --------------------------------------------------------------------------
   A photo carousel of the trip's places (see journal-places.ts) with the
   "write an entry" button pinned underneath. Falls back to the latest entries
   as rows when nothing has a photo yet.

   The dashboard re-renders wholesale on every store change, so the carousel's
   position lives here (not in the DOM) and the timer re-attaches on each wire —
   a Firestore tick or a weather fetch must not snap the slide back to #1.
   ========================================================================== */

import type { StoredLeg } from '../../data/stores/route-store.ts';
import type { StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { buildPlaceSlides, type PlaceSlide } from './journal-places.ts';
import { entryCover, excerpt, moodEmoji, prettyDate, titleFor } from '../journal/shared/utils.ts';
import { escHtml as esc } from '../../core/utils.ts';
import { t } from '../../core/i18n.ts';

const INTERVAL_MS = 4500;
let _idx = 0;
let _timer: number | undefined;
let _paused = false;

function stop(): void {
  if (_timer !== undefined) { window.clearInterval(_timer); _timer = undefined; }
}

function range(s: PlaceSlide): string {
  return s.from === s.to ? prettyDate(s.from) : `${prettyDate(s.from)} – ${prettyDate(s.to)}`;
}

function renderSlides(slides: PlaceSlide[]): string {
  const idx = Math.min(_idx, slides.length - 1);
  const slide = (s: PlaceSlide, i: number) => {
    // Only the visible slide and the next one get a real src up front; the rest
    // load as the carousel reaches them, so a trip of 8 cities isn't 8 downloads.
    const near = i === idx || i === (idx + 1) % slides.length;
    const place = [s.flag, s.city].filter(Boolean).join(' ');
    const sub = s.count > 1
      ? `${t('dash.journal.entries', { n: s.count })} · ${range(s)}`
      : range(s);
    return `
      <button type="button" class="jr-slide${i === idx ? ' is-active' : ''}" data-nav="journal" aria-hidden="${i === idx ? 'false' : 'true'}" tabindex="${i === idx ? '0' : '-1'}">
        <img ${near ? `src="${esc(s.image)}"` : `data-src="${esc(s.image)}"`} alt="" decoding="async">
        <span class="jr-shade"></span>
        <span class="jr-cap">
          ${place ? `<span class="jr-place">${esc(place)}</span>` : ''}
          <span class="jr-sub">${esc(sub)}</span>
        </span>
      </button>`;
  };
  const dots = slides.length > 1
    ? `<div class="jr-dots">${slides.map((_, i) => `<button type="button" class="jr-dot${i === idx ? ' is-active' : ''}" data-jr-dot="${i}" aria-label="${i + 1}"></button>`).join('')}</div>`
    : '';
  return `<div class="jr-carousel" data-jr>${slides.map(slide).join('')}${dots}</div>`;
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

export function renderJournalWidget(entries: StoredJournalEntry[], legs: StoredLeg[]): string {
  const slides = buildPlaceSlides(entries, legs);
  return `
    <div class="td-widget td-w-journal" data-widget-id="journal">
      <div class="td-widget-header">
        <div class="td-widget-label">📔 ${esc(t('dash.widget.journal'))}${entries.length ? ` <span class="td-jq-count">${entries.length}</span>` : ''}</div>
        <button class="td-link" data-nav="journal">${esc(t('dash.link.allEntries'))}</button>
      </div>
      ${slides.length ? renderSlides(slides) : renderRecentRows(entries)}
      <button class="td-jq-btn btn btn-primary" data-journal-new>
        <span class="td-jq-icon">✍️</span>
        <span class="td-jq-label">${esc(t('dash.journal.compose'))}</span>
      </button>
    </div>`;
}

/** Attach dot clicks, hover-pause and the auto-advance timer to the fresh DOM. */
export function wireJournalAlbum(body: HTMLElement): void {
  stop();
  const root = body.querySelector<HTMLElement>('[data-jr]');
  if (!root) return;
  const slides = [...root.querySelectorAll<HTMLElement>('.jr-slide')];
  const dots = [...root.querySelectorAll<HTMLElement>('.jr-dot')];
  if (!slides.length) return;

  const load = (i: number) => {
    const img = slides[i]?.querySelector<HTMLImageElement>('img[data-src]');
    if (img) { img.src = img.dataset.src!; img.removeAttribute('data-src'); }
  };
  const show = (i: number) => {
    _idx = (i + slides.length) % slides.length;
    slides.forEach((s, n) => {
      const on = n === _idx;
      s.classList.toggle('is-active', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
      s.tabIndex = on ? 0 : -1;
    });
    dots.forEach((d, n) => d.classList.toggle('is-active', n === _idx));
    load(_idx); load((_idx + 1) % slides.length);
  };

  dots.forEach((d) => d.addEventListener('click', (e) => { e.stopPropagation(); show(Number(d.dataset.jrDot)); }));
  root.addEventListener('mouseenter', () => { _paused = true; });
  root.addEventListener('mouseleave', () => { _paused = false; });
  root.addEventListener('focusin', () => { _paused = true; });
  root.addEventListener('focusout', () => { _paused = false; });

  // Respect reduced motion: no auto-advance (dots still work).
  if (slides.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  _timer = window.setInterval(() => {
    // The dashboard re-renders wholesale and may be off-screen: stop once our
    // carousel is no longer the live one.
    if (!root.isConnected) { stop(); return; }
    if (_paused || document.hidden) return;
    show(_idx + 1);
  }, INTERVAL_MS);
}

/** Dashboard teardown / new trip. */
export function resetJournalAlbum(): void { stop(); _idx = 0; _paused = false; }

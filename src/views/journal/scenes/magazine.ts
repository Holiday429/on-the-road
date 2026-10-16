/* ==========================================================================
   On the Road · Journal magazine — the open book (markup)
   --------------------------------------------------------------------------
   An album, opened. Every page is drawn in a fixed 600 × 800 box and the whole
   spread (1200 × 800) is scaled to the screen with one number, so what was
   measured when the book was paginated is exactly what is shown, at any size.
   On a phone one page is shown at a time.

   Nothing on a page is a control. Back, design cover, rename, delete and the
   page count are a bar ABOVE the book; the arrows are on its edges. The cover
   appears once, as the first page. Articles are printed in full — there is
   nothing to open.

   Pure markup over a finished Book (magazine-book.ts). The scale and the
   one-or-two-pages mode are measured from the screen after drawing
   (syncMagazineView) and remembered here between draws.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { t } from '../../../core/i18n.ts';
import { escHtml } from '../shared/utils.ts';
import { coverOf, issueLine, renderCover } from './album-cover.ts';
import { bookTone, coverArtOf } from './albums.ts';
import type { Book } from './magazine-book.ts';
import {
  BODY_H, BODY_W, MARGIN, PAGE_H, PAGE_W, TOC_PER_PAGE, bodyLeft, folioOf, sideOf, spreadIdx, spreadIndexOf,
  type Leaf, type ViewMode,
} from './magazine-model.ts';
import type { Page } from './magazine-paginate.ts';
import { headHtml, textClass, textHtml } from './magazine-text.ts';
import { columnsOf } from './magazine-measure.ts';
import '../styles/album-cover.css';

export interface MagazineState {
  /** Leaf (physical page) being looked at: 0 is the cover. */
  leaf: number;
  /** Flips each turn so the fade restarts. */
  turn: boolean;
  dir: '' | 'next' | 'prev';
}

/* ── Fitting the book to the screen ──────────────────────────────────────── */

const view: { mode: ViewMode; k: number } = { mode: 'spread', k: 0.6 };

export const currentMode = (): ViewMode => view.mode;

/** A phone-width desk shows one page; anything wider shows the spread. */
const SINGLE_BELOW = 760;

/**
 * Measure the desk and set the scale. Returns true if the one-or-two-pages
 * mode changed, in which case the caller draws again.
 */
export function syncMagazineView(root: ParentNode): boolean {
  const fit = root.querySelector<HTMLElement>('.mag-fit');
  if (!fit) return false;
  const width = fit.clientWidth;
  if (!width) return false;
  const mode: ViewMode = width < SINGLE_BELOW ? 'single' : 'spread';
  const across = mode === 'single' ? PAGE_W : PAGE_W * 2;
  const room = Math.max(360, window.innerHeight - fit.getBoundingClientRect().top - 28);
  const k = Math.max(0.2, Math.min(width / across, room / PAGE_H));
  view.k = k;
  fit.style.setProperty('--k', String(k));
  const changed = mode !== view.mode;
  view.mode = mode;
  return changed;
}

/* ── Leaves ──────────────────────────────────────────────────────────────── */

const px = (n: number) => `${Math.round(n * 100) / 100}px`;
const box = (b: { x: number; y: number; w: number; h?: number }) =>
  `left:${px(b.x)};top:${px(b.y)};width:${px(b.w)}${b.h != null ? `;height:${px(b.h)}` : ''}`;

function pageBody(page: Page, book: Book, folio: number): string {
  const article = book.articles.find((a) => a.id === page.articleId)!;
  const text = book.texts[page.articleId] ?? '';
  return `
    ${page.photos.map((p) => `
      <figure class="mag-photo" style="${box(p)}">
        <img src="${escHtml(p.photo.src)}" alt="${escHtml(article.headline)}" loading="lazy" draggable="false">
      </figure>`).join('')}
    ${page.head ? `<div class="mag-head${page.head.size === 'l' ? ' is-l' : ''}" style="${box(page.head)}">${headHtml(article)}</div>` : ''}
    ${page.frames.map((f) => `
      <div class="${textClass(f)}" style="${box(f)};columns:${columnsOf(f.cols)}">${textHtml(text.slice(f.from, f.to), f)}</div>`).join('')}
    ${page.continues ? `<span class="mag-cont">${escHtml(t('journal.mag.continued', { n: folio + 1 }))}</span>` : ''}`;
}

function contentsBody(book: Book, part: number): string {
  const rows = book.toc.slice(part * TOC_PER_PAGE, (part + 1) * TOC_PER_PAGE);
  return `
    <h2 class="mag-toc-title">${escHtml(t('journal.mag.contents'))}</h2>
    <ol class="mag-toc">
      ${rows.map((r) => `
        <li class="mag-toc-row">
          <span class="mag-toc-text">
            <span class="mag-kicker">${escHtml(r.kicker)}</span>
            <span class="mag-toc-head">${escHtml(r.headline)}</span>
          </span>
          <span class="mag-dots" aria-hidden="true"></span>
          <span class="mag-toc-no">${r.folio}</span>
        </li>`).join('')}
    </ol>`;
}

function leafHtml(leaf: Leaf | null, index: number | null, album: StoredJournalAlbum, entries: StoredJournalEntry[], book: Book): string {
  if (!leaf || index === null) return `<div class="mag-page is-void" aria-hidden="true"></div>`;
  const side = sideOf(index);
  const cls = `mag-page is-${side}`;
  const folio = folioOf(index);

  if (leaf.kind === 'cover') {
    return `<section class="${cls} is-cover" aria-label="${escHtml(album.title)}"><div class="mag-cover">${renderCover(coverOf(album), coverArtOf(album, entries))}</div></section>`;
  }
  if (leaf.kind === 'back') {
    const cover = coverOf(album);
    const art = coverArtOf(album, entries);
    return `
      <section class="${cls} is-back jc-tone--${cover.tone}">
        <div class="mag-back">
          <span class="mag-back-name">On the Road</span>
          <span class="mag-back-title">${escHtml(cover.headline)}</span>
          <span class="mag-back-issue">${escHtml(issueLine(art.count, art.newest))}</span>
        </div>
      </section>`;
  }
  const inner = leaf.kind === 'toc' ? contentsBody(book, leaf.part) : pageBody(book.pages[leaf.page], book, folio);
  return `
    <section class="${cls}">
      <div class="mag-body" style="left:${bodyLeft(side)}px;top:${MARGIN.top}px;width:${BODY_W}px;height:${BODY_H}px">${inner}</div>
      <span class="mag-folio">${folio}</span>
    </section>`;
}

/* ── The desk ────────────────────────────────────────────────────────────── */

function bar(album: StoredJournalAlbum, position: string): string {
  return `
    <div class="mag-bar">
      <button class="jb-chip" data-album-back type="button">← ${escHtml(t('journal.view.albums'))}</button>
      <span class="mag-bar-title">${escHtml(album.emoji)} ${escHtml(album.title)}</span>
      <div class="mag-bar-tools">
        <button class="jb-chip" data-album-cover="${escHtml(album.id)}" type="button">${escHtml(t('journal.cover.design'))}</button>
        <button class="jb-chip" data-album-rename="${escHtml(album.id)}" type="button">${escHtml(t('journal.cover.rename'))}</button>
        <button class="jb-chip is-danger" data-album-delete="${escHtml(album.id)}" type="button">${escHtml(t('journal.cover.deleteAlbum'))}</button>
      </div>
      <span class="mag-bar-pos">${escHtml(position)}</span>
    </div>`;
}

/**
 * The album as a magazine. `book` is undefined while it is still being bound
 * (waiting for fonts and photo shapes), which shows a binding state instead.
 */
export function renderMagazine(
  album: StoredJournalAlbum,
  entries: StoredJournalEntry[],
  book: Book | undefined,
  s: MagazineState,
): string {
  if (!book) {
    return `
      <div class="mag-desk" tabindex="0" data-book-keys>
        ${bar(album, '')}
        <div class="mag-fit" style="--k:${view.k}">
          <div class="mag-binding" role="status">${escHtml(t('journal.mag.binding'))}</div>
        </div>
      </div>`;
  }

  const count = book.leaves.length;
  const at = Math.max(0, Math.min(count - 1, s.leaf));
  const spreads = spreadIdx(count);
  const single = view.mode === 'single';
  const shown: Array<number | null> = single ? [at] : spreads[spreadIndexOf(at, count)];
  const first = shown.find((i): i is number => i !== null) ?? 0;
  const last = [...shown].reverse().find((i): i is number => i !== null) ?? 0;
  const position = `${folioOf(first)}${last !== first ? `–${folioOf(last)}` : ''} / ${count}`;
  const fade = s.dir ? ` is-fade-${s.turn ? 'a' : 'b'}` : '';
  const atStart = single ? at === 0 : spreadIndexOf(at, count) === 0;
  const atEnd = single ? at >= count - 1 : spreadIndexOf(at, count) >= spreads.length - 1;

  return `
    <div class="mag-desk" tabindex="0" data-book-keys data-tone="${bookTone(album.id)}">
      ${bar(album, position)}
      <div class="mag-fit" data-mode="${view.mode}" style="--k:${view.k};--across:${single ? PAGE_W : PAGE_W * 2}">
        <div class="mag-stage">
          <div class="mag-spread${fade}" style="width:${single ? PAGE_W : PAGE_W * 2}px;height:${PAGE_H}px">
            ${shown.map((i) => leafHtml(i === null ? null : book.leaves[i], i, album, entries, book)).join('')}
          </div>
          <button class="mag-turn mag-turn--prev" data-album-page="prev" type="button" aria-label="${escHtml(t('journal.mag.prev'))}" ${atStart ? 'disabled' : ''}>‹</button>
          <button class="mag-turn mag-turn--next" data-album-page="next" type="button" aria-label="${escHtml(t('journal.mag.next'))}" ${atEnd ? 'disabled' : ''}>›</button>
        </div>
      </div>
      ${entries.length === 0 ? `<p class="jb-empty-note">${escHtml(t('journal.album.empty'))}</p>` : ''}
    </div>`;
}

/* ==========================================================================
   On the Road · Journal magazine — measuring in the browser
   --------------------------------------------------------------------------
   The real `Measurer`: a hidden element with exactly the CSS of a printed text
   frame (the same classes, from styles/magazine.css, and the same markup from
   magazine-text.ts), grown one binary-search step at a time until the text
   just fits. Nothing is estimated from a character count — fonts, Chinese and
   Latin mixed, drop caps and column breaks all come out as they will print.

   It must not start before the fonts are in (a swap would reflow everything),
   nor before each photograph's shape is known (the photo's height decides how
   much room the words get) — loadBook waits for both, and caches the result in
   memory by the book's key so turning pages never measures again.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';
import { entryImages } from '../shared/utils.ts';
import { measureMissing, ratioFor } from '../shared/ratio-cache.ts';
import { toArticle } from './magazine-model.ts';
import { headHtml, textClass, textHtml } from './magazine-text.ts';
import { assembleBook, bookKeyOf, type Book } from './magazine-book.ts';
import type { Measurer } from './magazine-paginate.ts';

/**
 * `columns: 1` is still a multicolumn box: text that does not fit then runs off to a
 * second column on the right instead of overflowing downwards, and a height check would
 * wrongly say it fits. One column is therefore no `columns` at all.
 */
/** The least area one character can take in a printed frame, px². */
export const FRAME_PX_PER_CHAR = 90;

export const columnsOf = (cols: 1 | 2): string => (cols > 1 ? '2' : 'auto');

export interface DomMeasurer extends Measurer { dispose(): void }

export function createDomMeasurer(): DomMeasurer {
  const host = document.createElement('div');
  host.className = 'mag-measure';
  host.setAttribute('aria-hidden', 'true');
  const textEl = document.createElement('div');
  const headEl = document.createElement('div');
  const quoteEl = document.createElement('blockquote');
  host.append(textEl, headEl, quoteEl);
  document.body.appendChild(host);

  return {
    fit(text, f) {
      textEl.className = textClass(f);
      textEl.style.cssText = `width:${f.w}px;height:${f.h}px;columns:${columnsOf(f.cols)}`;
      const fits = (n: number) => {
        // eslint-disable-next-line no-restricted-syntax -- audited: textHtml escapes every character of the traveller's text
        textEl.innerHTML = textHtml(text.slice(0, n));
        return f.cols > 1 ? textEl.scrollWidth <= textEl.clientWidth + 1 : textEl.scrollHeight <= textEl.clientHeight + 1;
      };
      // No frame holds more characters than its area allows (even narrow Latin letters take ~90 px²
      // at this size), so the search never has to set — and lay out — thousands of characters
      // that cannot fit. Capping errs only toward a page with a little less on it, never an overflow.
      const cap = Math.min(text.length, Math.ceil((f.w * f.h) / FRAME_PX_PER_CHAR));
      if (fits(cap)) return cap;
      let lo = 0;
      let hi = cap;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(mid)) lo = mid; else hi = mid - 1;
      }
      return lo;
    },
    quote(text, w) {
      quoteEl.className = 'mag-quote';
      quoteEl.style.cssText = `width:${w}px`;
      quoteEl.textContent = text;
      return Math.ceil(quoteEl.offsetHeight);
    },
    head(a, w, size) {
      headEl.className = `mag-head${size === 'l' ? ' is-l' : ''}`;
      headEl.style.cssText = `width:${w}px`;
      // eslint-disable-next-line no-restricted-syntax -- audited: headHtml escapes
      headEl.innerHTML = headHtml(a);
      return Math.ceil(headEl.offsetHeight);
    },
    dispose() { host.remove(); },
  };
}

/* ── Loading ─────────────────────────────────────────────────────────────── */

const books = new Map<string, Book>();
const pending = new Set<string>();

export function cachedBook(album: StoredJournalAlbum, entries: StoredJournalEntry[]): Book | undefined {
  return books.get(bookKeyOf(album.id, entries));
}

export function bookIsLoading(album: StoredJournalAlbum, entries: StoredJournalEntry[]): boolean {
  return pending.has(bookKeyOf(album.id, entries));
}

/** The fonts the page is set in, loaded — `document.fonts.ready` alone resolves before a face nobody has used yet is asked for. */
async function fontsReady(): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) return;
  try {
    await Promise.all([fonts.load('15px "Newsreader"'), fonts.load('600 38px "Newsreader"'), fonts.load('11px "JetBrains Mono"')]);
    await fonts.ready;
  } catch { /* a font that will not load falls back to the system serif; measure with that */ }
}

/**
 * Build (once) the book for an album. Resolves with it; a second call for the
 * same entries while the first is running resolves with undefined — the caller
 * repaints when the first finishes.
 */
export async function loadBook(
  album: StoredJournalAlbum,
  entries: StoredJournalEntry[],
  write?: (entryId: string, ratios: number[]) => Promise<unknown>,
): Promise<Book | undefined> {
  const key = bookKeyOf(album.id, entries);
  const have = books.get(key);
  if (have) return have;
  if (pending.has(key)) return undefined;
  pending.add(key);
  try {
    await fontsReady();
    await measureMissing(entries, { write });
    const articles = entries.map((e) => toArticle(e, entryImages(e).map((_, i) => ratioFor(e, i))));
    const m = createDomMeasurer();
    try {
      const book = assembleBook(articles, m, album.id, key);
      books.set(key, book);
      return book;
    } finally {
      m.dispose();
    }
  } finally {
    pending.delete(key);
  }
}

/** For tests. */
export function resetBooks(): void { books.clear(); pending.clear(); }

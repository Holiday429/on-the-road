/* ==========================================================================
   On the Road · Journal magazine — the finished book (pure)
   --------------------------------------------------------------------------
   Paginate every article, write the contents from the result, bind the leaves.
   The measurer is passed in, so this is testable end to end with a fake one;
   magazine-measure.ts supplies the real one.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import { articleText, bindLeaves, type Article, type Leaf } from './magazine-model.ts';
import { contentsOf, paginateBook, type Measurer, type Page, type TocRow } from './magazine-paginate.ts';

export interface Book {
  /** What the book was made from: albumId + each entry's id and last change. */
  key: string;
  articles: Article[];
  /** Each article's full text, by id — pages hold character ranges into these. */
  texts: Record<string, string>;
  pages: Page[];
  toc: TocRow[];
  leaves: Leaf[];
}

/** Same key, same book: it only changes when an entry is added, removed, reordered or edited. */
export function bookKeyOf(albumId: string, entries: Array<Pick<StoredJournalEntry, 'id' | 'updatedAt'>>): string {
  return `${albumId}|${entries.map((e) => `${e.id}:${e.updatedAt}`).join(',')}`;
}

export function assembleBook(articles: Article[], m: Measurer, albumId: string, key: string): Book {
  const { pages, firstPage } = paginateBook(articles, m, albumId);
  return {
    key, articles, pages,
    texts: Object.fromEntries(articles.map((a) => [a.id, articleText(a)])),
    toc: contentsOf(articles, firstPage),
    leaves: bindLeaves(pages.length, articles.length),
  };
}

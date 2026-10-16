/**
 * @vitest-environment jsdom
 *
 * The open book's structure: what is on a page and what is not.
 */
import { describe, expect, it } from 'vitest';
import { renderMagazine } from './magazine.ts';
import { assembleBook } from './magazine-book.ts';
import { article, fakeMeasurer, photo } from './magazine-test-kit.ts';

const album: any = { id: 'alb', title: 'Brussels', emoji: '🧇', entryIds: [], coverEntryId: null, cover: undefined };
const entry = (id: string): any => ({
  id, title: `T${id}`, body: 'x', destination: 'Brussels', happenedOn: '2026-07-14', images: ['a.jpg'], tags: [], updatedAt: 1,
});

function open(leaf: number, articles = [article({ chars: 2600, photos: [photo('3:2'), photo('3:4', 1)] }), article({ chars: 200 })]) {
  const book = assembleBook(articles, fakeMeasurer(), 'alb', 'k');
  const host = document.createElement('div');
  // eslint-disable-next-line no-restricted-syntax -- audited: fixture markup under test
  host.innerHTML = renderMagazine(album, [entry('a'), entry('b')], book, { leaf, turn: false, dir: '' });
  return { host, book };
}

describe('renderMagazine', () => {
  it('shows a binding state until the book is ready', () => {
    const host = document.createElement('div');
    // eslint-disable-next-line no-restricted-syntax -- audited: fixture
    host.innerHTML = renderMagazine(album, [], undefined, { leaf: 0, turn: false, dir: '' });
    expect(host.querySelector('.mag-binding')).toBeTruthy();
    expect(host.querySelector('.mag-page')).toBeNull();
  });

  it('puts every control above the book, and none on a page', () => {
    const { host } = open(1);
    for (const sel of ['[data-album-back]', '[data-album-cover]', '[data-album-rename]', '[data-album-delete]']) {
      expect(host.querySelector(`.mag-bar ${sel}`), sel).toBeTruthy();
      expect(host.querySelector(`.mag-page ${sel}`), `${sel} on a page`).toBeNull();
    }
    expect(host.querySelector('.mag-page button, .mag-page a, .mag-page [role="button"], .mag-page [data-open-entry]')).toBeNull();
  });

  it('opens on the cover alone on the right, and the cover appears exactly once in the book', () => {
    const { host, book } = open(0);
    expect(host.querySelectorAll('.mag-page')).toHaveLength(2);
    expect(host.querySelector('.is-void')).toBeTruthy();
    expect(host.querySelectorAll('.jc')).toHaveLength(1);
    for (let i = 1; i < book.leaves.length; i++) expect(open(i).host.querySelector('.jc'), `leaf ${i}`).toBeNull();
  });

  it('next opens the contents facing the first page, with true page numbers', () => {
    const { host, book } = open(1);
    expect(host.querySelector('.mag-toc')).toBeTruthy();
    const nums = [...host.querySelectorAll('.mag-toc-no')].map((n) => Number(n.textContent));
    expect(nums).toEqual(book.toc.map((r) => r.folio));
    expect(host.querySelector('.mag-page.is-recto .mag-head, .mag-page.is-recto .mag-text')).toBeTruthy();
  });

  it('prints the words of an article in full across its pages: nothing is left to open', () => {
    const a = article({ chars: 2600 });
    const book = assembleBook([a], fakeMeasurer(), 'alb', 'k');
    let printed = '';
    for (let i = 1; i < book.leaves.length; i += 2) {
      const host = document.createElement('div');
      // eslint-disable-next-line no-restricted-syntax -- audited: fixture
      host.innerHTML = renderMagazine(album, [entry('a')], book, { leaf: i, turn: false, dir: '' });
      printed += [...host.querySelectorAll('.mag-text')].map((n) => n.textContent).join('');
    }
    expect(printed.replace(/\s/g, '')).toBe(a.paragraphs.join('').replace(/\s/g, ''));
  });

  it('ends on the back cover, alone on the left, with ‹ available and › not', () => {
    const { host, book } = open(99);
    expect(host.querySelector('.is-back')).toBeTruthy();
    expect(host.querySelectorAll('.mag-page')).toHaveLength(2);
    expect(host.querySelector<HTMLButtonElement>('[data-album-page="next"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-album-page="prev"]')!.disabled).toBe(false);
    expect(host.querySelector('.mag-bar-pos')!.textContent).toBe(`${book.leaves.length} / ${book.leaves.length}`);
  });

  it('says where a page runs on, on the side away from its page number', () => {
    const { host } = open(2);
    const cont = host.querySelector('.mag-cont');
    expect(cont?.textContent).toContain('4');
  });

  it('escapes what the traveller typed', () => {
    const a = article({ headline: '<img src=x onerror=1>', paragraphs: ['<b>hi</b>'], photos: [photo('3:2')] });
    const book = assembleBook([a], fakeMeasurer(), 'alb', 'k');
    const host = document.createElement('div');
    // eslint-disable-next-line no-restricted-syntax -- audited: fixture
    host.innerHTML = renderMagazine(album, [entry('a')], book, { leaf: 2, turn: false, dir: '' });
    expect(host.querySelector('.mag-page .mag-headline img')).toBeNull();
    expect(host.querySelector('.mag-text b')).toBeNull();
  });

  it('sets a caption under a photograph, and a running head at the top of every article page', () => {
    const { host } = open(2);
    expect(host.querySelector('.mag-cap')?.textContent).toBe('Test · 06 SEP 2026');
    expect(host.querySelector('.mag-run')?.textContent).toContain('Brussels');
    const withCountry = document.createElement('div');
    const book = assembleBook([article({ chars: 200 })], fakeMeasurer(), 'alb', 'k');
    // eslint-disable-next-line no-restricted-syntax -- audited: fixture markup under test
    withCountry.innerHTML = renderMagazine(album, [entry('a')], book, { leaf: 2, turn: false, dir: '' }, { [book.articles[0].id]: 'Belgium' });
    expect(withCountry.querySelector('.mag-run')?.textContent).toBe('Brussels · Belgium');
    expect(open(1).host.querySelector('.mag-toc')!.closest('.mag-page')!.querySelector('.mag-run')).toBeNull();
  });

  it('prints a pulled quotation once, between two blocks of the piece', () => {
    const a = article({ chars: 5200, quote: '这是一句值得放大的话，它来自文章的中间。' });
    const book = assembleBook([a], fakeMeasurer(), 'alb', 'k');
    let quotes = 0;
    for (let i = 1; i < book.leaves.length; i += 2) {
      const host = document.createElement('div');
      // eslint-disable-next-line no-restricted-syntax -- audited: fixture
      host.innerHTML = renderMagazine(album, [entry('a')], book, { leaf: i, turn: false, dir: '' });
      quotes += host.querySelectorAll('.mag-quote').length;
    }
    expect(quotes).toBe(1);
  });

  it('begins the next article under the last, with a rule, on the same page — and the contents agree', () => {
    const book = assembleBook([article({ chars: 260 }), article({ chars: 1200 })], fakeMeasurer(), 'alb', 'k');
    const shared = book.pages.findIndex((p) => p.tail);
    expect(shared).toBeGreaterThanOrEqual(0);
    const leaf = 1 + 1 + shared;                                  // cover, contents, then the pages
    const host = document.createElement('div');
    // eslint-disable-next-line no-restricted-syntax -- audited: fixture
    host.innerHTML = renderMagazine(album, [entry('a'), entry('b')], book, { leaf, turn: false, dir: '' });
    expect(host.querySelector('.mag-rule')).toBeTruthy();
    expect(host.querySelectorAll('.mag-headline')).toHaveLength(2);
    expect(book.toc[1].folio).toBe(book.toc[0].folio);
  });

  it('prints a plate: a dark page with one picture to the edges and a caption', () => {
    const photos = [photo('3:2', 0), photo('3:2', 1), photo('3:2', 2)];
    // which page shape is chosen among the fitting ones depends on the album's id: take one that gives a plate
    const books = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => assembleBook([article({ chars: 0, paragraphs: [], photos })], fakeMeasurer(), id, 'k'));
    const book = books.find((b) => b.pages.some((p) => p.plate))!;
    expect(book).toBeTruthy();
    const plates = book.pages.map((p, i) => (p.plate ? i : -1)).filter((i) => i >= 0);
    const host = document.createElement('div');
    // eslint-disable-next-line no-restricted-syntax -- audited: fixture
    host.innerHTML = renderMagazine(album, [entry('a')], book, { leaf: 2 + plates[0], turn: false, dir: '' });
    expect(host.querySelector('.is-plate .mag-photo.is-bleed')).toBeTruthy();
  });
});

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
});

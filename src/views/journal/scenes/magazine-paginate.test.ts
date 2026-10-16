import { describe, expect, it } from 'vitest';
import { article, fakeMeasurer, photo } from './magazine-test-kit.ts';
import { adjustCut, contentsOf, paginateArticle, paginateBook, TAIL_MIN } from './magazine-paginate.ts';
import { articleText, BODY_H, BODY_W } from './magazine-model.ts';
import { assembleBook } from './magazine-book.ts';
import { TEMPLATES } from './magazine-templates.ts';

const m = fakeMeasurer();

/** Everything printed on a run of pages, in order. */
const printed = (a: ReturnType<typeof article>) => {
  const pages = paginateArticle(a, m);
  const text = articleText(a);
  return { pages, text, got: pages.flatMap((p) => p.frames).map((f) => text.slice(f.from, f.to)).join('') };
};

describe('paginateArticle — the words', () => {
  it('prints every word of a long article, in order, across as many pages as it takes', () => {
    const a = article({ chars: 3600 });
    const { pages, text, got } = printed(a);
    expect(pages.length).toBeGreaterThan(3);
    expect(got.replace(/\n/g, '')).toBe(text.replace(/\n/g, ''));
  });

  it('fits every frame: no frame is asked to hold more than the measurer said fits', () => {
    const a = article({ chars: 3000, photos: [photo('3:2'), photo('3:4', 1)] });
    for (const page of paginateArticle(a, m)) {
      for (const f of page.frames) {
        const n = f.to - f.from;
        expect(n).toBeLessThanOrEqual(m.fit(articleText(a).slice(f.from), { w: f.w, h: f.h, cols: f.cols, dropcap: f.dropcap, continued: f.continued }) + 0);
      }
    }
  });

  it('starts on an opener and carries on as plain word pages when there are no photographs', () => {
    const { pages } = printed(article({ chars: 2400 }));
    expect(pages[0].template).toBe('opener-text');
    expect(pages[0].first).toBe(true);
    expect(pages.slice(1).every((p) => p.template === 'text-2col')).toBe(true);
    expect(pages.slice(0, -1).every((p) => p.continues)).toBe(true);
    expect(pages[pages.length - 1].continues).toBe(false);
  });

  it('is a single page for a short note, and a single page for an empty one', () => {
    expect(paginateArticle(article({ chars: 80 }), m)).toHaveLength(1);
    const empty = paginateArticle(article({ paragraphs: [] }), m);
    expect(empty).toHaveLength(1);
    expect(empty[0].head).toBeTruthy();
    expect(empty[0].frames).toEqual([]);
  });

  it('sets a drop cap on the first frame only, and marks a page that begins mid-paragraph', () => {
    const { pages } = printed(article({ chars: 2400 }));
    const frames = pages.flatMap((p) => p.frames);
    expect(frames.filter((f) => f.dropcap)).toHaveLength(1);
    expect(frames[0].dropcap).toBe(true);
    expect(frames[0].from).toBe(0);
    expect(frames.slice(1).some((f) => f.continued)).toBe(true);
  });

  it('never lets a page begin with a closing mark or full stop', () => {
    const a = article({ paragraphs: ['字'.repeat(3000).replace(/(.{40})/g, '$1。')] });
    const text = articleText(a);
    for (const f of paginateArticle(a, m).flatMap((p) => p.frames).slice(1)) {
      expect('。，、；：？！）」”'.includes(text[f.from]), `page starts with ${text[f.from]}`).toBe(false);
    }
  });
});

describe('adjustCut', () => {
  it('leaves a cut that is already fine, and returns the length for text that fits', () => {
    expect(adjustCut('abcdef', 3, false)).toBe(3);
    expect(adjustCut('abc', 10, false)).toBe(3);
  });

  it('pulls a full stop back so it is not the first thing on the next page', () => {
    const text = '一二三四五。六七八九十';
    expect(adjustCut(text, 5, false)).toBe(4);          // the 五 goes over with its 。
  });

  it('does not end a page on an opening quote', () => {
    expect(adjustCut('一二三“四五六', 4, false)).toBe(3);
  });

  it('does not split a Latin word when there is a space to fall back to', () => {
    expect(adjustCut('the quick brown fox jumps', 12, false)).toBe(10);     // "the quick " | "brown…"
  });

  it('leaves the next page more than a stray line to read', () => {
    const text = 'x'.repeat(200);
    const c = adjustCut(text, 195, true);
    expect(text.length - c).toBeGreaterThanOrEqual(TAIL_MIN);
  });

  it('keeps going if the text is shorter than the minimum tail', () => {
    expect(adjustCut('x'.repeat(20), 15, true)).toBeGreaterThanOrEqual(1);
  });
});

describe('paginateArticle — the photographs', () => {
  it('chooses the opener by the first photograph: wide, tall, or none', () => {
    expect(paginateArticle(article({ chars: 300, photos: [photo('3:2')] }), m)[0].template).toBe('opener-land');
    expect(paginateArticle(article({ chars: 300, photos: [photo('16:9')] }), m)[0].template).toBe('opener-land');
    expect(paginateArticle(article({ chars: 300, photos: [photo('3:4')] }), m)[0].template).toBe('opener-port');
    expect(paginateArticle(article({ chars: 300, photos: [photo('2:3')] }), m)[0].template).toBe('opener-port');
    expect(paginateArticle(article({ chars: 300 }), m)[0].template).toBe('opener-text');
  });

  it('places every photograph, however many and whatever order — even with no words at all', () => {
    const photos = [photo('3:2', 0), photo('3:4', 1), photo('16:9', 2), photo('2:3', 3), photo('4:3', 4), photo('3:4', 5), photo('3:4', 6)];
    for (const chars of [0, 200, 3000]) {
      const pages = paginateArticle(article({ chars, photos }), m);
      expect(pages.flatMap((p) => p.photos.map((x) => x.photo.src)).sort(), `chars=${chars}`).toEqual(photos.map((p) => p.src).sort());
    }
  });

  it('keeps each photograph the shape it is: height follows from width and its own ratio', () => {
    const photos = [photo('3:2', 0), photo('3:4', 1), photo('16:9', 2), photo('2:3', 3), photo('4:3', 4)];
    for (const page of paginateArticle(article({ chars: 2500, photos }), m)) {
      for (const p of page.photos) {
        const r = p.w / p.h;
        const want = { '3:2': 1.5, '3:4': 0.75, '16:9': 16 / 9, '2:3': 2 / 3, '4:3': 4 / 3 }[p.photo.ratio as string]!;
        // a page may trim a very tall picture a few percent, never turn it into another orientation
        expect(Math.sign(Math.log(r)), p.photo.src).toBe(Math.sign(Math.log(want)));
        expect(Math.abs(Math.log(r / want)), p.photo.src).toBeLessThan(0.12);
      }
    }
  });

  it('keeps everything inside the body box', () => {
    const photos = [photo('3:2', 0), photo('3:4', 1), photo('16:9', 2), photo('2:3', 3), photo('2:3', 4), photo('9:16', 5)];
    for (const page of paginateArticle(article({ chars: 2500, photos }), m)) {
      const boxes = [...page.photos, ...page.frames, ...(page.head ? [page.head] : [])];
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(BODY_W + 0.5);
        expect(b.y + b.h).toBeLessThanOrEqual(BODY_H + 0.5);
      }
    }
  });

  it('pairs photographs only when they are the same shape', () => {
    const t = TEMPLATES['photo-pair'];
    expect(t.take([photo('3:4'), photo('3:4')], true)).toBe(2);
    expect(t.take([photo('3:4'), photo('2:3')], true)).toBe(1);
    expect(t.take([photo('3:2'), photo('16:9')], true)).toBe(1);
    expect(t.take([photo('3:2')], true)).toBe(1);
  });

  it('with no words left, any two photographs share a page', () => {
    const t = TEMPLATES['photo-pair'];
    expect(t.take([photo('3:4'), photo('3:2')], false)).toBe(2);
    expect(t.take([photo('3:2'), photo('16:9'), photo('3:4')], false)).toBe(2);
  });

  it('puts two portraits side by side and two landscapes one above the other', () => {
    const t = TEMPLATES['photo-pair'];
    const head = () => 0;
    const side = t.layout({ photos: [photo('3:4'), photo('3:4', 1)], headHeight: head, textRemains: true });
    expect(side.photos[0].y).toBe(side.photos[1].y);
    expect(side.photos[1].x).toBeGreaterThan(side.photos[0].x);
    const stacked = t.layout({ photos: [photo('3:2'), photo('3:2', 1)], headHeight: head, textRemains: true });
    expect(stacked.photos[1].y).toBeGreaterThan(stacked.photos[0].y);
    expect(stacked.photos[1].x).toBe(stacked.photos[0].x);
  });

  it('alternates picture pages and word pages, and never repeats a template twice running when it has a choice', () => {
    const photos = Array.from({ length: 6 }, (_, i) => photo('3:2', i));
    const pages = paginateArticle(article({ chars: 4500, photos }), m);
    for (let i = 1; i < pages.length; i++) {
      const a = pages[i - 1].template;
      const b = pages[i].template;
      if (pages[i - 1].continues && pages[i].photos.length === 0 && pages[i - 1].photos.length === 0) continue;   // only words left to set
      expect(a === b && pages[i].photos.length > 0, `pages ${i - 1},${i}: ${a},${b}`).toBe(false);
    }
  });

  it('lets a mix of orientations through without losing any', () => {
    const photos = [photo('3:4', 0), photo('3:2', 1), photo('3:4', 2), photo('3:2', 3)];
    const got = paginateArticle(article({ chars: 600, photos }), m).flatMap((p) => p.photos.map((x) => x.photo.src));
    expect(got).toHaveLength(4);
  });
});

describe('the book', () => {
  const articles = [
    article({ chars: 3000, photos: [photo('3:2', 0), photo('3:4', 1)] }),
    article({ chars: 150 }),
    article({ chars: 0, photos: [photo('3:4', 2)] }),
    article({ chars: 2000, photos: [photo('16:9', 3), photo('2:3', 4), photo('2:3', 5)] }),
  ];

  it('the contents quote the real page number of every article — the page its opener is printed on', () => {
    const book = assembleBook(articles, m, 'alb', 'k');
    expect(book.toc).toHaveLength(articles.length);
    for (const row of book.toc) {
      const leafIndex = row.folio - 1;                      // folio = leaf index + 1
      const leaf = book.leaves[leafIndex];
      expect(leaf.kind).toBe('page');
      const page = book.pages[(leaf as { page: number }).page];
      expect(page.articleId).toBe(row.articleId);
      expect(page.first, `article ${row.articleId} starts there`).toBe(true);
    }
  });

  it('the first article starts after the cover and the contents', () => {
    const book = assembleBook(articles, m, 'alb', 'k');
    expect(book.toc[0].folio).toBe(3);                      // cover 1, contents 2, first page 3
  });

  it('with more than a page of contents, every page number moves along with it', () => {
    const many = Array.from({ length: 14 }, () => article({ chars: 100 }));
    const book = assembleBook(many, m, 'alb', 'k');
    expect(book.leaves.filter((l) => l.kind === 'toc')).toHaveLength(2);
    expect(book.toc[0].folio).toBe(4);
    for (const row of book.toc) {
      const leaf = book.leaves[row.folio - 1];
      expect(leaf.kind === 'page' && book.pages[leaf.page].articleId === row.articleId).toBe(true);
    }
  });

  it('is cover, contents, pages, back — and an empty album is cover, contents, back', () => {
    const book = assembleBook(articles, m, 'alb', 'k');
    expect(book.leaves[0].kind).toBe('cover');
    expect(book.leaves[1].kind).toBe('toc');
    expect(book.leaves[book.leaves.length - 1].kind).toBe('back');
    expect(assembleBook([], m, 'alb', 'k').leaves.map((l) => l.kind)).toEqual(['cover', 'toc', 'back']);
  });

  it('paginates the same way every time, whatever the order of calls', () => {
    const a = JSON.stringify(paginateBook(articles, m, 'alb'));
    paginateBook([articles[0]], m, 'other');
    expect(JSON.stringify(paginateBook(articles, m, 'alb'))).toBe(a);
  });

  it('every article starts on a page of its own', () => {
    const { pages, firstPage } = paginateBook(articles, m, 'alb');
    for (const i of firstPage) expect(pages[i].first).toBe(true);
    expect(pages.filter((p) => p.first)).toHaveLength(articles.length);
  });

  it('contentsOf matches the assembled book', () => {
    const { firstPage } = paginateBook(articles, m, 'alb');
    expect(contentsOf(articles, firstPage)).toEqual(assembleBook(articles, m, 'alb', 'k').toc);
  });
});

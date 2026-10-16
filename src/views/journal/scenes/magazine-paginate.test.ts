import { describe, expect, it } from 'vitest';
import { article, fakeMeasurer, photo } from './magazine-test-kit.ts';
import { adjustCut, contentsOf, paginateArticle, paginateBook, SHORT_NOTE, TAIL_MIN } from './magazine-paginate.ts';
import { articleText, BODY_H, BODY_W } from './magazine-model.ts';
import { assembleBook } from './magazine-book.ts';
import { textClass, textHtml } from './magazine-text.ts';
import { justify, pictureCount, TEMPLATES } from './magazine-templates.ts';

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
        expect(n).toBeLessThanOrEqual(m.fit(articleText(a).slice(f.from), { w: f.w, h: f.h, cols: f.cols, lead: f.lead }) + 0);
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

  it('sets no drop cap and no indent: the markup and the frames carry neither', () => {
    const { pages } = printed(article({ chars: 2400 }));
    for (const f of pages.flatMap((p) => p.frames)) expect(Object.keys(f)).not.toContain('dropcap');
    expect(textHtml('一段。\n二段。')).toBe('<p>一段。</p><p>二段。</p>');
    expect(textClass({})).toBe('mag-text');
  });

  it('sets a very short note large, in one column, and a longer one in two', () => {
    const [short] = paginateArticle(article({ chars: 100 }), m);
    expect(short.frames[0].lead).toBe(true);
    expect(short.frames[0].cols).toBe(1);
    const [longer] = paginateArticle(article({ chars: SHORT_NOTE + 200 }), m);
    expect(longer.frames[0].lead).toBe(false);
    expect(longer.frames[0].cols).toBe(2);
    // a note with a picture is not "short": it has its opener
    expect(paginateArticle(article({ chars: 100, photos: [photo('3:2')] }), m)[0].frames.every((f) => !f.lead)).toBe(true);
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
    const ctx = { headHeight: () => 0, quoteHeight: () => 0, parity: 0 as const };
    const side = t.layout({ photos: [photo('3:4'), photo('3:4', 1)], ...ctx, textRemains: true });
    expect(side.photos[0].y).toBe(side.photos[1].y);
    expect(side.photos[1].x).toBeGreaterThan(side.photos[0].x);
    const stacked = t.layout({ photos: [photo('3:2'), photo('3:2', 1)], ...ctx, textRemains: true });
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
      expect(page.first && page.articleId === row.articleId, `article ${row.articleId} starts there`).toBe(true);
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
      expect(leaf.kind === 'page' && book.pages[leaf.page].first && book.pages[leaf.page].articleId === row.articleId).toBe(true);
    }
  });

  it('is cover, contents, pages, back — and an empty album is cover, contents, back', () => {
    const book = assembleBook(articles, m, 'alb', 'k');
    expect(book.leaves[0].kind).toBe('cover');
    expect(book.leaves[1].kind).toBe('toc');
    expect(book.leaves[book.leaves.length - 1].kind).toBe('back');
    expect(assembleBook([], m, 'alb', 'k').leaves.map((l) => l.kind)).toEqual(['cover', 'toc', 'back']);
  });

  it('always binds the back cover onto a right-hand page with something facing it, whatever the page count', () => {
    for (let n = 0; n < 9; n++) {
      const many = Array.from({ length: n }, () => article({ chars: 100 }));
      const book = assembleBook(many, m, 'alb', 'k');
      const last = book.leaves.length - 1;
      expect(last % 2, `${n} articles`).toBe(0);                                 // even index: a recto
      expect(book.leaves[last].kind).toBe('back');
      expect(book.leaves[last - 1].kind).not.toBe('back');                        // and a page faces it
      expect(book.leaves.filter((l) => l.kind === 'colophon').length).toBeLessThanOrEqual(1);
    }
  });

  it('paginates the same way every time, whatever the order of calls', () => {
    const a = JSON.stringify(paginateBook(articles, m, 'alb'));
    paginateBook([articles[0]], m, 'other');
    expect(JSON.stringify(paginateBook(articles, m, 'alb'))).toBe(a);
  });

  it('every article starts on a page of its own: no page ever holds two notes', () => {
    const { pages, firstPage } = paginateBook(articles, m, 'alb');
    articles.forEach((a, i) => { expect(pages[firstPage[i]].first && pages[firstPage[i]].articleId === a.id, a.id).toBe(true); });
    expect(pages.filter((p) => p.first)).toHaveLength(articles.length);
    // each page belongs to one article, and an article's pages are consecutive
    const order = pages.map((p) => p.articleId);
    expect(order.join()).toBe([...order].sort((x, y) => order.indexOf(x) - order.indexOf(y)).join());
  });

  it('contentsOf matches the assembled book', () => {
    const { firstPage } = paginateBook(articles, m, 'alb');
    expect(contentsOf(articles, firstPage)).toEqual(assembleBook(articles, m, 'alb', 'k').toc);
  });
});


describe('pages of pictures with no words left', () => {
  const ph = (...ratios: Array<'3:2' | '3:4' | '16:9' | '2:3' | '4:3'>) => ratios.map((r, i) => photo(r, i));

  it('justify keeps every picture its own shape, inside the width, and scales down to the height', () => {
    const photos = ph('3:4', '3:4', '3:4', '3:2');
    const j = justify(photos, BODY_W, BODY_H - 18);
    expect(j.boxes).toHaveLength(4);
    j.boxes.forEach((b, i) => {
      const want = { '3:4': 0.75, '3:2': 1.5 }[photos[i].ratio as string]!;
      expect(Math.abs(Math.log(b.w / b.h / want))).toBeLessThan(0.03);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(BODY_W + 1);
      expect(b.y + b.h).toBeLessThanOrEqual(BODY_H - 18 + 1);
    });
    expect(j.height).toBeLessThanOrEqual(BODY_H - 18);
  });

  it('four photographs from the owner\'s screenshot (3 tall, 1 wide) go on one page and fill most of it', () => {
    const photos = ph('3:4', '3:4', '3:4', '3:2');
    expect(pictureCount(photos)).toBe(4);
    const pages = paginateArticle(article({ chars: 0, paragraphs: [], photos }), m);
    const last = pages[pages.length - 1];
    expect(last.photos.length).toBeGreaterThanOrEqual(3);
    const bottom = Math.max(...last.photos.map((p) => p.y + p.h));
    expect(bottom).toBeGreaterThan(BODY_H * 0.55);
  });

  it('does not leave a lone picture for the next page when the count can be shared out', () => {
    expect(pictureCount(ph('3:2', '3:2', '3:2', '3:2', '3:2'))).toBe(3);
    expect(pictureCount(ph('3:2', '3:2'))).toBe(2);
    expect(pictureCount(ph('3:2'))).toBe(1);
  });

  it('centres the pictures on the page rather than hanging them from the top', () => {
    const pages = paginateArticle(article({ chars: 0, paragraphs: [], photos: ph('3:4', '3:4') }), m);
    const p = pages[pages.length - 1];
    const top = Math.min(...p.photos.map((x) => x.y));
    const bottom = Math.max(...p.photos.map((x) => x.y + x.h));
    expect(top).toBeGreaterThan(0);
    expect(Math.abs(top - (BODY_H - 18 - bottom))).toBeLessThanOrEqual(2);
  });
});

describe('the other page shapes', () => {
  const landscapes = (n: number) => Array.from({ length: n }, (_, i) => photo('3:2', i));
  const portraits = (n: number) => Array.from({ length: n }, (_, i) => photo('3:4', i));
  const pagesOf = (a: ReturnType<typeof article>) => paginateArticle(a, m, 'alb');
  /** The pages of that shape this article gets in any of a handful of albums — which shape a page takes among the fitting ones is chosen by the album's id. */
  const withTemplate = (a: ReturnType<typeof article>, id: string) =>
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].flatMap((album) => paginateArticle(a, m, album).filter((p) => p.template === id));

  it('sets three or four photographs of one orientation together as a grid', () => {
    for (const photos of [landscapes(4), landscapes(3), portraits(4), portraits(3)]) {
      const grids = withTemplate(article({ chars: 3000, photos: [photo('3:2', 9), ...photos] }), 'grid');
      expect(grids.length, photos.length + photos[0].orient).toBeGreaterThanOrEqual(1);
      expect(grids[0].photos.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('only grids when words follow: with none left the pictures are set together as rows instead', () => {
    expect(TEMPLATES.grid.applies(portraits(3), false)).toBe(false);
    expect(TEMPLATES.grid.applies(portraits(3), true)).toBe(true);
  });

  it('never grids photographs of mixed orientation', () => {
    const mixed = [photo('3:2', 0), photo('3:4', 1), photo('3:2', 2), photo('3:4', 3), photo('3:2', 4)];
    expect(withTemplate(article({ chars: 0, paragraphs: [], photos: mixed }), 'grid')).toHaveLength(0);
  });

  it('a row of tall pictures is a row, not squares: each stays tall', () => {
    const [g] = withTemplate(article({ chars: 3000, photos: [photo('3:2', 9), ...portraits(4)] }), 'grid');
    expect(g).toBeTruthy();
    for (const p of g.photos) expect(p.h).toBeGreaterThan(p.w);
  });

  it('puts a wide picture across a whole dark page only when there are no words left to set', () => {
    const plates = withTemplate(article({ chars: 0, paragraphs: [], photos: landscapes(5) }), 'full-bleed');
    expect(plates.length).toBeGreaterThanOrEqual(1);
    expect(plates[0].plate).toBe(true);
    expect(plates[0].photos[0].bleed).toBe(true);
    expect(plates[0].photos[0].w).toBe(600);
    expect(plates[0].frames).toEqual([]);
    expect(pagesOf(article({ chars: 3000, photos: landscapes(2) })).filter((p) => p.template === 'full-bleed' && p.frames.length)).toHaveLength(0);
  });

  it('sets a tall picture beside the words, alternating sides', () => {
    const a = article({ chars: 6000, photos: [photo('3:2', 0), ...portraits(3)] });
    const sides = withTemplate(a, 'photo-side-text').map((p) => p.photos[0].x);
    expect(sides.length).toBeGreaterThanOrEqual(1);
    for (const p of withTemplate(a, 'photo-side-text')) {
      expect(p.frames.length).toBeGreaterThanOrEqual(1);
      // the words and the picture never share a column's space
      for (const f of p.frames) {
        const overlapX = f.x < p.photos[0].x + p.photos[0].w && p.photos[0].x < f.x + f.w;
        const overlapY = f.y < p.photos[0].y + p.photos[0].h && p.photos[0].y < f.y + f.h;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('pulls one quotation from a long piece, once, between two blocks of its text', () => {
    const a = article({ chars: 5000, quote: '这是一句值得放大的话，它来自文章的中间。' });
    const pages = pagesOf(a).filter((p) => p.quote);
    expect(pages).toHaveLength(1);
    expect(pages[0].template).toBe('pull-quote');
    expect(pages[0].frames).toHaveLength(2);
    const [above, below] = pages[0].frames;
    expect(above.y + above.h).toBeLessThanOrEqual(pages[0].quote!.y);
    expect(below.y).toBeGreaterThanOrEqual(pages[0].quote!.y + pages[0].quote!.h);
  });

  it('pulls nothing from a short piece or one with no good sentence', () => {
    expect(pagesOf(article({ chars: 600, quote: 'x'.repeat(30) })).some((p) => p.quote)).toBe(false);
    expect(pagesOf(article({ chars: 5000, quote: null })).some((p) => p.quote)).toBe(false);
  });

  it('captions every picture page, inside the page', () => {
    const photos = [photo('3:2', 0), photo('3:4', 1), photo('16:9', 2), ...portraits(3), photo('4:3', 8)];
    for (const page of pagesOf(article({ chars: 2500, photos }))) {
      if (!page.photos.length) continue;
      expect(page.captions.length, page.template).toBeGreaterThanOrEqual(1);
      for (const c of page.captions) expect(c.y).toBeLessThanOrEqual(BODY_H);
    }
  });

  it('still places every photograph and every word, whatever mix', () => {
    const photos = [photo('3:2', 0), ...portraits(3), ...landscapes(4).map((p, i) => ({ ...p, src: `l${i}.jpg` })), photo('2:3', 20), photo('16:9', 21)];
    for (const chars of [0, 300, 4000]) {
      const a = article({ chars, photos, quote: chars > 3000 ? '一句二十个字以上的引文放在这里这里这里这里。' : null });
      const pages = pagesOf(a);
      expect(pages.flatMap((p) => p.photos.map((x) => x.photo.src)).sort(), `photos, chars=${chars}`).toEqual(photos.map((p) => p.src).sort());
      const text = articleText(a);
      expect(pages.flatMap((p) => p.frames).map((f) => text.slice(f.from, f.to)).join('').replace(/\n/g, ''), `words, chars=${chars}`).toBe(text.replace(/\n/g, ''));
    }
  });

  it('keeps every box inside the body (a bleed picture inside the page)', () => {
    const photos = [photo('3:2', 0), ...portraits(4), ...landscapes(4).map((p, i) => ({ ...p, src: `l${i}.jpg` }))];
    for (const page of pagesOf(article({ chars: 3000, photos, quote: '一句二十个字以上的引文放在这里这里这里这里。' }))) {
      for (const b of [...page.photos.filter((p) => !p.bleed), ...page.frames, ...(page.head ? [page.head] : []), ...(page.quote ? [page.quote] : [])]) {
        expect(b.x, page.template).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.w, page.template).toBeLessThanOrEqual(BODY_W + 0.5);
        expect(b.y + b.h, page.template).toBeLessThanOrEqual(BODY_H + 0.5);
      }
    }
  });
});


describe('a big album', () => {
  it('paginates 80 articles of every kind in well under a second, and loses nothing', () => {
    const shapes = ['3:2', '3:4', '16:9', '2:3', '4:3'] as const;
    const many = Array.from({ length: 80 }, (_, i) => article({
      chars: [0, 150, 900, 3600][i % 4],
      photos: Array.from({ length: (i * 5) % 7 }, (_, k) => photo(shapes[(i + k) % 5], i * 10 + k)),
    }));
    const t0 = performance.now();
    const book = assembleBook(many, m, 'big', 'k');
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(book.toc).toHaveLength(80);
    // every photograph is on some page, once
    const placed = book.pages.flatMap((p) => p.photos.map((x) => x.photo.src));
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length).toBe(many.reduce((n, a) => n + a.photos.length, 0));
  });
});

import { describe, expect, it } from 'vitest';
import {
  bindLeaves, bodyLeft, captionOf, headlineOf, kickerOf, pickQuote, sideOf, spreadIdx, spreadIndexOf, toArticle, tocPageCount, turnTo, BODY_W, MARGIN, PAGE_W,
} from './magazine-model.ts';
import { bookKeyOf } from './magazine-book.ts';

describe('the page', () => {
  it('is 600 wide: two margins and a body of 496', () => {
    expect(MARGIN.outer + BODY_W + MARGIN.inner).toBe(PAGE_W);
  });
  it('has the wider margin on the gutter side', () => {
    expect(bodyLeft('verso')).toBe(MARGIN.outer);
    expect(bodyLeft('recto')).toBe(MARGIN.inner);
  });
  it('cover is a right-hand page, then they alternate', () => {
    expect([0, 1, 2, 3].map(sideOf)).toEqual(['recto', 'verso', 'recto', 'verso']);
  });
});

describe('toArticle', () => {
  const entry = (over: Record<string, unknown> = {}): any => ({
    id: 'e1', title: 'Nyhavn', body: 'One.\n\nTwo.\nThree.', destination: 'Copenhagen', happenedOn: '2026-09-06', mood: 'calm',
    images: ['a.jpg', 'b.jpg', 'c.jpg'], ...over,
  });

  it('splits the body into paragraphs and drops the empty ones', () => {
    expect(toArticle(entry(), []).paragraphs).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('writes the kicker as the day, month and place', () => {
    expect(kickerOf(entry())).toBe('06 SEP · COPENHAGEN');
    expect(kickerOf(entry({ destination: '' }))).toBe('06 SEP');
  });

  it('gives each photo its shape class and orientation; an unmeasured one is wide', () => {
    const a = toArticle(entry(), [0.75, 1.78, undefined]);
    expect(a.photos.map((p) => [p.ratio, p.orient])).toEqual([['3:4', 'portrait'], ['16:9', 'landscape'], ['3:2', 'landscape']]);
  });

  it('headlines with the title, else the first line, else the place; a Chinese body is cut, not dumped whole', () => {
    expect(headlineOf({ title: 'T', body: 'b', destination: 'd' })).toBe('T');
    expect(headlineOf({ title: '', body: 'First line\nmore', destination: 'd' })).toBe('First line');
    expect(headlineOf({ title: '', body: '', destination: 'Rome' })).toBe('Rome');
    const cut = headlineOf({ title: '', body: '字'.repeat(200), destination: '' });
    expect(cut.length).toBe(30);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('binding', () => {
  it('is cover, contents, pages, back', () => {
    expect(bindLeaves(3, 2).map((l) => l.kind)).toEqual(['cover', 'toc', 'page', 'page', 'page', 'back']);
  });
  it('gives a long list of articles a second contents page', () => {
    expect(tocPageCount(0)).toBe(1);
    expect(tocPageCount(12)).toBe(1);
    expect(tocPageCount(13)).toBe(2);
  });

  it('spreads: the cover alone on the right, pages paired, the back alone on the left', () => {
    // cover, toc, p, p, p, back  (6 leaves)
    expect(spreadIdx(6)).toEqual([[null, 0], [1, 2], [3, 4], [5, null]]);
    expect(spreadIdx(7)).toEqual([[null, 0], [1, 2], [3, 4], [5, null], [6, null]]);
    expect(spreadIdx(1)).toEqual([[null, 0]]);
    expect(spreadIdx(0)).toEqual([]);
  });

  it('finds the spread a leaf is on', () => {
    expect(spreadIndexOf(0, 7)).toBe(0);
    expect(spreadIndexOf(2, 7)).toBe(1);
    expect(spreadIndexOf(3, 7)).toBe(2);
    expect(spreadIndexOf(6, 7)).toBe(4);
  });
});

describe('turnTo', () => {
  it('turns a spread at a time, landing on its first leaf', () => {
    expect(turnTo(0, 1, 8, 'spread')).toBe(1);
    expect(turnTo(1, 1, 8, 'spread')).toBe(3);
    expect(turnTo(4, 1, 8, 'spread')).toBe(5);
    expect(turnTo(3, -1, 8, 'spread')).toBe(1);
    expect(turnTo(1, -1, 8, 'spread')).toBe(0);
  });
  it('turns a leaf at a time on a phone', () => {
    expect(turnTo(2, 1, 8, 'single')).toBe(3);
    expect(turnTo(2, -1, 8, 'single')).toBe(1);
  });
  it('stops at the ends', () => {
    expect(turnTo(0, -1, 8, 'spread')).toBe(0);
    expect(turnTo(7, 1, 8, 'spread')).toBe(7);
    expect(turnTo(7, 1, 8, 'single')).toBe(7);
    expect(turnTo(0, -1, 8, 'single')).toBe(0);
  });
});

describe('bookKeyOf', () => {
  it('changes when an entry is edited, added or reordered, and not otherwise', () => {
    const a = [{ id: 'a', updatedAt: 1 }, { id: 'b', updatedAt: 2 }];
    expect(bookKeyOf('x', a)).toBe(bookKeyOf('x', [...a]));
    expect(bookKeyOf('x', a)).not.toBe(bookKeyOf('x', [a[0], { id: 'b', updatedAt: 3 }]));
    expect(bookKeyOf('x', a)).not.toBe(bookKeyOf('x', [a[1], a[0]]));
    expect(bookKeyOf('x', a)).not.toBe(bookKeyOf('y', a));
  });
});

describe('captionOf', () => {
  it('names the place and the day', () => {
    expect(captionOf({ destination: 'Brussels', happenedOn: '2026-07-14' })).toBe('Brussels · 14 JUL 2026');
    expect(captionOf({ destination: '', happenedOn: '2026-07-14' })).toBe('14 JUL 2026');
  });
});

describe('pickQuote', () => {
  const para = (s: string) => s.repeat(1);
  const filler = '字'.repeat(180) + '。';

  it('pulls a whole sentence of 20–60 characters ending in a stop', () => {
    const q = '一路走来，我才明白旅行最奢侈的东西其实是没有计划的下午。';
    const out = pickQuote([filler, filler, para(q), filler]);
    expect(out).toBe(q);
    expect(out!.length).toBeGreaterThanOrEqual(20);
    expect(out!.length).toBeLessThanOrEqual(60);
  });

  it('pulls nothing from a short piece, or one with no sentence of the right length', () => {
    expect(pickQuote(['很短的一段。'])).toBeNull();
    expect(pickQuote([filler, filler, filler])).toBeNull();
  });

  it('prefers the middle of the piece to its opening', () => {
    const a = '开头的这句话是二十个字以上的一个句子，放在文章最前面。';
    const b = '中间的这句话也是二十个字以上的一个句子，放在文章中部。';
    expect(pickQuote([a, filler, filler, b, filler, filler, filler])).toBe(b);
  });

  it('does not pull half a quotation', () => {
    const half = '她说：“这里是我见过最安静的地方，真的是这样。';
    expect(pickQuote([filler, filler, half, filler])).toBeNull();
  });

  it('works on Latin sentences too, and is the same every time', () => {
    const q = 'It was the quietest square I had ever stood in, and I stayed.';
    const text = ['Lorem ipsum dolor sit amet. '.repeat(20), q + ' ' + 'x'.repeat(10), 'Lorem ipsum dolor sit amet. '.repeat(20)];
    expect(pickQuote(text)).toBe(pickQuote(text));
  });
});

import { describe, expect, it } from 'vitest';
import {
  bindLeaves, bodyLeft, headlineOf, kickerOf, sideOf, spreadIdx, spreadIndexOf, toArticle, tocPageCount, turnTo, BODY_W, MARGIN, PAGE_W,
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

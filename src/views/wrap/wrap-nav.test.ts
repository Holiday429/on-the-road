import { describe, expect, it } from 'vitest';
import { chapterKeyTarget, currentChapter } from './wrap-nav.ts';

const VH = 800;
// Three chapters of one window each, scrolled so chapter 1 sits at the top.
const at = (scrollY: number, heights = [800, 800, 800]) => {
  let y = -scrollY;
  return heights.map((h) => { const r = { top: y, bottom: y + h }; y += h; return r; });
};

describe('currentChapter', () => {
  it('is the chapter filling the upper-middle of the window', () => {
    expect(currentChapter(at(0), VH)).toBe(0);
    expect(currentChapter(at(800), VH)).toBe(1);
    expect(currentChapter(at(700), VH)).toBe(1);   // chapter 0 has only 100px left, chapter 1 owns the window
    expect(currentChapter(at(400), VH)).toBe(0);
  });
  it('falls back to the last chapter below the end', () => {
    expect(currentChapter(at(5000), VH)).toBe(2);
  });
});

describe('chapterKeyTarget', () => {
  it('↓ goes to the next chapter, ↑ to the previous', () => {
    expect(chapterKeyTarget('ArrowDown', at(0), VH)).toBe(1);
    expect(chapterKeyTarget('ArrowUp', at(1600), VH)).toBe(1);
  });
  it('nothing past either end', () => {
    expect(chapterKeyTarget('ArrowDown', at(1600), VH)).toBeNull();
    expect(chapterKeyTarget('ArrowUp', at(0), VH)).toBeNull();
  });
  it('a tall chapter scrolls natively until its edge is reached', () => {
    const tall = [1600, 800];
    expect(chapterKeyTarget('ArrowDown', at(0, tall), VH)).toBeNull();      // bottom still off screen
    expect(chapterKeyTarget('ArrowDown', at(800, tall), VH)).toBe(1);       // bottom now at the window's edge
    expect(chapterKeyTarget('ArrowUp', at(400, [1600, 800]), VH)).toBeNull(); // top is above the window
  });
  it('a chapter a little taller than the window (page header above it) still counts as in view', () => {
    expect(chapterKeyTarget('ArrowDown', at(-60), VH)).toBe(1);
  });
  it('other keys and an empty page are left alone', () => {
    expect(chapterKeyTarget('PageDown', at(0), VH)).toBeNull();
    expect(chapterKeyTarget('ArrowDown', [], VH)).toBeNull();
  });
});

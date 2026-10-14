import { describe, expect, it } from 'vitest';
import { CLIP_SLOTS, FLOOR_BAGS, clipLines, floorBags, renderSwitcher } from './prepare-scenes.ts';
import type { PackSceneBag } from './pack-section.ts';

const lines = (n: number, left = n) =>
  clipLines(Array.from({ length: Math.min(n, 9) }, (_, i) => ({ text: `t${i}`, done: false })), left);
const count = (html: string) => (html.match(/class="prep-clip-row/g) ?? []).length;

describe('the clipboard has a fixed number of lines', () => {
  it('is always CLIP_SLOTS lines, whatever the list holds', () => {
    for (const n of [0, 1, 3, 4, 5, 9, 40]) expect(count(lines(n))).toBe(CLIP_SLOTS);
  });

  it('turns the last line into "+N more" only when something does not fit', () => {
    expect(lines(4)).not.toContain('is-more');
    const html = lines(9);
    expect(html).toContain('is-more');
    expect(html).toContain('t2');          // three real lines
    expect(html).not.toContain('t3');
  });
});

describe('the floor', () => {
  const bag = (id: string, weightG: number): PackSceneBag => ({
    id, label: id, kind: 'suitcase', weightG, limitG: 0, over: false, loadPct: 0, tone: 0, size: 'M',
  });

  it('shows every bag up to the limit', () => {
    const bags = [bag('a', 1), bag('b', 2), bag('c', 3)];
    expect(floorBags(bags)).toEqual({ shown: bags, hidden: 0 });
  });

  it('beyond it keeps the heaviest, in list order, and counts the rest', () => {
    const bags = [bag('a', 10), bag('b', 500), bag('c', 20), bag('d', 400), bag('e', 300)];
    const { shown, hidden } = floorBags(bags);
    expect(shown.map(b => b.id)).toEqual(['b', 'd', 'e']);
    expect(shown).toHaveLength(FLOOR_BAGS);
    expect(hidden).toBe(2);
  });
});

describe('the switcher', () => {
  it('only exists when there is somewhere to switch to', () => {
    expect(renderSwitcher('cl', 'A', 0, 1)).toBe('');
    expect(renderSwitcher('cl', '<A>', 1, 3)).toContain('2/3');
    expect(renderSwitcher('cl', '<A>', 1, 3)).toContain('&lt;A&gt;');
  });
});

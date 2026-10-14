import { describe, expect, it } from 'vitest';
import { GRID_COLS, orientation, planFeed, tiltFor } from './feed-plan.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';

let n = 0;
function entry(over: Partial<StoredJournalEntry> = {}): StoredJournalEntry {
  n++;
  return {
    id: `e${n}`, createdAt: 1, updatedAt: 1, schemaVersion: 1, tripId: null, title: '', body: '', template: 'moment',
    destination: '', tags: [], happenedOn: '2026-06-01', favorite: false, visibility: 'private', slug: '', images: [],
    ...over,
  } as StoredJournalEntry;
}
const photo = (ratio: number, over: Partial<StoredJournalEntry> = {}) => entry({ images: ['https://x/a.jpg'], imageRatio: ratio, ...over });

describe('feed plan', () => {
  it('reads photo shape: portrait, landscape, otherwise square', () => {
    expect(orientation(0.7)).toBe('portrait');
    expect(orientation(1.6)).toBe('landscape');
    expect(orientation(1)).toBe('square');
    expect(orientation(undefined)).toBe('square');
  });

  it('the first photo entry leads as the cover story, and the next photo fills the slot beside it', () => {
    const blocks = planFeed([photo(1.5), photo(0.7), photo(1)]);
    expect(blocks[0].kind).toBe('hero');
    expect(blocks[0].variant).toBe('cover');
    expect(blocks[0].tilt).toBe(0);
    // the portrait photo takes the two-column strip beside the cover: a tall polaroid, exactly
    expect(blocks[1]).toMatchObject({ kind: 'tall', cols: 2, rows: 3 });
  });

  it('words only: long text becomes a pull-quote, short text a ticket', () => {
    const [q, t] = planFeed([entry({ body: 'x'.repeat(200) }), entry({ body: 'tram 28' })]);
    expect(q.kind).toBe('quote');
    expect(['note', 'quote']).toContain(t.kind);
    expect(t.hasPhoto).toBe(false);
    expect(q.hasPhoto).toBe(false);
  });

  it('wide photo blocks are dressed as postcards, covers as covers', () => {
    const blocks = planFeed([photo(1), photo(1.6), photo(1.6), photo(1.6)]);
    for (const b of blocks) {
      if (b.kind === 'wide') expect(b.variant).toBe('postcard');
      if (b.kind === 'hero') expect(b.variant).toBe('cover');
    }
    expect(blocks[0].variant).toBe('cover');
  });

  it('a cover story is never followed straight away by another', () => {
    const kinds = planFeed(Array.from({ length: 20 }, () => photo(1.6))).map((b) => b.kind);
    for (let i = 1; i < kinds.length; i++) expect(kinds[i - 1] === 'hero' && kinds[i] === 'hero').toBe(false);
    expect(kinds.filter((k) => k === 'hero').length).toBeGreaterThanOrEqual(2);
  });

  it('tilt is stable per id and small', () => {
    expect(tiltFor('abc')).toBe(tiltFor('abc'));
    for (const id of ['a', 'bb', 'ccc', 'dddd']) expect(Math.abs(tiltFor(id))).toBeLessThanOrEqual(1.4);
  });
});

describe('feed layout fills the page', () => {
  /** Re-place the blocks the way a dense grid does and count the empty cells inside the used area. */
  function holes(list: ReturnType<typeof planFeed>): number {
    const grid: boolean[][] = [];
    for (const b of list) {
      let placed = false;
      for (let r = 0; !placed; r++) {
        for (let c = 0; c + b.cols <= GRID_COLS && !placed; c++) {
          let free = true;
          for (let y = r; y < r + b.rows && free; y++) for (let x = c; x < c + b.cols; x++) if (grid[y]?.[x]) { free = false; break; }
          if (!free) continue;
          for (let y = r; y < r + b.rows; y++) { grid[y] ??= Array(GRID_COLS).fill(false); for (let x = c; x < c + b.cols; x++) grid[y][x] = true; }
          placed = true;
        }
      }
    }
    return grid.reduce((n, row) => n + row.filter((v) => !v).length, 0);
  }

  it('widens blocks into gaps so no cell is left empty', () => {
    const mixed = [
      photo(1.6), entry({ body: 'short' }), photo(0.7), entry({ body: 'tram 28' }), photo(1), entry({ body: 'y'.repeat(200) }),
      photo(1), entry({ body: 'a note' }), photo(1.5), photo(0.7), entry({ body: 'last one' }),
    ];
    expect(holes(planFeed(mixed))).toBe(0);
  });

  it('a long mixed feed leaves no holes either', () => {
    const list = Array.from({ length: 40 }, (_, i) => i % 4 === 0 ? entry({ body: i % 8 === 0 ? 'z'.repeat(180) : 'short' }) : photo([1.6, 0.7, 1, 1.4][i % 4]));
    expect(holes(planFeed(list))).toBe(0);
  });

  it('blocks never run off the page', () => {
    for (const b of planFeed([entry({ body: 'one' }), entry({ body: 'two' }), photo(0.7)])) expect(b.cols).toBeLessThanOrEqual(GRID_COLS);
  });
});

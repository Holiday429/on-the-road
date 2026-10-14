import { describe, expect, it } from 'vitest';
import { bookTone, spreadCount } from './albums.ts';
import { CHARS_PER_SLOT, clampSpread, leavesFor, paginate, SLOTS_PER_PAGE } from './album-pages.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';

let n = 0;
function entry(over: Partial<StoredJournalEntry> = {}): StoredJournalEntry {
  n++;
  return {
    id: `a${n}`, createdAt: 1, updatedAt: 1, schemaVersion: 1, tripId: null, title: `T${n}`, body: '', template: 'moment',
    destination: '', tags: [], happenedOn: '2026-06-01', favorite: false, visibility: 'private', slug: '', images: [],
    ...over,
  } as StoredJournalEntry;
}
const short = (photos = 0) => entry({ body: 'A short note.', images: Array.from({ length: photos }, (_, i) => `p${i}.jpg`) });
const long = (photos = 0) => entry({ body: 'x'.repeat(CHARS_PER_SLOT * 10), images: Array.from({ length: photos }, (_, i) => `p${i}.jpg`) });

describe('album pagination', () => {
  it('a short entry with one photo takes a single leaf, run as a plate', () => {
    const leaves = leavesFor(short(1));
    expect(leaves).toHaveLength(1);
    expect(leaves[0].layout).toBe('plate');
    expect(leaves[0].photos).toHaveLength(1);
    expect(leaves[0].continues).toBe(false);
  });

  it('a short entry with no photo is a reading column; with several photos, a feature', () => {
    expect(leavesFor(short(0))[0].layout).toBe('column');
    expect(leavesFor(short(3))[0].layout).toBe('feature');
  });

  it('a long entry runs over several leaves, carrying its photos on the first', () => {
    const leaves = leavesFor(long(2));
    expect(leaves.length).toBeGreaterThan(1);
    expect(leaves[0].photos).toHaveLength(2);
    expect(leaves[0].continues).toBe(true);
    expect(leaves[0].continued).toBe(false);
    // the run-on leaves are text only, and the last one ends the entry
    for (const l of leaves.slice(1)) {
      expect(l.photos).toHaveLength(0);
      expect(l.continued).toBe(true);
      expect(l.layout).toBe('column');
    }
    expect(leaves[leaves.length - 1].continues).toBe(false);
  });

  it('every leaf of a long entry carries a slice of the body, in order and without loss', () => {
    const e = long();
    const joined = leavesFor(e).map((l) => l.text).join('');
    expect(joined).toBe(e.body.trim());
  });

  it('no leaf asks for more than a page', () => {
    for (const e of [short(0), short(1), short(4), long(0), long(3)]) {
      for (const l of leavesFor(e)) expect(l.slots).toBeLessThanOrEqual(SLOTS_PER_PAGE);
    }
  });

  it('the album opens on its title page, and leaves fill both sides of a spread', () => {
    const spreads = paginate([short(1), short(1), short(1)]);
    expect(spreads[0][0]!.layout).toBe('title');
    expect(spreads[0][1]!.entry!.id).toBeTruthy();
    expect(spreads[1][0]).not.toBeNull();
    expect(spreads[1][1]).not.toBeNull();
  });

  it('an empty album is just the title page, and an odd count leaves one side blank', () => {
    const empty = paginate([]);
    expect(empty).toHaveLength(1);
    expect(empty[0][1]).toBeNull();
    expect(paginate([short(1)])[0][1]!.entry).toBeTruthy();
  });

  it('a long entry makes the album run to more spreads than it has entries', () => {
    expect(spreadCount([long()])).toBeGreaterThan(1);
    expect(spreadCount([short(1), short(1)])).toBe(2);   // title + 3 leaves
  });

  it('paging is clamped to what the album has', () => {
    expect(clampSpread(-3, 4)).toBe(0);
    expect(clampSpread(99, 4)).toBe(3);
    expect(clampSpread(Number.NaN, 4)).toBe(0);
  });

  it('a book keeps its colour', () => {
    expect(bookTone('abc')).toBe(bookTone('abc'));
    expect(bookTone('abc')).toBeLessThan(6);
  });
});

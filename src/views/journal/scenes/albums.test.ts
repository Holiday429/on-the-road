import { describe, expect, it } from 'vitest';
import { albumSpreads, bookTone, clampSpread, spreadCount } from './albums.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';

const e = (id: string) => ({ id } as StoredJournalEntry);

describe('album book', () => {
  it('the title page faces the first entry, then entries come two to a spread', () => {
    const s = albumSpreads([e('a'), e('b'), e('c')]);
    expect(s).toHaveLength(2);
    expect(s[0][0]).toEqual({ kind: 'title' });
    expect((s[0][1] as { entry: StoredJournalEntry }).entry.id).toBe('a');
    expect((s[1][0] as { entry: StoredJournalEntry }).entry.id).toBe('b');
    expect((s[1][1] as { entry: StoredJournalEntry }).entry.id).toBe('c');
  });

  it('an odd page count leaves the last right page blank; an empty album is just the title page', () => {
    expect(albumSpreads([e('a'), e('b')])[1][1]).toBeNull();
    const s = albumSpreads([]);
    expect(s).toHaveLength(1);
    expect(s[0][1]).toBeNull();
  });

  it('spread count and clamping', () => {
    expect(spreadCount(0)).toBe(1);
    expect(spreadCount(1)).toBe(1);
    expect(spreadCount(2)).toBe(2);
    expect(spreadCount(9)).toBe(5);
    expect(clampSpread(-3, 4)).toBe(0);
    expect(clampSpread(99, 4)).toBe(2);
    expect(clampSpread(Number.NaN, 4)).toBe(0);
  });

  it('a book keeps its colour', () => {
    expect(bookTone('abc')).toBe(bookTone('abc'));
    expect(bookTone('abc')).toBeLessThan(6);
  });
});

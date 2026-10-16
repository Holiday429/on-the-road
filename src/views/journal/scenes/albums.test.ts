import { describe, expect, it } from 'vitest';
import { bookTone, coverArtOf, magazineEntries } from './albums.ts';

describe('albums', () => {
  it('a book keeps its colour', () => {
    expect(bookTone('abc')).toBe(bookTone('abc'));
    expect(bookTone('abc')).toBeLessThan(6);
  });

  const e = (id: string, day: string, image = ''): any => ({ id, happenedOn: day, images: image ? [image] : [] });
  const album: any = { id: 'a', entryIds: ['late', 'early', 'mid', 'mid2'], coverEntryId: null };
  const all = [e('early', '2026-07-01', 'e.jpg'), e('mid', '2026-07-05'), e('mid2', '2026-07-05'), e('late', '2026-07-09', 'l.jpg')];

  it('prints the magazine in the order things happened, not the order they were filed', () => {
    expect(magazineEntries(album, all).map((x) => x.id)).toEqual(['early', 'mid', 'mid2', 'late']);
  });

  it('keeps the filing order for entries of the same day, and skips deleted ones', () => {
    const withGone = { ...album, entryIds: ['mid2', 'gone', 'mid'] };
    expect(magazineEntries(withGone, all).map((x) => x.id)).toEqual(['mid2', 'mid']);
  });

  it('gives the same cover photo whichever order the entries arrive in', () => {
    expect(coverArtOf(album, magazineEntries(album, all)).photo).toBe(coverArtOf(album, all).photo);
    expect(coverArtOf(album, all).photo).toBe('l.jpg');       // first in the album's own order that has one
  });
});

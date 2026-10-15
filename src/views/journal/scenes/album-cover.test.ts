import { describe, expect, it } from 'vitest';
import { COVER_TEMPLATES, COVER_TONES, coverOf, issueLine, renderCover } from './album-cover.ts';
import type { StoredJournalAlbum } from '../../../data/stores/journal-album-store.ts';

const album = (over: Partial<StoredJournalAlbum> = {}): StoredJournalAlbum => ({
  id: 'a1', tripId: null, title: 'Lisbon days', emoji: '📁', coverEntryId: null,
  entryIds: [], visibility: 'private', slug: '', createdAt: 1, updatedAt: 1, schemaVersion: 1,
  ...over,
} as StoredJournalAlbum);

const art = { photo: 'https://x.test/p.jpg', count: 7, newest: '2026-09-14', suggested: ['A long walk'] };

describe('coverOf', () => {
  it('prints the default cover for an album saved before covers existed', () => {
    const c = coverOf(album());
    expect(c.template).toBe('wordmark');
    expect(c.tone).toBe('paper');
    // The album's own title stands in as the headline, so nothing is blank.
    expect(c.headline).toBe('Lisbon days');
  });

  it('falls back to the title when the headline is blank or only spaces', () => {
    expect(coverOf(album({ cover: { template: 'banner', headline: '   ', kicker: '', lines: [], tone: 'ink', focalY: 0.5 } })).headline)
      .toBe('Lisbon days');
  });

  it('keeps what the designer set', () => {
    const c = coverOf(album({ cover: { template: 'frame', headline: 'PORTO', kicker: 'three days', lines: ['a', 'b'], tone: 'sage', focalY: 0.2 } }));
    expect(c).toMatchObject({ template: 'frame', headline: 'PORTO', kicker: 'three days', tone: 'sage', focalY: 0.2 });
  });
});

describe('issueLine', () => {
  it('numbers the issue by how much the album holds, and dates it by its newest entry', () => {
    expect(issueLine(7, '2026-09-14')).toBe('VOL.07 · SEP 2026');
    expect(issueLine(12, '2026-01-02')).toBe('VOL.12 · JAN 2026');
  });

  it('still prints a volume when there is no date, and never prints VOL.00', () => {
    expect(issueLine(3, '')).toBe('VOL.03');
    expect(issueLine(0, '')).toBe('VOL.01');
    expect(issueLine(2, 'not-a-date')).toBe('VOL.02');
  });
});

describe('renderCover', () => {
  it('draws every template and tone without losing the headline', () => {
    for (const template of COVER_TEMPLATES) {
      for (const tone of COVER_TONES) {
        const html = renderCover({ template, tone, headline: 'Lisbon', kicker: '', lines: [], focalY: 0.5 }, art);
        expect(html, `${template}/${tone}`).toContain('Lisbon');
        expect(html).toContain(`jc--${template}`);
        expect(html).toContain(`jc-tone--${tone}`);
      }
    }
  });

  it('escapes what the user typed', () => {
    const html = renderCover(
      { template: 'wordmark', tone: 'paper', headline: '<img src=x onerror=alert(1)>', kicker: '', lines: ['"quoted"'], focalY: 0.5 },
      art,
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('offers the entries own headlines as billings only until the designer writes their own', () => {
    const suggested = renderCover({ template: 'wordmark', tone: 'paper', headline: 'X', kicker: '', lines: [], focalY: 0.5 }, art);
    expect(suggested).toContain('A long walk');
    const own = renderCover({ template: 'wordmark', tone: 'paper', headline: 'X', kicker: '', lines: ['Mine'], focalY: 0.5 }, art);
    expect(own).toContain('Mine');
    expect(own).not.toContain('A long walk');
  });

  it('carries the focal point onto the photo, and copes with an album that has none', () => {
    expect(renderCover({ template: 'banner', tone: 'ink', headline: 'X', kicker: '', lines: [], focalY: 0.25 }, art))
      .toContain('object-position:50% 25%');
    const noPhoto = renderCover({ template: 'frame', tone: 'amber', headline: 'X', kicker: '', lines: [], focalY: 0.5 }, { ...art, photo: '' });
    expect(noPhoto).toContain('jc-photo--none');
    expect(noPhoto).not.toContain('<img');
  });
});

import { describe, it, expect } from 'vitest';
import { entriesToJson, entriesToMarkdown } from './export.ts';

const mk = (id: string, over: Record<string, unknown> = {}): any => ({
  id, tripId: 't1', title: '', body: '', template: 'moment', destination: '', tags: [],
  happenedOn: '2026-07-02', favorite: false, visibility: 'private', slug: '',
  images: [], createdAt: 1, updatedAt: 1, ...over,
});

describe('journal export', () => {
  it('orders oldest first and groups by date', () => {
    const md = entriesToMarkdown([
      mk('b', { happenedOn: '2026-07-05', body: 'later' }),
      mk('a', { happenedOn: '2026-07-02', body: 'earlier' }),
      mk('c', { happenedOn: '2026-07-02', body: 'same day', createdAt: 2 }),
    ]);
    expect(md.indexOf('earlier')).toBeLessThan(md.indexOf('same day'));
    expect(md.indexOf('same day')).toBeLessThan(md.indexOf('later'));
    expect(md.match(/## 2026-07-02/g)).toHaveLength(1);
  });

  it('renders title, meta, body and photos', () => {
    const md = entriesToMarkdown([
      mk('a', { title: 'Nyhavn', body: 'Quiet.', destination: 'Copenhagen', tags: ['food'], mood: 'calm', images: ['https://x/1.jpg'] }),
    ]);
    expect(md).toContain('### Nyhavn');
    expect(md).toContain('📍 Copenhagen · 🌊 · #food');
    expect(md).toContain('Quiet.');
    expect(md).toContain('![](https://x/1.jpg)');
  });

  it('falls back to the legacy cover image and handles an empty list', () => {
    expect(entriesToJson([mk('a', { images: [], coverImage: 'https://x/c.jpg' })])[0].images).toEqual(['https://x/c.jpg']);
    expect(entriesToMarkdown([])).toContain('No entries');
  });
});

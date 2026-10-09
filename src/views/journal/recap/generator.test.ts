/**
 * The recap client is thin on purpose; these pin the two things it still owns:
 * what it is willing to send, and how it judges a portrait out of date.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const postJson = vi.fn();
vi.mock('../../../core/api.ts', () => ({ postJson: (...a: unknown[]) => postJson(...a) }));
vi.mock('../../../core/i18n.ts', () => ({ aiLanguage: () => 'English' }));
vi.mock('../../../data/trip-context.ts', () => ({ currentTripId: () => 't1' }));

import { generateRecap, isRecapStale } from './generator.ts';

const mk = (i: number, over: Record<string, unknown> = {}): any => ({
  id: `e${i}`, tripId: 't1', title: `T${i}`, body: 'body', template: 'moment',
  destination: 'Lisbon', tags: ['a'], happenedOn: `2026-07-${String(i + 1).padStart(2, '0')}`,
  mood: 'spark', favorite: false, visibility: 'private', slug: '',
  images: [], createdAt: 1, updatedAt: 1, ...over,
});

const TAP = { userInitiated: true } as const;

beforeEach(() => {
  postJson.mockReset();
  postJson.mockResolvedValue({ draft: { source: 'ai' }, privacyReport: { attention: [] } });
});

describe('intent', () => {
  it('sends the user-tap flag, and refuses to call without it', async () => {
    await generateRecap([mk(1)], TAP);
    expect(postJson.mock.calls[0][1].userInitiated).toBe(true);
    postJson.mockClear();
    await expect(generateRecap([mk(1)], undefined as never)).rejects.toThrow(/user tap/);
    await expect(generateRecap([mk(1)], { userInitiated: false } as never)).rejects.toThrow(/user tap/);
    expect(postJson).not.toHaveBeenCalled();
  });
});

describe('what is sent', () => {
  it('sends photo counts, never photo URLs', async () => {
    await generateRecap([mk(1, { images: ['https://x/a.jpg', 'https://x/b.jpg'], coverImage: 'https://x/c.jpg' })], TAP);
    const body = postJson.mock.calls[0][1];
    expect(body.entries[0].photoCount).toBe(2);
    expect(JSON.stringify(body)).not.toContain('https://');
  });

  it('sends only the fields the pipeline reads', async () => {
    await generateRecap([mk(1)], TAP);
    expect(Object.keys(postJson.mock.calls[0][1].entries[0]).sort()).toEqual([
      'body', 'destination', 'happenedOn', 'id', 'photoCount', 'title',
    ]);
  });

  it('does not send tags, mood or favourites', async () => {
    await generateRecap([mk(1, { tags: ['secret'], mood: 'spark', favorite: true })], TAP);
    const sent = JSON.stringify(postJson.mock.calls[0][1]);
    expect(sent).not.toContain('secret');
    expect(sent).not.toContain('spark');
    expect(sent).not.toContain('favorite');
  });

  it('includes the trip and output language', async () => {
    await generateRecap([mk(1)], TAP);
    expect(postJson).toHaveBeenCalledWith('/api/recap', expect.objectContaining({ tripId: 't1', lang: 'English' }));
  });

  it('keeps the newest entries when a journal exceeds the server limit', async () => {
    const many = Array.from({ length: 900 }, (_, i) =>
      mk(i, { id: `e${i}`, happenedOn: `2026-01-01`, createdAt: i }));
    // Distinct dates so "newest" is well defined.
    many.forEach((e, i) => { e.happenedOn = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10); });
    await generateRecap(many, TAP);
    const sent = postJson.mock.calls[0][1].entries;
    expect(sent).toHaveLength(800);
    expect(sent.some((e: any) => e.id === 'e899')).toBe(true);
    expect(sent.some((e: any) => e.id === 'e0')).toBe(false);
  });

  it('lets a failed call propagate, so an existing portrait is never overwritten', async () => {
    postJson.mockRejectedValue(new Error('502'));
    await expect(generateRecap([mk(1)], TAP)).rejects.toThrow('502');
  });

  it('defaults a missing privacy report', async () => {
    postJson.mockResolvedValue({ draft: { source: 'ai' } });
    expect((await generateRecap([mk(1)], TAP)).privacyReport).toEqual({});
  });
});

describe('staleness', () => {
  const recap = { entryCount: 3, generatedAt: 1000 };

  it('is fresh when nothing was added or touched since', () => {
    expect(isRecapStale(recap, [{ updatedAt: 10 }, { updatedAt: 500 }, { updatedAt: 1000 }])).toBe(false);
  });

  it('is stale when an entry was added', () => {
    expect(isRecapStale(recap, [{ updatedAt: 1 }, { updatedAt: 1 }, { updatedAt: 1 }, { updatedAt: 1 }])).toBe(true);
  });

  it('is stale when an entry was deleted', () => {
    expect(isRecapStale(recap, [{ updatedAt: 1 }, { updatedAt: 1 }])).toBe(true);
  });

  it('is stale when an entry was edited after generation', () => {
    expect(isRecapStale(recap, [{ updatedAt: 1 }, { updatedAt: 1 }, { updatedAt: 1001 }])).toBe(true);
  });
});

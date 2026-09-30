/**
 * The AI tidy pass.
 *
 * The model's output is untrusted input: it can name entries that don't exist,
 * invent template values, return one-entry "albums", or fail outright. None of
 * that may reach the journal, so everything here is about what gets discarded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const postJson = vi.hoisted(() => vi.fn());

vi.mock('../../core/api.ts', () => ({ postJson }));
vi.mock('../../core/i18n.ts', () => ({ aiLanguage: () => 'English' }));
vi.mock('../../data/trip-context.ts', () => ({ currentTripId: () => 't1' }));

import { suggestTidy } from './ai-classify.ts';

const mkEntry = (id: string, over: Record<string, unknown> = {}): any => ({
  id, tripId: null, title: `T${id}`, body: `B${id}`, template: 'moment',
  destination: 'Kyoto', tags: [], happenedOn: '2026-07-08',
  favorite: false, visibility: 'private', slug: '', images: [],
  createdAt: 1, updatedAt: 1, ...over,
});

const entries = ['e1', 'e2', 'e3', 'e4'].map((id) => mkEntry(id));

beforeEach(() => { postJson.mockReset(); });

describe('suggestTidy', () => {
  it('does not call the model for a handful of entries', async () => {
    const result = await suggestTidy([mkEntry('e1'), mkEntry('e2')]);
    expect(postJson).not.toHaveBeenCalled();
    expect(result).toEqual({ albums: [], entries: [] });
  });

  it('returns suggestions without writing anything', async () => {
    postJson.mockResolvedValue({
      albums: [{ title: 'Kyoto day one', emoji: '⛩', reason: 'same day', entryIds: ['e1', 'e2'] }],
      entries: [{ id: 'e1', template: 'note', tags: ['Coffee', '#Food'] }],
    });

    const result = await suggestTidy(entries);
    expect(result.albums).toHaveLength(1);
    expect(result.albums[0]).toMatchObject({ title: 'Kyoto day one', entryIds: ['e1', 'e2'] });
    // Tags normalised: lowercased, '#' stripped.
    expect(result.entries[0].tags).toEqual(['coffee', 'food']);
  });

  it('drops albums that name entries which do not exist', async () => {
    postJson.mockResolvedValue({
      albums: [{ title: 'Ghosts', emoji: '👻', reason: '', entryIds: ['nope', 'alsonope'] }],
      entries: [],
    });
    const result = await suggestTidy(entries);
    expect(result.albums).toEqual([]);
  });

  it('drops one-entry albums, which are not a grouping', async () => {
    postJson.mockResolvedValue({
      albums: [{ title: 'Lonely', emoji: '📁', reason: '', entryIds: ['e1'] }],
      entries: [],
    });
    const result = await suggestTidy(entries);
    expect(result.albums).toEqual([]);
  });

  it('drops entry suggestions with an invented template', async () => {
    postJson.mockResolvedValue({
      albums: [],
      entries: [
        { id: 'e1', template: 'vibes', tags: [] },
        { id: 'e2', template: 'note', tags: [] },
      ],
    });
    const result = await suggestTidy(entries);
    expect(result.entries.map((e) => e.entryId)).toEqual(['e2']);
  });

  it('returns empty rather than throwing when the call fails', async () => {
    // The failure is caught and logged by design, so the console.warn is part
    // of the expected behaviour rather than noise — silence it so the runner
    // doesn't read it as the test itself erroring.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    postJson.mockImplementation(async () => { throw new Error('offline'); });

    const result = await suggestTidy(entries);

    expect(result).toEqual({ albums: [], entries: [] });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('survives a model that returns nothing usable', async () => {
    postJson.mockResolvedValue({});
    const result = await suggestTidy(entries);
    expect(result).toEqual({ albums: [], entries: [] });
  });
});

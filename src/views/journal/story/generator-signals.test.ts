/**
 * The recap's ranking signals.
 *
 * `template` used to be worth up to 3 points here and decided the traveller
 * persona outright. It's inferred now, so weighting by it would be the recap
 * reacting to its own guess — these tests pin down that it doesn't, and that
 * what the user actually did still drives the result.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../firebase/db.ts', () => ({ genId: () => Math.random().toString(36).slice(2) }));
vi.mock('../../../core/api.ts', () => ({ postJson: vi.fn() }));
vi.mock('../../../core/i18n.ts', () => ({ aiLanguage: () => 'English' }));
vi.mock('../../../data/trip-context.ts', () => ({ currentTripId: () => 't1' }));

import { generateStoryDraft } from './generator.ts';

const mk = (id: string, over: Record<string, unknown> = {}): any => ({
  id, tripId: null, title: '', body: 'a short line', template: 'moment',
  destination: 'Kyoto', tags: [], happenedOn: '2026-07-08', mood: '',
  favorite: false, visibility: 'private', slug: '', images: [],
  createdAt: 1, updatedAt: 1, ...over,
});

/** Only the heuristic path runs for <2 entries; use 2+ and let AI fail over. */
async function draftOf(entries: any[]) {
  return generateStoryDraft(entries, []);
}

describe('recap ranking', () => {
  it('ignores template when ordering entries', async () => {
    // Identical entries but for template. If template still carried weight,
    // the `interesting` one would be ranked first.
    const plain = mk('plain', { template: 'note', body: 'x'.repeat(200), favorite: true });
    const tagged = mk('tagged', { template: 'interesting', body: 'y' });

    const draft = await draftOf([plain, tagged]);
    expect(draft.entryIds[0]).toBe('plain');
  });

  it('ranks by what the user did — pinning, photos, length', async () => {
    const rich = mk('rich', { favorite: true, images: ['a', 'b'], body: 'z'.repeat(300) });
    const thin = mk('thin', { body: 'z' });

    const draft = await draftOf([rich, thin]);
    expect(draft.entryIds[0]).toBe('rich');
  });

  it('calls a mostly-terse journal a planner, whatever the templates say', async () => {
    const terse = ['a', 'b', 'c', 'd'].map((id) =>
      mk(id, { template: 'interesting', body: '¥800', mood: '' }));

    const draft = await draftOf(terse);
    expect(draft.travelerMode).toBe('Sharp-Eyed Planner');
  });

  it('calls a journal full of moods feeling-first', async () => {
    const moody = ['a', 'b', 'c', 'd'].map((id) =>
      mk(id, { template: 'note', mood: '😄', body: 'a longer reflective line about the day' }));

    const draft = await draftOf(moody);
    expect(draft.travelerMode).toBe('Feeling-First Wanderer');
  });

  it('still lets tags win, since those are the user\'s own words', async () => {
    const foodie = ['a', 'b', 'c', 'd'].map((id) =>
      mk(id, { tags: ['food'], body: 'x'.repeat(100) }));

    const draft = await draftOf(foodie);
    expect(draft.travelerMode).toBe('Taste-First Rover');
  });
});

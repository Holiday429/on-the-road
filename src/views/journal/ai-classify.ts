/* ==========================================================================
   On the Road · Journal — AI tidying pass
   --------------------------------------------------------------------------
   The rule-based `inferTemplate` runs on every save and is deliberately dumb:
   it must be instant and never wrong in an expensive way. This module is the
   other half — a slower, better read of a batch of entries, run on demand.

   Two things it must not do:
     · It never blocks saving. The user writes, the entry is stored, done.
       This runs later, from the Albums view, when the user asks for it.
     · It never writes on its own. It returns SUGGESTIONS; applying one is a
       separate, explicit action. An AI that silently re-files someone's
       journal is worse than no AI, because they can't tell what moved.
   ========================================================================== */

import { postJson } from '../../core/api.ts';
import { aiLanguage } from '../../core/i18n.ts';
import { currentTripId } from '../../data/trip-context.ts';
import type { StoredJournalEntry } from '../../data/stores/journal-store.ts';
import { excerpt, titleFor } from './shared/utils.ts';
import { BUILTIN_TEMPLATE_KINDS } from './templates.ts';

/** A proposed album: a title plus the entries the model thinks belong in it. */
export interface AlbumSuggestion {
  title: string;
  emoji: string;
  reason: string;
  entryIds: string[];
}

/** A proposed re-categorisation / tagging of one entry. */
export interface EntrySuggestion {
  entryId: string;
  template: string;
  tags: string[];
}

export interface TidySuggestions {
  albums: AlbumSuggestion[];
  entries: EntrySuggestion[];
}

const MAX_ENTRIES = 40;
const MAX_ALBUMS = 5;

/**
 * Ask the model to group a trip's entries and sharpen their categories.
 *
 * Returns empty suggestions rather than throwing: this is an optional
 * convenience, and a failed call should leave the journal exactly as it was.
 */
export async function suggestTidy(entries: StoredJournalEntry[]): Promise<TidySuggestions> {
  const empty: TidySuggestions = { albums: [], entries: [] };
  // Below a handful of entries there's nothing to group — grouping 2 entries
  // into an album is noise, not organisation.
  if (entries.length < 4) return empty;

  const payload = entries.slice(0, MAX_ENTRIES).map((entry) => ({
    id: entry.id,
    title: titleFor(entry),
    body: excerpt(entry.body, 160),
    destination: entry.destination,
    tags: entry.tags,
    happenedOn: entry.happenedOn,
    hasPhoto: (entry.images?.length ?? 0) > 0,
  }));

  const prompt = `You are tidying a traveller's journal. They wrote these entries quickly, without categorising them.
Return ONLY valid JSON matching this exact shape:
{
  "albums": [
    { "title": "short album name", "emoji": "one emoji", "reason": "why these belong together, one short sentence", "entryIds": ["id1", "id2"] }
  ],
  "entries": [
    { "id": "entryId", "template": "moment|note|interesting|place", "tags": ["tag1", "tag2"] }
  ]
}

Constraints:
- Group by what actually connects the entries: a day, a city, a theme, an activity.
- An album needs at least 2 entries. Produce at most ${MAX_ALBUMS} albums.
- Do not put every entry in an album. Leaving something ungrouped is fine.
- template must be exactly one of: ${BUILTIN_TEMPLATE_KINDS.join(', ')}.
- tags: at most 3 per entry, lowercase, no '#'.
- Only use ids from the payload.

Entries:
${JSON.stringify(payload)}`;

  let parsed: any;
  try {
    parsed = await postJson<any>('/api/story', {
      prompt,
      lang: aiLanguage(),
      tripId: currentTripId(),
    });
  } catch (error) {
    console.warn('Journal tidy suggestions unavailable:', error);
    return empty;
  }

  const validIds = new Set(entries.map((entry) => entry.id));
  const knownTemplates = new Set<string>(BUILTIN_TEMPLATE_KINDS);

  const albums: AlbumSuggestion[] = Array.isArray(parsed?.albums)
    ? parsed.albums
        .map((album: any): AlbumSuggestion => ({
          title: String(album?.title ?? '').trim().slice(0, 40),
          emoji: String(album?.emoji ?? '📁').trim().slice(0, 4) || '📁',
          reason: String(album?.reason ?? '').trim().slice(0, 140),
          entryIds: Array.isArray(album?.entryIds)
            ? [...new Set<string>(album.entryIds.filter((id: unknown): id is string =>
                typeof id === 'string' && validIds.has(id)))]
            : [],
        }))
        // A one-entry album isn't a grouping, and an untitled one can't be shown.
        .filter((album: AlbumSuggestion) => album.title && album.entryIds.length >= 2)
        .slice(0, MAX_ALBUMS)
    : [];

  const entrySuggestions: EntrySuggestion[] = Array.isArray(parsed?.entries)
    ? parsed.entries
        .map((row: any): EntrySuggestion => ({
          entryId: String(row?.id ?? ''),
          template: String(row?.template ?? ''),
          tags: Array.isArray(row?.tags)
            ? row.tags
                .filter((tag: unknown): tag is string => typeof tag === 'string')
                .map((tag: string) => tag.trim().replace(/^#/, '').toLowerCase())
                .filter(Boolean)
                .slice(0, 3)
            : [],
        }))
        .filter((row: EntrySuggestion) =>
          validIds.has(row.entryId) && knownTemplates.has(row.template))
    : [];

  return { albums, entries: entrySuggestions };
}

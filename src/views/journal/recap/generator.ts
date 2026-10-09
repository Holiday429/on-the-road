/* ==========================================================================
   On the Road · Recap client
   --------------------------------------------------------------------------
   Deliberately thin. The portrait pipeline (signals → evidence → model →
   privacy gate) runs in /api/recap, shared with iOS; this file only sends the
   journal's entries and hands back the finished document to be stored.

   Nothing here computes a signal, a hash or a redaction. That is what keeps web
   and iOS from ever disagreeing about a portrait, and it means the privacy
   decision about what may be shared is made in one place the client can't skip.

   Cross-device sync needs nothing extra: the returned draft is written to
   trips/{tripId}/travelerRecaps, and every other device just subscribes to it.
   ========================================================================== */

import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { TravelerRecap } from '../../../data/schema.ts';
import { postJson } from '../../../core/api.ts';
import { aiLanguage } from '../../../core/i18n.ts';
import { currentTripId } from '../../../data/trip-context.ts';
import { entryImages } from '../shared/utils.ts';

/**
 * Entries needed before a model-written portrait is offered. Mirror of
 * MIN_ENTRIES_FOR_PORTRAIT in api/_recap/signals.ts — below it the server
 * returns a free numbers-only card instead.
 */
export const MIN_ENTRIES_FOR_PORTRAIT = 8;

/** Mirror of MAX_ENTRIES in api/recap.ts; the newest entries win if a journal exceeds it. */
const MAX_ENTRIES_SENT = 800;

export type RecapDraft = Omit<TravelerRecap, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>;

export interface GenerateResult {
  draft: RecapDraft;
  /** Per-chapter redaction reasons, for the share preview. */
  privacyReport: Record<string, string[]>;
}

/**
 * The only shape of a journal entry the server ever sees. Photo URLs are
 * reduced to a count — the portrait reads how often someone photographs, never
 * what — so nothing about the images leaves the device or the user's storage.
 * Tags, mood and favourites are not sent: they say nothing reliable about the
 * person, so the portrait is not allowed to lean on them.
 */
function toWireEntry(entry: StoredJournalEntry) {
  return {
    id: entry.id,
    happenedOn: entry.happenedOn,
    title: entry.title,
    body: entry.body,
    destination: entry.destination,
    photoCount: entryImages(entry).length,
  };
}

/**
 * Ask the server for a portrait. Billing errors (quota / auth / rate limit)
 * propagate to the caller's paywall handling; so does any other failure, so a
 * failed regenerate leaves the existing portrait untouched.
 */
export async function generateRecap(
  entries: StoredJournalEntry[],
  intent: { userInitiated: true },
): Promise<GenerateResult> {
  // Belt and braces for callers that bypass the types: the model is only ever
  // paid for on a deliberate tap, never from a script, effect or test.
  if (intent?.userInitiated !== true) throw new Error('generateRecap needs a user tap');

  const newest = [...entries]
    .sort((a, b) => b.happenedOn.localeCompare(a.happenedOn))
    .slice(0, MAX_ENTRIES_SENT);

  const result = await postJson<GenerateResult>('/api/recap', {
    entries: newest.map(toWireEntry),
    userInitiated: true,
    tripId: currentTripId(),
    lang: aiLanguage(),
  });

  return { draft: result.draft, privacyReport: result.privacyReport ?? {} };
}

/**
 * Whether the journal has changed since the portrait was made.
 *
 * Judged from entry count and update times, not from a content hash: those are
 * identical on every platform, whereas a hash would have to be computed the same
 * way in Swift and TypeScript. The cost is that an edit which wouldn't have
 * changed the portrait still counts as a change — acceptable, because the only
 * consequence is that "Generate" becomes available again; "Regenerate" is always
 * an explicit choice.
 */
export function isRecapStale(
  recap: { entryCount: number; generatedAt: number },
  entries: Array<{ updatedAt: number }>,
): boolean {
  if (recap.entryCount !== entries.length) return true;
  return entries.some((entry) => entry.updatedAt > recap.generatedAt);
}

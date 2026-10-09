/* ==========================================================================
   On the Road · Recap export — choosing what to share
   --------------------------------------------------------------------------
   The owner decides which cards leave the app. The automatic checks (names,
   quoted speech, amounts…) only inform that decision: a flagged card starts
   unticked with its reasons shown, and can be ticked anyway.

   What is exported is always the PUBLIC wording. A card with none (a chapter whose
   public text came back empty) cannot be chosen at all — there would be nothing
   to draw but the private reading, which never leaves the app.

   Pure functions, so the rules are tested without a DOM or a canvas.
   ========================================================================== */

import type { StoredTravelerRecap } from '../../../../data/stores/traveler-recap-store.ts';
import { buildDeck, cardKey, flagsOf, type Card } from '../render.ts';
import { plainText } from '../emphasis.ts';

export interface ExportCandidate {
  /** Index in the deck (stable across selections; used as the checkbox value). */
  index: number;
  key: string;
  card: Card;
  /** Why the automatic checks flagged the public text; empty when it passed. */
  flags: string[];
  /** False when there is no public wording to draw. */
  hasPublicText: boolean;
}

export function exportCandidates(recap: StoredTravelerRecap): ExportCandidate[] {
  return buildDeck(recap).map((card, index) => ({
    index,
    key: cardKey(card),
    card,
    flags: flagsOf(card),
    hasPublicText: card.kind !== 'chapter' || plainText(card.chapter.bodyPublic).trim().length > 0,
  }));
}

/**
 * What is ticked when the sheet opens: every card whose public text passed the
 * checks. Flagged cards start unticked — a prompt to look, not a prohibition.
 */
export function defaultSelection(candidates: ExportCandidate[]): Set<number> {
  return new Set(candidates.filter((c) => c.hasPublicText && c.flags.length === 0).map((c) => c.index));
}

/** The chosen cards, in deck order, ignoring any that cannot be drawn. */
export function chosenCards(candidates: ExportCandidate[], selected: ReadonlySet<number>): ExportCandidate[] {
  return candidates.filter((c) => selected.has(c.index) && c.hasPublicText);
}

/** A one-line preview of a card's public wording, for the selection sheet. */
export function previewText(candidate: ExportCandidate, max = 56): string {
  const { card } = candidate;
  let text = '';
  if (card.kind === 'chapter') text = plainText(card.chapter.bodyPublic);
  else if (card.kind === 'cover') text = [card.label, card.tagline].filter(Boolean).join(' · ');
  else if (card.kind === 'traits') text = card.traits.map((t) => t.key).join(' · ');
  else text = card.oneLine || card.questions[0] || '';
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

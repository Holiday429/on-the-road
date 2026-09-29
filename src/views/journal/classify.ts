import { DEFAULT_TEMPLATE, type TemplateId } from './templates.ts';

/**
 * Signals that a body is practical reference material rather than a feeling:
 * money, clock times, and the vocabulary of opening hours / booking.
 *
 * Deliberately conservative — a false `note` is worse than a missed one,
 * because `moment` is the neutral bucket a user expects when nothing stands out.
 */
const NOTE_PATTERN =
  /[¥$€£₩]\s?\d|\d+\s?(元|円|块|块钱|欧|刀)|\d{1,2}:\d{2}|营业|开放时间|预约|订票|门票|地铁|班次|收费/;

export interface ClassifiableDraft {
  body: string;
  mood: string;
  linkedPlaces: string[];
}

/**
 * Pick the template for a new entry from what the user actually wrote.
 *
 * The user no longer chooses a category up front — see the single-entry
 * composer — so `template` became a system-inferred label. It stays a weak
 * signal on purpose: it drives tint and grouping, never anything the user
 * can't override by editing the entry.
 *
 * Only ever called for NEW entries. Editing keeps whatever the entry already
 * has, so a hand-corrected category isn't overwritten on the next save.
 */
export function inferTemplate(draft: ClassifiableDraft): TemplateId {
  if (NOTE_PATTERN.test(draft.body)) return 'note';
  if (draft.linkedPlaces.length > 0) return 'place';
  if (draft.mood.trim()) return 'moment';
  return DEFAULT_TEMPLATE;
}

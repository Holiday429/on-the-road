/* ==========================================================================
   On the Road · Recap length limits, by script
   --------------------------------------------------------------------------
   Every limit exists because a 3:4 card has a fixed area. Area, not character
   count, is what is fixed — and a Latin letter is roughly half the width of a
   CJK glyph — so the same card holds about twice as many characters in English
   as in Chinese. One flat limit would either truncate English mid-sentence or
   leave Chinese cards half empty.

   The output language decides the tier. Chinese, Japanese and Korean share the
   tight one; everything else uses the roomy one.

   Hard limits: the prompt states them, the parser enforces them, and the privacy
   gate uses the public-body ceiling. Keep the three in step by reading from here.
   ========================================================================== */

export interface Limits {
  label: number;        // archetype.label — set large on the cover
  tagline: number;
  traitKey: number;     // an axis label on the radar
  traitNote: number;
  heading: number;
  bodyMin: number;      // private reading
  bodyMax: number;
  pubMin: number;       // share-card text
  pubMax: number;
  oneLine: number;
  question: number;
  numLabel: number;     // overview tile
}

export const CJK_LIMITS: Limits = {
  label: 14, tagline: 30, traitKey: 6, traitNote: 40, heading: 16,
  bodyMin: 100, bodyMax: 260, pubMin: 60, pubMax: 150,
  oneLine: 60, question: 40, numLabel: 10,
};

export const LATIN_LIMITS: Limits = {
  label: 28, tagline: 60, traitKey: 12, traitNote: 70, heading: 28,
  bodyMin: 200, bodyMax: 520, pubMin: 120, pubMax: 300,
  oneLine: 110, question: 80, numLabel: 16,
};

const CJK_LANGUAGES = new Set(['Simplified Chinese', 'Japanese', 'Korean']);

/** Limits for the output language named in the request (see ALLOWED_LANGUAGES in recap.ts). */
export function limitsFor(lang: unknown): Limits {
  return typeof lang === 'string' && CJK_LANGUAGES.has(lang) ? CJK_LIMITS : LATIN_LIMITS;
}

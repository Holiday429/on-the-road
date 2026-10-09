/* ==========================================================================
   On the Road · Recap emphasis marker (client side)
   --------------------------------------------------------------------------
   A chapter's text may carry one key sentence between **double asterisks**
   (see api/_recap/emphasis.ts, which guarantees at most one closed pair).
   Cards draw it highlighted; the canvas export draws it the same way.
   ========================================================================== */

export interface Span { text: string; em: boolean }

/** Split text into plain and emphasised spans. Tolerates stray asterisks from older documents. */
export function splitEmphasis(text: string): Span[] {
  const match = /\*\*([^*]+?)\*\*/.exec(text);
  if (!match) return [{ text: text.replace(/\*+/g, ''), em: false }];

  const strip = (s: string) => s.replace(/\*+/g, '');
  const spans: Span[] = [
    { text: strip(text.slice(0, match.index)), em: false },
    { text: strip(match[1]), em: true },
    { text: strip(text.slice(match.index + match[0].length)), em: false },
  ];
  return spans.filter((s) => s.text);
}

/** The text without markers — for measuring and for plain-text uses. */
export function plainText(text: string): string {
  return text.replace(/\*+/g, '');
}

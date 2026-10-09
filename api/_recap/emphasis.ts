/* ==========================================================================
   On the Road · Recap emphasis marker
   --------------------------------------------------------------------------
   Each chapter's text carries ONE key sentence wrapped in **double asterisks**:
   the sentence that states the judgement. The card draws it underlined, which
   gives every card a point of focus and keeps a short text from reading as a
   uniform grey block.

   The marker lives in the text itself rather than in an extra field so old
   documents and old clients simply see a few asterisks they can strip, and
   nothing in the schema changes. Everything downstream that measures or
   inspects the text (length limits, the privacy gate) works on the plain text.
   ========================================================================== */

const PAIR = /\*\*([^*]+?)\*\*/;

/** The text with the marker removed — what length limits and the privacy gate see. */
export function stripEmphasis(text: string): string {
  // Every asterisk, not just pairs: the prompt reserves them for this marker, so
  // any other run (`***x***`, a lone `*`) is the model's mistake and must not be
  // measured, inspected or drawn.
  return text.replace(/\*+/g, '');
}

/**
 * Keep the first well-formed `**…**` pair and drop every other asterisk pair.
 *
 * The model is asked for exactly one, but it may emit none, several, or an
 * unbalanced one — and trimming a long text at a sentence boundary can cut a
 * pair in half. Rendering must never show a stray `**`, so the stored text is
 * always either marker-free or carries exactly one closed pair.
 */
export function normalizeEmphasis(text: string): string {
  const first = PAIR.exec(text);
  if (!first) return stripEmphasis(text);

  const before = stripEmphasis(text.slice(0, first.index));
  const inner = stripEmphasis(first[1]);
  const after = stripEmphasis(text.slice(first.index + first[0].length));
  return `${before}**${inner}**${after}`;
}

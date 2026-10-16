/* ==========================================================================
   On the Road · Journal magazine — setting the words (pure markup)
   --------------------------------------------------------------------------
   One function builds the HTML of a text frame and one the heading block, and
   BOTH the page and the hidden element that measures it use them. That is the
   whole trick of the pagination: what was measured is, character for
   character and rule for rule, what is printed.

   The text is the article's paragraphs joined with a newline. A frame carries a
   character range of it.
   ========================================================================== */

import { escHtml } from '../shared/utils.ts';

export interface TextOpts {
  /** A very short note, set larger so it does not sit as two lines on an empty page. */
  lead?: boolean;
}

/** The paragraphs of a slice of article text, as markup. Paragraphs are told apart by space, not by indenting. */
export function textHtml(text: string): string {
  return text
    .split('\n')
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escHtml(p)}</p>`)
    .join('');
}

/** The class list of a text frame. */
export function textClass(o: TextOpts = {}): string {
  return `mag-text${o.lead ? ' is-lead' : ''}`;
}

export type HeadSize = 'm' | 'l';

/** The kicker over a headline. */
export function headHtml(a: { kicker: string; headline: string }): string {
  return `<span class="mag-kicker">${escHtml(a.kicker)}</span><h2 class="mag-headline">${escHtml(a.headline)}</h2>`;
}

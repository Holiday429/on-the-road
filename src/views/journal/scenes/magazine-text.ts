/* ==========================================================================
   On the Road · Journal magazine — setting the words (pure markup)
   --------------------------------------------------------------------------
   One function builds the HTML of a text frame and one the heading block, and
   BOTH the page and the hidden element that measures it use them. That is the
   whole trick of the pagination: what was measured is, character for
   character and rule for rule, what is printed.

   The text is the article's paragraphs joined with a newline. A frame carries a
   character range of it; a page that starts mid-paragraph says so (`continued`)
   so its first line is not indented as if a paragraph began there.
   ========================================================================== */

import { escHtml } from '../shared/utils.ts';

export interface TextOpts {
  /** First letter of the first paragraph is set large, sunk into the lines. */
  dropcap?: boolean;
  /** The text begins in the middle of a paragraph. */
  continued?: boolean;
}

/** The paragraphs of a slice of article text, as markup. */
export function textHtml(text: string, o: TextOpts = {}): string {
  const paragraphs = text.split('\n').filter((p) => p.length > 0);
  return paragraphs
    .map((p, i) => `<p${i === 0 && o.continued ? ' class="is-cont"' : ''}>${escHtml(p)}</p>`)
    .join('');
}

/** The class list of a text frame. */
export function textClass(o: TextOpts = {}): string {
  return `mag-text${o.dropcap ? ' has-dropcap' : ''}`;
}

export type HeadSize = 'm' | 'l';

/** The kicker over a headline. */
export function headHtml(a: { kicker: string; headline: string }): string {
  return `<span class="mag-kicker">${escHtml(a.kicker)}</span><h2 class="mag-headline">${escHtml(a.headline)}</h2>`;
}

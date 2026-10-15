/* ==========================================================================
   On the Road · Journal albums — choosing a page layout
   --------------------------------------------------------------------------
   Which arrangement each page of the magazine gets. The pagination in
   album-pages.ts decides WHAT goes on a page (which photos, how much text);
   this decides HOW it sits there.

   Two rules keep a magazine from reading like a contact sheet:
     · no layout repeats on the page that follows it, and
     · picture-led and text-led pages alternate where the content allows.

   Beyond that the choice is drawn from the album id and the page number, so a
   book looks the same every time it is opened but different from its neighbour
   on the shelf. Pure: no DOM, no state.
   ========================================================================== */

import { hashId } from './feed-plan.ts';
import type { Leaf } from './album-pages.ts';

/**
 * The arrangements a page can take.
 *
 *   plate     one picture as large as the page allows, a caption under it
 *   duo       two pictures stacked, the words beside them
 *   mosaic    three or more pictures at mixed sizes, words below
 *   inset     the words run the page, one picture set into them
 *   column    nothing but words, in two reading columns
 *   openerL   a picture bled to the page edge, the title over it
 */
export type PageLayout = 'plate' | 'duo' | 'mosaic' | 'inset' | 'column' | 'openerL';

/** Layouts that lead with pictures, for the alternation rule. */
const PICTURE_LED: ReadonlySet<PageLayout> = new Set<PageLayout>(['plate', 'duo', 'mosaic', 'openerL']);

export function isPictureLed(layout: PageLayout): boolean {
  return PICTURE_LED.has(layout);
}

/** What a page could be, given what it holds — best first. */
export function candidatesFor(leaf: Leaf, isOpener: boolean): PageLayout[] {
  const photos = leaf.photos.length;
  const words = leaf.text.trim().length;

  if (photos === 0) return ['column'];
  if (photos === 1) {
    // One picture and little to say is a plate; with real text it can be an inset.
    const out: PageLayout[] = words < 200 ? ['plate', 'inset'] : ['inset', 'plate'];
    if (isOpener) out.unshift('openerL');
    return out;
  }
  if (photos === 2) return words < 200 ? ['duo', 'mosaic', 'plate'] : ['duo', 'inset', 'mosaic'];
  // Several pictures: every picture-led arrangement is honest, and with real text
  // an inset works too — so a page like this is where an album's own character shows.
  const many: PageLayout[] = ['mosaic', 'duo', 'plate'];
  if (words >= 200) many.push('inset');
  if (isOpener) many.unshift('openerL');
  return many;
}

/**
 * Pick each page's layout in order, applying the two rules.
 *
 * `albumId` only shifts where in the candidate list each page starts, so two
 * albums holding the same entries still read differently.
 */
export function planLayouts(leaves: Array<Leaf | null>, albumId: string): Array<PageLayout | null> {
  const out: Array<PageLayout | null> = [];
  let previous: PageLayout | null = null;

  leaves.forEach((leaf, index) => {
    if (!leaf || leaf.layout === 'title') { out.push(null); return; }

    const options = candidatesFor(leaf, index <= 1 && !leaf.continued);
    const shift = hashId(`${albumId}:${index}`) % options.length;
    const rotated = [...options.slice(shift), ...options.slice(0, shift)];

    // Rule 1: never the same arrangement twice running.
    // Rule 2: if the page before led with pictures, prefer one that leads with words.
    const wantSwitch = previous !== null && isPictureLed(previous);
    const pick =
      rotated.find((l) => l !== previous && isPictureLed(l) !== wantSwitch)
      ?? rotated.find((l) => l !== previous)
      ?? rotated[0];

    out.push(pick);
    previous = pick;
  });

  return out;
}

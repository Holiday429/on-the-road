/* ==========================================================================
   On the Road · Journal albums — choosing between page layouts
   --------------------------------------------------------------------------
   Two rules keep a magazine from reading like a contact sheet, and they are the
   same whatever the layouts are:

     · no layout repeats on the page that follows it, and
     · picture-led and text-led pages alternate where the content allows.

   Beyond that the choice is drawn from the album id and the page number, so a
   book looks the same every time it is opened but different from its neighbour
   on the shelf. Pure: no DOM, no state. (The magazine's paginator —
   magazine-paginate.ts — supplies the options and applies this.)
   ========================================================================== */

import { hashId } from './feed-plan.ts';

/**
 * Pick one of `options` for the page at `index`.
 *
 * `albumId` only shifts where in the list each page starts, so two albums
 * holding the same entries still read differently. `previous` is the layout of
 * the page before (null at the start).
 */
export function pickLayout<T>(
  options: readonly T[],
  previous: T | null,
  isPictureLed: (layout: T) => boolean,
  albumId: string,
  index: number,
): T {
  if (options.length === 1) return options[0];
  const shift = hashId(`${albumId}:${index}`) % options.length;
  const rotated = [...options.slice(shift), ...options.slice(0, shift)];

  // Rule 1: never the same arrangement twice running.
  // Rule 2: if the page before led with pictures, prefer one that leads with words (and vice versa).
  const wantSwitch = previous !== null && isPictureLed(previous);
  return rotated.find((l) => l !== previous && isPictureLed(l) !== wantSwitch)
    ?? rotated.find((l) => l !== previous)
    ?? rotated[0];
}

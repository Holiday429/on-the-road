/* ==========================================================================
   On the Road · Shared colour palette
   Used by the map country fills and the prep sticky-note backgrounds.
   ========================================================================== */

export const MAP_PALETTE = ['#c8b4d4','#b4c8d4','#d4c8b4','#b4d4c8','#d4b4b4','#b4d4b4'];
/* Darker desaturated counterparts for the dark map theme (see map-theme.ts). */
export const MAP_PALETTE_DARK = ['#4a3f50','#3f4a50','#504a3f','#3f504a','#504040','#405040'];

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

/** Pick a stable colour from the shared palette based on any string key. */
export function paletteColor(key: string): string {
  return MAP_PALETTE[hashStr(key) % MAP_PALETTE.length];
}

/* Sticky notes take their colour from the site's own tints (--note-0..5 in
   base.css: brand amber + the category tints, washed toward the page surface),
   so they follow the theme with no per-theme table here. The order alternates
   warm / cool so neighbours in a grid never match. */
export const NOTE_COUNT = 6;
export function noteVar(index: number): string {
  return `var(--note-${((index % NOTE_COUNT) + NOTE_COUNT) % NOTE_COUNT})`;
}

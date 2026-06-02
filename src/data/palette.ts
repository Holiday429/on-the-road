/* ==========================================================================
   On the Road · Shared colour palette
   Used by the map country fills and the prep sticky-note backgrounds.
   ========================================================================== */

export const MAP_PALETTE = ['#c8b4d4','#b4c8d4','#d4c8b4','#b4d4c8','#d4b4b4','#b4d4b4'];

/* Softer, desaturated tints for sticky-note backgrounds — keeps dark ink readable. */
export const NOTE_PALETTE = ['#ece2f3','#e2edf3','#f3ede2','#e2f3ec','#f3e6e6','#e6f3e6'];

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

/** Pick a stable colour from the shared palette based on any string key. */
export function paletteColor(key: string): string {
  return MAP_PALETTE[hashStr(key) % MAP_PALETTE.length];
}

/** Pick a stable soft note tint based on any string key. */
export function noteColor(key: string): string {
  return NOTE_PALETTE[hashStr(key) % NOTE_PALETTE.length];
}

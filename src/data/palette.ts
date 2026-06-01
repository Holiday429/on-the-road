/* ==========================================================================
   On the Road · Shared colour palette
   Used by the map country fills and the prep sticky-note backgrounds.
   ========================================================================== */

export const MAP_PALETTE = ['#c8b4d4','#b4c8d4','#d4c8b4','#b4d4c8','#d4b4b4','#b4d4b4'];

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

/** Pick a stable colour from the shared palette based on any string key. */
export function paletteColor(key: string): string {
  return MAP_PALETTE[hashStr(key) % MAP_PALETTE.length];
}

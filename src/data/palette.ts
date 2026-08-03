/* ==========================================================================
   On the Road · Shared colour palette
   Used by the map country fills and the prep sticky-note backgrounds.
   ========================================================================== */

export const MAP_PALETTE = ['#c8b4d4','#b4c8d4','#d4c8b4','#b4d4c8','#d4b4b4','#b4d4b4'];
/* Darker desaturated counterparts for the dark map theme (see map-shared.ts). */
export const MAP_PALETTE_DARK = ['#4a3f50','#3f4a50','#504a3f','#3f504a','#504040','#405040'];

/* Softer, desaturated tints for sticky-note backgrounds — keeps dark ink readable. */
export const NOTE_PALETTE = ['#ece2f3','#e2edf3','#f3ede2','#e2f3ec','#f3e6e6','#e6f3e6'];
/* Dark-theme counterparts — CSS vars --note-0..5 in base.css mirror these by
   index; this array exists for JS call sites (noteColor) that need a hex
   string directly rather than a var(). */
export const NOTE_PALETTE_DARK = ['#322b3a','#2b333a','#3a342b','#2b3a33','#3a2e2e','#2e3a2e'];

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

/** Pick a stable colour from the shared palette based on any string key. */
export function paletteColor(key: string): string {
  return MAP_PALETTE[hashStr(key) % MAP_PALETTE.length];
}

function isDarkTheme(): boolean {
  try { return document.documentElement.dataset.theme === 'dark'; } catch { return false; }
}

/** Pick a stable soft note tint based on any string key. */
export function noteColor(key: string): string {
  const palette = isDarkTheme() ? NOTE_PALETTE_DARK : NOTE_PALETTE;
  return palette[hashStr(key) % palette.length];
}

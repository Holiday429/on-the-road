/* ==========================================================================
   On the Road · Recap card tones
   --------------------------------------------------------------------------
   Nine cards, nine washes of colour, so the deck reads as many travellers' days
   rather than one grey document. The first seven are the expense categories'
   pastels (src/views/expenses/expense-helpers.ts) — already in the product, with
   dark counterparts, and light enough to carry dark text — plus two new ones so
   no two adjacent cards share a colour family.

   Keyed by card identity, not position, so a deck with a missing card (no radar,
   a skipped chapter) never shifts the colours of the others.

   Used by the DOM deck (as CSS custom properties) and by the canvas export, so
   a saved image is the same colour as the card it came from.
   ========================================================================== */

export interface Tone {
  /** Light-theme wash. */
  light: string;
  /** Dark-theme wash. */
  dark: string;
}

export const TONES: Record<string, Tone> = {
  cover:       { light: '#fdf3dd', dark: '#4a3d1a' }, // warm yellow  (expense: food)
  traits:      { light: '#ede8fb', dark: '#332a4d' }, // soft purple  (shopping)
  attention:   { light: '#ddeeff', dark: '#1e3a52' }, // sky blue     (accommodation)
  method:      { light: '#d1f5e8', dark: '#1a4a3a' }, // mint         (transport)
  relations:   { light: '#fce4e4', dark: '#4a2530' }, // coral pink   (activities)
  friction:    { light: '#ffecd6', dark: '#4d3520' }, // peach        (health)
  recording:   { light: '#e8eef7', dark: '#2a3340' }, // mist blue
  throughline: { light: '#e6f0e4', dark: '#2c3a2a' }, // sage
  closing:     { light: '#f3ede2', dark: '#3a342b' }, // paper brown  (note palette)
};

const FALLBACK: Tone = { light: '#f3f4f6', dark: '#3a3a3a' };

export function toneFor(key: string): Tone {
  return TONES[key] ?? FALLBACK;
}

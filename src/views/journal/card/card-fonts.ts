/* ==========================================================================
   On the Road · Share card — font preloading
   --------------------------------------------------------------------------
   Canvas text rendering does not wait for web fonts. Before drawing we must
   force every weight/family the card uses to be loaded, otherwise the first
   render falls back to a system font and the layout shifts. We load the exact
   `weight family` combinations the specs reference.
   ========================================================================== */

const REQUIRED_FONTS = [
  '400 16px Sora',
  '500 16px Sora',
  '600 16px Sora',
  '700 16px Sora',
  '400 16px "DM Sans"',
  '500 16px "DM Sans"',
  '500 16px Caveat',
  '600 16px Caveat',
  '700 16px Caveat',
];

let fontsReady: Promise<void> | null = null;

/** Resolve once all card fonts are usable on the canvas. Memoized. */
export function ensureCardFonts(): Promise<void> {
  if (fontsReady) return fontsReady;

  fontsReady = (async () => {
    // `document.fonts.load` only fetches; awaiting `ready` afterwards guarantees
    // the faces are parsed and available to the 2D context.
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    try {
      await Promise.all(REQUIRED_FONTS.map((font) => document.fonts.load(font)));
      await document.fonts.ready;
    } catch {
      // Fall through — drawing with a fallback font is better than blocking.
    }
  })();

  return fontsReady;
}

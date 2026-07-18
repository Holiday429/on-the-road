/* ==========================================================================
   On the Road · Analytics
   --------------------------------------------------------------------------
   Thin wrapper around the Plausible script tag (loaded in index.html /
   app.html). No-ops if the script didn't load (adblock, offline, dev without
   the tag) so call sites never need to guard for it.
   ========================================================================== */

type PlausibleFn = (event: string, opts?: { props?: Record<string, string | number | boolean> }) => void;

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

export function track(event: string, props?: Record<string, string | number | boolean>): void {
  try {
    window.plausible?.(event, props ? { props } : undefined);
  } catch {
    // Analytics must never break the app.
  }
}

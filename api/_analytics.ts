/* ==========================================================================
   On the Road · Server-side analytics
   --------------------------------------------------------------------------
   Fires events to the Plausible Events API for things that only happen
   server-side (e.g. a webhook payment confirmation) — the client-side
   payment-return page can't be trusted since the user may never redirect
   back. Fire-and-forget: never let analytics failure affect the response.
   ========================================================================== */

const PLAUSIBLE_DOMAIN = 'easy-on-the-road.app';

export async function trackServerEvent(
  name: string,
  props?: Record<string, string | number | boolean>,
): Promise<void> {
  try {
    await fetch('https://plausible.io/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: PLAUSIBLE_DOMAIN,
        name,
        url: `https://${PLAUSIBLE_DOMAIN}/`,
        props,
      }),
    });
  } catch (e) {
    console.warn('[analytics] trackServerEvent failed:', e);
  }
}

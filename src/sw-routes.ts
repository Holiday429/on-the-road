/* ==========================================================================
   On the Road · Service worker route tests (pure)
   --------------------------------------------------------------------------
   Kept out of sw.ts (which needs a worker scope and Workbox) so the rules can
   be tested as plain functions.
   ========================================================================== */

/**
 * Whether the photo cache may answer this request. Photos in Firebase Storage are cached cache-first, and a page's
 * plain <img> leaves an OPAQUE copy in that cache (no CORS verdict on it). A request in CORS mode — a canvas that
 * means to draw the photo and save the picture (the passport's share image, a journal card) — must never be handed
 * that copy: the browser rejects an opaque answer to a CORS request outright, as a network error. So CORS requests
 * skip the cache and go to the network, where the host answers with its CORS headers.
 */
export function isCachedStoragePhoto(url: URL, request: { mode: RequestMode }): boolean {
  return url.origin === 'https://firebasestorage.googleapis.com' && request.mode !== 'cors';
}

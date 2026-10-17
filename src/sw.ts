/* ==========================================================================
   On the Road · Service worker (injectManifest — see vite.config.ts)
   --------------------------------------------------------------------------
   Workbox precaches every build asset (self.__WB_MANIFEST, injected at build
   time) so offline works for views the user never visited this session — the
   old hand-written cache only covered the app shell + whatever the user had
   already loaded. Runtime routing below adds the app-specific pieces Workbox
   doesn't know about: notification messages and the SPA navigation fallback
   (deep links under /app/* and the marketing site both need to resolve to
   their shell HTML offline, not a network error).

   registerSW()'s onNeedRefresh (see src/core/sw-update.ts) handles telling the
   user a new version is ready — this file only owns caching + notifications.
   ========================================================================== */

/// <reference lib="webworker" />
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, PrecacheFallbackPlugin } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { isCachedStoragePhoto } from './sw-routes.ts';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

self.skipWaiting();
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Navigations (the app shell / marketing shell) — try the network first so
// deploys are picked up immediately, falling back to the precached shell only
// when offline. Workbox's own navigateFallback would map every path to a
// single fallback; /app/* and marketing routes need different shells, so
// that's two NetworkFirst routes, each with a PrecacheFallbackPlugin pointing
// at its own precached shell HTML (app.html / index.html) rather than an
// empty runtime cache — a plain NetworkFirst({cacheName}) here would have
// nothing to fall back to until the network had succeeded at least once.
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && (url.pathname === '/app' || url.pathname.startsWith('/app/')),
  new NetworkFirst({
    cacheName: 'otr-app-shell',
    plugins: [
      new PrecacheFallbackPlugin({ fallbackURL: '/app.html' }),
      new ExpirationPlugin({ maxEntries: 30, purgeOnQuotaError: true }),
    ],
  }),
);
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !(url.pathname === '/app' || url.pathname.startsWith('/app/')),
  new NetworkFirst({
    cacheName: 'otr-marketing-shell',
    plugins: [
      new PrecacheFallbackPlugin({ fallbackURL: '/index.html' }),
      new ExpirationPlugin({ maxEntries: 30, purgeOnQuotaError: true }),
    ],
  }),
);

// Static assets not covered by the precache manifest (e.g. anything added at
// runtime, or same-origin requests Workbox's build-time scan didn't see):
// stale-while-revalidate so repeat visits are instant but never stale forever.
//
// The expiration is not optional. Asset filenames are content-hashed, so every
// deploy introduces a fresh set of URLs and the old ones are never requested
// again — without a bound this cache only ever grows, and once it hits the
// origin's storage quota every `cache.put` here throws QuotaExceededError.
// That surfaces as a flood of uncaught rejections from sw.js and a page running
// on half-loaded chunks. purgeOnQuotaError lets Workbox drop this cache rather
// than keep failing if the origin is squeezed by something else.
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin
    && /\.(js|css|png|jpg|jpeg|svg|gif|webp|woff2?|ico|mp4|webm)(\?.*)?$/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'otr-static-assets',
    plugins: [
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
);

// Journal photos live in Firebase Storage (a different origin, so the
// same-origin route above never matches them) and are immutable once
// uploaded — each upload path is timestamped, never overwritten. Cache-first
// means a photo is fetched once and then reused on every re-render and while
// offline, instead of hitting the network every time the feed redraws.
//
// Only for the page's own <img> requests: a CORS request (a canvas about to draw the photo) handed the opaque copy
// those leave in the cache is rejected by the browser — see sw-routes.ts.
registerRoute(
  ({ url, request }) => isCachedStoragePhoto(url, request),
  new CacheFirst({
    cacheName: 'otr-journal-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 60 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
);

// amCharts (core, map, theme and the geodata files) is loaded from its CDN on
// first use of a map and is several MB, so it isn't bundled or precached. Cache
// it at runtime instead: once a map has been opened, the same scripts come from
// the cache — including offline. The <script> tags are cross-origin without CORS,
// so the responses are opaque (status 0), which CacheableResponsePlugin allows.
// Versioned URLs (/lib/5/...) change rarely; 30 days keeps the cache bounded.
registerRoute(
  ({ url }) => url.origin === 'https://cdn.amcharts.com',
  new CacheFirst({
    cacheName: 'otr-amcharts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
);

// ── Notifications (unchanged from the hand-written SW) ──────────────────────

self.addEventListener('message', (e) => {
  const data = e.data as { type?: string; title?: string; body?: string } | undefined;
  if (data?.type === 'SHOW_NOTIFICATION') {
    e.waitUntil(
      self.registration.showNotification(data.title || 'On the Road', {
        body: data.body || '',
        icon: '/icons/apple-touch-icon.png',
        badge: '/icons/apple-touch-icon.png',
        tag: 'otr-todo-reminder',
      }),
    );
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.startsWith(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    }),
  );
});

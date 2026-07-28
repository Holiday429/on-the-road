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
import { precacheAndRoute, PrecacheFallbackPlugin } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

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
    plugins: [new PrecacheFallbackPlugin({ fallbackURL: '/app.html' })],
  }),
);
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !(url.pathname === '/app' || url.pathname.startsWith('/app/')),
  new NetworkFirst({
    cacheName: 'otr-marketing-shell',
    plugins: [new PrecacheFallbackPlugin({ fallbackURL: '/index.html' })],
  }),
);

// Static assets not covered by the precache manifest (e.g. anything added at
// runtime, or same-origin requests Workbox's build-time scan didn't see):
// stale-while-revalidate so repeat visits are instant but never stale forever.
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin
    && /\.(js|css|png|jpg|jpeg|svg|gif|webp|woff2?|ico|mp4|webm)(\?.*)?$/.test(url.pathname),
  new StaleWhileRevalidate({ cacheName: 'otr-static-assets' }),
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

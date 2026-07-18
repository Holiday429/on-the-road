const CACHE = 'otr-shell-v4';

const SHELL = [
  '/',
  '/index.html',
  '/app',
  '/app.html',
];

self.addEventListener('install', e => {
  // Cache each shell URL independently (not addAll) — addAll aborts the whole
  // install if any single URL 404s (e.g. '/' in local dev, which only
  // resolves via Vercel's production rewrites), which would otherwise leave
  // the SW permanently unregistered instead of just missing that one entry.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(SHELL.map(url => c.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Handle notification messages from the app
self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    e.waitUntil(
      self.registration.showNotification(e.data.title || 'On the Road', {
        body: e.data.body || '',
        icon: '/icons/apple-touch-icon.png',
        badge: '/icons/apple-touch-icon.png',
        tag: 'otr-todo-reminder',
      })
    );
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.startsWith(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow('/');
    })
  );
});

// Network-first for navigation; cache-first for assets
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    // /app and any /app/* deep link fall back to the cached app shell offline;
    // everything else (the marketing site) falls back to the landing page.
    // NOTE: caches.match() returns a Promise, so `a || b` here would always
    // resolve to the first Promise object (always truthy) regardless of
    // whether it matched — must await each candidate in order instead.
    const isApp = url.pathname === '/app' || url.pathname.startsWith('/app/');
    const candidates = isApp ? ['/app', '/app.html'] : ['/', '/index.html'];
    e.respondWith(
      fetch(request).catch(async () => {
        for (const c of candidates) {
          const hit = await caches.match(c);
          if (hit) return hit;
        }
        return Response.error();
      })
    );
    return;
  }

  // Stale-while-revalidate for static assets (JS/CSS/fonts/images/media):
  // serve the cached copy instantly for speed/offline, but always re-fetch in
  // the background and update the cache so edits (e.g. landing.css, the hero
  // video) reach users on their next visit instead of being pinned forever.
  if (/\.(js|css|png|jpg|jpeg|svg|gif|webp|woff2?|ico|mp4|webm)(\?.*)?$/.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(request).then(cached => {
          const network = fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
  }
});

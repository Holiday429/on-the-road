const CACHE = 'otr-shell-v1';

const SHELL = [
  '/on-the-road/',
  '/on-the-road/index.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
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
        icon: '/on-the-road/icons/apple-touch-icon.png',
        badge: '/on-the-road/icons/apple-touch-icon.png',
        tag: 'otr-todo-reminder',
      })
    );
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('/on-the-road/'));
      if (existing) return existing.focus();
      return clients.openWindow('/on-the-road/');
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
    e.respondWith(
      fetch(request).catch(() =>
        caches.match('/on-the-road/') || caches.match('/on-the-road/index.html')
      )
    );
    return;
  }

  // Cache-first for static assets (JS/CSS/fonts/images)
  if (/\.(js|css|png|jpg|jpeg|svg|gif|woff2?|ico)(\?.*)?$/.test(url.pathname)) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return res;
        });
      })
    );
  }
});

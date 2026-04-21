// ATS Draft Service Worker
const CACHE_NAME = 'ats-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

// Push notification handler
self.addEventListener('push', (e) => {
  const data = e.data?.json() ?? {};
  const title = data.title ?? 'ATS Draft';
  const options = {
    body: data.body ?? "It's your turn to pick!",
    icon: '/icon-192.png',
    badge: '/icon-120.png',
    data: { url: data.url ?? '/draft' },
    vibrate: [200, 100, 200],
    requireInteraction: true,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Tap notification → open app at /draft
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? '/draft';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      clients.openWindow(url);
    })
  );
});

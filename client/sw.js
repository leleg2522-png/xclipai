// Retirement worker: removes the old generator's offline shell, then unregisters.
// No fetch handler is installed, so requests are never served from legacy caches.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => /^xclip-v\d+$/.test(key)).map(key => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
  })());
});

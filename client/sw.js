const CACHE_NAME = 'xclip-v5';
const STATIC_ASSETS = [
  '/generator',
  '/index.html',
  '/styles/main.css?v=38',
  '/src/main.js?v=39',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' ||
      url.pathname === '/' || url.pathname === '/developer' ||
      url.pathname === '/developer/' || url.pathname === '/developer.html' ||
      url.pathname.startsWith('/src/developer') || url.pathname === '/styles/developer.css' ||
      url.pathname.startsWith('/api/') || url.pathname.startsWith('/sse')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
           return cached || caches.match('/generator');
        });
      })
  );
});

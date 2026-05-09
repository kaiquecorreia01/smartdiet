// SmartDiet Service Worker — instala como app + offline básico
// IMPORTANTE: bump CACHE_NAME a cada deploy que mexer em assets.
const CACHE_NAME = 'smartdiet-v8';
const URLS_TO_CACHE = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first, fallback to cache. Apenas GETs same-origin e não-Supabase.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Só intercepta same-origin — evita CORS e supply-chain accidental
  if (url.origin !== self.location.origin) return;

  // Nunca cacheia o próprio sw.js
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith(
    fetch(req)
      .then(response => {
        // Não cacheia respostas opacas/erro
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        return response;
      })
      .catch(() => caches.match(req))
  );
});

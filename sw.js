// Höj versionen när filerna ändras så att telefonen hämtar de nya.
const CACHE = 'dagbok-v75';
const FILES = [
  './',
  'index.html',
  'style.css',
  'editor.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/icon-maskable-512.png',
  'fonts/alegreya-italic-latin-ext.woff2',
  'fonts/alegreya-italic-latin.woff2',
  'fonts/alegreya-latin-ext.woff2',
  'fonts/alegreya-latin.woff2',
  'fonts/alegreya-sans-400-latin-ext.woff2',
  'fonts/alegreya-sans-400-latin.woff2',
  'fonts/alegreya-sans-500-latin-ext.woff2',
  'fonts/alegreya-sans-500-latin.woff2',
  'fonts/alegreya-sans-700-latin-ext.woff2',
  'fonts/alegreya-sans-700-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Nätet först, cachen om telefonen är offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Väderanrop går direkt till nätet och sparas inte
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});

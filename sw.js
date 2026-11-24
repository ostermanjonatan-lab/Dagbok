// Höj versionen när filerna ändras så att telefonen hämtar de nya.
const CACHE = 'dagbok-v312';
const FILES = [
  './',
  'index.html',
  'style.css',
  'editor.js',
  'app.js',
  'manifest.webmanifest',
  'fonts/mali-400-latin.woff2',
  'fonts/mali-400-latin-ext.woff2',
  'fonts/mali-600-latin.woff2',
  'fonts/mali-600-latin-ext.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
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
  // no-cache: frågar alltid servern om filen har ändrats, så att webbläsarens egen cache
  // aldrig ger en gammal version av appen
  const req = event.request.mode === 'navigate'
    ? fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(event.request, { cache: 'no-cache' });
  event.respondWith(
    req
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});

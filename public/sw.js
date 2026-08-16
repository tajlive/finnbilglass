/* Finnbilglass.no — service worker.
   Strategi (80 % mobil = raske gjentatte besøk + flaky nett):
   - HTML (navigate): network-first → fersk index.html, cache som offline-fallback.
   - Statisk (styles.css, app.js, ikon.svg): stale-while-revalidate → instant visning
     fra cache, oppdateres i bakgrunnen (selvhelende, aldri vedvarende gammel).
   - API (/api/*): aldri cachet. POST røres aldri. */
const VERSION = 'v1';
const STATIC_CACHE = 'finnbilglass-static-' + VERSION;
const HTML_CACHE = 'finnbilglass-html-' + VERSION;
const PRECACHE = ['/', '/styles.css', '/app.js', '/ikon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== HTML_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // aldri cache POST
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // kun same-origin (fonten håndteres av HTTP-cache)
  if (url.pathname.startsWith('/api/')) return;    // aldri cache API

  // HTML: network-first, cache som offline-fallback.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(HTML_CACHE).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Statisk: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

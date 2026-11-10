// Offline cache: app files + the pose model/WASM (large, rarely change) + satellite tiles.
const CACHE = 'golf-v3';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const heavy = u.hostname === 'storage.googleapis.com' || u.hostname === 'cdn.jsdelivr.net' || u.hostname.endsWith('gstatic.com') || u.hostname === 'server.arcgisonline.com'; // satellite tiles: cache-first so a hole you've opened stays mapped on the course
  const same = u.origin === self.location.origin;
  if (!heavy && !same && !u.hostname.endsWith('googleapis.com')) return;
  if (heavy) {
    // cache-first for model + wasm
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else {
    // network-first for the app itself, so updates land
    e.respondWith(fetch(e.request, { cache: 'no-store' }).then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
  }
});

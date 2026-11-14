// App-shell cache so Tunebox opens instantly and works offline.
// Songs are NOT cached here — they live in IndexedDB (see app.js).
const VERSION = 'tunebox-v11';
const SHELL = ['./', 'index.html', 'app.css?v=11', 'app.js?v=11', 'glass.js?v=11', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('tunebox-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Fetch fresh documents online; keep the installed shell available offline.
// Versioned assets are immutable within a release.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const key = req.mode === 'navigate' ? 'index.html' : req;
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(VERSION).then(async cache => {
      try {
        const response = await fetch(req, { cache: 'no-cache' });
        if (response.ok) {
          await cache.put('index.html', response.clone());
          return response;
        }
        return (await cache.match('index.html')) || response;
      } catch {
        return (await cache.match('index.html')) || Response.error();
      }
    }));
    return;
  }
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(key);
    const net = fetch(req).then(r => {
      if (r && r.ok && r.type === 'basic') cache.put(key, r.clone());
      return r;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const r = await net;
    return r || new Response('Offline', { status: 503 });
  }));
});

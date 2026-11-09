/* Service worker: app shell precache + cache-first for versioned CDN libraries. */
const VERSION = 'pdfloom-v1';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'assets/favicon.svg',
  'js/lib.js', 'js/icons.js', 'js/ui.js', 'js/viewer.js', 'js/app.js',
  'js/tools/essentials.js', 'js/tools/edit.js', 'js/tools/security.js', 'js/tools/convert.js', 'js/tools/smart.js',
];
const CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN_HOSTS.includes(url.hostname)) {
    // versioned third-party assets never change: cache first
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
  } else if (url.origin === location.origin) {
    // own files: network first so updates show up, cache as offline fallback
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
  }
});

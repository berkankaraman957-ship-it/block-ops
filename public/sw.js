/*
 * Service worker — makes BLOCK OPS installable as an app (home-screen icon, fullscreen,
 * no browser bar) and caches the game shell so it opens instantly.
 * Realtime traffic (Socket.io / WebSocket) is never cached.
 */
const CACHE = 'blockops-v1.0.0';
const SHELL = [
  './', 'index.html', 'css/style.css', 'config.js', 'manifest.webmanifest',
  'shared/shared.js', 'vendor/socket.io.min.js',
  'js/main.js', 'js/engine.js', 'js/world.js', 'js/models.js', 'js/viewmodel.js',
  'js/effects.js', 'js/audio.js', 'js/input.js', 'js/hud.js', 'js/net.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/shim-ws') || url.pathname === '/health') return;
  // network-first so updates arrive immediately; cache as offline fallback
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

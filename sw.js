// Кэш оболочки приложения: работает без сети, запросы к базе товаров идут в сеть
const CACHE = 'kalorii-v8';
const SHELL = ['./', 'index.html', 'app.js', 'sync.js', 'foods.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'fonts/onest-cyrillic-400-normal.woff2', 'fonts/onest-cyrillic-500-normal.woff2', 'fonts/onest-cyrillic-600-normal.woff2', 'fonts/onest-cyrillic-700-normal.woff2', 'fonts/onest-latin-400-normal.woff2', 'fonts/onest-latin-600-normal.woff2'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Сначала сеть, чтобы обновления приходили сразу; без сети — из кэша
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});

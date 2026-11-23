// Service worker: la app abre sin conexión. Cambia VERSION al modificar archivos para forzar la actualización.
const VERSION = 'v1.8.0';
const CACHE = `vinyltracker-${VERSION}`;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'favicon.svg', 'css/app.css',
  'js/app.js', 'js/core.js', 'js/config.js', 'js/storage.js', 'js/spotify.js', 'js/discogs.js',
  'js/firebase.js', 'js/collection.js', 'js/zip.js', 'js/dom.js', 'js/charts.js', 'js/stats.js', 'js/statsview.js', 'js/live.js', 'js/artists.js',
  'js/wishlist.js', 'js/wishview.js', 'js/barcode.js', 'js/concerts.js', 'js/concertsview.js', 'js/covers.js', 'js/cloud.js', 'js/imgcache.js', 'js/vendor/zxing.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('vinyltracker-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // APIs externas: directo a la red
  // Datos de tiendas: red primero (se regeneran a diario); sin conexión, la última copia
  if (url.pathname.endsWith('/data/stores.json') || url.pathname.endsWith('/data/concerts.json')) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req)));
    return;
  }
  // Resto: caché primero y se renueva en segundo plano
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});

const CACHE = 'hr-sushi-v4';
const PRECACHE = ['icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// HTML/JS: immer Netz zuerst (Updates greifen sofort), Cache nur als Offline-Fallback.
// Niemals index.html als Ersatz für andere Dateien liefern.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Produktbilder (Inventur): Cache-first -> sofort geladen + offline-fest,
  // da sich Bilder nie ändern (Dateiname = Artikelnummer).
  if (url.origin === location.origin && url.pathname.includes('/icons/items/')) {
    e.respondWith(
      caches.match(req).then(hit => {
        if (hit) return hit;
        return fetch(req).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
          }
          return res;
        });
      })
    );
    return;
  }

  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && new URL(req.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});

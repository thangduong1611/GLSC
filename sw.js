const CACHE = 'hr-sushi-v7';
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

  // Eigene Dateien (index.html, mitarbeiter.html, sw.js selbst, ...):
  // cache:'no-store' erzwingt eine ECHTE Netzwerk-Anfrage - ohne das würde
  // "network-first" nur die eigene Service-Worker-Cache-Storage umgehen,
  // aber der fetch() könnte trotzdem still aus dem normalen HTTP-Cache des
  // Browsers bedient werden (abhängig von den Cache-Control-Headern von
  // GitHub Pages), sodass Änderungen erst nach Ablauf dieses Caches ankommen.
  // Fremde CDN-Skripte (jsPDF, ExcelJS, Firebase-SDK, Google Fonts, ...)
  // bleiben normal cachebar - deren URLs sind ohnehin versioniert/gepinnt,
  // aendern sich also nie unter derselben Adresse, und profitieren vom
  // normalen Browser-Cache (schneller, weniger Datenverbrauch).
  const isOwn = url.origin === location.origin;
  e.respondWith(
    fetch(req, isOwn ? { cache: 'no-store' } : {}).then(res => {
      if (res && res.ok && isOwn) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});

// Service worker: keeps the app (and the PDF/Excel libraries) on the phone
// so it opens and works with no signal. Your data is in IndexedDB, not here.
const VERSION = 'fscf-doors-v0.6.0';
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then(async (c) => {
      await c.addAll(SHELL);
      // Libraries are cached too, but a failure here shouldn't block install
      await Promise.all(LIBS.map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || url.host === 'cdnjs.cloudflare.com' || url.host.endsWith('fonts.googleapis.com') || url.host.endsWith('fonts.gstatic.com');
  if (!cacheable) return;
  // Stale-while-revalidate: answer from cache instantly, refresh in background
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
      const net = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      }).catch(() => hit || (req.mode === 'navigate' ? c.match('index.html') : Response.error()));
      return hit || net;
    })
  );
});

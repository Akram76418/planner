/* Service worker: app shell offline + Web Push display. Bump VERSION when files change. */
const VERSION = 'planner-v35';
const SHELL = ['./', './index.html', './config.js', './sync.js', './comm.js', './ext.js', './logs.js', './ledger.js', './logo.png', './manifest.json', './icon-192.png', './icon-512.png'];
const CDN = ['https://cdn.jsdelivr.net/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const cdn = CDN.some(p => req.url.startsWith(p));
  if (!sameOrigin && !cdn) return;                 // Supabase API calls always go to the network
  if (cdn) {                                       // cache-first for pinned CDN files and fonts
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); return r; })));
    return;
  }
  e.respondWith(                                   // stale-while-revalidate for the app shell
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const net = fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; }).catch(() => hit || caches.match('./index.html'));
      return hit || net;
    })
  );
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'My Daily Planner', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'My Daily Planner', { body: d.body || '', tag: d.tag || undefined, vibrate: [200, 100, 200], data: { url: d.url || './index.html' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) return w.focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './index.html');
  }));
});

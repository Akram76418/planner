/* Service worker: يعمل التطبيق دون إنترنت، ويتحدّث تلقائياً عند توفر الاتصال. ارفع VERSION عند تغيير أي ملف. */
const VERSION = 'planner-v74';
const CDN_CACHE = 'planner-cdn';          // مكتبات الخارج والخطوط: لا تُحذف عند تحديث النسخة حتى يعمل التطبيق دون نت دائماً
const SHELL = ['./', './index.html', './config.js', './sync.js', './comm.js', './ext.js', './logs.js', './ledger.js', './takaful.js', './booking.js', './iv.js', './logo.png', './manifest.json', './icon-192.png', './icon-512.png'];
const CDN_PRE = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js', 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Readex+Pro:wght@500;600&display=swap'];
const CDN = ['https://cdn.jsdelivr.net/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];
const NET_WAIT = 4000;                    // ننتظر الشبكة 4 ثوانٍ كحد أقصى ثم نعرض النسخة المحفوظة

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(VERSION).then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => { if (r.ok) return c.put(u, r); }).catch(() => {})))),
    caches.open(CDN_CACHE).then(c => Promise.all(CDN_PRE.map(u => c.match(u).then(h => h || fetch(u).then(r => { if (r.ok) return c.put(u, r); }).catch(() => {}))))),
  ]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== CDN_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

function withTimeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, er => { clearTimeout(t); rej(er); }); }); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const cdn = CDN.some(p => req.url.startsWith(p));
  if (sameOrigin && url.pathname.endsWith('/book.html')) return;   // صفحة الطلبة: دائماً مباشرة
  if (sameOrigin && url.pathname.endsWith('/give.html')) return;   // صفحة فاعل الخير: دائماً مباشرة
  if (!sameOrigin && !cdn) return;                                  // طلبات Supabase تذهب للشبكة دائماً
  if (cdn) {                                                        // ملفات الخارج: من الذاكرة أولاً (نسخها مثبّتة بالإصدار)
    e.respondWith(caches.open(CDN_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }))));
    return;
  }
  // ملفات التطبيق: الشبكة أولاً (تحديث فوري عند وجود نت) ثم النسخة المحفوظة دون نت
  e.respondWith(
    withTimeout(fetch(req, { cache: 'no-cache' }), NET_WAIT).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
      return r;
    }).catch(() => caches.open(VERSION).then(c => c.match(req, { ignoreSearch: true })).then(hit => hit || caches.match(req, { ignoreSearch: true })).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
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

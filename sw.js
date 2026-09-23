/* オフライン用 Service Worker
 * 文言や画面を更新したら CACHE の版番号を上げてください（例：v1.0.1）。
 */
var CACHE = 'pa-assist-v1.1.1';
var FONT_CACHE = 'pa-assist-fonts';
var SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/speech.js',
  './js/app.js',
  './data/announcements.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== CACHE && k !== FONT_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Google Fonts：あればキャッシュ、裏で更新（なくても端末のゴシック体で表示される）
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // 文言データ：通信できれば最新、できなければキャッシュ
  if (url.pathname.endsWith('/data/announcements.json')) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put('./data/announcements.json', copy); });
      return res;
    }).catch(function () {
      return caches.match('./data/announcements.json');
    }));
    return;
  }

  // それ以外：キャッシュ優先
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(req).catch(function () {
      if (req.mode === 'navigate') return caches.match('./index.html');
    });
  }));
});

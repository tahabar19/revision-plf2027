/* Service worker : rend le site utilisable hors ligne (GitHub Pages / https). */
var SHELL = 'rev27-shell-v2';
var AUDIO = 'rev27-audio';
var FILES = ['./', 'index.html', 'styles.css', 'app.js', 'data.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('rev27-shell') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function rangeFrom(req, resp) {
  var range = req.headers.get('range');
  if (!range) return resp;
  return resp.arrayBuffer().then(function (buf) {
    var m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    var size = buf.byteLength;
    var start = m[1] ? parseInt(m[1], 10) : 0;
    var end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (!m[1] && m[2]) { start = size - parseInt(m[2], 10); end = size - 1; }
    end = Math.min(end, size - 1);
    return new Response(buf.slice(start, end + 1), {
      status: 206,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' }
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // MP3 : depuis le cache s'ils ont été téléchargés (avec gestion des requêtes Range)
  if (/\.mp3$/.test(url.pathname)) {
    e.respondWith(caches.open(AUDIO).then(function (c) {
      return c.match(url.pathname.split('/').slice(-2).join('/'), { ignoreSearch: true }).then(function (hit) {
        return hit || c.match(req, { ignoreSearch: true, ignoreVary: true });
      }).then(function (hit) { return hit ? rangeFrom(req, hit) : fetch(req); });
    }));
    return;
  }
  // Le reste : réseau d'abord (contenu à jour), cache en secours
  e.respondWith(fetch(req).then(function (r) {
    if (r.ok && (url.pathname.indexOf('/audio/') < 0 || /manifest\.json$/.test(url.pathname))) {
      var copy = r.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); });
    }
    return r;
  }).catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); }); }));
});

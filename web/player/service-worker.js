'use strict';
// Generated with the release: all public player assets, never account/API data.
importScripts('/offline-assets.js');
var CACHE = 'mineradio-shell-' + self.MINERADIO_OFFLINE.revision;
var PATHS = new Set(self.MINERADIO_OFFLINE.paths);
var progress = { type:'mineradio:offline', revision:self.MINERADIO_OFFLINE.revision, state:'installing', done:0, total:PATHS.size };
async function announce(value) {
  progress = Object.assign({}, progress, value);
  var clients = await self.clients.matchAll({ includeUncontrolled:true, type:'window' });
  clients.forEach(function (client) { client.postMessage(progress); });
}
async function boundedFetch(url, timeout) {
  var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, timeout);
  try { return await fetch(url, { cache:'no-store', credentials:'same-origin', signal:controller.signal }); }
  finally { clearTimeout(timer); }
}
self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE), pending = Array.from(PATHS), failed;
    await Promise.all(Array.from({length:6}, async function () {
      while (pending.length && !failed) {
        var path = pending.shift();
        try {
          var response = await boundedFetch(path, 30000);
          if (!response.ok || response.redirected || response.type === 'opaque') throw new Error('Asset unavailable');
          await cache.put(path, response);
          await announce({ done:progress.done + 1 });
        } catch (error) { failed = error; }
      }
    }));
    if (failed) {
      await caches.delete(CACHE);
      await announce({ state:'failed' });
      throw failed;
    }
    await announce({ state:'ready' });
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    // Music/lyrics/visual preferences in IndexedDB/localStorage are untouched.
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (key) {
      return key !== CACHE && (key.startsWith('mineradio-shell-') || key === 'mineradio-offline-v1');
    }).map(function (key) { return caches.delete(key); }));
    await self.clients.claim();
    await announce({ state:'ready', done:PATHS.size });
  })());
});
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'mineradio:offline-status') {
    event.waitUntil((async function () {
      var entries = await (await caches.open(CACHE)).keys();
      await announce({ state:entries.length === PATHS.size ? 'ready' : progress.state, done:entries.length });
    })());
  }
});
self.addEventListener('fetch', function (event) {
  var request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Keep the HTML and scripts on one completely prepared release.
  var path = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html') ? '/' : url.pathname;
  if (!PATHS.has(path)) return;
  event.respondWith((async function () {
    var cached = await (await caches.open(CACHE)).match(path);
    return cached || fetch(request);
  })());
});

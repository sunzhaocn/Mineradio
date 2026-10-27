"""Fresh native-app entry point: retire only the former UI shell cache."""

BOOTSTRAP_HTML = br'''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mineradio</title><style>body{background:#0b0e12;color:#dce8ef;font:18px system-ui;display:grid;place-items:center;min-height:90vh}</style>
<body><p id="status">Mineradio</p><script>
'use strict';
window.mineradioEmbeddedCleanup = (async function () {
  if (!(window.desktopWindow && window.desktopWindow.isDesktop) && !window.MineradioAndroid)
    throw new Error('Native app entry required');
  var removedRegistrations = 0, removedCaches = 0;
  if ('serviceWorker' in navigator) {
    var registrations = await navigator.serviceWorker.getRegistrations();
    for (var registration of registrations) {
      var workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
      var own = registration.scope === location.origin + '/' && workers.some(function (worker) {
        var url = new URL(worker.scriptURL);
        return url.origin === location.origin && url.pathname === '/service-worker.js';
      });
      if (own && await registration.unregister()) removedRegistrations++;
    }
  }
  if ('caches' in window) {
    for (var key of await caches.keys()) {
      if (key.startsWith('mineradio-shell-') || key === 'mineradio-offline-v1') {
        if (await caches.delete(key)) removedCaches++;
      }
    }
  }
  return { embedded:true, removedRegistrations:removedRegistrations, removedCaches:removedCaches };
})();
window.mineradioEmbeddedCleanup.then(function () {
  var next = new URL(location.href).searchParams.get('next');
  if (!next) return;
  var target = new URL(next, location.origin);
  if (target.origin !== location.origin || target.pathname !== '/') throw new Error('Invalid app destination');
  location.replace(target.href);
}).catch(function () { document.getElementById('status').textContent = '\u64ad\u653e\u5668\u51c6\u5907\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00'; });
</script></body></html>'''

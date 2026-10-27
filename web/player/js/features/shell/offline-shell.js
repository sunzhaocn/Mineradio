'use strict';
(function () {
  var badge, registration, connected = navigator.onLine !== false, hideTimer, updateReady = false, latestRevision = '';
  var state = { state:'checking', done:0, total:0 };
  function render() {
    if (!document.body) return;
    if (!badge) {
      badge = document.createElement('button'); badge.id = 'offline-status'; badge.type = 'button';
      badge.setAttribute('role', 'status'); badge.setAttribute('aria-live', 'polite');
      badge.style.cssText = 'position:fixed;z-index:100001;top:calc(env(safe-area-inset-top,0px) + 10px);left:50%;transform:translateX(-50%);max-width:90vw;padding:9px 15px;border:1px solid #ffffff25;border-radius:18px;background:#171b29ed;color:#edf1ff;font:13px system-ui;box-shadow:0 4px 20px #0005;';
      badge.onclick = function () {
        if (updateReady) { location.reload(); return; }
        if (!connected && typeof loadPersistedLocalLibraryIntoQueue === 'function') {
          if (typeof dismissSplash === 'function') dismissSplash({ fastSkip:true });
          if (!loadPersistedLocalLibraryIntoQueue() && typeof showToast === 'function') showToast('本地曲库暂无歌曲，联网下载或导入音频后即可离线播放');
        }
        else if (state.state === 'failed' && registration) { state.state = 'checking'; render(); registration.update().catch(failure); }
      };
      document.body.appendChild(badge);
    }
    clearTimeout(hideTimer); badge.hidden = false;
    if (!connected) badge.textContent = '离线模式 · 点击打开本地音乐';
    else if (updateReady) badge.textContent = '更新已就绪 · 点击重新打开';
    else if (state.state === 'ready') {
      badge.textContent = '离线初始化完成 · 断网也可打开';
      hideTimer = setTimeout(function () { badge.hidden = true; }, 5000);
    } else if (state.state === 'embedded') {
      // The iOS app ships its complete UI on-device. WKWebView may not expose
      // Service Workers; it still opens offline from the embedded HTTP server.
      badge.hidden = true;
    } else if (state.state === 'failed') badge.textContent = '离线资源未保存完整 · 联网后点击重试';
    else if (state.state === 'unsupported') badge.textContent = '此客户端无法保存离线界面，请更新 App';
    else badge.textContent = '正在保存离线界面和视觉预设' + (state.total ? ' · ' + state.done + '/' + state.total : '…');
    window.mineradioOfflineStatus = Object.assign({ connected:connected }, state);
  }
  function failure() { state.state = 'failed'; render(); }
  async function connectivity() {
    if (navigator.onLine === false) { connected = false; render(); return; }
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 4000);
    try { connected = (await fetch('/__health', { cache:'no-store', signal:controller.signal })).ok; }
    catch (_) { connected = false; }
    finally { clearTimeout(timer); render(); }
  }
  async function start() {
    if (!(location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) return;
    render(); connectivity();
    if (!('serviceWorker' in navigator)) {
      state.state = window.__mineradioIOS ? 'embedded' : 'unsupported'; render(); return;
    }
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (!event.data || event.data.type !== 'mineradio:offline') return;
      if (registration && registration.installing && event.source === registration.active) return;
      if (event.data.revision) latestRevision = event.data.revision;
      state = event.data; render();
    });
    navigator.serviceWorker.addEventListener('controllerchange',function(){
      // First-time offline initialization must not reload an already usable
      // page while a user is choosing/importing music. It is already current.
      if (!hadController) { hadController = true; return; }
      updateReady = true;
      var key = 'mineradio-web-refresh-' + (latestRevision || 'current');
      if (!(window.audio && !window.audio.paused) && !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key,'1');location.reload();
      } else render();
    });
    try {
      registration = await navigator.serviceWorker.register('/service-worker.js', { updateViaCache:'none' });
      registration.addEventListener('updatefound', function () {
        var worker = registration.installing;
        state.state = 'installing'; render();
        worker.addEventListener('statechange', function () { if (worker.state === 'redundant') failure(); });
      });
      if (navigator.onLine !== false) {
        try { await registration.update(); } catch (_) { if (!registration.active) throw _; }
      }
      if (registration.active && !registration.installing) registration.active.postMessage({ type:'mineradio:offline-status' });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    } catch (_) { failure(); }
  }
  window.addEventListener('online', connectivity);
  window.addEventListener('offline', function () { connected = false; render(); });
  window.addEventListener('mineradio:ready', connectivity);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();

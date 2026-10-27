'use strict';
(function () {
  var actions = document.getElementById('top-right');
  if (actions && window.ResizeObserver) new ResizeObserver(function () {
    document.documentElement.style.setProperty('--header-actions-width', Math.ceil(actions.getBoundingClientRect().width) + 'px');
  }).observe(actions);
  var device = !!window.__mineradioAndroid || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && navigator.platform === 'MacIntel');
  document.body.classList.toggle('mobile-device', device);
  var setDeviceVolume = false;
  function ready() {
    if (device && !setDeviceVolume && typeof setVolume === 'function') { setDeviceVolume = true; setVolume(1, true); }
    if (device) {
      var volume = document.getElementById('volume-btn');
      if (volume) { volume.title = '淡入淡出'; volume.setAttribute('aria-label', '淡入淡出'); }
    }
  }
  window.addEventListener('mineradio:ready', ready); ready();
})();

(function () {
  var bridge = window.desktopWindow || window.mineradioAndroidUpdater;
  if (!bridge || typeof bridge.checkForUpdates !== 'function') return;
  var android = bridge.platform === 'android';
  var state = { status: 'idle', progress: 0 };
  var busy = function () { return ['checking', 'downloading', 'installing'].indexOf(state.status) >= 0; };
  function render() {
    if (typeof updatePreviewState === 'undefined') return;
    updatePreviewState.currentVersion = state.currentVersion || updatePreviewState.currentVersion;
    updatePreviewState.version = state.version || state.currentVersion || updatePreviewState.version;
    updatePreviewState.updateAvailable = !!state.updateAvailable;
    updatePreviewState.status = state.status;
    var entry = document.getElementById('update-entry');
    if (entry) {
      entry.title = state.updateAvailable ? '发现新版本，点击更新' : '检查更新';
      entry.setAttribute('aria-label', entry.title);
      entry.classList.toggle('downloading', state.status === 'downloading');
    }
    if (typeof setUpdatePreviewVisible === 'function' && !updatePreviewState.visible) setUpdatePreviewVisible(true);
    var version = document.getElementById('update-modal-version');
    if (version) version.textContent = 'v' + updatePreviewState.version;
    var title = document.getElementById('update-modal-title');
    if (title) title.textContent = '软件更新';
    var hero = document.getElementById('update-hero-main');
    if (hero) hero.textContent = state.status === 'checking' ? '正在检查 GitHub 最新版本…'
      : android && state.status === 'downloaded' ? '安装包已校验，可在系统安装界面完成更新。'
      : state.status === 'installing' ? '下载校验完成，即将自动退出并安装更新。'
      : state.status === 'downloading' ? (android ? '正在下载更新，完成后打开系统安装界面。' : '正在下载更新，完成后自动退出并安装。')
      : state.status === 'error' ? '更新暂时失败，可以重试。'
      : state.updateAvailable ? '新版本已就绪，点击即可下载更新。' : '当前已是最新版本。';
    var sources = document.getElementById('update-download-sources');
    if (sources) sources.hidden = true;
    var list = document.getElementById('update-list');
    if (list) list.classList.toggle('android-update-notes', android);
    if (list) list.textContent = '当前版本 v' + updatePreviewState.currentVersion + ' · 来源：sunzhaocn/Mineradio'
      + (android && state.notes ? '\n\n' + state.notes : '');
    var button = document.getElementById('update-primary-btn');
    if (button) button.disabled = busy();
    var label = document.getElementById('update-btn-label');
    if (label) label.textContent = state.status === 'checking' ? '正在检查…'
      : state.status === 'downloading' ? '正在下载 ' + Math.floor(state.progress || 0) + '%'
      : state.status === 'installing' ? '即将退出并安装…'
      : android && state.status === 'downloaded' ? '安装更新'
      : state.updateAvailable ? '立即更新' : '检查更新';
    var fill = document.getElementById('update-btn-fill');
    if (fill) fill.style.width = (state.progress || 0) + '%';
    var foot = document.getElementById('update-footnote');
    if (foot) foot.textContent = state.error || (state.status === 'downloading'
      ? (state.transferred / 1048576).toFixed(1) + ' / ' + (state.total / 1048576).toFixed(1) + ' MB · '
        + (android ? '请保持应用运行，完成后按系统提示安装' : '下载期间可继续使用，完成后自动退出')
      : android ? '从 GitHub 下载并校验安装包，按系统提示覆盖安装。保留账号、歌单、本地音乐和设置。'
      : '点击立即更新后，下载并校验安装包，自动退出并覆盖安装。保留账号、歌单和设置，安装后可重新打开。');
    var androidEntry = document.getElementById('android-update-entry');
    if (androidEntry) androidEntry.textContent = state.status === 'downloading' ? '下载 ' + Math.floor(state.progress || 0) + '%'
      : state.status === 'downloaded' ? '安装更新' : state.updateAvailable ? '发现新版本' : '检查更新';
    var secondary = document.querySelector('#update-modal .update-secondary-btn');
    if (secondary) secondary.textContent = busy() ? '收起' : '关闭';
  }
  function accept(value) { if (value && value.status) state = value; render(); }
  async function check() {
    if (busy()) return;
    state.status = 'checking'; render();
    try { accept(await bridge.checkForUpdates()); }
    catch (error) { accept({ ...state, status: 'error', error: error.message }); }
  }
  async function download() {
    if (busy()) return;
    if (!state.updateAvailable) return check();
    state.status = 'downloading'; render();
    try { accept(await bridge.downloadUpdate()); }
    catch (error) { accept({ ...state, status: 'error', error: error.message }); }
  }
  window.mineradioNativeUpdater = { check: check, download: download, render: render };
  bridge.onUpdateState(accept);
  window.addEventListener('mineradio:ready', function () {
    if (android) {
      var actions = document.querySelector('.web-library-actions');
      if (actions && !document.getElementById('android-update-entry')) {
        var entry = document.createElement('button');
        entry.id = 'android-update-entry'; entry.type = 'button'; entry.textContent = '检查更新';
        entry.addEventListener('click', function () { openUpdatePanel(); });
        actions.appendChild(entry);
      }
    }
    bridge.getUpdateState().then(accept).then(function () { if (!android) return check(); }).catch(function () {});
  }, { once: true });
})();

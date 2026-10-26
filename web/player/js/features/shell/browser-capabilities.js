'use strict';

// A browser keeps the shared player, but cannot invoke Electron's OS APIs.
(function () {
  var desktop = !!(window.desktopWindow && window.desktopWindow.isDesktop === true);
  var nativeFxMethods = {
    desktopLyrics: 'setDesktopLyricsEnabled',
    desktopLyricsClickThrough: 'setDesktopLyricsEnabled',
    desktopLyricsCinema: 'setDesktopLyricsEnabled',
    desktopLyricsHighlight: 'setDesktopLyricsEnabled',
    wallpaperMode: 'setWallpaperMode',
    memoryAutoTrimApp: 'trimAppMemory',
    memoryAutoTrimOnBackground: 'trimAppMemory',
    memoryAutoSystemTrim: 'purgeSystemMemory',
    memorySystemAutoElevate: 'purgeSystemMemory'
  };
  function nativeMethod(name) {
    return !!(desktop && typeof window.desktopWindow[name] === 'function');
  }
  window.mineradioCapabilities = Object.freeze({
    desktop: desktop,
    nativeMethod: nativeMethod,
    supportsFx: function (key) { return !nativeFxMethods[key] || nativeMethod(nativeFxMethods[key]); },
    supportsHotkey: function (action, scope) {
      if (scope === 'global' && !nativeMethod('configureGlobalHotkeys')) return false;
      if (action === 'toggleDesktopLyrics') return nativeMethod('setDesktopLyricsEnabled');
      if (action === 'toggleDesktopInteraction') return false;
      return true;
    }
  });
  if (desktop) return;
  document.documentElement.classList.add('browser-runtime');

  var nativeSelectors = [
    '#t-desktopLyrics', '#t-desktopLyricsClickThrough', '#t-desktopLyricsCinema', '#t-desktopLyricsHighlight',
    '#fx-desktoplyricssize', '#fx-desktoplyricsopacity', '#fx-desktoplyricsy', '#desktop-lyrics-fps-seg',
    '#t-wallpaperMode', '#fx-wallpaperopacity', '#wallpaper-fps-seg', '.desktop-mode-note',
    '.wallpaper-engine-row', '#wallpaper-engine-opacity', '#wallpaper-engine-position-x',
    '#wallpaper-engine-position-y', '#wallpaper-engine-scale', '#close-behavior-seg',
    '#t-memoryAutoTrimApp', '#t-memoryAutoTrimOnBackground', '#t-memoryAutoSystemTrim', '#t-memorySystemAutoElevate',
    '#memory-mask-seg', '#fx-memory-interval', '#fx-memory-threshold', '.memory-action-row', '#cache-storage-panel'
  ];
  function disableBlock(node) {
    var block = node.closest('[data-fx-console-entry],.fx-slider,.lyric-color-row,.fx-seg,.fx-toggle,.hotkey-row') || node;
    block.classList.add('browser-native-only');
    block.setAttribute('inert', '');
    block.setAttribute('aria-disabled', 'true');
    block.title = '此功能需要 Windows 安装版';
    if (block.matches('button,input,select,textarea')) block.disabled = true;
    block.querySelectorAll('button,input,select,textarea').forEach(function (control) { control.disabled = true; });
    return block;
  }
  function text(id, value) {
    var node = document.getElementById(id);
    if (node && node.textContent !== value) node.textContent = value;
  }
  function adaptHotkeys() {
    var modal = document.getElementById('hotkey-modal');
    if (!modal) return;
    var tab = modal.querySelector('[data-hotkey-scope="global"]');
    if (tab) {
      tab.disabled = true;
      tab.title = '全局快捷键需要 Windows 安装版';
      tab.setAttribute('aria-disabled', 'true');
    }
    var globalSection = document.getElementById('hotkey-global-section');
    if (globalSection) {
      globalSection.setAttribute('inert', '');
      globalSection.setAttribute('aria-disabled', 'true');
    }
    modal.querySelectorAll('#hotkey-local-section [data-hotkey-action="toggleDesktopLyrics"],#hotkey-local-section [data-hotkey-action="toggleDesktopInteraction"]').forEach(function (button) {
      disableBlock(button);
    });
    var subtitle = modal.querySelector('.hotkey-sub');
    var explanation = '网页快捷键在当前页面内生效；全局快捷键和桌面功能需要 Windows 安装版。';
    if (subtitle && subtitle.textContent !== explanation) subtitle.textContent = explanation;
  }
  function apply() {
    document.querySelectorAll(nativeSelectors.join(',')).forEach(disableBlock);
    text('memory-status-chip', '系统内存优化仅 Windows 安装版可用');
    text('memory-status-sub', '网页渲染性能可在“性能与后台”中调整。');
    text('cache-storage-total', '由浏览器管理');
    text('cache-storage-root', '当前浏览器的网页存储');
    text('cache-storage-note', '网页存储由浏览器管理；自定义磁盘缓存目录需要 Windows 安装版。');
    var systemPage = document.getElementById('fx-console-page-system');
    if (systemPage && !document.getElementById('browser-native-features-note')) {
      var note = document.createElement('p');
      note.id = 'browser-native-features-note';
      note.className = 'browser-capability-note';
      note.textContent = '桌面歌词、壁纸、托盘、系统内存优化和缓存目录设置需使用 Windows 安装版。';
      systemPage.prepend(note);
    }
    adaptHotkeys();
    var modal = document.getElementById('hotkey-modal');
    if (modal && !modal._browserCapabilitiesObserved) {
      modal._browserCapabilitiesObserved = true;
      // Hotkey rows are rebuilt after editing a binding; their parent remains.
      var observer = new MutationObserver(adaptHotkeys);
      observer.observe(modal, { childList: true, subtree: true });
    }
  }
  window.addEventListener('mineradio:ready', function () { queueMicrotask(apply); }, { once: true });
  if (window.MINERADIO_MODULE_STATUS && window.MINERADIO_MODULE_STATUS.ready) queueMicrotask(apply);
}());

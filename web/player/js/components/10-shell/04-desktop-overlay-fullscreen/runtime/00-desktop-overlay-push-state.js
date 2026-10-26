'use strict';

var desktopOverlayPushState = {
  lyricsAt: 0,
  wallpaperAt: 0,
  lastLyricsKey: '',
  lastLyricsBeatKey: '',
  lastLyricsCustomFontId: '',
  lastWallpaperKey: ''
};

var desktopWallpaperRuntimeState = {
  supported: true,
  active: false,
  enabled: false,
  attaching: false,
  generation: -1,
  lastError: ''
};

var desktopWallpaperStatusGeneration = -1;

var desktopWallpaperStatusUnsubscribe = null;

var desktopWallpaperRendererOperation = 0;

var desktopWallpaperUiActivationState = false;

var desktopWallpaperHudPrimeTimer = 0;

var desktopIconVisibilityOperation = 0;

var desktopIconVisibilityPending = false;

var desktopSoftwareLockOperation = 0;

var desktopSoftwareLockPending = false;

var desktopModeControlDockState = {
  open: false,
  hideTimer: 0,
  peek: false,
  peekTimer: 0
};

var desktopPointerRouteReporter = {
  timer: 0,
  x: 0,
  y: 0,
  hasPointer: false,
  lastKey: '',
  forcePending: false,
  overControls: false
};

var desktopIconShieldReporter = {
  timer: 0,
  forceEmptyPending: false,
  lastKey: '',
  mutationObserver: null,
  resizeObserver: null,
  shelfTimer: 0,
  observedElements: []
};

var DESKTOP_ICON_SHIELD_TARGETS = [
  { selector: '#bottom-bar', kind: 'player-control' },
  { selector: '#search-area', kind: 'search' },
  { selector: '#top-right', kind: 'account-actions' },
  { selector: '#desktop-mode-control-handle', kind: 'desktop-controls' },
  { selector: '#desktop-mode-control-panel', kind: 'desktop-controls' },
  { selector: '#fx-panel', kind: 'fx-panel' },
  { selector: '#fx-fab', kind: 'fx-launcher' },
  { selector: '#fx-fab-hide-btn', kind: 'fx-launcher-toggle' },
  { selector: '#playlist-panel', kind: 'playlist-panel' },
  { selector: '#empty-home', kind: 'home' },
  { selector: '#desktop-titlebar', kind: 'window-controls' },
  { selector: '#fullscreen-diy-zone', kind: 'fullscreen-tools', ignoreAriaHidden: true },
  { selector: '#upload-panel', kind: 'upload-panel' },
  { selector: '#upload-tip', kind: 'upload-tip' },
  { selector: '#bottom-handle', kind: 'player-handle' },
  { selector: '#mini-queue-popover', kind: 'mini-queue' },
  { selector: '#thumb-wrap', kind: 'cover-control' },
  { selector: '#trial-banner', kind: 'trial-banner' },
  { selector: '#source-fallback-notice', kind: 'source-notice' },
  { selector: '#ai-depth-chip', kind: 'depth-chip' },
  { selector: '#beat-chip', kind: 'beat-chip' },
  { selector: '#cover-color-pop', kind: 'cover-color' },
  { selector: '#color-lab-pop', kind: 'color-lab' },
  { selector: '.quality-popover', kind: 'quality-popover' },
  { selector: '.volume-popover', kind: 'volume-popover' },
  { selector: '#lyric-timing-popover', kind: 'lyric-timing-popover' },
  { selector: '#control-source-switcher', kind: 'source-switcher' },
  { selector: '#cuefield-feedback', kind: 'cuefield-feedback' },
  { selector: '#cookie-export-prompt', kind: 'cookie-export' },
  { selector: '.modal-mask', kind: 'modal', visual: true },
  { selector: '#toast', kind: 'toast', visual: true },
  { selector: '#visual-guide', kind: 'guide', visual: true },
  { selector: '#drop-overlay', kind: 'drop', visual: true },
  { selector: '#splash', kind: 'splash', visual: true }
];

var DESKTOP_ICON_SHIELD_SELECTOR = DESKTOP_ICON_SHIELD_TARGETS.map(function (target) {
  return target.selector;
}).join(',');

setInterval(function () {
  if (fx && fx.desktopLyrics) syncDesktopOverlayState();
  if (fx && fx.wallpaperMode) ensureDesktopWallpaperFunctionalUi('health-watch');
}, 320);


// 全屏
var desktopFullscreenActive = false;

var documentFullscreenActive = false;

var desktopWindowState = {};

var desktopWindowMinimizeTimer = 0;

var desktopWindowRestoreTimer = 0;


(function initDesktopWindowShell() {
  var api = window.desktopWindow;
  if (!api || !api.isDesktop) return;

  document.documentElement.classList.add('desktop-shell-root');
  document.body.classList.add('desktop-shell');
  document.body.classList.remove('desktop-fullscreen');
  desktopFullscreenActive = false;
  syncCursorAutoHideMode();

  var maxBtn = document.querySelector('[data-window-action="maximize"]');
  var maxIcon = maxBtn && maxBtn.querySelector('.icon-maximize');
  var restoreIcon = maxBtn && maxBtn.querySelector('.icon-restore');
  function applyState(state) {
    var wasHidden = !!desktopWindowState.isMinimized || desktopWindowState.isVisible === false;
    desktopWindowState = Object.assign(desktopWindowState, state || {});
    var isHidden = !!desktopWindowState.isMinimized || desktopWindowState.isVisible === false;
    if (wasHidden && !isHidden) animateDesktopWindowRestore();
    var isMaximized = !!desktopWindowState.isMaximized;
    var isFullScreen = !!desktopWindowState.isFullScreen || !!desktopWindowState.isNativeFullScreen || !!desktopWindowState.isHtmlFullScreen || !!desktopWindowState.isWindowFullScreen || !!document.fullscreenElement;
    var wasFullScreen = desktopFullscreenActive;
    desktopFullscreenActive = isFullScreen;
    document.body.classList.toggle('desktop-maximized', isMaximized);
    document.body.classList.toggle('desktop-fullscreen', isFullScreen);
    syncDesktopWallpaperBodyClasses(
      desktopWallpaperRuntimeState,
      desktopWindowState.isDesktopEmbedded === true,
      desktopWindowState.isDesktopInteractive === true
    );
    applyDesktopWallpaperSafeArea(desktopWallpaperRuntimeState, desktopWindowState.isDesktopEmbedded === true);
    scheduleDesktopIconShieldReport(!(desktopWindowState.isDesktopEmbedded === true && desktopWindowState.isDesktopInteractive === true));
    updateDesktopModeControl(desktopWallpaperRuntimeState);
    scheduleDesktopPointerRouteReport(null, true);
    desktopRuntimeState.fullscreen = isFullScreen;
    if (isFullScreen) layoutFullscreenDiyZone();
    if (isFullScreen !== wasFullScreen) {
      scheduleMainRendererViewportRefresh('desktop-shell-state');
      if (!isFullScreen) {
        document.body.classList.remove('fullscreen-diy-peek');
        setTimeout(function () { clearPlayerControlFocusState('desktop-fullscreen-exit'); }, 80);
      }
    }
    syncCursorAutoHideMode();
    if (maxBtn) {
      maxBtn.title = isFullScreen ? '退出全屏' : '全屏';
      maxBtn.setAttribute('aria-label', maxBtn.title);
    }
    if (maxIcon) maxIcon.style.display = isFullScreen ? 'none' : '';
    if (restoreIcon) restoreIcon.style.display = isFullScreen ? '' : 'none';
  }

  document.querySelectorAll('[data-window-action]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var action = btn.getAttribute('data-window-action');
      if (action === 'minimize') animateDesktopWindowMinimize(api, e);
      if (action === 'maximize') toggleFullscreen();
      if (action === 'close') {
        saveLastPlaybackSnapshot(true, 'window-close');
        api.close(closeBehaviorPreference);
      }
    });
  });

  if (typeof api.onDesktopLyricsLockState === 'function') {
    api.onDesktopLyricsLockState(function (payload) {
      var locked = !payload || payload.locked !== false;
      if (fx.desktopLyricsClickThrough === locked) return;
      fx.desktopLyricsClickThrough = locked;
      updateFxInputs();
      saveLyricLayout({ user: true, reason: 'desktopLyricsClickThrough' });
      pushDesktopLyricsState(true);
      showToast(locked ? '桌面歌词已锁定' : '桌面歌词可移动');
    });
  }
  if (typeof api.onDesktopLyricsEnabledState === 'function') {
    api.onDesktopLyricsEnabledState(function (payload) {
      var enabled = !!(payload && payload.enabled);
      if (fx.desktopLyrics === enabled) return;
      fx.desktopLyrics = enabled;
      updateFxInputs();
      saveLyricLayout({ user: true, reason: 'desktopLyrics' });
      showToast(enabled ? '桌面歌词已开启' : '桌面歌词已关闭');
    });
  }

  initDesktopModeControls(api);
  initDesktopIconShieldReporter(api);
  initDesktopWallpaperRuntimeBridge(api);
  api.onStateChange(applyState);
  if (typeof api.getState === 'function') {
    api.getState().then(applyState).catch(function () { applyState({}); });
  } else {
    applyState({});
  }
  document.addEventListener('fullscreenchange', function () {
    var wasDocumentFullscreen = documentFullscreenActive;
    documentFullscreenActive = !!document.fullscreenElement;
    desktopWindowState.isHtmlFullScreen = documentFullscreenActive;
    if (wasDocumentFullscreen && !documentFullscreenActive && typeof api.exitFullscreenWindowed === 'function') {
      api.exitFullscreenWindowed();
    }
    applyState({});
  });
})();

// ============================================================
//  启动
// ============================================================

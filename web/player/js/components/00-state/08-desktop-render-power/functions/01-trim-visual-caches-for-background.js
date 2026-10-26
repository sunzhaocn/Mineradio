'use strict';


function trimVisualCachesForBackground() {
  if (!isDeepBackgroundMode()) return;
  trimRuntimeCaches('deep-background', true);
  requestBackgroundAppMemoryTrim('deep-background', isBackgroundReleaseMode() ? 900 : 1800);
}

function scheduleBackgroundCacheTrim() {
  if (!isDeepBackgroundMode()) return;
  if (backgroundCacheTrimTimer) clearTimeout(backgroundCacheTrimTimer);
  backgroundCacheTrimTimer = setTimeout(function () {
    backgroundCacheTrimTimer = 0;
    trimVisualCachesForBackground();
  }, 900);
}

function maybeTrimRuntimeCaches(now) {
  now = now || performance.now();
  var deep = isDeepBackgroundMode();
  var gap = deep ? (isBackgroundReleaseMode() ? 3600 : 7000) : 45000;
  if (!deep && now < 30000) return;
  if (now - runtimePerfState.lastCacheTrimAt < gap) return;
  trimRuntimeCaches(deep ? (isBackgroundReleaseMode() ? 'release-frame' : 'deep-frame') : 'active-frame', deep);
}

function applyRendererPowerMode() {
  if (typeof renderer === 'undefined' || !renderer) return;
  var deep = isDeepBackgroundMode();
  var width = deep ? 4 : Math.max(1, innerWidth);
  var height = deep ? 4 : Math.max(1, innerHeight);
  var pixelRatio = getRenderPixelRatio();
  var mode = deep ? 'sleep' : 'active';
  if (renderPowerState.mode === mode && renderPowerState.width === width && renderPowerState.height === height && Math.abs(renderPowerState.pixelRatio - pixelRatio) < 0.001) return;
  renderPowerState = { mode: mode, width: width, height: height, pixelRatio: pixelRatio };
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  if (typeof uniforms !== 'undefined' && uniforms && uniforms.uPixel) uniforms.uPixel.value = renderer.getPixelRatio();
  if (deep) {
    if (renderer.renderLists && renderer.renderLists.dispose) renderer.renderLists.dispose();
    scheduleBackgroundCacheTrim();
    requestBackgroundAppMemoryTrim('renderer-deep-sleep', isBackgroundReleaseMode() ? 900 : 2200);
  }
}

function updateDesktopRuntimeState(state) {
  state = state || {};
  var wasFullscreen = desktopRuntimeState.fullscreen;
  var wasDeep = isDeepBackgroundMode();
  desktopRuntimeState.desktop = !!window.desktopWindow;
  desktopRuntimeState.minimized = !!state.isMinimized;
  desktopRuntimeState.visible = state.isVisible !== false;
  desktopRuntimeState.focused = state.isFocused !== false;
  desktopRuntimeState.fullscreen = !!(state.isFullScreen || state.isNativeFullScreen || state.isHtmlFullScreen || state.isWindowFullScreen);
  desktopRuntimeState.embedded = state.isDesktopEmbedded === true;
  desktopRuntimeState.interactive = state.isDesktopInteractive === true;
  updateRenderPowerClasses();
  applyRendererPowerMode();
  if (typeof syncGestureControlHostVisibility === 'function') syncGestureControlHostVisibility('desktop-runtime-state');
  if ((desktopRuntimeState.minimized || !desktopRuntimeState.visible) && typeof flushLyricLayoutSave === 'function') {
    flushLyricLayoutSave();
  }
  if (fx && (fx.desktopLyrics || fx.wallpaperMode)) setTimeout(syncDesktopOverlayState, 0);
  if (wasDeep && !isDeepBackgroundMode()) recoverVisualsAfterBackground('desktop-runtime-state');
  if (desktopRuntimeState.fullscreen !== wasFullscreen) scheduleMainRendererViewportRefresh('desktop-runtime-state');
}

function installRenderPowerHooks() {
  updateRenderPowerClasses();
  if (window.desktopWindow && typeof window.desktopWindow.getGpuDiagnostics === 'function') {
    window.desktopWindow.getGpuDiagnostics().then(function (info) {
      runtimeGpuDiagnostics = info || null;
      runtimeGpuDiagnosticsError = '';
    }).catch(function (error) {
      runtimeGpuDiagnosticsError = String(error && error.message || error || 'GPU_DIAGNOSTICS_FAILED');
    });
  }
  document.addEventListener('visibilitychange', function () {
    updateRenderPowerClasses();
    applyRendererPowerMode();
    if (typeof syncGestureControlHostVisibility === 'function') syncGestureControlHostVisibility('visibilitychange');
    if (!isDeepBackgroundMode()) recoverVisualsAfterBackground('visibilitychange');
  });
  window.addEventListener('focus', function () {
    desktopRuntimeState.focused = true;
    updateRenderPowerClasses();
    applyRendererPowerMode();
    if (typeof syncGestureControlHostVisibility === 'function') syncGestureControlHostVisibility('focus');
    if (!isDeepBackgroundMode()) recoverVisualsAfterBackground('focus');
  });
  window.addEventListener('blur', function () {
    desktopRuntimeState.focused = false;
    updateRenderPowerClasses();
    applyRendererPowerMode();
  });
  if (window.desktopWindow && typeof window.desktopWindow.onStateChange === 'function') {
    window.desktopWindow.onStateChange(updateDesktopRuntimeState);
    if (typeof window.desktopWindow.getState === 'function') {
      window.desktopWindow.getState().then(updateDesktopRuntimeState).catch(function () { });
    }
  }
}
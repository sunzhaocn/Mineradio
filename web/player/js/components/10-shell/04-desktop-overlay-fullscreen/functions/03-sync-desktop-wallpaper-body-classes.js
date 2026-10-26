'use strict';



function syncDesktopWallpaperBodyClasses(status, enabled, interactive) {
  status = status || desktopWallpaperRuntimeState || {};
  enabled = enabled === true;
  interactive = enabled && interactive === true;
  var explorerLayeredColorkey = enabled && desktopUsesLayeredExplorerColorkey(status);
  var iconsHidden = enabled && !desktopIconsAreVisible(status);
  document.documentElement.classList.toggle('desktop-explorer-layered-colorkey-root', explorerLayeredColorkey);
  document.body.classList.toggle('desktop-wallpaper-mode', enabled);
  document.body.classList.toggle('desktop-wallpaper-interactive', interactive);
  document.body.classList.toggle('desktop-explorer-layered-colorkey', explorerLayeredColorkey);
  document.body.classList.toggle('desktop-software-locked', interactive && status.softwareInteractionLocked === true);
  document.body.classList.toggle('desktop-icons-hidden', iconsHidden);
  if (!interactive) {
    setDesktopModeControlsOpen(false);
    setDesktopModeControlPeek(false);
  }
}


function releaseDesktopWallpaperStartupVisibilityGate() {
  var root = document.documentElement;
  if (!root || !root.classList.contains('startup-fast-skip-preload')) return false;
  if (typeof releaseStartupFastSkipPreload === 'function') {
    try { releaseStartupFastSkipPreload(); } catch (_) { }
  }
  // Fail open even if the splash helper was interrupted. This class hides the
  // canvas, Home, search and bottom console, so it must never survive a native
  // desktop-mode activation.
  root.classList.remove('startup-fast-skip-preload');
  return true;
}


function ensureDesktopWallpaperFunctionalUi(reason) {
  var body = document.body;
  if (!body
    || !body.classList.contains('desktop-wallpaper-mode')
    || !body.classList.contains('desktop-wallpaper-interactive')) return false;

  releaseDesktopWallpaperStartupVisibilityGate();
  if (typeof immersiveMode !== 'undefined' && immersiveMode) return true;

  var homeActive = body.classList.contains('empty-home-active');
  if (homeActive) {
    if (typeof updateControlsChromeState === 'function') updateControlsChromeState();
    return true;
  }

  var shelfSuppressesConsole = false;
  try {
    shelfSuppressesConsole = typeof isBottomControlsSuppressedForShelf === 'function'
      && isBottomControlsSuppressedForShelf();
  } catch (_) { }
  if (shelfSuppressesConsole) return true;

  if (body.classList.contains('home-controls-locked')) {
    if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
    else body.classList.remove('home-controls-locked');
  }
  if (typeof controlsHideTimer !== 'undefined' && controlsHideTimer) {
    clearTimeout(controlsHideTimer);
    controlsHideTimer = null;
  }
  if (typeof controlsRevealHoldUntil !== 'undefined') {
    controlsRevealHoldUntil = Math.max(controlsRevealHoldUntil || 0, performance.now() + 900);
  }
  var bar = document.getElementById('bottom-bar');
  if (bar) {
    bar.classList.add('visible');
    bar.classList.remove('soft-hidden');
    bar.style.pointerEvents = '';
  }
  if (typeof setControlsHidden === 'function') setControlsHidden(false);
  if (typeof updateControlsChromeState === 'function') updateControlsChromeState();
  return !!bar;
}


function revealDesktopWallpaperUiOnActivation(enabled, interactive) {
  var nextActive = enabled === true && interactive === true;
  var wasActive = desktopWallpaperUiActivationState === true;
  desktopWallpaperUiActivationState = nextActive;
  if (!nextActive) {
    if (desktopWallpaperHudPrimeTimer) {
      clearTimeout(desktopWallpaperHudPrimeTimer);
      desktopWallpaperHudPrimeTimer = 0;
    }
    if (document.body) document.body.classList.remove('desktop-wallpaper-hud-prime');
    if (typeof controlsRevealHoldUntil !== 'undefined') controlsRevealHoldUntil = 0;
    setDesktopModeControlsOpen(false);
    setDesktopModeControlPeek(false);
    return false;
  }
  // Status can arrive after the native HWND was hidden/reparented or after a
  // throttled first paint. Reassert the actual functional surface on every
  // active status, not only on the first false -> true edge.
  ensureDesktopWallpaperFunctionalUi('runtime-status');
  if (typeof immersiveMode !== 'undefined' && immersiveMode) return false;
  if (wasActive) return false;

  setDesktopModeControlPeek(true);
  scheduleDesktopModeControlPeekHide(1800);

  var body = document.body;
  if (body) body.classList.add('desktop-wallpaper-hud-prime');

  var homeActive = !!(body && body.classList.contains('empty-home-active'));
  if (homeActive) {
    if (typeof updateControlsChromeState === 'function') updateControlsChromeState();
  } else {
    // A Home transition can leave this lock behind while Home itself is no
    // longer visible. Clear only that stale combination; a real Home page keeps
    // its existing player-console policy.
    if (body && body.classList.contains('home-controls-locked')) {
      if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
      else body.classList.remove('home-controls-locked');
    }
    if (typeof controlsHideTimer !== 'undefined' && controlsHideTimer) {
      clearTimeout(controlsHideTimer);
      controlsHideTimer = null;
    }
    if (typeof holdBottomControlsVisible === 'function') {
      holdBottomControlsVisible(4200);
    } else if (typeof revealBottomControls === 'function') {
      revealBottomControls(4200);
    } else {
      var bar = document.getElementById('bottom-bar');
      if (bar) {
        bar.classList.add('visible');
        bar.classList.remove('soft-hidden');
      }
      if (typeof updateControlsChromeState === 'function') updateControlsChromeState();
    }
  }

  // The HWND is briefly hidden/reparented below Explorer while this status is
  // applied. Commit the target HUD frame without relying on an opacity
  // transition that Chromium may leave at its transparent first sample.
  var activeSurface = document.getElementById(homeActive ? 'empty-home' : 'bottom-bar');
  if (activeSurface) {
    void activeSurface.offsetWidth;
    try { window.getComputedStyle(activeSurface).opacity; } catch (_) { }
  }
  if (desktopWallpaperHudPrimeTimer) clearTimeout(desktopWallpaperHudPrimeTimer);
  desktopWallpaperHudPrimeTimer = setTimeout(function () {
    desktopWallpaperHudPrimeTimer = 0;
    if (document.body) document.body.classList.remove('desktop-wallpaper-hud-prime');
  }, 900);
  return true;
}


function applyDesktopWallpaperRuntimeStatus(payload) {
  var status = desktopWallpaperStatusPayload(payload);
  var generation = Number(status.generation);
  if (isFinite(generation) && generation < desktopWallpaperStatusGeneration) return desktopWallpaperRuntimeState;
  if (isFinite(generation)) desktopWallpaperStatusGeneration = generation;
  desktopWallpaperRuntimeState = Object.assign({}, desktopWallpaperRuntimeState, status);
  var nextEnabled = status.enabled === true || status.active === true
    ? true
    : (status.attaching === true ? !!fx.wallpaperMode : false);
  if (fx.wallpaperMode !== nextEnabled) {
    fx.wallpaperMode = nextEnabled;
    updateFxInputs();
  }
  if (desktopWindowState && typeof desktopWindowState === 'object') {
    desktopWindowState.isDesktopEmbedded = nextEnabled;
    desktopWindowState.isDesktopInteractive = nextEnabled && status.interactive === true;
  }
  syncDesktopWallpaperBodyClasses(desktopWallpaperRuntimeState, nextEnabled, status.interactive === true);
  applyDesktopWallpaperSafeArea(desktopWallpaperRuntimeState, nextEnabled);
  revealDesktopWallpaperUiOnActivation(nextEnabled, status.interactive === true);
  if (!nextEnabled) {
    desktopIconVisibilityPending = false;
    desktopSoftwareLockPending = false;
  }
  updateDesktopModeControl(desktopWallpaperRuntimeState);
  applyDesktopIconRevealMask();
  updateDesktopWallpaperRuntimeControls(desktopWallpaperRuntimeState);
  scheduleDesktopIconShieldReport(!(nextEnabled && status.interactive === true));
  scheduleDesktopPointerRouteReport(null, true);
  return desktopWallpaperRuntimeState;
}

function desktopWallpaperErrorLabel(error) {
  var code = String(error || 'WALLPAPER_FAILED');
  if (code.indexOf('WALLPAPER_PLATFORM_UNSUPPORTED') >= 0) return '当前系统不支持';
  if (code.indexOf('WALLPAPER_WORKERW_NOT_FOUND') >= 0) return '未找到桌面 WorkerW';
  if (code.indexOf('WALLPAPER_PROGMAN_NOT_FOUND') >= 0) return '未找到 Windows 桌面宿主';
  if (code.indexOf('WALLPAPER_NATIVE_ATTACH_ABORTED') >= 0 || code.indexOf('WALLPAPER_START_SUPERSEDED') >= 0) return '启动已取消';
  if (code.indexOf('FULL_DESKTOP_RECOVERY_TRAY_UNAVAILABLE') >= 0) return '无法创建桌面模式恢复入口';
  if (code.indexOf('FULL_DESKTOP_WALLPAPER_ENGINE_SUSPEND_FAILED') >= 0
    || code.indexOf('FULL_DESKTOP_WALLPAPER_ENGINE_HELPER_EXIT_TIMEOUT') >= 0
    || code.indexOf('WALLPAPER_ENGINE_DESKTOP_TRANSITION_BUSY') >= 0
    || code.indexOf('WALLPAPER_DESKTOP_PREVIEW') >= 0
    || code.indexOf('WALLPAPER_ENGINE_SESSION_MISMATCH') >= 0) return 'Wallpaper Engine 项目未能安全切换到桌面预览';
  if (code.indexOf('DESKTOP_MODE_DETACH') >= 0 || code.indexOf('FULL_DESKTOP_DETACH') >= 0) return '主窗口恢复失败';
  return '无法进入完整桌面模式';
}

function initDesktopWallpaperRuntimeBridge(api) {
  if (!api) return;
  if (typeof api.onWallpaperModeState === 'function' && !desktopWallpaperStatusUnsubscribe) {
    try {
      desktopWallpaperStatusUnsubscribe = api.onWallpaperModeState(applyDesktopWallpaperRuntimeStatus);
    } catch (_) {
      desktopWallpaperStatusUnsubscribe = null;
    }
  }
  if (typeof api.getWallpaperModeStatus === 'function') {
    Promise.resolve().then(function () {
      return api.getWallpaperModeStatus();
    }).then(applyDesktopWallpaperRuntimeStatus).catch(function () { });
  }
}

function pushDesktopLyricsState(force) {
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateDesktopLyrics !== 'function') return;
  var now = performance.now();
  if (!force && now - desktopOverlayPushState.lyricsAt < desktopLyricsPushInterval()) return;
  var currentCustomFontId = desktopLyricsCurrentCustomFontId();
  var includeCustomFontData = !!currentCustomFontId && currentCustomFontId !== desktopOverlayPushState.lastLyricsCustomFontId;
  var payload = desktopLyricsPayload(!!force, includeCustomFontData);
  var colors = payload.colors || {};
  var motion = payload.motion || {};
  var payloadCustomFontId = payload.customFont ? payload.customFont.id : '';
  var key = payload.enabled + '|' + payload.text + '|' + Math.round(payload.progress * 1000) + '|' + Math.round((payload.progressSpan || 0) * 100) + '|' + payload.playing + '|' + payload.size + '|' + payload.opacity + '|' + payload.y + '|' + payload.clickThrough + '|' + payload.cinema + '|' + payload.highlightFollow + '|' + payload.frameRate + '|' + payload.fontFamily + '|' + payloadCustomFontId + '|' + payload.fontWeight + '|' + payload.letterSpacing + '|' + payload.lineHeight + '|' + payload.lyricScale + '|' + payload.feather + '|' + payload.beatMapKey + '|' + colors.primary + '|' + colors.secondary + '|' + colors.highlight + '|' + colors.glow + '|' + motion.lyricGlow + '|' + motion.lyricGlowBeat + '|' + Math.round((motion.lyricGlowStrength || 0) * 100) + '|' + Math.round((motion.highBloom || 0) * 100) + '|' + Math.round((motion.beatGlow || 0) * 100) + '|' + Math.round((motion.beatPulse || 0) * 100) + '|' + Math.round((motion.bass || 0) * 100);
  if (!force && key === desktopOverlayPushState.lastLyricsKey && now - desktopOverlayPushState.lyricsAt < 900) return;
  desktopOverlayPushState.lyricsAt = now;
  desktopOverlayPushState.lastLyricsKey = key;
  desktopOverlayPushState.lastLyricsCustomFontId = payloadCustomFontId;
  api.updateDesktopLyrics(payload).catch(function (e) { console.warn('desktop lyrics update failed:', e); });
}

function applyDesktopLyricsState(force) {
  var api = getDesktopWindowApi();
  if (!api) return;
  normalizeDevelopmentLockedFxState();
  var payload = desktopLyricsPayload(true, true);
  var payloadCustomFontId = payload.customFont ? payload.customFont.id : '';
  if (typeof api.setDesktopLyricsEnabled === 'function') {
    desktopOverlayPushState.lastLyricsCustomFontId = payloadCustomFontId;
    api.setDesktopLyricsEnabled(!!payload.enabled, payload).catch(function (e) { console.warn('desktop lyrics state failed:', e); });
  } else {
    desktopOverlayPushState.lastLyricsCustomFontId = '';
  }
  pushDesktopLyricsState(!!force);
}

function pushWallpaperState(force) {
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateWallpaperMode !== 'function') return;
  if (!force) return;
  api.updateWallpaperMode(Object.assign(wallpaperPayload(), { reason: 'renderer-status-refresh' })).then(function (result) {
    if (result && result.status) applyDesktopWallpaperRuntimeStatus(result.status);
    if (result && result.ok === false) console.warn('wallpaper update failed:', result.error || 'WALLPAPER_UPDATE_FAILED');
  }).catch(function (e) { console.warn('wallpaper update failed:', e); });
}

function applyWallpaperModeState(force, options) {
  // Visual archives, resets and unrelated controls must not reattach or close
  // the native desktop host. Only its settings switch changes the mode.
  if (!options || options.source !== 'settings') {
    return Promise.resolve({ ok: true, enabled: !!fx.wallpaperMode, unchanged: true });
  }
  var api = getDesktopWindowApi();
  if (!api) {
    fx.wallpaperMode = false;
    updateFxInputs();
    return Promise.resolve({ ok: false, enabled: false, error: 'WALLPAPER_DESKTOP_API_UNAVAILABLE' });
  }
  normalizeDevelopmentLockedFxState();
  var payload = wallpaperPayload();
  payload.reason = 'settings-toggle';
  if (typeof api.setWallpaperMode !== 'function') return Promise.resolve({ ok: false, enabled: false, error: 'WALLPAPER_DESKTOP_API_UNAVAILABLE' });
  var operation = ++desktopWallpaperRendererOperation;
  if (payload.enabled) {
    desktopWallpaperRuntimeState = Object.assign({}, desktopWallpaperRuntimeState, { attaching: true, enabled: true, lastError: '' });
    updateDesktopWallpaperRuntimeControls(desktopWallpaperRuntimeState);
  }
  return Promise.resolve().then(function () {
    return api.setWallpaperMode(!!payload.enabled, payload);
  }).then(function (result) {
    result = result && typeof result === 'object' ? result : { ok: false, enabled: false, error: 'WALLPAPER_RESULT_INVALID' };
    if (operation !== desktopWallpaperRendererOperation) return Object.assign({}, result, { rendererStale: true });
    if (result.status) applyDesktopWallpaperRuntimeStatus(result.status);
    else {
      fx.wallpaperMode = result.ok === true && result.enabled === true;
      updateFxInputs();
    }
    if (result.ok !== true) {
      var failedStatus = result.status && typeof result.status === 'object' ? result.status : {};
      fx.wallpaperMode = result.enabled === true || failedStatus.enabled === true || failedStatus.active === true;
      updateFxInputs();
    }
    return result;
  }).catch(function (error) {
    if (operation !== desktopWallpaperRendererOperation) return { ok: false, enabled: false, rendererStale: true, error: String(error && error.message || error) };
    fx.wallpaperMode = false;
    desktopWallpaperRuntimeState = Object.assign({}, desktopWallpaperRuntimeState, { active: false, enabled: false, attaching: false, lastError: String(error && error.message || error) });
    updateFxInputs();
    updateDesktopWallpaperRuntimeControls(desktopWallpaperRuntimeState);
    return { ok: false, enabled: false, error: desktopWallpaperRuntimeState.lastError };
  });
}

function syncDesktopOverlayState() {
  if (fx.desktopLyrics) pushDesktopLyricsState(false);
}


function desktopWindowReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}


function clearDesktopWindowTransitionClasses() {
  document.body.classList.remove('desktop-window-minimizing');
  document.body.classList.remove('desktop-window-restoring');
}


function animateDesktopWindowMinimize(api, activationEvent) {
  if (!api || typeof api.minimize !== 'function') return;
  // A minimize request must originate from a real activation of the visible
  // title-bar control. This keeps stale timers or synthetic DOM clicks from
  // unexpectedly putting the player in the taskbar during playback.
  if (!activationEvent || activationEvent.isTrusted !== true) return;
  if (desktopWindowReducedMotion()) {
    api.minimize();
    return;
  }
  clearTimeout(desktopWindowMinimizeTimer);
  clearTimeout(desktopWindowRestoreTimer);
  document.body.classList.remove('desktop-window-restoring');
  document.body.classList.add('desktop-window-minimizing');
  desktopWindowMinimizeTimer = setTimeout(function () {
    document.body.classList.remove('desktop-window-minimizing');
    api.minimize();
  }, 150);
}


function animateDesktopWindowRestore() {
  if (desktopWindowReducedMotion()) {
    clearDesktopWindowTransitionClasses();
    return;
  }
  clearTimeout(desktopWindowMinimizeTimer);
  clearTimeout(desktopWindowRestoreTimer);
  document.body.classList.remove('desktop-window-minimizing');
  document.body.classList.add('desktop-window-restoring');
  desktopWindowRestoreTimer = setTimeout(function () {
    document.body.classList.remove('desktop-window-restoring');
  }, 280);
}

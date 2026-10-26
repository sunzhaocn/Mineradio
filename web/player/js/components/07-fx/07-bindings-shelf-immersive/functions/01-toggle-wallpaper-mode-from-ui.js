'use strict';


function toggleWallpaperModeFromUi() {
  if (typeof desktopWallpaperRuntimeState !== 'undefined' && desktopWallpaperRuntimeState.supported === false) {
    showToast('当前系统不支持桌面壁纸模式');
    return Promise.resolve({ ok: false, enabled: false, error: 'WALLPAPER_PLATFORM_UNSUPPORTED' });
  }
  var desired = !fx.wallpaperMode;
  fx.wallpaperMode = desired;
  updateFxInputs();
  return applyWallpaperModeState(true, { source: 'settings' }).then(function (result) {
    if (result && result.rendererStale) return result;
    var accepted = !!(result && result.ok === true && result.enabled === desired);
    if (accepted) showToast(desired ? ('完整桌面模式已开启 · ' + desktopInteractionHotkeyHint()) : '完整桌面模式已关闭');
    else if (desired) showToast('完整桌面模式启动失败：' + desktopWallpaperErrorLabel(result && result.error));
    else showToast('完整桌面模式关闭失败：' + desktopWallpaperErrorLabel(result && result.error));
    return result;
  });
}

function toggleFx(key) {
  if (window.mineradioCapabilities && !window.mineradioCapabilities.supportsFx(key)) {
    showToast('此功能需要 Windows 安装版');
    return;
  }
  if (isDevelopmentLockedFx(key)) {
    normalizeDevelopmentLockedFxState();
    saveLyricLayout({ user: true, reason: key });
    updateFxInputs();
    applyDesktopLyricsState(true);
    applyWallpaperModeState(true);
    showToast('开发中，暂不可用');
    return;
  }
  if (key === 'wallpaperMode') {
    toggleWallpaperModeFromUi();
    return;
  }
  fx[key] = !fx[key];
  var toggleId = 't-' + (key === 'floatLayer' ? 'float' : key === 'aiDepth' ? 'aidepth' : key);
  var toggle = document.getElementById(toggleId);
  if (toggle) toggle.classList.toggle('on', fx[key]);
  if (key === 'lyricGlow' || key === 'lyricGlowBeat') updateLyricGlowControls();
  syncFxUniforms();
  if (key === 'lyricCameraLock' || key === 'lyricGlow' || key === 'lyricGlowBeat' || key === 'lyricGlowParticles' || key === 'lyricVerticalFloat' || key === 'lyricLiveViewportFit' || key === 'lyricContextHighQuality' || key === 'lyricBackdropAdapt' || key === 'coverBackdropAdapt' || key === 'backgroundStarRiver' || key === 'lyricPauseHold' || key === 'bloom' || key === 'edge' || key === 'cinema' || key === 'aiDepth' || key === 'desktopLyrics' || key === 'desktopLyricsClickThrough' || key === 'desktopLyricsCinema' || key === 'desktopLyricsHighlight' || key === 'wallpaperMode' || key === 'sonicGroundFloatingEnabled' || key === 'sonicAudioMonitorEnabled' || key === 'sonicAudioAutoTrack' || key === 'shelfShowPodcasts' || key === 'shelfMergeCollections' || key === 'liveBackgroundKeep' || key === 'memoryAutoTrimApp' || key === 'memoryAutoTrimOnBackground' || key === 'memoryAutoSystemTrim' || key === 'memorySystemAutoElevate') saveLyricLayout({ user: true, reason: key });
  if ((key === 'sonicAudioMonitorEnabled' || key === 'sonicAudioAutoTrack') && typeof refreshSonicAudioMonitorUi === 'function') refreshSonicAudioMonitorUi();
  if (key === 'floatLayer') { if (fx.floatLayer) createFloatLayer(); else destroyFloatLayer(); saveLyricLayout({ user: true, reason: key }); }
  if (key === 'desktopLyrics') applyDesktopLyricsState(true);
  if (key === 'desktopLyricsClickThrough' || key === 'desktopLyricsCinema' || key === 'desktopLyricsHighlight') pushDesktopLyricsState(true);
  if (key === 'lyricGlow' || key === 'lyricGlowBeat' || key === 'lyricGlowParticles') pushDesktopLyricsState(true);
  if (key === 'lyricContextHighQuality' && typeof invalidateLyricQualityTextures === 'function') {
    invalidateLyricQualityTextures('context-quality-toggle', { release: true });
  }
  if (key === 'backgroundStarRiver') {
    if (typeof updateBackgroundStarRiverState === 'function') updateBackgroundStarRiverState(0.016, true);
    showToast(fx.backgroundStarRiver !== false ? '背景星河已开启' : '背景星河已关闭');
  }
  if (key === 'wallpaperMode') applyWallpaperModeState(true);
  if (key === 'shelfShowPodcasts' || key === 'shelfMergeCollections') {
    if (shelfManager && shelfManager.rebuild) shelfManager.rebuild(true);
    if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  }
  if (key === 'liveBackgroundKeep') {
    fx.performanceBackground = fx.liveBackgroundKeep ? 'keep' : 'auto';
    updatePerformanceControls();
    saveLyricLayout({ user: true, reason: 'liveBackgroundKeep' });
    if (fx.liveBackgroundKeep && backgroundCacheTrimTimer) {
      clearTimeout(backgroundCacheTrimTimer);
      backgroundCacheTrimTimer = 0;
    }
    updateRenderPowerClasses();
    applyRendererPowerMode();
    if (fx.liveBackgroundKeep) recoverVisualsAfterBackground('live-background-keep');
  }
  if (key === 'memoryAutoTrimApp' || key === 'memoryAutoTrimOnBackground' || key === 'memoryAutoSystemTrim' || key === 'memorySystemAutoElevate') {
    if (typeof updateMemoryControls === 'function') updateMemoryControls();
    if (typeof configureMemoryReductFromFx === 'function') configureMemoryReductFromFx('toggle', key === 'memoryAutoSystemTrim' && fx.memoryAutoSystemTrim);
  }
  if (key === 'lyricGlow') showToast(fx.lyricGlow ? '歌词溢光已开启' : '歌词溢光已关闭');
  if (key === 'lyricGlowBeat') showToast(fx.lyricGlowBeat ? '歌词溢光跟随鼓点' : '歌词溢光已脱离鼓点');
  if (key === 'lyricGlowParticles') showToast(fx.lyricGlowParticles ? '歌词光粒已开启' : '歌词光粒已关闭');
  if (key === 'lyricVerticalFloat') showToast(fx.lyricVerticalFloat !== false ? '歌词上下浮动已开启' : '歌词上下浮动已关闭');
  if (key === 'lyricLiveViewportFit') showToast(fx.lyricLiveViewportFit !== false ? '歌词实时边界已开启' : '歌词实时边界已关闭，已停止逐帧投影');
  if (key === 'lyricContextHighQuality') showToast(fx.lyricContextHighQuality !== false ? '上下句高清纹理已开启' : '上下句高清纹理已关闭，仅保留当前双语高清');
  if (key === 'lyricBackdropAdapt') showToast(fx.lyricBackdropAdapt !== false ? '全局歌词避光已开启' : '全局歌词避光已关闭');
  if (key === 'coverBackdropAdapt') showToast(fx.coverBackdropAdapt !== false ? '封面粒子避光已开启' : '封面粒子避光已关闭');
  if (key === 'lyricPauseHold') showToast(fx.lyricPauseHold !== false ? '暂停时保留歌词' : '暂停时隐藏歌词');
  if (key === 'desktopLyrics') showToast(fx.desktopLyrics ? '桌面歌词已开启' : '桌面歌词已关闭');
  if (key === 'desktopLyricsClickThrough') showToast(fx.desktopLyricsClickThrough !== false ? '桌面歌词已锁定' : '桌面歌词可移动');
  if (key === 'desktopLyricsCinema') showToast(fx.desktopLyricsCinema !== false ? '桌面歌词电影震动已开启' : '桌面歌词电影震动已关闭，基础漂浮保留');
  if (key === 'desktopLyricsHighlight') showToast(fx.desktopLyricsHighlight === true ? '桌面歌词高亮跟随已开启' : '桌面歌词高亮跟随已关闭');
  if (key === 'wallpaperMode') showToast(fx.wallpaperMode ? '壁纸模式已开启' : '壁纸模式已关闭');
  if (key === 'shelfShowPodcasts') showToast(fx.shelfShowPodcasts !== false ? '3D歌单架已显示播客歌单' : '3D歌单架已隐藏播客歌单');
  if (key === 'shelfMergeCollections') showToast(fx.shelfMergeCollections === true ? '我的歌单与收藏歌单已合并滚动' : '收藏歌单恢复滚到底切页');
  if (key === 'liveBackgroundKeep') showToast(fx.liveBackgroundKeep ? '直播后台保持已开启' : '直播后台保持已关闭');
  if (key === 'memoryAutoTrimApp') showToast(fx.memoryAutoTrimApp ? '播放器进程压缩已开启' : '播放器进程压缩已关闭');
  if (key === 'memoryAutoTrimOnBackground') showToast(fx.memoryAutoTrimOnBackground ? '最小化后台会自动压缩' : '后台自动压缩已关闭');
  if (key === 'memoryAutoSystemTrim') showToast(fx.memoryAutoSystemTrim ? '系统级 Mem Reduct 已开启' : '系统级 Mem Reduct 已关闭');
  if (key === 'memorySystemAutoElevate') showToast(fx.memorySystemAutoElevate ? '系统释放允许请求管理员权限' : '系统释放不再自动提权');
  if (key === 'lyricCameraLock') showToast(fx.lyricCameraLock ? '歌词已绑定镜头' : '歌词已恢复自由漂浮');
  if (key === 'bloom') showToast(fx.bloom ? '溢光已开启' : '溢光已关闭');
  if (key === 'edge') showToast(fx.edge ? '已开启轮廓高亮' : '已关闭轮廓高亮');
  if (key === 'cinema') showToast(fx.cinema ? '已开启电影镜头' : '已关闭电影镜头');
  if (key === 'aiDepth') {
    if (fx.aiDepth) {
      aiDepthFailUntil = 0;
      queueAIDepthForCurrentCover(true);
    }
    showToast(fx.aiDepth ? '已开启后台 AI 立体增强' : '已关闭 AI 立体增强, 使用轻量弧面');
  }
}

function toggleFxPanel(force) {
  var el = document.getElementById('fx-panel');
  if (!el) return;
  if (!diyPlayerMode && force !== false) {
    showToast('开启 DIY 玩家模式后可打开视觉控制台');
    return;
  }
  var currentlyOpen = el.classList.contains('show') || el.classList.contains('peek');
  if (peekTimers && peekTimers.fx) { clearTimeout(peekTimers.fx); peekTimers.fx = null; }
  var opening = typeof force === 'boolean' ? force : !currentlyOpen;
  fxPanelPinned = !window.mineradioHoverPanels && opening;
  var launcher = document.getElementById('fx-fab');
  if (launcher) launcher.setAttribute('aria-expanded', opening ? 'true' : 'false');
  if (!opening) {
    el.classList.remove('show', 'peek');
    el.classList.toggle('closing', currentlyOpen);
    setTimeout(function () { el.classList.remove('closing'); }, 280);
    var fab = document.getElementById('fx-fab');
    if (fab) fab.classList.remove('active');
    return;
  }
  el.classList.remove('show', 'closing');
  setPeek(el, true, 'fx');
}

function resetFx() {
  var savedCam = fx.cam;
  var savedGesturePlayerActions = fx.gesturePlayerActions;
  var savedGestureHandOverlay = fx.gestureHandOverlay;
  var savedGestureSensitivity = fx.gestureSensitivity;
  var savedShelf = fx.shelf;
  var savedShelfCameraMode = normalizeShelfCameraMode(fx.shelfCameraMode || fxDefaults.shelfCameraMode);
  var savedShelfPresence = normalizeShelfPresence(fx.shelfPresence || fxDefaults.shelfPresence);
  fx = Object.assign({}, fxDefaults, {
    cam: savedCam,
    gesturePlayerActions: savedGesturePlayerActions,
    gestureHandOverlay: savedGestureHandOverlay,
    gestureSensitivity: savedGestureSensitivity,
    shelf: savedShelf,
    wallpaperMode: fx.wallpaperMode,
    desktopLyrics: fx.desktopLyrics,
    shelfCameraMode: savedShelfCameraMode,
    shelfPresence: savedShelfPresence,
    shelfAngleY: shelfDefaultAngleForCameraMode(savedShelfCameraMode),
    shelfAngleYManual: false
  });
  applyCoverParticleResolution(fx.coverResolution, { reload: true });
  updateFxInputs();
  syncFxUniforms();
  refreshStageLyricDisplayMode();
  applyDesktopLyricsState(true);
  pushDesktopLyricsState(true);
  applyWallpaperModeState(true);
  updateRenderPowerClasses();
  applyRendererPowerMode();
  setStageLyricPalette(stageLyrics.coverPalette || stageLyrics.palette);
  setPreset(fx.preset, { silent: true, preserveCamera: true, skipTransition: true });
  if (fx.floatLayer) createFloatLayer(); else destroyFloatLayer();
  if (shelfManager && shelfManager.rebuild) shelfManager.rebuild(true);
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  saveLyricLayout({ user: true, reason: 'resetFx' });
  showToast('已恢复默认参数');
}


function setShelfMode(m, opts) {
  opts = opts || {};
  m = /^(off|side|stage)$/.test(String(m || '')) ? m : fxDefaults.shelf;
  var prevShelf = fx.shelf;
  var prevPinned = fx.shelfPinnedOpen;
  var prevPresence = fx.shelfPresence;
  fx.shelf = m;
  if (m !== 'side' && shelfPinnedOpen) setShelfPinnedOpen(false, true, false);
  if (m !== 'side') {
    fx.shelfPinnedOpen = false;
    shelfVisibility = 0;
    updateShelfHoverCueFromPointer(null);
    shelfHoverCue.target = 0;
    shelfHoverCue.value = 0;
    shelfHoverCue.zoneActive = false;
    shelfHoverCue.enteredAt = 0;
    shelfHoverCue.guide = false;
    if (typeof setShelfHoverTabVisible === 'function') setShelfHoverTabVisible(false);
    if (shelfManager && shelfManager.clearSelected) shelfManager.clearSelected();
    if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent() && typeof safeShelfCloseContent === 'function') safeShelfCloseContent('shelf-mode-off');
  }
  if (m === 'off') fx.shelfPresence = 'auto';
  document.querySelectorAll('#shelf-seg button').forEach(function (b) { b.classList.toggle('active', b.dataset.shelf === m); });
  if (shelfManager) shelfManager.setMode(m);
  // 舞台模式: 顶部搜索、底部控件让位
  var searchArea = document.getElementById('search-area');
  var bottomBar = document.getElementById('bottom-bar');
  if (searchArea) searchArea.classList.toggle('stage-mode', m === 'stage');
  if (bottomBar) bottomBar.classList.toggle('stage-mode', m === 'stage');
  if (opts.forceSave || prevShelf !== fx.shelf || prevPinned !== fx.shelfPinnedOpen || prevPresence !== fx.shelfPresence) {
    saveLyricLayout({ user: opts.user !== false, reason: 'shelfMode' });
  }
}


function updateShelfControlUi() {
  fx.shelfCameraMode = normalizeShelfCameraMode(fx.shelfCameraMode || fxDefaults.shelfCameraMode);
  fx.shelfPresence = normalizeShelfPresence(fx.shelfPresence || fxDefaults.shelfPresence);
  document.querySelectorAll('#shelf-camera-seg [data-shelf-camera]').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-shelf-camera') === fx.shelfCameraMode);
  });
  document.querySelectorAll('#shelf-presence-seg [data-shelf-presence]').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-shelf-presence') === fx.shelfPresence);
  });
  var color = shelfAccentHex();
  var picker = document.getElementById('shelf-accent-picker');
  var value = document.getElementById('shelf-accent-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}

function refreshShelfVisuals(reason) {
  updateShelfControlUi();
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  if (shelfManager && shelfManager.rebuild && reason === 'mode') shelfManager.rebuild(true);
}

function setShelfCameraMode(mode) {
  fx.shelfCameraMode = normalizeShelfCameraMode(mode);
  applyShelfCameraDefaultAngle(true);
  setRange('fx-shelfangle', fx.shelfAngleY);
  updateShelfControlUi();
  if (fx.shelfCameraMode === 'static' && orbit && orbit.focus && /^shelf-/.test(String(orbit.focus.type || ''))) {
    setFocusZone(null, true);
  }
  saveLyricLayout({ user: true, reason: 'shelfCameraMode' });
  showToast(fx.shelfCameraMode === 'static' ? '3D歌单架: 静态镜头' : '3D歌单架: 动态镜头');
}

function setShelfPresence(mode) {
  fx.shelfPresence = normalizeShelfPresence(mode);
  updateShelfControlUi();
  if (shelfManager && shelfManager.setMode) shelfManager.setMode(fx.shelf);
  if (fx.shelfPresence === 'auto') {
    if (shelfPinnedOpen) setShelfPinnedOpen(false, true, false);
    fx.shelfPinnedOpen = false;
    updateShelfHoverCueFromPointer(null);
    shelfHoverCue.target = 0;
    shelfHoverCue.value = 0;
    shelfHoverCue.zoneActive = false;
    shelfHoverCue.enteredAt = 0;
    shelfHoverCue.guide = false;
    shelfVisibility = 0;
    if (typeof setShelfHoverTabVisible === 'function') setShelfHoverTabVisible(false);
    if (shelfManager && shelfManager.clearSelected) shelfManager.clearSelected();
    if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent() && typeof safeShelfCloseContent === 'function') safeShelfCloseContent('shelf-presence-auto');
    if (typeof setFocusZone === 'function') setFocusZone(null, true);
  }
  updateShelfControlUi();
  saveLyricLayout({ user: true, reason: 'shelfPresence' });
  showToast(fx.shelfPresence === 'always' ? '3D歌单架: 常驻' : '3D歌单架: 自动隐藏');
}

function setShelfAccentColor(color, silent) {
  fx.shelfAccentColor = normalizeHexColor(color || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor);
  refreshShelfVisuals('color');
  saveLyricLayout({ user: true, reason: 'shelfAccentColor' });
  if (!silent) showToast('歌单架颜色: ' + fx.shelfAccentColor.toUpperCase());
}

function resetShelfAccentColor() {
  setShelfAccentColor(fxDefaults.shelfAccentColor || '#f4d28a');
}


function syncControlsAutoHideButton() {
  var btn = document.getElementById('controls-hide-btn');
  if (btn) btn.classList.toggle('active', controlsAutoHide);
  if (!controlsAutoHide && controlsHideTimer) {
    clearTimeout(controlsHideTimer);
    controlsHideTimer = null;
  }
}


function setParticleLyricsSilently(on) {
  fx.particleLyrics = !!on;
  if (fx.particleLyrics) {
    createLyricsParticles();
    if (typeof requestStageLyricWarmup === 'function') requestStageLyricWarmup('setParticleLyricsSilently', 150);
    if (typeof scheduleStageLyricPrewarm === 'function') scheduleStageLyricPrewarm('setParticleLyricsSilently', 48);
    if (typeof scheduleStageLyricFullTrackWarmup === 'function') scheduleStageLyricFullTrackWarmup('track-ready', 220);
  } else clearStageLyrics();
  lyricsVisible = fx.particleLyrics;
}


function updateImmersiveButton() {
  var btn = document.getElementById('immersive-btn');
  if (!btn) return;
  btn.classList.toggle('active', immersiveMode);
  btn.setAttribute('aria-pressed', immersiveMode ? 'true' : 'false');
  btn.title = immersiveMode ? '退出全沉浸式' : '全沉浸式';
  btn.setAttribute('aria-label', btn.title);
}


function closeImmersiveInterference() {
  closeMiniQueue();
  toggleFxPanel(false);
  closeUploadTip(false);
  closeLoginModal();
  closeUserModal();
  closeCollectModal();
  closeCoverCropModal();
  closeCustomLyricModal();
  closeTrackDetailModal();
  if (!localBeatAnalysis.active) closeLocalBeatModal();
  ['search-area', 'fx-panel', 'trial-banner', 'ai-depth-chip', 'beat-chip'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('peek', 'show', 'closing');
  });
  var fab = document.getElementById('fx-fab');
  if (fab) fab.classList.remove('active');
  document.body.classList.remove('login-guide-active');
  setFocusZone(null, true);
}


function setImmersiveMode(on) {
  on = !!on;
  if (immersiveMode === on) return;

  if (on) {
    immersiveState = {
      shelfMode: fx.shelf,
      shelfPinnedOpen: shelfPinnedOpen,
      lyrics: fx.particleLyrics,
      controlsAutoHide: controlsAutoHide,
      bottomVisible: !!(document.getElementById('bottom-bar') && document.getElementById('bottom-bar').classList.contains('visible'))
    };
    immersiveMode = true;
    document.body.classList.add('immersive-mode');
    var bottomBarEnter = document.getElementById('bottom-bar');
    if (bottomBarEnter) bottomBarEnter.classList.add('visible');
    closeImmersiveInterference();
    if (!fx.particleLyrics) setParticleLyricsSilently(true);
    controlsAutoHide = true;
    syncControlsAutoHideButton();
    updateImmersiveButton();
    syncCursorAutoHideMode();
    controlsRevealHoldUntil = 0;
    revealBottomControls(350);
    setTimeout(function () {
      if (immersiveMode && !controlsHovering) setControlsHidden(true);
    }, 500);
    return;
  }

  immersiveMode = false;
  document.body.classList.remove('immersive-mode');
  closeMiniQueue();
  if (immersiveState.shelfMode) setShelfMode(immersiveState.shelfMode);
  if (immersiveState.shelfMode === 'side' && immersiveState.shelfPinnedOpen) setShelfPinnedOpen(true, true);
  else setShelfPinnedOpen(false, true);
  if (immersiveState.lyrics === false) setParticleLyricsSilently(false);
  controlsAutoHide = immersiveState.controlsAutoHide !== false;
  syncControlsAutoHideButton();
  updateImmersiveButton();
  syncCursorAutoHideMode();
  var bottomBarExit = document.getElementById('bottom-bar');
  if (immersiveState.bottomVisible) revealBottomControls(900);
  else if (bottomBarExit) bottomBarExit.classList.remove('visible', 'soft-hidden');
  showToast('已退出全沉浸式');
}


function toggleImmersiveMode() {
  setImmersiveMode(!immersiveMode);
}

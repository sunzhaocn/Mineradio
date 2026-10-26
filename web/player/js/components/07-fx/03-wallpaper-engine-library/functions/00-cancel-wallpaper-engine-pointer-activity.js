'use strict';



function cancelWallpaperEnginePointerActivity() {
  if (wallpaperEnginePointerActivityTimer) clearTimeout(wallpaperEnginePointerActivityTimer);
  wallpaperEnginePointerActivityTimer = 0;
  wallpaperEnginePointerActivityLastSentAt = 0;
}


function wallpaperEnginePointerActivityReady() {
  // A native WE source is briefly aligned over the Electron host while the
  // capture stream is prepared. Chromium can keep Page Visibility hidden
  // after that source is parked even though the real Mineradio window is
  // visible. Desktop sessions therefore trust the main-process window state;
  // browser fallback still resolves to document.hidden.
  if (!wallpaperEngineDesktopHostIsVisible()
    || wallpaperEngineHostBoundsPreparing
    || !wallpaperEngineSelection.active
    || wallpaperEngineSelection.kind !== 'engine'
    || !/^[a-f0-9]{24}$/i.test(String(wallpaperEngineNativeSessionId || ''))
    || !wallpaperEngineCaptureStream) return false;
  var layer = document.getElementById('wallpaper-engine-layer');
  return !!(layer && layer.classList.contains('engine-ready'));
}


function flushWallpaperEnginePointerActivity() {
  wallpaperEnginePointerActivityTimer = 0;
  if (!wallpaperEnginePointerActivityHasPoint || !wallpaperEnginePointerActivityReady()) return;
  var api = wallpaperEngineDesktopApi();
  if (!api || typeof api.reportWallpaperEnginePointerActivity !== 'function') return;
  wallpaperEnginePointerActivityLastSentAt = typeof performance !== 'undefined' && performance.now
    ? performance.now() : Date.now();
  try {
    api.reportWallpaperEnginePointerActivity({
      sessionId: String(wallpaperEngineNativeSessionId || ''),
      xUnit: wallpaperEnginePointerActivityLatestX,
      yUnit: wallpaperEnginePointerActivityLatestY
    });
  } catch (e) { }
}


function rememberWallpaperEnginePointerPosition(event) {
  if (!event || !Number.isFinite(Number(event.clientX)) || !Number.isFinite(Number(event.clientY))) return;
  var width = Math.max(1, Number(document.documentElement && document.documentElement.clientWidth) || Number(window.innerWidth) || 1);
  var height = Math.max(1, Number(document.documentElement && document.documentElement.clientHeight) || Number(window.innerHeight) || 1);
  var xRatio = Math.max(0, Math.min(1, Number(event.clientX) / Math.max(1, width - 1)));
  var yRatio = Math.max(0, Math.min(1, Number(event.clientY) / Math.max(1, height - 1)));
  wallpaperEnginePointerActivityLatestX = Math.round(xRatio * 65535);
  wallpaperEnginePointerActivityLatestY = Math.round(yRatio * 65535);
  wallpaperEnginePointerActivityHasPoint = true;
}


function queueWallpaperEnginePointerActivity(event) {
  rememberWallpaperEnginePointerPosition(event);
  if (!wallpaperEnginePointerActivityHasPoint || !wallpaperEnginePointerActivityReady() || wallpaperEnginePointerActivityTimer) return;
  var now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  var delay = Math.max(0, WALLPAPER_ENGINE_POINTER_ACTIVITY_INTERVAL_MS - Math.max(0, now - wallpaperEnginePointerActivityLastSentAt));
  wallpaperEnginePointerActivityTimer = setTimeout(flushWallpaperEnginePointerActivity, delay);
}


function cancelWallpaperEngineHostRecovery(resetAttempts) {
  if (wallpaperEngineHostRecoveryRetryTimer) clearTimeout(wallpaperEngineHostRecoveryRetryTimer);
  wallpaperEngineHostRecoveryRetryTimer = 0;
  wallpaperEngineHostRecoveryInFlight = false;
  if (resetAttempts !== false) wallpaperEngineHostRecoveryAttempt = 0;
}


function wallpaperEngineDesktopHostIsVisible() {
  if (!wallpaperEngineUsesDesktopHostLifecycle()) return !document.hidden;
  try {
    if (typeof desktopRuntimeState === 'object' && desktopRuntimeState) {
      return desktopRuntimeState.visible !== false && desktopRuntimeState.minimized !== true;
    }
  } catch (e) { }
  return true;
}


function readWallpaperEngineIdSet(key) {
  try {
    var raw = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set((Array.isArray(raw) ? raw : []).map(String).filter(function (id) { return /^[a-f0-9]{24}$/i.test(id); }));
  } catch (e) {
    return new Set();
  }
}


function saveWallpaperEngineIdSet(key, values) {
  try { localStorage.setItem(key, JSON.stringify(Array.from(values))); } catch (e) { }
}


function normalizeWallpaperEngineSelection(value) {
  value = value && typeof value === 'object' ? value : {};
  var id = String(value.id || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
  return {
    version: 1,
    active: value.active === true && id.length === 24,
    id: id,
    title: String(value.title || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160),
    kind: value.kind === 'engine' ? 'engine' : (value.kind === 'media' ? 'media' : 'preview'),
    mediaType: value.mediaType === 'video' ? 'video' : 'image',
    mediaAnimated: value.mediaAnimated === true,
    projectType: String(value.projectType || 'unknown').slice(0, 32),
    hasPreview: value.hasPreview === true,
    previewAnimated: value.previewAnimated === true,
    visualOpacity: Math.max(0.15, Math.min(1, Number(value.visualOpacity) || 1)),
    visualPositionX: Math.max(-0.5, Math.min(0.5, Number(value.visualPositionX) || 0)),
    visualPositionY: Math.max(-0.5, Math.min(0.5, Number(value.visualPositionY) || 0)),
    visualScale: Math.max(1, Math.min(1.6, Number(value.visualScale) || 1.08)),
    updatedAt: Math.max(0, Number(value.updatedAt) || 0)
  };
}


function readWallpaperEngineSelection() {
  try { return normalizeWallpaperEngineSelection(JSON.parse(localStorage.getItem(WALLPAPER_ENGINE_SELECTION_STORE_KEY) || '{}')); }
  catch (e) { return normalizeWallpaperEngineSelection({}); }
}


function wallpaperEngineVisualSettings() {
  return {
    opacity: Math.max(0.15, Math.min(1, Number(wallpaperEngineSelection.visualOpacity) || 1)),
    positionX: Math.max(-0.5, Math.min(0.5, Number(wallpaperEngineSelection.visualPositionX) || 0)),
    positionY: Math.max(-0.5, Math.min(0.5, Number(wallpaperEngineSelection.visualPositionY) || 0)),
    scale: Math.max(1, Math.min(1.6, Number(wallpaperEngineSelection.visualScale) || 1.08))
  };
}


function syncWallpaperEngineVisualControls() {
  var settings = wallpaperEngineVisualSettings();
  var controls = [
    ['wallpaper-engine-opacity', settings.opacity, Math.round(settings.opacity * 100) + '%'],
    ['wallpaper-engine-position-x', settings.positionX * 100, Math.round(settings.positionX * 100) + '%'],
    ['wallpaper-engine-position-y', settings.positionY * 100, Math.round(settings.positionY * 100) + '%'],
    ['wallpaper-engine-scale', settings.scale, settings.scale.toFixed(2) + '×']
  ];
  controls.forEach(function (entry) {
    var input = document.getElementById(entry[0]);
    if (!input) return;
    input.value = String(entry[1]);
    var output = input.parentElement && input.parentElement.querySelector('output');
    if (output) output.textContent = entry[2];
  });
}


function flushWallpaperEngineVisualSettings() {
  wallpaperEngineVisualSettingsTimer = 0;
  var api = wallpaperEngineDesktopApi();
  var sessionId = String(wallpaperEngineNativeSessionId || '');
  if (!api || typeof api.updateWallpaperEngineVisualSettings !== 'function'
    || !/^[a-f0-9]{24}$/i.test(sessionId)) return;
  try { api.updateWallpaperEngineVisualSettings(Object.assign({ sessionId: sessionId }, wallpaperEngineVisualSettings())); }
  catch (e) { }
}


function applyWallpaperEngineVisualSettings(immediate) {
  var settings = wallpaperEngineVisualSettings();
  var layer = document.getElementById('wallpaper-engine-layer');
  if (layer) {
    layer.style.setProperty('--wallpaper-engine-visual-opacity', settings.opacity.toFixed(3));
    layer.style.setProperty('--wallpaper-engine-visual-position-x', (settings.positionX * 100).toFixed(2) + '%');
    layer.style.setProperty('--wallpaper-engine-visual-position-y', (settings.positionY * 100).toFixed(2) + '%');
    layer.style.setProperty('--wallpaper-engine-visual-scale', settings.scale.toFixed(3));
  }
  syncWallpaperEngineVisualControls();
  if (wallpaperEngineVisualSettingsTimer) clearTimeout(wallpaperEngineVisualSettingsTimer);
  if (immediate === true) flushWallpaperEngineVisualSettings();
  else wallpaperEngineVisualSettingsTimer = setTimeout(flushWallpaperEngineVisualSettings, 42);
}


function setWallpaperEngineVisualSetting(name, rawValue) {
  var value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  if (name === 'opacity') wallpaperEngineSelection.visualOpacity = Math.max(0.15, Math.min(1, value));
  else if (name === 'positionX') wallpaperEngineSelection.visualPositionX = Math.max(-0.5, Math.min(0.5, value / 100));
  else if (name === 'positionY') wallpaperEngineSelection.visualPositionY = Math.max(-0.5, Math.min(0.5, value / 100));
  else if (name === 'scale') wallpaperEngineSelection.visualScale = Math.max(1, Math.min(1.6, value));
  else return;
  saveWallpaperEngineSelection();
  applyWallpaperEngineVisualSettings(false);
}


function saveWallpaperEngineSelection() {
  try { localStorage.setItem(WALLPAPER_ENGINE_SELECTION_STORE_KEY, JSON.stringify(normalizeWallpaperEngineSelection(wallpaperEngineSelection))); }
  catch (e) { }
}


function wallpaperEngineDesktopApi() {
  try {
    if (typeof getDesktopWindowApi === 'function') return getDesktopWindowApi();
    return window.desktopWindow || null;
  } catch (e) {
    return null;
  }
}


function wallpaperEngineUsesDesktopHostLifecycle() {
  var api = wallpaperEngineDesktopApi();
  return !!(api && typeof api.onWallpaperEngineHostBoundsChanged === 'function');
}


function wallpaperEngineNativeHostUnavailable() {
  return wallpaperEngineHostBoundsPreparing
    || (!wallpaperEngineUsesDesktopHostLifecycle() && document.hidden);
}


function normalizeWallpaperEngineProject(item) {
  item = item && typeof item === 'object' ? item : {};
  var id = String(item.id || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
  if (id.length !== 24) return null;
  var projectType = String(item.projectType || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'unknown';
  var mediaType = item.mediaType === 'video' ? 'video' : (item.mediaType === 'image' ? 'image' : '');
  return {
    id: id,
    title: String(item.title || 'Wallpaper Engine').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Wallpaper Engine',
    projectType: projectType,
    mediaType: mediaType,
    mediaAnimated: item.mediaAnimated === true,
    playable: item.playable === true && !!mediaType,
    enginePlayable: item.enginePlayable === true && projectType === 'scene',
    previewOnly: item.previewOnly === true || (item.playable !== true && item.enginePlayable !== true),
    hasPreview: item.hasPreview === true,
    previewAnimated: item.previewAnimated === true,
    source: String(item.source || '').slice(0, 32),
    sourceLabel: String(item.sourceLabel || '本地项目').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80),
    workshopId: String(item.workshopId || '').replace(/\D/g, '').slice(0, 32),
    propertyCount: Math.max(0, Math.min(256, Number(item.propertyCount) || 0)),
    audioPropertyCount: Math.max(0, Math.min(256, Number(item.audioPropertyCount) || 0)),
    mutedAudioPropertyCount: Math.max(0, Math.min(256, Number(item.mutedAudioPropertyCount) || 0)),
    updatedAt: Math.max(0, Number(item.updatedAt) || 0),
    safetyMode: item.safetyMode === 'native-engine' ? 'native-engine' : (item.safetyMode === 'direct-media' ? 'direct-media' : 'preview-only')
  };
}


function wallpaperEngineProjectById(id) {
  id = String(id || '');
  for (var i = 0; i < wallpaperEngineProjects.length; i++) {
    if (wallpaperEngineProjects[i].id === id) return wallpaperEngineProjects[i];
  }
  return null;
}


function wallpaperEngineMediaUrl(item, kind) {
  item = item || {};
  kind = kind === 'media' ? 'media' : 'preview';
  return 'mineradio-wallpaper://' + kind + '/' + encodeURIComponent(item.id || '') + '?v=' + encodeURIComponent(String(item.updatedAt || 0)) + '&token=' + encodeURIComponent(wallpaperEngineMediaToken);
}


function wallpaperEngineProjectLabel(item) {
  item = item || {};
  if (item.playable && item.mediaType === 'video') return 'Video · 动态播放';
  if (item.playable && item.mediaType === 'image') return '图片 · 原图显示';
  if (item.projectType === 'scene' && item.enginePlayable) return 'Scene · Wallpaper Engine 原生实时运行';
  if (item.projectType === 'scene') return 'Scene · 预览（未找到有效 PKGV 场景包）';
  if (item.projectType === 'web') return 'Web · 安全预览（未执行 HTML）';
  if (item.projectType === 'application') return 'Application · 安全预览（未运行程序）';
  return '本地项目 · 安全预览';
}


function updateWallpaperEngineEntryUi(message) {
  var value = document.getElementById('wallpaper-engine-value');
  var restore = document.getElementById('wallpaper-engine-restore-btn');
  var active = !!wallpaperEngineSelection.active;
  if (value) {
    if (message) value.textContent = message;
    else if (active && wallpaperEngineRuntimeError) value.textContent = wallpaperEngineRuntimeError + ' · 已显示原背景';
    else if (active && wallpaperEngineSelection.kind === 'engine' && wallpaperEngineDesktopPreviewActive) {
      value.textContent = (wallpaperEngineSelection.title || '已选择')
        + (wallpaperEngineDesktopPreviewUsesAsset ? ' · 桌面被动模式 · 项目预览' : ' · 桌面被动模式 · 原背景');
    }
    else if (active && wallpaperEngineSelection.kind === 'engine') value.textContent = (wallpaperEngineSelection.title || '已选择') + ' · WE 引擎实时运行';
    else if (active) value.textContent = (wallpaperEngineSelection.title || '已选择') + ' · 原背景保留';
    else value.textContent = '未启用 · 原背景保留';
  }
  if (restore) restore.disabled = !active;
}


function cancelWallpaperEngineSwitchTimer() {
  if (wallpaperEngineSwitchTimer) clearTimeout(wallpaperEngineSwitchTimer);
  wallpaperEngineSwitchTimer = 0;
}


function cancelWallpaperEngineVideoRetry() {
  if (wallpaperEngineVideoRetryTimer) clearTimeout(wallpaperEngineVideoRetryTimer);
  wallpaperEngineVideoRetryTimer = 0;
}


function cancelWallpaperEngineFirstFrameWait() {
  var wait = wallpaperEngineFirstFrameWait;
  wallpaperEngineFirstFrameWait = null;
  if (!wait) return;
  if (wait.timer) clearTimeout(wait.timer);
  if (wait.video && wait.callbackId && typeof wait.video.cancelVideoFrameCallback === 'function') {
    try { wait.video.cancelVideoFrameCallback(wait.callbackId); } catch (e) { }
  }
  if (wait.video && wait.loadedDataHandler) {
    try { wait.video.removeEventListener('loadeddata', wait.loadedDataHandler); } catch (e2) { }
  }
  if (wait.raf1 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wait.raf1);
  if (wait.raf2 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wait.raf2);
}


function resetWallpaperEngineCaptureViewport(video) {
  wallpaperEngineCaptureViewportScaleX = 1;
  wallpaperEngineCaptureViewportScaleY = 1;
  video = video || document.getElementById('wallpaper-engine-video');
  if (video) {
    video.style.removeProperty('transform');
    video.style.removeProperty('transform-origin');
  }
  var layer = document.getElementById('wallpaper-engine-layer');
  if (layer) {
    delete layer.dataset.captureScaleX;
    delete layer.dataset.captureScaleY;
  }
}


function wallpaperEngineCaptureContentSize(runtime) {
  runtime = runtime && typeof runtime === 'object' ? runtime : {};
  var host = runtime.hostWindowRect && typeof runtime.hostWindowRect === 'object'
    ? runtime.hostWindowRect
    : null;
  var width = host ? Math.abs((Number(host.right) || 0) - (Number(host.left) || 0)) : 0;
  var height = host ? Math.abs((Number(host.bottom) || 0) - (Number(host.top) || 0)) : 0;
  if (!(width > 0)) width = Number(runtime.sourceWindowVisibleWidth) || 0;
  if (!(height > 0)) height = Number(runtime.sourceWindowVisibleHeight) || 0;
  return { width: width, height: height };
}
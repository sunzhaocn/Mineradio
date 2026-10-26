'use strict';

var WALLPAPER_ENGINE_SELECTION_STORE_KEY = 'mineradio-wallpaper-engine-selection-v1';

var WALLPAPER_ENGINE_HIDDEN_STORE_KEY = 'mineradio-wallpaper-engine-hidden-v1';

var WALLPAPER_ENGINE_FAVORITE_STORE_KEY = 'mineradio-wallpaper-engine-favorites-v1';

var wallpaperEngineProjects = [];

var wallpaperEngineLibrarySnapshot = null;

var wallpaperEngineMediaToken = '';

var wallpaperEngineLibraryBusy = false;

var wallpaperEngineLayerToken = 0;

var wallpaperEnginePreviewObserver = null;

var wallpaperEngineSearchRenderTimer = 0;

var wallpaperEnginePreviewScrollTimer = 0;

var wallpaperEngineSwitchTimer = 0;

var wallpaperEngineVideoRetryTimer = 0;

var wallpaperEngineFirstFrameWait = null;

var wallpaperEngineCaptureStream = null;

var wallpaperEnginePreparedCaptureStreams = new Map();

var wallpaperEngineGlassCaptureStream = null;

var wallpaperEnginePreparedGlassCaptureStreams = new Map();

var wallpaperEngineGlassCaptureToken = 0;

var wallpaperEngineGlassCaptureRetryTimer = 0;

var wallpaperEngineGlassCaptureRetryAttempt = 0;

var wallpaperEngineCaptureMode = '';

var wallpaperEngineNativeSessionId = '';

var wallpaperEngineHostBoundsRestartTimer = 0;

var wallpaperEngineHostBoundsUnsubscribe = null;

var wallpaperEngineHostBoundsPreparing = false;

var wallpaperEngineDesktopPreviewActive = false;

var wallpaperEngineDesktopPreviewUsesAsset = false;

var wallpaperEngineHostRecoveryInFlight = false;

var wallpaperEngineHostRecoveryAttempt = 0;

var wallpaperEngineHostRecoveryRetryTimer = 0;

var wallpaperEngineFreezeReleaseTimer = 0;

var wallpaperEngineFreezeGeneration = 0;

var wallpaperEngineFreezeVisible = false;

var wallpaperEngineCaptureViewportScaleX = 1;

var wallpaperEngineCaptureViewportScaleY = 1;

var wallpaperEnginePointerActivityTimer = 0;

var wallpaperEnginePointerActivityLastSentAt = 0;

var wallpaperEnginePointerActivityLatestX = 32768;

var wallpaperEnginePointerActivityLatestY = 32768;

var wallpaperEnginePointerActivityHasPoint = false;

var wallpaperEngineRenderLimit = 240;

var wallpaperEngineRuntimeError = '';

var wallpaperEngineProjectDetailsId = '';

var wallpaperEngineVisualSettingsTimer = 0;

var WALLPAPER_ENGINE_SWITCH_FADE_MS = 440;

var WALLPAPER_ENGINE_RENDER_BATCH = 240;

var WALLPAPER_ENGINE_PREPARED_STREAM_TTL_MS = 12000;

var WALLPAPER_ENGINE_FIRST_FRAME_TIMEOUT_MS = 8000;

var WALLPAPER_ENGINE_FREEZE_FADE_MS = 180;

var WALLPAPER_ENGINE_HOST_RECOVERY_MAX_ATTEMPTS = 3;

var WALLPAPER_ENGINE_POINTER_ACTIVITY_INTERVAL_MS = 8;


var hiddenWallpaperEngineIds = readWallpaperEngineIdSet(WALLPAPER_ENGINE_HIDDEN_STORE_KEY);

var favoriteWallpaperEngineIds = readWallpaperEngineIdSet(WALLPAPER_ENGINE_FAVORITE_STORE_KEY);


var wallpaperEngineSelection = readWallpaperEngineSelection();


window.__mineradioSyncWallpaperEngineCaptureFrameRate = syncWallpaperEngineCaptureFrameRate;


window.__mineradioPrepareWallpaperEngineCapture = async function (sessionId, fps, sourceId) {
  sessionId = String(sessionId || '');
  if (!/^[a-f0-9]{24}$/i.test(sessionId)) return { ok: false, error: 'WALLPAPER_ENGINE_SESSION_INVALID' };
  try {
    var stream = await openWallpaperEngineCaptureStream(sessionId, fps, sourceId, {
      sourceIdOnly: true,
      purpose: 'scene'
    });
    storeWallpaperEnginePreparedCaptureStream(sessionId, stream);
    return { ok: true };
  } catch (error) {
    stopWallpaperEnginePreparedCaptureStreams(sessionId);
    return {
      ok: false,
      error: String(error && (error.message || error.name) || error || 'WALLPAPER_CAPTURE_PREPARE_FAILED').slice(0, 500)
    };
  }
};


window.__mineradioPrepareWallpaperEngineGlassCapture = async function (sessionId, fps, sourceId) {
  sessionId = String(sessionId || '');
  if (!/^[a-f0-9]{24}$/i.test(sessionId)) return { ok: false, error: 'WALLPAPER_ENGINE_SESSION_INVALID' };
  try {
    var stream = await openWallpaperEngineCaptureStream(sessionId, fps, sourceId, {
      sourceIdOnly: true,
      purpose: 'dwm-glass',
      // The exact granted source is the helper's own DWM thumbnail surface.
      // It has no cursor-rendering path, so a Chromium track reporting
      // `cursor: always` cannot bake the user's Windows cursor into its pixels.
      trustedCursorFreeSurface: true
    });
    storeWallpaperEnginePreparedGlassCaptureStream(sessionId, stream);
    return { ok: true };
  } catch (error) {
    stopWallpaperEnginePreparedGlassCaptureStreams(sessionId);
    return {
      ok: false,
      error: String(error && (error.message || error.name) || error || 'WALLPAPER_GLASS_CAPTURE_PREPARE_FAILED').slice(0, 500)
    };
  }
};


window.__mineradioPrepareWallpaperEngineHostBoundsChange = function (sessionId, reason) {
  sessionId = String(sessionId || '');
  reason = String(reason || '').slice(0, 80);
  if (!wallpaperEngineSelection.active || wallpaperEngineSelection.kind !== 'engine') {
    return { ok: true, frozen: false, skipped: true };
  }
  // A Promise.race timeout in main cannot cancel executeJavaScript. Requiring an
  // exact live session here makes a late ACK harmless after a switch/restart.
  if (sessionId && sessionId !== wallpaperEngineNativeSessionId) {
    return { ok: false, frozen: false, error: 'WALLPAPER_ENGINE_SESSION_MISMATCH' };
  }
  var suspendingHost = /(?:^|[-_])(hidden|hide|minimize|minimized|tray|document-hidden)(?:$|[-_])/i.test(reason)
    || /^(hidden|hide|minimize|minimized|tray|document-hidden)$/i.test(reason);
  if (suspendingHost) {
    cancelWallpaperEngineHostRecovery(true);
    wallpaperEngineHostBoundsPreparing = true;
    cancelWallpaperEngineSwitchTimer();
    cancelWallpaperEngineVideoRetry();
    cancelWallpaperEngineFirstFrameWait();
    if (wallpaperEngineHostBoundsRestartTimer) {
      clearTimeout(wallpaperEngineHostBoundsRestartTimer);
      wallpaperEngineHostBoundsRestartTimer = 0;
    }
    ++wallpaperEngineLayerToken;
    wallpaperEngineNativeSessionId = '';
    wallpaperEngineCaptureMode = '';
    restoreOriginalBackgroundAfterWallpaperEngine();
    clearWallpaperEngineFreezeFrame(true);
    clearWallpaperEngineLayerMedia(0);
    return { ok: true, frozen: false, suspended: true, reason: reason };
  }
  if (wallpaperEngineHostBoundsPreparing) {
    return {
      ok: wallpaperEngineFreezeVisible === true,
      frozen: wallpaperEngineFreezeVisible === true,
      error: wallpaperEngineFreezeVisible ? '' : 'WALLPAPER_BOUNDS_FREEZE_UNAVAILABLE'
    };
  }
  var frozen = captureWallpaperEngineFreezeFrame();
  // Keep the current capture and native source alive when no real frame could
  // be copied. Stopping here would recreate the black gap we are avoiding.
  if (!frozen) {
    return { ok: false, frozen: false, error: 'WALLPAPER_BOUNDS_FREEZE_UNAVAILABLE' };
  }
  wallpaperEngineHostBoundsPreparing = true;
  // The OS hardware cursor remains authoritative while native title-bar
  // dragging pauses renderer events.
  cancelWallpaperEngineSwitchTimer();
  cancelWallpaperEngineVideoRetry();
  cancelWallpaperEngineFirstFrameWait();
  if (wallpaperEngineHostBoundsRestartTimer) {
    clearTimeout(wallpaperEngineHostBoundsRestartTimer);
    wallpaperEngineHostBoundsRestartTimer = 0;
  }
  ++wallpaperEngineLayerToken;
  stopWallpaperEngineCaptureStream();
  wallpaperEngineNativeSessionId = '';
  wallpaperEngineCaptureMode = '';
  return { ok: true, frozen: true, reason: reason };
};


window.__mineradioPrepareWallpaperEngineDesktopPreview = function (sessionId, reason) {
  sessionId = String(sessionId || '');
  reason = String(reason || 'full-desktop-passive').slice(0, 80);
  if (!wallpaperEngineSelection.active || wallpaperEngineSelection.kind !== 'engine') {
    return Promise.resolve({ ok: true, preview: false, selectedEngine: false, skipped: true });
  }
  if (sessionId && sessionId !== String(wallpaperEngineNativeSessionId || '')) {
    return Promise.resolve({
      ok: false,
      preview: false,
      selectedEngine: true,
      error: 'WALLPAPER_ENGINE_SESSION_MISMATCH'
    });
  }

  var item = wallpaperEngineProjectById(wallpaperEngineSelection.id);
  wallpaperEngineDesktopPreviewActive = true;
  wallpaperEngineDesktopPreviewUsesAsset = false;
  cancelWallpaperEngineHostRecovery(true);
  wallpaperEngineHostBoundsPreparing = true;
  cancelWallpaperEngineSwitchTimer();
  cancelWallpaperEngineVideoRetry();
  cancelWallpaperEngineFirstFrameWait();
  if (wallpaperEngineHostBoundsRestartTimer) {
    clearTimeout(wallpaperEngineHostBoundsRestartTimer);
    wallpaperEngineHostBoundsRestartTimer = 0;
  }
  var token = ++wallpaperEngineLayerToken;
  stopWallpaperEngineCaptureStream();
  wallpaperEngineNativeSessionId = '';
  wallpaperEngineCaptureMode = '';
  restoreOriginalBackgroundAfterWallpaperEngine();
  clearWallpaperEngineFreezeFrame(true);
  clearWallpaperEngineLayerMedia(0);

  if (!item || !item.hasPreview) {
    updateWallpaperEngineEntryUi('桌面被动模式 · 已显示原背景');
    return Promise.resolve({
      ok: true,
      preview: false,
      selectedEngine: true,
      fallback: true,
      reason: reason
    });
  }

  var layer = document.getElementById('wallpaper-engine-layer');
  var image = document.getElementById('wallpaper-engine-image');
  if (!layer || !image) {
    updateWallpaperEngineEntryUi('桌面被动模式 · 已显示原背景');
    return Promise.resolve({
      ok: true,
      preview: false,
      selectedEngine: true,
      fallback: true,
      reason: reason
    });
  }

  updateWallpaperEngineEntryUi('正在准备桌面壁纸预览…');
  return new Promise(function (resolve) {
    var settled = false;
    var timer = 0;
    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = 0;
      image.onload = null;
      image.onerror = null;
      resolve(result);
    }
    function fallback(error) {
      if (token !== wallpaperEngineLayerToken) {
        finish({
          ok: false,
          preview: false,
          selectedEngine: true,
          error: 'WALLPAPER_DESKTOP_PREVIEW_SUPERSEDED'
        });
        return;
      }
      restoreOriginalBackgroundAfterWallpaperEngine();
      clearWallpaperEngineLayerMedia(0);
      updateWallpaperEngineEntryUi('桌面被动模式 · 已显示原背景');
      finish({
        ok: true,
        preview: false,
        selectedEngine: true,
        fallback: true,
        reason: reason,
        error: String(error || '')
      });
    }
    image.onload = function () {
      if (token !== wallpaperEngineLayerToken
        || !wallpaperEngineSelection.active
        || wallpaperEngineSelection.kind !== 'engine'
        || wallpaperEngineSelection.id !== item.id) {
        finish({
          ok: false,
          preview: false,
          selectedEngine: true,
          error: 'WALLPAPER_DESKTOP_PREVIEW_SUPERSEDED'
        });
        return;
      }
      wallpaperEngineDesktopPreviewUsesAsset = true;
      wallpaperEngineLayerReady('image', token);
      updateWallpaperEngineEntryUi('桌面被动模式 · 项目预览');
      finish({
        ok: true,
        preview: true,
        selectedEngine: true,
        reason: reason
      });
    };
    image.onerror = function () { fallback('WALLPAPER_DESKTOP_PREVIEW_LOAD_FAILED'); };
    timer = setTimeout(function () { fallback('WALLPAPER_DESKTOP_PREVIEW_LOAD_TIMEOUT'); }, 5000);
    image.src = wallpaperEngineMediaUrl(item, 'preview');
  });
};


initializeWallpaperEngineLibrary();

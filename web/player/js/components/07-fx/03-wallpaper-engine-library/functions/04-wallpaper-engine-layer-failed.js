'use strict';



function wallpaperEngineLayerFailed(item, attemptedKind, token) {
  if (token !== wallpaperEngineLayerToken) return;
  var nativeStopPromise = Promise.resolve({ ok: true });
  if (attemptedKind === 'engine') {
    cancelWallpaperEngineFirstFrameWait();
    var failedSessionId = String(wallpaperEngineNativeSessionId || '');
    if (/^[a-f0-9]{24}$/i.test(failedSessionId)) reportWallpaperEngineCaptureResult(failedSessionId, false);
    stopWallpaperEngineCaptureStream();
    nativeStopPromise = stopWallpaperEngineNativeSession();
    if (wallpaperEngineHostRecoveryInFlight
      && wallpaperEngineHostRecoveryAttempt < WALLPAPER_ENGINE_HOST_RECOVERY_MAX_ATTEMPTS
      && wallpaperEngineDesktopHostIsVisible()) {
      wallpaperEngineHostBoundsPreparing = true;
      wallpaperEngineRuntimeError = '';
      restoreOriginalBackgroundAfterWallpaperEngine();
      clearWallpaperEngineLayerMedia(0);
      updateWallpaperEngineEntryUi('正在恢复 ' + (item && item.title || 'Wallpaper Engine') + '…');
      Promise.resolve(nativeStopPromise).finally(function () {
        if (!wallpaperEngineHostRecoveryInFlight || wallpaperEngineHostRecoveryRetryTimer) return;
        wallpaperEngineHostRecoveryRetryTimer = setTimeout(function () {
          wallpaperEngineHostRecoveryRetryTimer = 0;
          if (!wallpaperEngineHostRecoveryInFlight
            || !wallpaperEngineSelection.active
            || wallpaperEngineSelection.kind !== 'engine'
            || !wallpaperEngineDesktopHostIsVisible()) return;
          wallpaperEngineHostBoundsPreparing = false;
          restartWallpaperEngineAfterHostBoundsChange();
        }, 650);
      });
      return;
    }
    cancelWallpaperEngineHostRecovery(true);
  }
  if ((attemptedKind === 'media' || attemptedKind === 'engine') && item && item.hasPreview) {
    wallpaperEngineSelection.kind = 'preview';
    wallpaperEngineSelection.mediaType = 'image';
    showToast(attemptedKind === 'engine' ? ((wallpaperEngineRuntimeError || 'Wallpaper Engine 实时运行失败') + '，已切换到项目预览；再次点击可重试') : '动态媒体解码失败，已切换到安全预览');
    applyWallpaperEngineBackground(item, true);
    return;
  }
  wallpaperEngineRuntimeError = attemptedKind === 'engine' ? 'WE 引擎运行失败' : '媒体不可用';
  restoreOriginalBackgroundAfterWallpaperEngine();
  clearWallpaperEngineLayerMedia(0);
  updateWallpaperEngineEntryUi();
  showToast('壁纸媒体不可用，已恢复原背景');
}


function applyWallpaperEngineBackground(item, quiet) {
  item = item || wallpaperEngineProjectById(wallpaperEngineSelection.id);
  if (!item || !wallpaperEngineSelection.active) {
    wallpaperEngineRuntimeError = item ? '' : '项目离线';
    restoreOriginalBackgroundAfterWallpaperEngine();
    clearWallpaperEngineLayerMedia(0);
    updateWallpaperEngineEntryUi(item ? '' : '项目离线 · 已显示原背景');
    return false;
  }
  var kind = wallpaperEngineSelection.kind === 'engine' && item.enginePlayable
    ? 'engine'
    : (wallpaperEngineSelection.kind === 'media' && item.playable ? 'media' : 'preview');
  if (kind === 'preview' && !item.hasPreview) {
    wallpaperEngineLayerFailed(item, kind, wallpaperEngineLayerToken);
    return false;
  }
  var layer = document.getElementById('wallpaper-engine-layer');
  var image = document.getElementById('wallpaper-engine-image');
  var video = document.getElementById('wallpaper-engine-video');
  var preserveOutgoingFrame = !!(layer && (layer.classList.contains('ready') || wallpaperEngineSwitchTimer));
  cancelWallpaperEngineSwitchTimer();
  var token = ++wallpaperEngineLayerToken;
  if (kind !== 'engine') stopWallpaperEngineNativeSession();
  restoreOriginalBackgroundAfterWallpaperEngine();
  if (!layer || !image || !video) return false;
  updateWallpaperEngineEntryUi('正在加载 ' + (item.title || '壁纸') + '…');

  function beginWallpaperEngineMediaLoad() {
    if (token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active || wallpaperEngineSelection.id !== item.id) return;
    if (kind === 'engine' && wallpaperEngineNativeHostUnavailable()) return;
    clearWallpaperEngineLayerMedia(0);
    if (kind === 'engine') {
      startWallpaperEngineNativeBackground(item, token).catch(function (error) {
        if (token !== wallpaperEngineLayerToken) return;
        if (wallpaperEngineNativeHostUnavailable() || /WALLPAPER_ENGINE_START_SUPERSEDED/.test(String(error && (error.code || error.message) || error || ''))) return;
        console.warn('[Wallpaper Engine Scene]', error);
        wallpaperEngineRuntimeError = wallpaperEngineRuntimeErrorText(error);
        wallpaperEngineLayerFailed(item, kind, token);
      });
    } else if (kind === 'media' && item.mediaType === 'video') {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      if (item.hasPreview) video.poster = wallpaperEngineMediaUrl(item, 'preview');
      video.onloadeddata = function () {
        if (token !== wallpaperEngineLayerToken) return;
        requestWallpaperEngineVideoPlayback(video, item, kind, token, true, 0);
      };
      video.onerror = function () { wallpaperEngineLayerFailed(item, kind, token); };
      video.src = wallpaperEngineMediaUrl(item, 'media');
      video.load();
    } else {
      image.onload = function () { wallpaperEngineLayerReady('image', token); };
      image.onerror = function () { wallpaperEngineLayerFailed(item, kind, token); };
      image.src = wallpaperEngineMediaUrl(item, kind === 'media' ? 'media' : 'preview');
    }
  }

  if (preserveOutgoingFrame) {
    clearWallpaperEngineLayerMedia(WALLPAPER_ENGINE_SWITCH_FADE_MS);
    wallpaperEngineSwitchTimer = setTimeout(function () {
      wallpaperEngineSwitchTimer = 0;
      beginWallpaperEngineMediaLoad();
    }, WALLPAPER_ENGINE_SWITCH_FADE_MS + 20);
  } else {
    clearWallpaperEngineLayerMedia(0);
    beginWallpaperEngineMediaLoad();
  }
  if (!quiet) showToast(kind === 'engine' ? '正在用 Wallpaper Engine 原生引擎载入 Scene…' : (kind === 'media' ? 'Wallpaper Engine 壁纸已启用' : '已启用安全预览，原背景仍保留'));
  return true;
}


function activateWallpaperEngineItem(id) {
  var item = wallpaperEngineProjectById(id);
  if (!item || (!item.playable && !item.enginePlayable && !item.hasPreview)) {
    showToast('该项目没有可安全导入的媒体');
    return;
  }
  wallpaperEngineSelection = normalizeWallpaperEngineSelection({
    active: true,
    id: item.id,
    title: item.title,
    kind: item.enginePlayable ? 'engine' : (item.playable ? 'media' : 'preview'),
    mediaType: item.enginePlayable ? 'video' : (item.playable ? item.mediaType : 'image'),
    mediaAnimated: item.mediaAnimated,
    projectType: item.projectType,
    hasPreview: item.hasPreview,
    previewAnimated: item.previewAnimated,
    visualOpacity: wallpaperEngineSelection.visualOpacity,
    visualPositionX: wallpaperEngineSelection.visualPositionX,
    visualPositionY: wallpaperEngineSelection.visualPositionY,
    visualScale: wallpaperEngineSelection.visualScale,
    updatedAt: item.updatedAt
  });
  wallpaperEngineDesktopPreviewActive = false;
  wallpaperEngineDesktopPreviewUsesAsset = false;
  cancelWallpaperEngineHostRecovery(true);
  saveWallpaperEngineSelection();
  wallpaperEngineRuntimeError = '';
  applyWallpaperEngineBackground(item, false);
  closeWallpaperEngineLibrary();
}


function deactivateWallpaperEngineBackground(quiet) {
  cancelWallpaperEngineHostRecovery(true);
  wallpaperEngineDesktopPreviewActive = false;
  wallpaperEngineDesktopPreviewUsesAsset = false;
  wallpaperEngineSelection.active = false;
  if (wallpaperEngineHostBoundsRestartTimer) {
    clearTimeout(wallpaperEngineHostBoundsRestartTimer);
    wallpaperEngineHostBoundsRestartTimer = 0;
  }
  saveWallpaperEngineSelection();
  wallpaperEngineRuntimeError = '';
  cancelWallpaperEngineSwitchTimer();
  cancelWallpaperEngineVideoRetry();
  cancelWallpaperEngineFirstFrameWait();
  wallpaperEngineHostBoundsPreparing = false;
  stopWallpaperEngineCaptureStream();
  stopWallpaperEngineNativeSession();
  ++wallpaperEngineLayerToken;
  restoreOriginalBackgroundAfterWallpaperEngine();
  clearWallpaperEngineFreezeFrame(true);
  clearWallpaperEngineLayerMedia(0);
  updateWallpaperEngineEntryUi();
  renderWallpaperEngineLibrary();
  if (!quiet) showToast('已恢复原背景媒体，原设置没有被覆盖');
}


function restartWallpaperEngineAfterHostBoundsChange() {
  if (!wallpaperEngineSelection.active || wallpaperEngineSelection.kind !== 'engine' || wallpaperEngineNativeHostUnavailable()) return;
  var item = wallpaperEngineProjectById(wallpaperEngineSelection.id);
  if (!item || !item.enginePlayable) {
    clearWallpaperEngineFreezeFrame(false);
    return;
  }
  cancelWallpaperEngineSwitchTimer();
  cancelWallpaperEngineVideoRetry();
  cancelWallpaperEngineFirstFrameWait();
  if (wallpaperEngineHostBoundsRestartTimer) {
    clearTimeout(wallpaperEngineHostBoundsRestartTimer);
    wallpaperEngineHostBoundsRestartTimer = 0;
  }
  var token = ++wallpaperEngineLayerToken;
  wallpaperEngineHostRecoveryInFlight = true;
  wallpaperEngineHostRecoveryAttempt += 1;
  wallpaperEngineRuntimeError = '';
  updateWallpaperEngineEntryUi('正在恢复 ' + (item.title || 'Wallpaper Engine') + '…');
  startWallpaperEngineNativeBackground(item, token).catch(function (error) {
    if (token !== wallpaperEngineLayerToken) return;
    if (wallpaperEngineNativeHostUnavailable() || /WALLPAPER_ENGINE_START_SUPERSEDED/.test(String(error && (error.code || error.message) || error || ''))) return;
    console.warn('[Wallpaper Engine Scene bounds restart]', error);
    wallpaperEngineRuntimeError = wallpaperEngineRuntimeErrorText(error);
    wallpaperEngineLayerFailed(item, 'engine', token);
  });
}


function handleWallpaperEngineHostBoundsChange(payload) {
  var phase = String(payload && payload.phase || 'restart');
  if (phase === 'resident') {
    var residentSessionId = String(payload && payload.sessionId || '');
    if (!wallpaperEngineSelection.active
      || wallpaperEngineSelection.kind !== 'engine'
      || wallpaperEngineCaptureMode !== 'dwm-thumbnail'
      || residentSessionId !== String(wallpaperEngineNativeSessionId || '')) return;
    // Minimize no longer destroys the native DWM base. Restore only the
    // renderer-side visual state and, if Chromium ended it in the background,
    // reacquire the narrow glass sampler without restarting the Scene.
    wallpaperEngineHostBoundsPreparing = false;
    wallpaperEngineDesktopPreviewActive = false;
    wallpaperEngineDesktopPreviewUsesAsset = false;
    applyWallpaperEngineVisualSettings(true);
    clearWallpaperEngineFreezeFrame(false);
    if (!wallpaperEngineCaptureStream
      || !wallpaperEngineCaptureStream.getVideoTracks
      || !wallpaperEngineCaptureStream.getVideoTracks().some(function (track) { return track && track.readyState === 'live'; })) {
      scheduleWallpaperEngineGlassSamplerCapture(residentSessionId, wallpaperEngineLayerToken, 0);
    }
    updateWallpaperEngineEntryUi();
    return;
  }
  if (phase === 'restart') {
    if (!wallpaperEngineHostBoundsPreparing && !wallpaperEngineDesktopPreviewActive) return;
    // BrowserWindow.show()/restore can fire before Chromium has published the
    // visible document state. Keep the session suspended until visibilitychange
    // confirms that capture can be created without an immediate preview fallback.
    if (document.hidden && !(payload && payload.forceVisibleHost === true)) return;
    wallpaperEngineDesktopPreviewActive = false;
    wallpaperEngineDesktopPreviewUsesAsset = false;
    wallpaperEngineHostBoundsPreparing = false;
    restartWallpaperEngineAfterHostBoundsChange();
    return;
  }
  if (phase === 'prepare' && typeof window.__mineradioPrepareWallpaperEngineHostBoundsChange === 'function') {
    window.__mineradioPrepareWallpaperEngineHostBoundsChange(payload && payload.sessionId, payload && payload.reason);
  }
}


function wallpaperEngineFilteredProjects() {
  var search = document.getElementById('wallpaper-engine-search');
  var query = String(search && search.value || '').trim().toLowerCase();
  return wallpaperEngineProjects.filter(function (item) {
    if (hiddenWallpaperEngineIds.has(item.id)) return false;
    if (!query) return true;
    return (item.title + ' ' + item.projectType + ' ' + item.sourceLabel + ' ' + item.workshopId).toLowerCase().indexOf(query) >= 0;
  }).sort(function (a, b) {
    var activeA = wallpaperEngineSelection.active && wallpaperEngineSelection.id === a.id ? 1 : 0;
    var activeB = wallpaperEngineSelection.active && wallpaperEngineSelection.id === b.id ? 1 : 0;
    var favA = favoriteWallpaperEngineIds.has(a.id) ? 1 : 0;
    var favB = favoriteWallpaperEngineIds.has(b.id) ? 1 : 0;
    return activeB - activeA || favB - favA || Number(b.playable) - Number(a.playable) || Number(b.enginePlayable) - Number(a.enginePlayable) || a.title.localeCompare(b.title, 'zh-CN');
  });
}


function disconnectWallpaperEnginePreviewObserver() {
  if (wallpaperEnginePreviewObserver) wallpaperEnginePreviewObserver.disconnect();
  wallpaperEnginePreviewObserver = null;
}


function loadWallpaperEnginePreviewsNearViewport() {
  var grid = document.getElementById('wallpaper-engine-grid');
  var modal = document.getElementById('wallpaper-engine-modal');
  if (!grid || (modal && !modal.classList.contains('show'))) return;
  var viewport = grid.getBoundingClientRect();
  grid.querySelectorAll('img[data-src]').forEach(function (image) {
    var rect = image.getBoundingClientRect();
    var nearby = rect.bottom >= viewport.top - 220 && rect.top <= viewport.bottom + 220;
    if (nearby) {
      if (!image.getAttribute('src')) image.src = image.dataset.src || '';
    } else if (image.dataset.animated === '1') {
      image.removeAttribute('src');
      image.classList.remove('loaded');
    }
  });
}


function extendWallpaperEngineLibraryNearEnd() {
  var grid = document.getElementById('wallpaper-engine-grid');
  if (!grid || !grid.querySelector('[data-wallpaper-action="load-more"]')) return;
  var remaining = grid.scrollHeight - grid.scrollTop - grid.clientHeight;
  if (remaining > Math.max(280, grid.clientHeight * 0.7)) return;
  wallpaperEngineRenderLimit += WALLPAPER_ENGINE_RENDER_BATCH;
  renderWallpaperEngineLibrary(true);
}


function scheduleWallpaperEnginePreviewViewportUpdate() {
  if (wallpaperEnginePreviewObserver) {
    extendWallpaperEngineLibraryNearEnd();
    return;
  }
  if (wallpaperEnginePreviewScrollTimer) return;
  wallpaperEnginePreviewScrollTimer = setTimeout(function () {
    wallpaperEnginePreviewScrollTimer = 0;
    loadWallpaperEnginePreviewsNearViewport();
    extendWallpaperEngineLibraryNearEnd();
  }, 60);
}


function observeWallpaperEnginePreviews() {
  disconnectWallpaperEnginePreviewObserver();
  var grid = document.getElementById('wallpaper-engine-grid');
  if (!grid || typeof IntersectionObserver === 'undefined') {
    if (grid) {
      grid.querySelectorAll('img[data-src]').forEach(function (img) {
        img.onload = function () { img.classList.add('loaded'); };
      });
      loadWallpaperEnginePreviewsNearViewport();
    }
    return;
  }
  wallpaperEnginePreviewObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var img = entry.target;
      if (entry.isIntersecting) {
        if (!img.getAttribute('src')) img.src = img.dataset.src || '';
      } else if (img.dataset.animated === '1') {
        img.removeAttribute('src');
        img.classList.remove('loaded');
      }
    });
  }, { root: grid, rootMargin: '220px 0px', threshold: 0.01 });
  grid.querySelectorAll('img[data-src]').forEach(function (img) {
    img.onload = function () { img.classList.add('loaded'); };
    wallpaperEnginePreviewObserver.observe(img);
  });
  loadWallpaperEnginePreviewsNearViewport();
}


function renderWallpaperEngineManualRoots() {
  var host = document.getElementById('wallpaper-engine-manual-roots');
  if (!host) return;
  var roots = wallpaperEngineLibrarySnapshot && Array.isArray(wallpaperEngineLibrarySnapshot.manualRoots)
    ? wallpaperEngineLibrarySnapshot.manualRoots : [];
  host.innerHTML = roots.map(function (root) {
    return '<span class="wallpaper-engine-root-chip"><span title="手动导入目录">' + escHtml(root.name || '导入目录') + '</span>' +
      '<button type="button" data-wallpaper-action="remove-root" data-root-id="' + escHtml(root.id || '') + '" title="移除此索引目录">×</button></span>';
  }).join('');
}
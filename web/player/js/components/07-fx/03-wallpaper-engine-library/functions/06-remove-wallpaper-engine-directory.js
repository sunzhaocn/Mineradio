'use strict';



async function removeWallpaperEngineDirectory(rootId) {
  var api = wallpaperEngineDesktopApi();
  if (!api || typeof api.removeWallpaperEngineDirectory !== 'function') return;
  if (wallpaperEngineLibraryBusy) return;
  wallpaperEngineLibraryBusy = true;
  updateWallpaperEngineLibraryStatus(null, '');
  renderWallpaperEngineLibrary();
  var failure = '';
  try {
    var snapshot = await api.removeWallpaperEngineDirectory(rootId);
    if (!snapshot || snapshot.ok === false) throw new Error(snapshot && snapshot.error || '移除失败');
    consumeWallpaperEngineSnapshot(snapshot);
    showToast('已移除手动导入目录，Steam 自动识别不受影响');
  } catch (e) {
    failure = e.message || '目录移除失败';
    showToast(e.message || '目录移除失败');
  } finally {
    wallpaperEngineLibraryBusy = false;
    updateWallpaperEngineLibraryStatus(wallpaperEngineLibrarySnapshot, failure);
    renderWallpaperEngineLibrary();
  }
}


function toggleFavoriteWallpaperEngineItem(id) {
  id = String(id || '');
  if (favoriteWallpaperEngineIds.has(id)) favoriteWallpaperEngineIds.delete(id);
  else favoriteWallpaperEngineIds.add(id);
  saveWallpaperEngineIdSet(WALLPAPER_ENGINE_FAVORITE_STORE_KEY, favoriteWallpaperEngineIds);
  renderWallpaperEngineLibrary();
}


function hideWallpaperEngineItem(id) {
  id = String(id || '');
  hiddenWallpaperEngineIds.add(id);
  saveWallpaperEngineIdSet(WALLPAPER_ENGINE_HIDDEN_STORE_KEY, hiddenWallpaperEngineIds);
  renderWallpaperEngineLibrary();
}


function restoreHiddenWallpaperEngineItems() {
  if (!hiddenWallpaperEngineIds.size) {
    showToast('没有已隐藏的壁纸');
    return;
  }
  hiddenWallpaperEngineIds.clear();
  saveWallpaperEngineIdSet(WALLPAPER_ENGINE_HIDDEN_STORE_KEY, hiddenWallpaperEngineIds);
  renderWallpaperEngineLibrary();
  showToast('已恢复全部隐藏壁纸');
}


function bindWallpaperEngineLibraryEvents() {
  var desktopApi = wallpaperEngineDesktopApi();
  if (!wallpaperEngineHostBoundsUnsubscribe && desktopApi && typeof desktopApi.onWallpaperEngineHostBoundsChanged === 'function') {
    wallpaperEngineHostBoundsUnsubscribe = desktopApi.onWallpaperEngineHostBoundsChanged(function (payload) {
      handleWallpaperEngineHostBoundsChange(payload || {});
    });
  }
  var grid = document.getElementById('wallpaper-engine-grid');
  if (grid && !grid._wallpaperEngineBound) {
    grid._wallpaperEngineBound = true;
    grid.addEventListener('scroll', scheduleWallpaperEnginePreviewViewportUpdate, { passive: true });
    grid.addEventListener('click', function (event) {
      var action = event.target && event.target.closest ? event.target.closest('[data-wallpaper-action]') : null;
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        var actionName = action.getAttribute('data-wallpaper-action');
        var id = action.getAttribute('data-wallpaper-id');
        if (actionName === 'favorite') toggleFavoriteWallpaperEngineItem(id);
        else if (actionName === 'hide') hideWallpaperEngineItem(id);
        else if (actionName === 'details') showWallpaperEngineProjectDetails(id);
        else if (actionName === 'load-more') {
          wallpaperEngineRenderLimit += WALLPAPER_ENGINE_RENDER_BATCH;
          renderWallpaperEngineLibrary(true);
        }
        return;
      }
      var card = event.target && event.target.closest ? event.target.closest('[data-wallpaper-id]') : null;
      if (card) activateWallpaperEngineItem(card.getAttribute('data-wallpaper-id'));
    });
    grid.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target && event.target.closest && event.target.closest('[data-wallpaper-action]')) return;
      var card = event.target && event.target.closest ? event.target.closest('.wallpaper-engine-card[data-wallpaper-id]') : null;
      if (!card || event.target !== card) return;
      event.preventDefault();
      activateWallpaperEngineItem(card.getAttribute('data-wallpaper-id'));
    });
  }
  var roots = document.getElementById('wallpaper-engine-manual-roots');
  if (roots && !roots._wallpaperEngineBound) {
    roots._wallpaperEngineBound = true;
    roots.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-wallpaper-action="remove-root"]') : null;
      if (button) removeWallpaperEngineDirectory(button.getAttribute('data-root-id'));
    });
  }
  if (!document._wallpaperEngineKeyBound) {
    document._wallpaperEngineKeyBound = true;
    document.addEventListener('pointermove', queueWallpaperEnginePointerActivity, { passive: true, capture: true });
    document.addEventListener('mousemove', queueWallpaperEnginePointerActivity, { passive: true, capture: true });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        var drawer = document.getElementById('wallpaper-engine-details-drawer');
        if (drawer && drawer.classList.contains('show')) closeWallpaperEngineProjectDetails();
        else closeWallpaperEngineLibrary();
      }
    });
    document.addEventListener('visibilitychange', function () {
      var video = document.getElementById('wallpaper-engine-video');
      if (!wallpaperEngineSelection.active) return;
      var item = wallpaperEngineProjectById(wallpaperEngineSelection.id);
      if (wallpaperEngineSelection.kind === 'engine') {
        if (wallpaperEngineDesktopPreviewActive) return;
        if (wallpaperEngineUsesDesktopHostLifecycle()) {
          if (!document.hidden && item && wallpaperEngineHostBoundsPreparing) {
            wallpaperEngineHostBoundsPreparing = false;
            restartWallpaperEngineAfterHostBoundsChange();
          }
          return;
        }
        if (document.hidden) {
          window.__mineradioPrepareWallpaperEngineHostBoundsChange(wallpaperEngineNativeSessionId, 'document-hidden');
          stopWallpaperEngineNativeSession();
        } else if (item && wallpaperEngineHostBoundsPreparing) {
          wallpaperEngineHostBoundsPreparing = false;
          restartWallpaperEngineAfterHostBoundsChange();
        }
        return;
      }
      if (wallpaperEngineSelection.mediaType === 'video') {
        if (!video) return;
        if (document.hidden) {
          cancelWallpaperEngineVideoRetry();
          try { video.pause(); } catch (e) { }
        } else if (document.body.classList.contains('wallpaper-engine-active')) {
          var token = wallpaperEngineLayerToken;
          requestWallpaperEngineVideoPlayback(video, item, 'media', token, false, 0);
        }
        return;
      }
      var animatedImage = wallpaperEngineSelection.kind === 'preview'
        ? wallpaperEngineSelection.previewAnimated : wallpaperEngineSelection.mediaAnimated;
      if (!animatedImage || !item) return;
      if (document.hidden) {
        ++wallpaperEngineLayerToken;
        clearWallpaperEngineLayerMedia(0);
      } else {
        applyWallpaperEngineBackground(item, true);
      }
    });
    window.addEventListener('pagehide', function () {
      if (typeof wallpaperEngineHostBoundsUnsubscribe === 'function') {
        try { wallpaperEngineHostBoundsUnsubscribe(); } catch (e) { }
        wallpaperEngineHostBoundsUnsubscribe = null;
      }
      cancelWallpaperEngineSwitchTimer();
      cancelWallpaperEngineVideoRetry();
      cancelWallpaperEngineFirstFrameWait();
      cancelWallpaperEnginePointerActivity();
      ++wallpaperEngineLayerToken;
      stopWallpaperEngineCaptureStream();
      clearWallpaperEngineFreezeFrame(true);
    });
  }
}


function initializeWallpaperEngineLibrary() {
  bindWallpaperEngineLibraryEvents();
  applyWallpaperEngineVisualSettings(false);
  updateWallpaperEngineEntryUi();
  if (!wallpaperEngineSelection.active) return;
  setTimeout(function () {
    loadWallpaperEngineLibrary(false, false).then(function () {
      var item = wallpaperEngineProjectById(wallpaperEngineSelection.id);
      if (item) applyWallpaperEngineBackground(item, true);
      else {
        wallpaperEngineRuntimeError = '项目离线';
        updateWallpaperEngineEntryUi('项目离线 · 已显示原背景');
      }
    });
  }, 120);
}
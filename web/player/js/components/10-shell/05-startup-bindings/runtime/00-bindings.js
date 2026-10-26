'use strict';

var simplePlayerAtStartup = !!(window.mineradioSimplePlayer && window.mineradioSimplePlayer.active());

applyDiyMode(!simplePlayerAtStartup && diyPlayerMode, { save: false });

if (!simplePlayerAtStartup) bindFxPanel();

if (!simplePlayerAtStartup) applySavedLyricPaletteState();

bindQualityControl();

bindAudioOutputControls();

bindVolumeControls();

if (!simplePlayerAtStartup) initControlGlassSurface();

if (!simplePlayerAtStartup) bindPlayerControlAnimations();

if (!simplePlayerAtStartup) scheduleUiWarmTask(function () {
  updateControlGlassDisplacementMap();
  updateSearchBoxGlassDisplacementMap();
  updateSearchPillGlassDisplacementMap();
  try {
    if (renderer && renderer.compile && scene && camera) renderer.compile(scene, camera);
  } catch (e) { }
}, 900);

applyUserCapsuleAutoHideState();

applyFxFabAutoHideState();

initializeDesktopCloseBehavior();

applyStartupAutoplayUi();

if (!simplePlayerAtStartup) applyControlsAutoHidePreference();

applyDesktopLyricsState(false);

applyWallpaperModeState(false);

if (!simplePlayerAtStartup) setShelfMode(fx.shelf);

if (!simplePlayerAtStartup && fx.shelf === 'side') setShelfPinnedOpen(!!fx.shelfPinnedOpen, true, false);

var restoredPlaybackAtStartup = restoreLastPlaybackSnapshot();

var persistedLocalLibraryRestorePromise = Promise.resolve(restorePersistedLocalLibrary()).then(function (restored) {
  if (restored) restoredPlaybackAtStartup = true;
  else if (!restoredLastPlaybackSnapshot) restoredPlaybackAtStartup = false;
  return restored;
}, function () { return false; });

var builtInPlaylistRestorePromise = typeof refreshBuiltInPlaylists === 'function'
  ? Promise.resolve(refreshBuiltInPlaylists(false))
  : Promise.resolve(false);

if (!simplePlayerAtStartup) applyStartupStarfieldPreset();

switchPlaylistTab(queueViewTab, { save: false, animate: false, refresh: false });

applyPlaylistPanelPinState(false);

if (!simplePlayerAtStartup && fx.floatLayer) createFloatLayer();

if (!simplePlayerAtStartup && fx.particleLyrics) createLyricsParticles();

if (!simplePlayerAtStartup && fx.backCover) createBackCoverLayer();

if (!simplePlayerAtStartup) initIdleGuideCanvas();

var startupLoginStatusPromise = Promise.all([refreshLoginStatus(), refreshQQLoginStatus({ forceVip: true, reason: 'startup' }), refreshKugouLoginStatus(), refreshQishuiLoginStatus(), persistedLocalLibraryRestorePromise, builtInPlaylistRestorePromise]);

startQQLoginStatusAutoRefresh();

startKugouLoginStatusAutoRefresh();

startQishuiLoginStatusAutoRefresh();

if (typeof setupFullscreenDiyLayoutTracking === 'function') setupFullscreenDiyLayoutTracking();

if (startupLoginStatusPromise && startupLoginStatusPromise.then) {
  startupLoginStatusPromise.then(function () {
    if (hasAnyPlatformLogin()) {
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
    }
    if (restoredPlaybackAtStartup) queueStartupAutoplayAfterHomeReveal('login-status');
    if (document.body.classList.contains('splash-active')) return;
    var homeShown = updateEmptyHomeVisibility({ forceLoad: hasAnyPlatformLogin() });
    if (!hasAnyPlatformLogin()) maybeRunStartupLoginGuide('status');
    else if (!homeShown) maybeRunStartupLoginGuide('status');
  }, function () {
    if (restoredPlaybackAtStartup) queueStartupAutoplayAfterHomeReveal('login-status');
  });
} else if (restoredPlaybackAtStartup) {
  queueStartupAutoplayAfterHomeReveal('startup');
}

var collectNameInput = document.getElementById('collect-new-name');

if (collectNameInput) {
  collectNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      createPlaylistFromCollect();
    }
  });
}

var customLyricInput = document.getElementById('custom-lyric-input');

if (customLyricInput) {
  customLyricInput.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveCustomLyricForCurrent();
    }
  });
}

safeRenderQueuePanel('startup');

if (!restoredPlaybackAtStartup) {
  restoredPlaybackAtStartup = restoreLastPlaybackSnapshot();
  if (restoredPlaybackAtStartup) queueStartupAutoplayAfterHomeReveal('startup-restore');
}

safeRenderQueuePanel('startup-restore');

updateCustomCoverButton();

updateCustomLyricControls();

updateLikeButtons();

setTimeout(initUpdatePreview, 9000);

window.addEventListener('beforeunload', function () {
  saveLastPlaybackSnapshot(true, 'beforeunload');
});

// ============================================================
//  主循环

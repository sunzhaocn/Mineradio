'use strict';


function resetFixedRenderCadenceState() {
  fixedRenderCadenceState.key = '';
  fixedRenderCadenceState.lastCheckAt = 0;
  fixedRenderCadenceState.phase = 0;
}

function shouldSkipFixedRenderCadenceFrame(state, now, fps, displayHz, key) {
  if (!state) return false;
  now = Number(now);
  fps = Math.max(1, Number(fps) || 1);
  displayHz = Math.max(1, Number(displayHz) || 60);
  key = String(key || fps);
  if (!isFinite(now)) now = performance.now();
  var lastCheckAt = Number(state.lastCheckAt) || 0;
  var elapsedMs = Math.max(0, now - lastCheckAt);
  var stallResetMs = Math.max(50, (1000 / displayHz) * 4);
  if (state.key !== key || !lastCheckAt || now < lastCheckAt || elapsedMs > stallResetMs) {
    state.key = key;
    state.lastCheckAt = now;
    state.phase = 0;
    return false;
  }
  state.lastCheckAt = now;
  // Accumulate target-frame credit instead of anchoring the phase to the last
  // rendered rAF.  This avoids 45 -> 30 on 60 Hz and 60 -> 48 on 144 Hz.
  // At or above the display rate every VSync is already the strict upper cap;
  // this also absorbs the tiny 59.94/60 and 119.88/120 rAF timing mismatch.
  if (fps >= displayHz * 0.98) {
    state.phase = 0;
    return false;
  }
  state.phase = Math.max(0, Number(state.phase) || 0) + elapsedMs * fps / 1000;
  if (state.phase < 1) return true;
  state.phase = Math.max(0, state.phase - 1);
  return false;
}

function isMainSceneCoveredBySplash() {
  return document.body.classList.contains('splash-active') && !document.body.classList.contains('splash-revealing');
}

function currentRenderAdaptiveContext(now) {
  var tier = (typeof getRenderLoadTier === 'function') ? getRenderLoadTier() : 0;
  if (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive(now)) {
    return { kind: 'interaction', tier: tier };
  }
  var activePlayback = !!(playing && audio && !audio.paused);
  return { kind: activePlayback ? 'playback' : 'idle', tier: tier };
}

function resolveAdaptiveRenderCadence(now, mode) {
  if (isDeepBackgroundMode()) return null;
  mode = mode || ((typeof normalizeForegroundFpsMode === 'function') ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode) : 'adaptive');
  if (mode !== 'adaptive' || RENDER_VISIBLE_VSYNC || typeof selectAdaptiveRenderCadence !== 'function') return null;
  var context = currentRenderAdaptiveContext(now);
  return selectAdaptiveRenderCadence(context.kind, context.tier);
}

function getAdaptiveRenderFps(now) {
  if (isDeepBackgroundMode()) return 1;
  var mode = (typeof normalizeForegroundFpsMode === 'function') ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode) : 'adaptive';
  var fixedFps = (typeof foregroundFixedFpsForMode === 'function') ? foregroundFixedFpsForMode(mode) : null;
  if (fixedFps !== null) return fixedFps;
  if (RENDER_VISIBLE_VSYNC) return 0;
  var cadence = resolveAdaptiveRenderCadence(now, mode);
  if (cadence) return cadence.fps;
  var context = currentRenderAdaptiveContext(now);
  var tier = context.tier;
  if (context.kind === 'interaction') {
    if (tier >= 2) return RENDER_INTERACTION_HUGE_FPS;
    if (tier >= 1) return RENDER_INTERACTION_LARGE_FPS;
    return RENDER_INTERACTION_FPS;
  }
  var activePlayback = context.kind === 'playback';
  if (!activePlayback) {
    if (tier >= 2) return RENDER_IDLE_HUGE_FPS;
    if (tier >= 1) return RENDER_IDLE_LARGE_FPS;
    return RENDER_IDLE_FPS;
  }
  if (tier >= 2) return RENDER_HUGE_FPS;
  if (tier >= 1) return RENDER_LARGE_FPS;
  return RENDER_ACTIVE_FPS;
}

function shouldSkipAdaptiveRenderFrame(now) {
  if (typeof sampleDisplayRefreshHz === 'function') sampleDisplayRefreshHz(now);
  var mode = (typeof normalizeForegroundFpsMode === 'function') ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode) : 'adaptive';
  var cadence = resolveAdaptiveRenderCadence(now, mode);
  var fps = cadence ? cadence.fps : getAdaptiveRenderFps(now);
  var displayHz = (typeof estimatedDisplayRefreshHz === 'function') ? estimatedDisplayRefreshHz() : 60;
  renderPerfState.displayHz = Math.round(displayHz * 10) / 10;
  renderPerfState.mode = cadence
    ? ('adaptive-' + cadence.fps + 'fps/' + cadence.divisor + 'x')
    : (fps ? (mode === 'adaptive' ? ('adaptive-' + fps + 'fps') : (fps + 'fps')) : 'vsync');
  renderPerfState.targetFps = fps;
  renderPerfState.foregroundFpsMode = mode;
  renderPerfState.interactionBoost = (typeof isRenderInteractionActive === 'function') ? isRenderInteractionActive(now) : false;
  if (cadence) {
    resetFixedRenderCadenceState();
    var prevDivisor = renderPerfState.adaptiveDivisor;
    var prevKind = renderPerfState.adaptiveKind;
    renderPerfState.adaptiveDivisor = cadence.divisor;
    renderPerfState.adaptiveKind = cadence.kind;
    renderPerfState.adaptivePressure = cadence.pressure;
    if (prevDivisor !== cadence.divisor || prevKind !== cadence.kind) renderPerfState.adaptiveCadenceTick = 0;
    renderPerfState.adaptiveCadenceTick += 1;
    if (cadence.divisor > 1 && (renderPerfState.adaptiveCadenceTick - 1) % cadence.divisor !== 0) {
      renderPerfState.skipped += 1;
      if (window.__mineradioPerf && window.__mineradioPerf.count) window.__mineradioPerf.count('frame.skipped');
      return true;
    }
    renderPerfState.lastRenderAt = now;
    return false;
  }
  renderPerfState.adaptiveDivisor = 0;
  renderPerfState.adaptiveKind = '';
  if (!fps) {
    resetFixedRenderCadenceState();
    renderPerfState.lastRenderAt = now;
    return false;
  }
  var fixedCadenceKey = mode + ':' + fps;
  if (shouldSkipFixedRenderCadenceFrame(fixedRenderCadenceState, now, fps, displayHz, fixedCadenceKey)) {
    renderPerfState.skipped += 1;
    if (window.__mineradioPerf && window.__mineradioPerf.count) window.__mineradioPerf.count('frame.skipped');
    return true;
  }
  renderPerfState.lastRenderAt = now;
  return false;
}

function sampleRenderPerf(now, dt) {
  renderPerfState.frames += 1;
  if (dt > 0.034) renderPerfState.longFrames += 1;
  if (now - renderPerfState.lastSampleAt >= 1000) {
    renderPerfState.fps = Math.round(renderPerfState.frames * 1000 / Math.max(1, now - renderPerfState.lastSampleAt));
    renderPerfState.frames = 0;
    renderPerfState.lastSampleAt = now;
  }
  maybeTrimRuntimeCaches(now);
}

function mainLoopDeepBackgroundSleeping() {
  return typeof isDeepBackgroundMode === 'function'
    && isDeepBackgroundMode()
    && !(typeof isLiveBackgroundKeepMode === 'function' && isLiveBackgroundKeepMode());
}

function mainLoopBackgroundDelayMs() {
  if (window.mineradioMV && mineradioMV.active() && !isMainSceneCoveredBySplash()) return 250;
  if (!mainLoopDeepBackgroundSleeping()) return 0;
  if (fx && (fx.desktopLyrics || fx.wallpaperMode)) return 250;
  if (typeof isBackgroundReleaseMode === 'function' && isBackgroundReleaseMode()) return 1500;
  return 1000;
}

function requestMainLoopAnimationFrame() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  if (mainLoopAnimationRequested) return;
  mainLoopAnimationRequested = true;
  requestAnimationFrame(animate);
}

function scheduleNextMainLoopFrame() {
  var delay = mainLoopBackgroundDelayMs();
  if (delay > 0) {
    if (mainLoopBackgroundTimer) return;
    mainLoopBackgroundTimer = setTimeout(function () {
      mainLoopBackgroundTimer = 0;
      requestMainLoopAnimationFrame();
    }, delay);
    return;
  }
  requestMainLoopAnimationFrame();
}

function wakeMainLoopFromBackground() {
  if (mainLoopBackgroundTimer) {
    clearTimeout(mainLoopBackgroundTimer);
    mainLoopBackgroundTimer = 0;
  }
  requestMainLoopAnimationFrame();
}

function tickDeepBackgroundFrame(now, dt) {
  sampleRenderPerf(now, dt);
  if (fx && (fx.desktopLyrics || fx.wallpaperMode) && typeof syncDesktopOverlayState === 'function') {
    syncDesktopOverlayState();
  }
}

function mainLoopInteractionActive(now) {
  return (typeof isRenderInteractionActive === 'function') && isRenderInteractionActive(now);
}

function visibleMotionFollowVsync(now) {
  if (isDeepBackgroundMode()) return false;
  var mode = (typeof normalizeForegroundFpsMode === 'function')
    ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode)
    : 'vsync';
  if (mode !== 'vsync') return false;
  if (typeof isProgressDragPreviewActive === 'function' && isProgressDragPreviewActive()) return true;
  if (mainLoopInteractionActive(now)) return true;
  return !!(playing && audio && !audio.paused);
}

function capMainLoopFpsToDisplay(fps) {
  var hz = (typeof estimatedDisplayRefreshHz === 'function') ? estimatedDisplayRefreshHz() : 60;
  return Math.max(1, Math.min(Number(fps) || 60, Math.max(48, hz)));
}

function capMainLoopFpsForBudget(fps, minFps) {
  var scale = (typeof runtimePerfScale === 'function') ? runtimePerfScale() : 1;
  var target = Math.round((Number(fps) || 60) * scale);
  return Math.max(minFps || 1, capMainLoopFpsToDisplay(target));
}

function targetMainAudioFps(now) {
  if (isDeepBackgroundMode()) return 1;
  var scale = (typeof runtimeAudioAnalysisScale === 'function') ? runtimeAudioAnalysisScale() : 1;
  if (playing && audio && !audio.paused) {
    var base = mainLoopInteractionActive(now) ? 72 : 54;
    return capMainLoopFpsToDisplay(Math.max(30, Math.round(base * scale)));
  }
  return mainLoopInteractionActive(now) ? 30 : 24;
}

function targetMainShelfFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (!fx || fx.shelf === 'off') return 12;
  if (mainLoopInteractionActive(now)) return 0;
  if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return 0;
  if (typeof shelfPreviewIsVisible === 'function' && shelfPreviewIsVisible()) return 0;
  if (shelfPinnedOpen || (typeof shelfAlwaysVisible === 'function' && shelfAlwaysVisible())) return 0;
  return capMainLoopFpsForBudget(mainLoopInteractionActive(now) ? 72 : 38, 18);
}

function targetMainLyricsParticleFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (!fx || fx.particleLyrics === false) return 12;
  if (visibleMotionFollowVsync(now)) return 0;
  if (mainLoopInteractionActive(now)) return capMainLoopFpsForBudget(120, 72);
  return (playing && audio && !audio.paused) ? capMainLoopFpsForBudget(60, 48) : 24;
}

function targetMainStageLyricsFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (!fx || fx.particleLyrics === false) return 12;
  if (visibleMotionFollowVsync(now)) return 0;
  if (mainLoopInteractionActive(now)) return capMainLoopFpsForBudget(120, 72);
  return (playing && audio && !audio.paused) ? capMainLoopFpsForBudget(60, 48) : 24;
}

function targetMainSkullParticleFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (!fx || fx.preset !== SKULL_PRESET_INDEX) return 10;
  if (visibleMotionFollowVsync(now)) return 0;
  if (mainLoopInteractionActive(now)) return capMainLoopFpsForBudget(120, 72);
  return (playing && audio && !audio.paused) ? capMainLoopFpsForBudget(60, 45) : 24;
}

function targetMainHomeAudioFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (!emptyHomeActive) return 6;
  return mainLoopInteractionActive(now) ? 30 : 15;
}

function targetMainDesktopOverlayFps(now) {
  if (isDeepBackgroundMode()) return 1;
  if (fx && (fx.desktopLyrics || fx.wallpaperMode)) {
    if (fx.desktopLyricsFps === 0 || mainLoopInteractionActive(now)) return 0;
    return Math.max(24, Math.min(120, Number(fx.desktopLyricsFps) || 60));
  }
  return 6;
}

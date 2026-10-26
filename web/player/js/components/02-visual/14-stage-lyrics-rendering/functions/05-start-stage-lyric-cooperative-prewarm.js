'use strict';



function startStageLyricCooperativePrewarm(payload, key, token, lightweight, reason) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  cancelStageLyricPrewarmBuildOnly();
  var state = beginCooperativeLyricMeshBuild(payload);
  var job = {
    state: state,
    payload: payload,
    key: key,
    guardKey: stageLyricPrewarmBuildGuardKey(),
    token: token,
    lightweight: !!lightweight,
    reason: reason || '',
    startedAt: stageLyricNowMs(),
    lastPhase: 'queued',
    readyToFinish: false
  };
  stageLyricPrewarm.build = job;
  if (typeof window !== 'undefined') {
    window.__mineradioLyricBuildStats = {
      active: true,
      reason: job.reason,
      lightweight: job.lightweight,
      totalRows: Number(state.totalRows) || 0,
      builtRows: 0,
      totalPhases: Number(state.totalPhases) || 0,
      builtPhases: 0,
      lastPhase: 'queued',
      lastChunkMs: 0,
      maxChunkMs: 0,
      phaseMaxMs: {},
      elapsedMs: 0,
      lastBuildMs: 0
    };
  }
  scheduleStageLyricCooperativeWork(job, 0);
}


function scheduleStageLyricPrewarmForIndex(targetIndex, reason, delay) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  var hasTarget = targetIndex != null && isFinite(Number(targetIndex));
  var prewarmIndex = hasTarget ? Math.round(Number(targetIndex)) : null;
  if (hasTarget && lyricsLines && lyricsLines.length) prewarmIndex = Math.max(0, Math.min(lyricsLines.length - 1, prewarmIndex));
  var lightweight = stageLyricLightPrewarmReason(reason);
  var wait = delay == null ? 90 : Number(delay);
  if (!isFinite(wait)) wait = 90;
  wait = Math.max(0, wait);
  if (lightweight && stageLyricPrewarm.mesh) {
    var guardIndex = prewarmIndex != null ? prewarmIndex : chooseStageLyricPrewarmIndex();
    if (stageLyricPrewarmFullCanServeIndex(guardIndex)) {
      upgradeCurrentStageLyricFromPreparedTrack(reason || 'full-prewarm-before-light');
      return;
    }
  }
  if (!lightweight && stageLyricLightweightPrewarmAwaitingTakeover()) {
    queueStageLyricFullTrackWarmupRetry(reason || 'track-ready', Math.max(96, wait));
    return;
  }
  var dueAt = stageLyricNowMs() + wait;
  if (stageLyricPrewarm.timer && stageLyricPrewarm.targetIndex === prewarmIndex && stageLyricPrewarm.lightweight === lightweight) {
    var existingDueAt = Number(stageLyricPrewarm.dueAt) || 0;
    if (!existingDueAt || dueAt >= existingDueAt - 8) return;
  }
  if (stageLyricPrewarm.build && stageLyricPrewarm.targetIndex === prewarmIndex && stageLyricPrewarm.lightweight === lightweight) return;
  if (stageLyricPrewarm.timer) clearTimeout(stageLyricPrewarm.timer);
  stageLyricPrewarm.timer = 0;
  cancelStageLyricPrewarmBuildOnly();
  stageLyricPrewarm.token += 1;
  stageLyricPrewarm.targetIndex = prewarmIndex;
  stageLyricPrewarm.lightweight = lightweight;
  stageLyricPrewarm.dueAt = dueAt;
  var token = stageLyricPrewarm.token;
  if (!fx || !fx.particleLyrics || !lyricsLines || !lyricsLines.length) {
    disposeStageLyricPrewarmMesh();
    return;
  }
  stageLyricPrewarm.timer = setTimeout(function () {
    stageLyricPrewarm.timer = 0;
    stageLyricPrewarm.dueAt = 0;
    if (token !== stageLyricPrewarm.token) return;
    if (!fx || !fx.particleLyrics || !lyricsLines || !lyricsLines.length) return;
    var idx = prewarmIndex != null ? prewarmIndex : chooseStageLyricPrewarmIndex();
    if (idx < 0) return;
    if (lightweight && stageLyricPrewarm.mesh && stageLyricPrewarmFullCanServeIndex(idx)) {
      upgradeCurrentStageLyricFromPreparedTrack(reason || 'full-prewarm-before-light');
      return;
    }
    var payload = buildStageLyricDisplayPayload(idx, { lightweightTrack: lightweight });
    var key = stageLyricPreparedKey(payload);
    if (!key || stageLyricCurrentMeshAlreadyPreparedForPayload(payload)) {
      if (stageLyricPrewarm.mesh) disposeStageLyricPrewarmMesh();
      return;
    }
    if (stageLyricPrewarm.mesh && stageLyricPrewarm.key !== key) {
      disposeLyricMesh(stageLyricPrewarm.mesh);
      stageLyricPrewarm.mesh = null;
      stageLyricPrewarm.key = '';
    }
    if (stageLyricPrewarm.mesh && stageLyricPrewarm.key === key) return;
    try {
      if (stageLyricShouldBuildCooperatively(payload)) {
        startStageLyricCooperativePrewarm(payload, key, token, lightweight, reason);
        return;
      }
      var mesh = buildLyricMesh(payload);
      primeLyricMeshOpacity(mesh, 0);
      mesh.visible = false;
      stageLyricPrewarm.mesh = mesh;
      stageLyricPrewarm.key = key;
      stageLyricPrewarm.lightweight = lightweight;
      clearStageLyricWarmup();
      if (!lightweight && stageLyricCurrentUsesPersistentTrack()) {
        disposeStageLyricPrewarmMesh();
        ensureStageLyricPersistentTrackRows(stageLyrics.current, stageLyrics.currentIdx, { reason: 'discard-full-track-takeover' });
      } else if (!lightweight && stageLyricCurrentUsesLightweightTrack()) {
        upgradeCurrentStageLyricFromPreparedTrack(reason || 'full-prewarm-ready');
      }
    } catch (e) {
      disposeStageLyricPrewarmMesh();
    }
  }, wait);
}

function scheduleStageLyricPrewarm(reason, delay) {
  var singleLineIndex = stageLyricSingleLineBootstrapIndex();
  scheduleStageLyricPrewarmForIndex(singleLineIndex >= 0 ? singleLineIndex : null, reason, delay);
}

function stageLyricMultiLineWarmupLoad() {
  var mode = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode);
  return mode !== 'single';
}

function stageLyricFullTrackWarmupDelay(delay, reason) {
  var base = Math.max(64, Number(delay) || 180);
  if (!stageLyricMultiLineWarmupLoad()) return base;
  var reasonText = String(reason || '');
  if (/lyrics-ready-preload/i.test(reasonText)) return Math.max(base, 24);
  if (/lightweight-upgrade|track-ready-fast|playback-resume|playback-started|startup-restore/i.test(reasonText)) return Math.max(base, 420);
  if (/track-demand/i.test(reasonText)) return Math.max(base, 260);
  var total = lyricsLines && lyricsLines.length ? lyricsLines.length : 0;
  var mode = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode);
  var lineCount = lyricDisplayLineCountForMode(mode);
  var translationMode = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode);
  var extra = Math.min(1200, total * (translationMode === 'off' ? 3.0 : 4.8));
  return Math.max(base, 760 + extra + lineCount * 38 + (translationMode === 'multi' ? 260 : 0));
}


function queueStageLyricFullTrackWarmupRetry(reason, delay) {
  var retryDelay = clampRange(Number(delay) || 140, 96, 420);
  var targetAt = stageLyricNowMs() + retryDelay;
  if (
    stageLyricFullTrackWarmupTimer && stageLyricFullTrackWarmupTargetAt &&
    targetAt >= stageLyricFullTrackWarmupTargetAt - 8
  ) return true;
  if (stageLyricFullTrackWarmupTimer) clearTimeout(stageLyricFullTrackWarmupTimer);
  stageLyricFullTrackWarmupTargetAt = targetAt;
  stageLyricFullTrackWarmupTimer = setTimeout(function () {
    stageLyricFullTrackWarmupTimer = 0;
    stageLyricFullTrackWarmupTargetAt = 0;
    runStageLyricFullTrackWarmup(reason || 'track-ready');
  }, retryDelay);
  return true;
}


function runStageLyricFullTrackWarmup(reason) {
  if (stageLyricCurrentUsesPersistentTrack()) {
    ensureStageLyricPersistentTrackRows(stageLyrics.current, stageLyrics.currentIdx, { reason: reason || 'persistent-track-warmup' });
    return true;
  }
  if (stageLyricLightweightPrewarmAwaitingTakeover()) {
    queueStageLyricFullTrackWarmupRetry(reason || 'track-ready', 140);
    return false;
  }
  var run = function () {
    if (stageLyricLightweightPrewarmAwaitingTakeover()) {
      queueStageLyricFullTrackWarmupRetry(reason || 'track-ready', 140);
      return;
    }
    scheduleStageLyricPrewarm(reason || 'track-ready', stageLyricMultiLineWarmupLoad() ? 96 : 24);
  };
  if (stageLyricMultiLineWarmupLoad() && window.requestIdleCallback) {
    stageLyricFullTrackWarmupIdle = window.requestIdleCallback(function () {
      stageLyricFullTrackWarmupIdle = 0;
      run();
    }, { timeout: 1500 });
  } else run();
  return true;
}


function scheduleStageLyricFullTrackWarmup(reason, delay) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return false;
  if (stageLyricCurrentUsesPersistentTrack()) {
    ensureStageLyricPersistentTrackRows(stageLyrics.current, stageLyrics.currentIdx, { reason: reason || 'persistent-track-warmup' });
    return true;
  }
  if (stageLyricShouldSkipFullTrackWarmup(reason)) return false;
  if (stageLyricFullTrackWarmupIdle) return true;
  if (stageLyricPrewarm.build && !stageLyricPrewarm.build.lightweight) return true;
  var prepared = stageLyricPrewarmPayload();
  if (prepared && !prepared.trackLightweight) return true;
  var warmupDelay = stageLyricFullTrackWarmupDelay(delay, reason);
  var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  var targetAt = now + warmupDelay;
  if (stageLyricFullTrackWarmupTimer && stageLyricFullTrackWarmupTargetAt && targetAt >= stageLyricFullTrackWarmupTargetAt - 8) return;
  if (stageLyricFullTrackWarmupTimer) clearTimeout(stageLyricFullTrackWarmupTimer);
  stageLyricFullTrackWarmupTargetAt = targetAt;
  stageLyricFullTrackWarmupTimer = setTimeout(function () {
    stageLyricFullTrackWarmupTimer = 0;
    stageLyricFullTrackWarmupTargetAt = 0;
    runStageLyricFullTrackWarmup(reason || 'track-ready');
  }, warmupDelay);
  return true;
}


function showStageLine(text, redrawOnly, options) {
  options = options || {};
  createLyricsParticles();
  if (!stageLyrics.group) return false;
  var payload = normalizeStageLyricPayload(text);
  if (!payload) { clearStageLyrics(); return false; }
  var lineStep = clampRange(Number(stageLyrics.transitionLineStep) || 0, -2, 2);
  var exitDir = lineStep > 0 ? 1 : (lineStep < 0 ? -1 : 0);
  if (!redrawOnly && stageLyrics.current && setLyricTrackTarget(stageLyrics.current, payload)) {
    stageLyrics.currentText = payload.text;
    stageLyrics.currentDisplayKey = payload.key;
    stageLyrics.currentPayload = payload;
    stageLyrics.current.userData.enterDirection = lineStep > 0 ? -1 : (lineStep < 0 ? 1 : 0);
    stageLyrics.current.userData.lastTrackSwitchAt = uniforms && uniforms.uTime ? uniforms.uTime.value : 0;
    return true;
  }
  if (options.noSyncBuild && shouldDeferStageLyricSyncBuild(payload, redrawOnly)) {
    requestStageLyricDemandPrewarm(payload);
    return false;
  }
  var singleLinePayload = stageLyricPayloadIsSingleLine(payload);
  var mesh = takeStageLyricSingleLinePrewarmMesh(payload) || takeStageLyricPrewarmMesh(payload);
  if (!mesh) {
    var singleLineBoundaryNoSyncBuild = options.noSyncBuild && singleLinePayload && !redrawOnly && stageLyrics.current;
    if (singleLineBoundaryNoSyncBuild) {
      requestStageLyricDemandPrewarm(payload);
      return false;
    }
    if (options.noSyncBuild) {
      requestStageLyricDemandPrewarm(payload);
      return false;
    }
    mesh = buildLyricMesh(payload);
  }
  if (!redrawOnly && singleLinePayload && typeof markRenderInteraction === 'function') {
    markRenderInteraction('lyric-swap', 360);
  }
  var outgoingMesh = stageLyrics.current;
  var holdOutgoingForReveal = !redrawOnly && stageLyricShouldHoldOutgoingForReveal(outgoingMesh, mesh);
  releaseStageLyricRevealHoldsForSuccessor(outgoingMesh);
  if (redrawOnly && stageLyrics.current) {
    disposeLyricMesh(stageLyrics.current);
    stageLyrics.current = null;
  } else if (stageLyrics.current) {
    stageLyrics.current.userData.state = 'out';
    stageLyrics.current.userData.age = 0;
    stageLyrics.current.userData.exitDirection = exitDir;
    stageLyrics.current.userData.lyricRevealSuccessor = holdOutgoingForReveal ? mesh : null;
    stageLyrics.outgoing.push(stageLyrics.current);
  }
  stageLyrics.currentText = payload.text;
  stageLyrics.currentDisplayKey = payload.key;
  stageLyrics.currentPayload = payload;
  resetPreparedStageLyricMesh(mesh, payload, lineStep);
  mesh.userData.enterDirection = lineStep > 0 ? -1 : (lineStep < 0 ? 1 : 0);
  if (!redrawOnly) {
    var primeAmount = singleLinePayload ? 0 : (Math.abs(lineStep) > 0 ? 0.34 : 0.24);
    primeLyricMeshOpacity(mesh, primeAmount);
  }
  stageLyrics.group.add(mesh);
  stageLyrics.current = mesh;
  initializeStageLyricPersistentTrack(mesh, payload);
  return true;
}


function refreshCurrentLyricStyle() {
  if (typeof playbackLyricsLoadingRuntime === 'function') playbackLyricsLoadingRuntime().styleKey = '';
  cancelStageLyricResidentBuild();
  clearStageLyricSingleLinePrewarmCache();
  disposeStageLyricPrewarmMesh();
  if (!stageLyrics || !stageLyrics.currentText || !stageLyrics.current) return;
  var progress = stageLyrics.current.userData ? (stageLyrics.current.userData.lastLyricProgress || 0) : 0;
  stageLyrics.transitionLineStep = 0;
  var redrawPayload = stageLyrics.currentPayload || stageLyrics.currentText;
  if (stageLyrics.currentIdx >= 0 && stageLyricMultiLineWarmupLoad()) {
    redrawPayload = buildStageLyricDisplayPayload(stageLyrics.currentIdx, { lightweightTrack: true }) || redrawPayload;
  }
  showStageLine(redrawPayload, true);
  updateLyricMeshProgress(stageLyrics.current, progress);
  if (stageLyrics.current && stageLyrics.current.userData) stageLyrics.current.userData.age = 0.48;
}


function clearStageLyrics() {
  if (typeof invalidateLyricQualityTextures === 'function') invalidateLyricQualityTextures('clear-stage-lyrics');
  cancelStageLyricResidentBuild();
  clearStageLyricFullTrackWarmup();
  disposeStageLyricPrewarmMesh();
  clearStageLyricSingleLinePrewarmCache();
  clearStageLyricWarmup();
  disposeLyricMesh(stageLyrics.current);
  stageLyrics.current = null;
  stageLyrics.currentIdx = -1;
  stageLyrics.currentText = '';
  stageLyrics.currentDisplayKey = '';
  stageLyrics.currentPayload = null;
  stageLyrics.renderSignature = '';
  stageLyrics.transitionLineStep = 0;
  while (stageLyrics.outgoing.length) disposeLyricMesh(stageLyrics.outgoing.pop());
}


function stageLyricUsesSingleLineSwap(mesh) {
  if (!mesh || !mesh.userData) return false;
  var data = mesh.userData.lyric || {};
  var payload = mesh.userData.payload || null;
  var mode = normalizeLyricDisplayMode(data.displayMode || (payload && payload.mode) || (fx && fx.lyricDisplayMode));
  return mode === 'single' && !data.usesTrack;
}

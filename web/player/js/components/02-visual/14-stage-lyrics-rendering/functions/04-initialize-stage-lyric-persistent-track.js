'use strict';



function initializeStageLyricPersistentTrack(mesh, payload) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  var mode = normalizeLyricDisplayMode(payload && payload.mode || data && data.displayMode || (fx && fx.lyricDisplayMode));
  if (!data || !data.usesTrack || mode === 'single' || !lyricsLines || !lyricsLines.length) return false;
  if (!data.trackPersistent) {
    data.trackPersistent = true;
    data.trackLightweight = false;
    data.trackStart = 0;
    data.trackEnd = lyricsLines.length - 1;
    data.trackScrollWindowKey = data.trackKey || (payload && payload.trackKey) || '';
    if (!isFinite(Number(data.trackScrollOffset))) {
      data.trackScrollOffset = isFinite(Number(data.trackTargetVirtualIndex))
        ? Number(data.trackTargetVirtualIndex)
        : lyricPrimaryVirtualIndex(Number(data.trackTargetLineIndex) || 0);
    }
    data.trackScrollPrimed = true;
    data.trackTextRunwayComplete = false;
    data.trackTextRunwayReadyAt = 0;
    data.trackTextRunwayDirection = 'next';
    var layoutMask = data.activeMask || data.mask || {};
    var stableLayout = typeof stableStageLyricRowMaskLayout === 'function'
      ? stableStageLyricRowMaskLayout()
      : { fontSize: 128, lineHeight: 138 };
    data.persistentMaskLayout = {
      fontSize: Number(layoutMask.logicalFontSize) || Number(stableLayout.fontSize) || 128,
      lineHeight: Number(layoutMask.logicalLineHeight) || Number(stableLayout.lineHeight) || (Number(stableLayout.fontSize) || 128) * 1.08
    };
    data.activeMask = null;
    if (mesh.userData.payload) {
      mesh.userData.payload.trackStart = 0;
      mesh.userData.payload.trackEnd = lyricsLines.length - 1;
      mesh.userData.payload.trackLightweight = false;
    }
    updateStageLyricPersistentResidentBounds(data);
  }
  clearStageLyricFullTrackWarmup();
  ensureStageLyricPersistentTrackRows(mesh, payload && payload.trackIndex != null ? payload.trackIndex : data.trackTargetLineIndex, { reason: 'persistent-track-bootstrap' });
  return true;
}


function stageLyricCurrentUsesLightweightTrack() {
  var data = stageLyrics && stageLyrics.current && stageLyrics.current.userData && stageLyrics.current.userData.lyric;
  return !!(data && data.trackLightweight);
}


function stageLyricTrackRevealReady(mesh) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.usesTrack) return true;
  if (data.renderInitialTextReady !== true) return false;
  var readyAt = Number(data.renderInitialTextReadyAt) || 0;
  return !readyAt || stageLyricNowMs() - readyAt >= 48;
}


function stageLyricShouldHoldOutgoingForReveal(current, incoming) {
  var currentData = current && current.userData && current.userData.lyric;
  var incomingData = incoming && incoming.userData && incoming.userData.lyric;
  return !!(
    currentData && incomingData && currentData.usesTrack && incomingData.usesTrack &&
    currentData.trackKey && currentData.trackKey === incomingData.trackKey &&
    incomingData.renderInitialTextReady !== true
  );
}


function releaseStageLyricRevealHoldsForSuccessor(successor) {
  if (!successor || !stageLyrics || !stageLyrics.outgoing) return;
  for (var i = 0; i < stageLyrics.outgoing.length; i++) {
    var outgoing = stageLyrics.outgoing[i];
    if (!outgoing || !outgoing.userData || outgoing.userData.lyricRevealSuccessor !== successor) continue;
    outgoing.userData.lyricRevealSuccessor = null;
    outgoing.userData.age = 0;
  }
}


function stageLyricLightweightPrewarmAwaitingTakeover() {
  if (!stageLyricPrewarm) return false;
  if (stageLyricPrewarm.build && stageLyricPrewarm.build.lightweight) return true;
  if (
    stageLyricPrewarm.lightweight &&
    (stageLyricPrewarm.timer || stageLyricPrewarm.workTimer || stageLyricPrewarm.workRaf)
  ) return true;
  var prepared = stageLyricPrewarmPayload();
  return !!(
    stageLyricPrewarm.mesh && prepared && prepared.trackLightweight &&
    (!stageLyrics || Number(stageLyrics.currentIdx) < 0)
  );
}


function stageLyricCurrentCanResumeWithoutWarmup() {
  if (!stageLyrics || !stageLyrics.current || !stageLyrics.currentPayload || stageLyrics.currentIdx < 0) return false;
  return !stageLyricCurrentUsesLightweightTrack();
}


function upgradeCurrentStageLyricFromPreparedTrack(reason) {
  if (!stageLyrics || !stageLyrics.current || stageLyrics.currentIdx < 0 || !stageLyricMultiLineWarmupLoad()) return false;
  if (stageLyricPayloadIsSingleLine(stageLyrics.currentPayload)) return false;
  var data = stageLyrics.current.userData && stageLyrics.current.userData.lyric;
  if (!data || !data.trackLightweight) return false;
  var idx = Number(stageLyrics.currentIdx);
  if (!isFinite(idx)) return false;
  var payload = stageLyricPreparedFullPayloadForIndex(idx);
  if (!payload) {
    if ((Number(stageLyricResumeUpgradeDeferUntil) || 0) > stageLyricNowMs()) return false;
    requestStageLyricLightweightUpgrade(reason || 'lightweight-upgrade', 132);
    return false;
  }
  var progress = stageLyrics.current.userData ? (stageLyrics.current.userData.lastLyricProgress || 0) : 0;
  stageLyrics.transitionLineStep = 0;
  if (!showStageLine(payload, false)) return false;
  stageLyrics.currentPayload = payload;
  stageLyrics.currentDisplayKey = payload.key;
  updateLyricMeshProgress(stageLyrics.current, progress);
  if (stageLyrics.current && stageLyrics.current.userData) {
    stageLyrics.current.userData.age = Math.max(Number(stageLyrics.current.userData.age) || 0, 0.36);
  }
  return true;
}


function stageLyricProgressPreviewActive() {
  return typeof isProgressDragPreviewActive === 'function' && isProgressDragPreviewActive();
}

function stageLyricPlaybackSeconds() {
  var preview = typeof getProgressDragPreviewSeconds === 'function' ? getProgressDragPreviewSeconds() : null;
  if (preview != null && isFinite(Number(preview))) return Math.max(0, Number(preview));
  var restoreSeconds = stageLyricRestoreWarmupSeconds();
  if (restoreSeconds != null) return restoreSeconds;
  return audio && isFinite(Number(audio.currentTime)) ? Math.max(0, Number(audio.currentTime)) : 0;
}

function stageLyricProgressSeekVisualReady(seconds) {
  if (!lyricsLines || !lyricsLines.length || !stageLyrics || !stageLyrics.current) return false;
  var t = Math.max(0, Number(seconds) || 0);
  var lyricT = typeof getAdjustedLyricPlaybackTime === 'function' ? getAdjustedLyricPlaybackTime(t) : t;
  var targetIndex = findStageLyricIndexAtTime(lyricT);
  if (targetIndex < 0) return stageLyrics.currentIdx === -2;
  if (Number(stageLyrics.currentIdx) !== Number(targetIndex)) return false;
  var data = stageLyrics.current.userData && stageLyrics.current.userData.lyric;
  if (!data || !data.trackPersistent) return true;
  if (Number(data.trackTargetLineIndex) !== Number(targetIndex)) return false;
  if (data.trackPendingPayload) return false;
  return stageLyricPersistentTargetRowsReady(stageLyrics.current, targetIndex);
}

function chooseStageLyricPrewarmIndex() {
  if (!lyricsLines || !lyricsLines.length) return -1;
  if (
    (Number(stageLyricTrackSwitchBootstrapUntil) || 0) > stageLyricNowMs() &&
    (!stageLyrics || stageLyrics.currentIdx < 0)
  ) {
    return 0;
  }
  var idx = -1;
  try {
    var t = stageLyricPlaybackSeconds();
    var lyricT = typeof getAdjustedLyricPlaybackTime === 'function' ? getAdjustedLyricPlaybackTime(t) : t;
    idx = findStageLyricIndexAtTime(lyricT);
  } catch (e) {
    idx = -1;
  }
  if (idx < 0) idx = 0;
  return Math.max(0, Math.min(lyricsLines.length - 1, idx));
}


function stageLyricSingleLineBootstrapIndex() {
  if (!lyricsLines || !lyricsLines.length) return -1;
  if (normalizeLyricDisplayMode(fx && fx.lyricDisplayMode) !== 'single') return -1;
  if (stageLyrics && stageLyrics.currentIdx >= 0) return Math.max(0, Math.min(lyricsLines.length - 1, stageLyrics.currentIdx));
  return chooseStageLyricPrewarmIndex();
}


function stageLyricShouldBuildCooperatively(payload) {
  return !!(
    payload && normalizeLyricDisplayMode(payload.mode) !== 'single' &&
    Array.isArray(payload.trackEntries) && payload.trackEntries.length > 2 &&
    typeof beginCooperativeLyricMeshBuild === 'function' &&
    typeof stepCooperativeLyricMeshBuild === 'function' &&
    typeof finishCooperativeLyricMeshBuild === 'function'
  );
}


function updateStageLyricBuildStats(job, active, chunkMs) {
  if (typeof window === 'undefined') return;
  var stats = window.__mineradioLyricBuildStats || {};
  var buildState = job && job.state;
  var rowState = job && job.state && job.state.rowState;
  var phase = job && job.lastPhase || buildState && buildState.lastPhase || '';
  stats.active = !!active;
  stats.reason = job && job.reason || stats.reason || '';
  stats.lightweight = !!(job && job.lightweight);
  stats.totalRows = buildState ? Number(buildState.totalRows) || 0 : Number(stats.totalRows) || 0;
  stats.builtRows = rowState ? Number(rowState.cursor) || 0 : (active ? Number(stats.builtRows) || 0 : Number(stats.totalRows) || 0);
  stats.totalPhases = buildState ? Number(buildState.totalPhases) || 0 : Number(stats.totalPhases) || 0;
  stats.builtPhases = buildState ? Number(buildState.completedPhases) || 0 : Number(stats.builtPhases) || 0;
  stats.lastPhase = phase || stats.lastPhase || '';
  stats.lastChunkMs = Number(chunkMs) || 0;
  stats.maxChunkMs = Math.max(Number(stats.maxChunkMs) || 0, Number(chunkMs) || 0);
  stats.phaseMaxMs = stats.phaseMaxMs || {};
  if (phase) stats.phaseMaxMs[phase] = Math.max(Number(stats.phaseMaxMs[phase]) || 0, Number(chunkMs) || 0);
  if (job && job.startedAt) stats.elapsedMs = Math.max(0, stageLyricNowMs() - job.startedAt);
  if (!active && job && job.startedAt) stats.lastBuildMs = Math.max(0, stageLyricNowMs() - job.startedAt);
  window.__mineradioLyricBuildStats = stats;
}


function finishStageLyricCooperativePrewarm(job) {
  if (!job || stageLyricPrewarm.build !== job) return;
  var startedAt = stageLyricNowMs();
  var mesh = null;
  try {
    mesh = finishCooperativeLyricMeshBuild(job.state);
  } catch (e) {
    cancelStageLyricPrewarmBuildOnly();
    return;
  }
  stageLyricPrewarm.build = null;
  stageLyricPrewarm.workTimer = 0;
  stageLyricPrewarm.workRaf = 0;
  job.lastPhase = 'mesh-finalize';
  if (
    !mesh || job.token !== stageLyricPrewarm.token || !fx || !fx.particleLyrics ||
    !lyricsLines || !lyricsLines.length || stageLyricPrewarmBuildGuardKey() !== job.guardKey
  ) {
    if (mesh) disposeLyricMesh(mesh);
    updateStageLyricBuildStats(job, false, stageLyricNowMs() - startedAt);
    return;
  }
  if (typeof applyLyricPaletteToMesh === 'function') applyLyricPaletteToMesh(mesh);
  var finalKey = stageLyricPreparedKey(job.payload);
  if (!finalKey) {
    disposeLyricMesh(mesh);
    updateStageLyricBuildStats(job, false, stageLyricNowMs() - startedAt);
    return;
  }
  if (stageLyricPrewarm.mesh && stageLyricPrewarm.mesh !== mesh) disposeLyricMesh(stageLyricPrewarm.mesh);
  primeLyricMeshOpacity(mesh, 0);
  mesh.visible = false;
  stageLyricPrewarm.mesh = mesh;
  stageLyricPrewarm.key = finalKey;
  stageLyricPrewarm.lightweight = job.lightweight;
  clearStageLyricWarmup();
  if (!job.lightweight && stageLyricCurrentUsesPersistentTrack()) {
    disposeStageLyricPrewarmMesh();
    ensureStageLyricPersistentTrackRows(stageLyrics.current, stageLyrics.currentIdx, { reason: 'discard-full-track-takeover' });
  } else if (!job.lightweight && stageLyricCurrentUsesLightweightTrack()) {
    upgradeCurrentStageLyricFromPreparedTrack(job.reason || 'full-prewarm-ready');
  }
  updateStageLyricBuildStats(job, false, stageLyricNowMs() - startedAt);
}


function stageLyricShouldYieldToPendingInput() {
  try {
    return !!(
      typeof navigator !== 'undefined' && navigator.scheduling && typeof navigator.scheduling.isInputPending === 'function' &&
      navigator.scheduling.isInputPending({ includeContinuous: true })
    );
  } catch (e) {
    return false;
  }
}


function stageLyricCooperativeNextDelay(job, chunkMs) {
  chunkMs = Math.max(0, Number(chunkMs) || 0);
  if (chunkMs >= 8) return 24;
  if (chunkMs >= 5) return 14;
  if (chunkMs >= 3.5) return 8;
  return job && job.lightweight ? 0 : 6;
}


function scheduleStageLyricCooperativeWork(job, delay) {
  if (!job || stageLyricPrewarm.build !== job) return;
  delay = Math.max(0, Number(delay) || 0);
  function runAfterPaint() {
    stageLyricPrewarm.workTimer = 0;
    if (!job || stageLyricPrewarm.build !== job) return;
    var canFrameAlign = typeof document !== 'undefined' && document.visibilityState === 'visible' && typeof requestAnimationFrame === 'function';
    if (!canFrameAlign) {
      stageLyricPrewarm.workTimer = setTimeout(function () {
        stageLyricPrewarm.workTimer = 0;
        runStageLyricCooperativePrewarm(job);
      }, 12);
      return;
    }
    stageLyricPrewarm.workRaf = requestAnimationFrame(function () {
      stageLyricPrewarm.workRaf = 0;
      if (!job || stageLyricPrewarm.build !== job) return;
      stageLyricPrewarm.workTimer = setTimeout(function () {
        stageLyricPrewarm.workTimer = 0;
        runStageLyricCooperativePrewarm(job);
      }, 0);
    });
  }
  if (delay > 0) stageLyricPrewarm.workTimer = setTimeout(runAfterPaint, delay);
  else runAfterPaint();
}


function runStageLyricCooperativePrewarm(job) {
  stageLyricPrewarm.workTimer = 0;
  if (!job || stageLyricPrewarm.build !== job) return;
  if (
    job.token !== stageLyricPrewarm.token || !fx || !fx.particleLyrics ||
    !lyricsLines || !lyricsLines.length || stageLyricPrewarmBuildGuardKey() !== job.guardKey
  ) {
    cancelStageLyricPrewarmBuildOnly();
    return;
  }
  if (stageLyricShouldYieldToPendingInput()) {
    scheduleStageLyricCooperativeWork(job, 16);
    return;
  }
  if (job.readyToFinish) {
    finishStageLyricCooperativePrewarm(job);
    return;
  }
  var startedAt = stageLyricNowMs();
  var done = false;
  try {
    done = stepCooperativeLyricMeshBuild(job.state, 1, 4.2);
  } catch (e) {
    cancelStageLyricPrewarmBuildOnly();
    return;
  }
  var chunkMs = stageLyricNowMs() - startedAt;
  job.lastPhase = job.state && job.state.lastPhase || '';
  updateStageLyricBuildStats(job, true, chunkMs);
  if (done) {
    job.readyToFinish = true;
    scheduleStageLyricCooperativeWork(job, stageLyricCooperativeNextDelay(job, chunkMs));
    return;
  }
  scheduleStageLyricCooperativeWork(job, stageLyricCooperativeNextDelay(job, chunkMs));
}
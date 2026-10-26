'use strict';



function stageLyricSingleLineUpcomingIndexes(index, count) {
  var out = [];
  var cursor = Math.max(0, Math.round(Number(index) || 0));
  var limit = Math.max(1, Number(count) || 4);
  while (out.length < limit) {
    cursor = stageLyricSingleLineNextIndex(cursor);
    if (cursor < 0) break;
    out.push(cursor);
  }
  return out;
}


function stageLyricSingleLinePrewarmDelay(currentIndex, targetIndex, lyricTime, slot) {
  var currentLine = lyricsLines && lyricsLines[currentIndex];
  var targetLine = lyricsLines && lyricsLines[targetIndex];
  var baseTime = Number(lyricTime || (currentLine && currentLine.t) || 0);
  var secondsUntil = targetLine && isFinite(Number(targetLine.t))
    ? Math.max(0, Number(targetLine.t) - baseTime)
    : 0;
  if (slot <= 0) return secondsUntil > 2.0 ? 32 : (secondsUntil > 1.0 ? 8 : 0);
  if (secondsUntil < 1.2) return slot * 18;
  if (secondsUntil < 2.4) return 36 + slot * 34;
  return Math.min(180, 52 + slot * 46);
}


function stageLyricSingleLinePrewarmCanServePayload(payload) {
  if (!stageLyricPayloadIsSingleLine(payload)) return false;
  var key = stageLyricPreparedKey(payload);
  var item = key && stageLyricSingleLinePrewarm && stageLyricSingleLinePrewarm.items
    ? stageLyricSingleLinePrewarm.items[key]
    : null;
  return !!(item && item.mesh);
}


function takeStageLyricSingleLinePrewarmMesh(payload) {
  if (!stageLyricPayloadIsSingleLine(payload)) return null;
  var key = stageLyricPreparedKey(payload);
  var item = key && stageLyricSingleLinePrewarm && stageLyricSingleLinePrewarm.items
    ? stageLyricSingleLinePrewarm.items[key]
    : null;
  if (!item || !item.mesh) return null;
  var mesh = item.mesh;
  item.mesh = null;
  if (item.timer) clearTimeout(item.timer);
  delete stageLyricSingleLinePrewarm.items[key];
  stageLyricSingleLinePrewarm.order = (stageLyricSingleLinePrewarm.order || []).filter(function (entryKey) { return entryKey !== key; });
  return mesh;
}


function scheduleStageLyricSingleLineCachePrewarm(index, reason, delay) {
  if (!fx || !fx.particleLyrics || !lyricsLines || !lyricsLines.length) return false;
  var payload = buildStageLyricDisplayPayload(index);
  if (!stageLyricPayloadIsSingleLine(payload)) return false;
  var key = stageLyricPreparedKey(payload);
  if (!key) return false;
  if (stageLyricPrewarmCanServePayload(payload)) return true;
  var wait = Math.max(0, Number(delay) || 0);
  var dueAt = stageLyricNowMs() + wait;
  var item = stageLyricSingleLinePrewarm.items[key];
  if (item) {
    if (item.mesh) return true;
    if (item.timer && (!item.dueAt || dueAt >= item.dueAt - 8)) return true;
    if (item.timer) clearTimeout(item.timer);
  } else {
    item = { mesh: null, timer: 0, targetIndex: index, dueAt: 0 };
    stageLyricSingleLinePrewarm.items[key] = item;
    stageLyricSingleLinePrewarm.order = (stageLyricSingleLinePrewarm.order || []).filter(function (entryKey) { return entryKey !== key; });
    stageLyricSingleLinePrewarm.order.push(key);
  }
  item.targetIndex = index;
  item.dueAt = dueAt;
  item.timer = setTimeout(function () {
    item.timer = 0;
    item.dueAt = 0;
    if (!fx || !fx.particleLyrics || !lyricsLines || !lyricsLines.length) {
      clearStageLyricSingleLinePrewarmItem(key);
      return;
    }
    if (item.mesh || stageLyricPrewarmCanServePayload(payload)) return;
    try {
      var mesh = buildLyricMesh(payload);
      primeLyricMeshOpacity(mesh, 0);
      mesh.visible = false;
      item.mesh = mesh;
      item.payload = payload;
      trimStageLyricSingleLinePrewarmCache();
    } catch (e) {
      clearStageLyricSingleLinePrewarmItem(key);
    }
  }, wait);
  trimStageLyricSingleLinePrewarmCache();
  return true;
}


function scheduleStageLyricSingleLineNextPrewarm(currentIndex, lyricTime, reason) {
  if (!fx || !fx.particleLyrics) return false;
  var upcoming = stageLyricSingleLineUpcomingIndexes(currentIndex, 6);
  if (!upcoming.length) return false;
  var allReady = true;
  for (var i = 0; i < upcoming.length; i++) {
    var targetIndex = upcoming[i];
    if (stageLyricSingleLineIndexPrewarmReady(targetIndex)) continue;
    allReady = false;
    var delay = stageLyricSingleLinePrewarmDelay(currentIndex, targetIndex, lyricTime, i);
    var prewarmReason = i === 0 ? (reason || 'single-line-next') : ('single-line-lookahead-' + (i + 1));
    scheduleStageLyricSingleLineCachePrewarm(targetIndex, prewarmReason, delay);
  }
  return allReady || stageLyricSingleLineNextPrewarmReady(currentIndex);
}


function scheduleStageLyricSingleLineBootstrapPrewarm(reason, delay) {
  if (!fx || !fx.particleLyrics || !lyricsLines || !lyricsLines.length) return false;
  if (normalizeLyricDisplayMode(fx && fx.lyricDisplayMode) !== 'single') return false;
  var currentIndex = stageLyricSingleLineBootstrapIndex();
  if (currentIndex < 0) return false;
  var wait = Math.max(0, Number(delay) || 0);
  var currentCoveredBySharedPrewarm = !!(
    stageLyricPrewarm &&
    stageLyricPrewarm.targetIndex === currentIndex &&
    (stageLyricPrewarm.timer || stageLyricPrewarm.mesh)
  );
  if (!currentCoveredBySharedPrewarm && !stageLyricSingleLineIndexPrewarmReady(currentIndex)) {
    scheduleStageLyricSingleLineCachePrewarm(currentIndex, (reason || 'single-line-bootstrap') + '-current', Math.min(wait, 8));
  }
  var upcoming = stageLyricSingleLineUpcomingIndexes(currentIndex, 6);
  for (var i = 0; i < upcoming.length; i++) {
    if (stageLyricSingleLineIndexPrewarmReady(upcoming[i])) continue;
    scheduleStageLyricSingleLineCachePrewarm(upcoming[i], (reason || 'single-line-bootstrap') + '-lookahead-' + (i + 1), Math.max(0, Math.min(wait + 8 + i * 18, 96)));
  }
  return true;
}


function resetPreparedStageLyricMesh(mesh, payload, lineStep) {
  if (!mesh) return null;
  payload = normalizeStageLyricPayload(payload);
  if (mesh.parent) mesh.parent.remove(mesh);
  var singleLineSwap = payload && normalizeLyricDisplayMode(payload.mode) === 'single';
  var enterDir = singleLineSwap ? 0 : (lineStep > 0 ? -1 : (lineStep < 0 ? 1 : 0));
  mesh.visible = true;
  var singleLineStartX = singleLineSwap ? 0 : (Math.random() - 0.5) * 0.045;
  mesh.position.set(singleLineStartX, 0.20, 1.46 - Math.abs(enterDir) * 0.055);
  mesh.scale.setScalar(0.96);
  mesh.userData = mesh.userData || {};
  mesh.userData.age = 0;
  mesh.userData.state = 'in';
  mesh.userData.lastLyricProgress = -1;
  mesh.userData.targetLyricProgress = 0;
  mesh.userData.shownLyricProgress = 0;
  mesh.userData.enterDirection = enterDir;
  mesh.userData.exitDirection = 0;
  mesh.userData.glitchBurst = 0;
  mesh.userData.glitchHold = 0;
  mesh.userData.progressPreviewMotionLocked = false;
  mesh.userData.progressPreviewMotionBlend = 1;
  delete mesh.userData.progressPreviewHoldX;
  delete mesh.userData.progressPreviewHoldY;
  delete mesh.userData.progressPreviewHoldZ;
  delete mesh.userData.progressPreviewHoldScale;
  delete mesh.userData.progressPreviewHoldRotationZ;
  mesh.userData.displayKey = payload ? payload.key : '';
  mesh.userData.payload = payload;
  var data = mesh.userData.lyric || {};
  if (data.context && data.context.userData) {
    data.context.userData.progressPreviewMotionLocked = false;
    data.context.userData.progressPreviewMotionBlend = 1;
  }
  var lineWorldStep = clampRange(Number(data.lineWorldStep) || 0.38, 0.20, 0.94);
  if (!singleLineSwap) mesh.position.y += enterDir * lineWorldStep;
  if (data && isFinite(Number(data.trackTargetVirtualIndex))) {
    data.trackScrollOffset = Number(data.trackTargetVirtualIndex);
    data.trackScrollPrimed = true;
    data.trackScrollSnapUntil = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) + 120;
  }
  primeLyricMeshOpacity(mesh, 0);
  updateLyricMeshProgress(mesh, 0);
  return mesh;
}


function takeStageLyricPrewarmMesh(payload) {
  var key = stageLyricPreparedKey(payload);
  if (!key || !stageLyricPrewarm.mesh) return null;
  if (stageLyricPrewarm.key === key) {
    var exactMesh = stageLyricPrewarm.mesh;
    stageLyricPrewarm.mesh = null;
    stageLyricPrewarm.key = '';
    stageLyricPrewarm.targetIndex = null;
    stageLyricPrewarm.dueAt = 0;
    return exactMesh;
  }
  var data = stageLyricPrewarm.mesh.userData && stageLyricPrewarm.mesh.userData.lyric;
  var targetLineIndex = payload && payload.trackIndex != null ? Number(payload.trackIndex) : NaN;
  if (
    data && data.usesTrack && payload && payload.trackKey && data.trackKey === payload.trackKey &&
    isFinite(targetLineIndex) &&
    data.trackStart != null && data.trackEnd != null &&
    targetLineIndex >= Number(data.trackStart) && targetLineIndex <= Number(data.trackEnd) &&
    setLyricTrackTarget(stageLyricPrewarm.mesh, payload)
  ) {
    var trackMesh = stageLyricPrewarm.mesh;
    stageLyricPrewarm.mesh = null;
    stageLyricPrewarm.key = '';
    stageLyricPrewarm.targetIndex = null;
    stageLyricPrewarm.dueAt = 0;
    return trackMesh;
  }
  if (stageLyricPrewarm.key !== key) {
    if (stageLyricPrewarm.mesh) disposeStageLyricPrewarmMesh();
    return null;
  }
  return null;
}


function stageLyricMeshCanServePayload(mesh, payload) {
  if (!mesh || !mesh.userData || !mesh.userData.lyric || !payload) return false;
  var data = mesh.userData.lyric;
  if (!data.usesTrack || !data.rowLayers || !data.rowLayers.length) return false;
  if (!payload.trackLightweight && data.trackLightweight) return false;
  if (!payload.trackKey || data.trackKey !== payload.trackKey) return false;
  if (payload.trackIndex == null || !isFinite(Number(payload.trackIndex))) return false;
  var targetLineIndex = Number(payload.trackIndex);
  if (data.trackStart != null && isFinite(Number(data.trackStart)) && targetLineIndex < Number(data.trackStart)) return false;
  if (data.trackEnd != null && isFinite(Number(data.trackEnd)) && targetLineIndex > Number(data.trackEnd)) return false;
  return true;
}


function stageLyricPrewarmCanServePayload(payload) {
  if (stageLyricSingleLinePrewarmCanServePayload(payload)) return true;
  var key = stageLyricPreparedKey(payload);
  if (!key || !stageLyricPrewarm.mesh) return false;
  return stageLyricPrewarm.key === key || stageLyricMeshCanServePayload(stageLyricPrewarm.mesh, payload);
}


function stageLyricCurrentMeshAlreadyPreparedForPayload(payload) {
  if (!stageLyrics || !stageLyrics.current || !payload) return false;
  if (payload.trackKey && payload.trackIndex != null) {
    return stageLyricMeshCanServePayload(stageLyrics.current, payload);
  }
  return !!(stageLyrics.currentDisplayKey === payload.key);
}


function stageLyricPreparedFullPayloadForIndex(index) {
  var prepared = stageLyricPrewarmPayload();
  if (!prepared || prepared.trackLightweight || !prepared.trackKey || !stageLyricPrewarm.mesh) return null;
  if (!lyricsLines || !lyricsLines.length) return null;
  index = Math.max(0, Math.min(lyricsLines.length - 1, Math.round(Number(index) || 0)));
  var payload = buildStageLyricDisplayPayload(index);
  if (!payload || payload.trackLightweight) return null;
  return stageLyricMeshCanServePayload(stageLyricPrewarm.mesh, payload) ? payload : null;
}


function stageLyricPrewarmFullCanServeIndex(index) {
  return !!stageLyricPreparedFullPayloadForIndex(index);
}


function shouldDeferStageLyricSyncBuild(payload, redrawOnly) {
  if (redrawOnly || !payload || !lyricsLines || !lyricsLines.length) return false;
  if (stageLyricPayloadIsSingleLine(payload)) return false;
  if (payload.trackLightweight) return false;
  var multiLineLoad = stageLyricMultiLineWarmupLoad();
  if (!multiLineLoad && lyricsLines.length < 24) return false;
  if (payload.trackIndex == null || !payload.trackKey) return false;
  if (stageLyrics.current && stageLyricMeshCanServePayload(stageLyrics.current, payload)) return false;
  if (stageLyricPrewarmCanServePayload(payload)) return false;
  return true;
}


function requestStageLyricDemandPrewarm(payload) {
  if (!payload) return;
  requestStageLyricWarmup('track-demand', 180);
  var singleLineDemand = stageLyricPayloadIsSingleLine(payload);
  var reason = singleLineDemand ? 'single-line-demand' : (payload.trackLightweight ? 'track-demand-light' : 'track-demand');
  var delay = singleLineDemand ? 0 : 16;
  if (payload.trackIndex != null && isFinite(Number(payload.trackIndex))) {
    if (singleLineDemand) scheduleStageLyricSingleLineCachePrewarm(Number(payload.trackIndex), reason, delay);
    else scheduleStageLyricPrewarmForIndex(Number(payload.trackIndex), reason, delay);
  } else {
    scheduleStageLyricPrewarm(reason, delay);
  }
  if (payload.trackLightweight && typeof scheduleStageLyricFullTrackWarmup === 'function') {
    scheduleStageLyricFullTrackWarmup('lightweight-upgrade', 120);
  }
}


function ensureStageLyricPlaybackWarmup(reason, delay) {
  if (!fx || !fx.particleLyrics || !lyricsLines || !lyricsLines.length) return false;
  var idx = stageLyrics && stageLyrics.currentIdx >= 0 ? stageLyrics.currentIdx : chooseStageLyricPrewarmIndex();
  if (idx < 0) return false;
  var now = stageLyricNowMs();
  if (
    stageLyricPlaybackWarmupLastIndex === idx &&
    now - stageLyricPlaybackWarmupLastAt < 680 &&
    (stageLyricPrewarm.timer || stageLyricPrewarm.workTimer || stageLyricPrewarm.workRaf || stageLyricPrewarm.build || stageLyricPrewarm.mesh || stageLyricFullTrackWarmupTimer)
  ) {
    return true;
  }
  stageLyricPlaybackWarmupLastAt = now;
  stageLyricPlaybackWarmupLastIndex = idx;
  requestStageLyricWarmup(reason || 'playback-resume', 220);
  scheduleStageLyricPrewarmForIndex(idx, reason || 'playback-resume', delay == null ? 16 : delay);
  if (typeof scheduleStageLyricFullTrackWarmup === 'function') scheduleStageLyricFullTrackWarmup('track-ready-fast', 96);
  return true;
}


function requestStageLyricLightweightUpgrade(reason, delay) {
  if (!fx || !fx.particleLyrics || !lyricsLines || !lyricsLines.length) return false;
  var now = stageLyricNowMs();
  if (
    now - stageLyricLightweightUpgradeLastAt < 900 &&
    (stageLyricFullTrackWarmupTimer || stageLyricPrewarm.timer || stageLyricPrewarm.workTimer || stageLyricPrewarm.workRaf || stageLyricPrewarm.build || stageLyricPrewarm.mesh)
  ) {
    return true;
  }
  stageLyricLightweightUpgradeLastAt = now;
  if (typeof scheduleStageLyricFullTrackWarmup === 'function') {
    scheduleStageLyricFullTrackWarmup(reason || 'lightweight-upgrade', delay == null ? 132 : delay);
    return true;
  }
  return ensureStageLyricPlaybackWarmup(reason || 'lightweight-upgrade', delay == null ? 32 : delay);
}


function stageLyricCurrentUsesPersistentTrack() {
  var data = stageLyrics && stageLyrics.current && stageLyrics.current.userData && stageLyrics.current.userData.lyric;
  return !!(data && data.trackPersistent);
}


function stageLyricResidentRowKey(row) {
  if (!row) return '';
  var lineIndex = row.isTranslation
    ? (row.parentIndex != null ? Number(row.parentIndex) : Number(row.lineIndex))
    : Number(row.lineIndex);
  if (!isFinite(lineIndex)) return '';
  return Math.round(lineIndex) + '|' + (row.isTranslation ? 'translation' : 'primary');
}


function updateStageLyricPersistentResidentBounds(data) {
  if (!data || !Array.isArray(data.rowLayers)) return;
  var start = Infinity;
  var end = -Infinity;
  var count = 0;
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    if (!row || !row.isPrimary || row.lineIndex == null || !isFinite(Number(row.lineIndex))) continue;
    var lineIndex = Math.round(Number(row.lineIndex));
    start = Math.min(start, lineIndex);
    end = Math.max(end, lineIndex);
    count += 1;
  }
  data.trackResidentStart = isFinite(start) ? start : 0;
  data.trackResidentEnd = isFinite(end) ? end : -1;
  data.trackResidentPrimaryCount = count;
}
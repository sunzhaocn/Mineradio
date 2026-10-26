'use strict';



function stageLyricColorSignature(value) {
  if (!value) return '';
  if (value.getHexString) return value.getHexString();
  return String(value);
}


function stageLyricPrewarmStyleKey(options) {
  var pal = stageLyrics && stageLyrics.palette || {};
  var parts = [
    normalizeLyricDisplayMode(fx && fx.lyricDisplayMode),
    normalizeLyricTranslationMode(fx && fx.lyricTranslationMode),
    Math.round(lyricContextSpreadValue() * 1000),
    Math.round(lyricContextOpacityValue() * 1000),
    Math.round(lyricTranslationGapValue() * 1000),
    Math.round(lyricTranslationScaleValue() * 1000),
    Math.round(lyricTranslationOpacityValue() * 1000),
    Math.round((Number(fx && fx.lyricLineHeight) || 1) * 1000),
    Math.round((Number(fx && fx.lyricLetterSpacing) || 0) * 1000),
    Math.round((Number(fx && fx.lyricWeight) || 700) * 10),
    Math.round((Number(fx && fx.lyricCustomLineCount) || 0) * 10),
    fx && fx.lyricMotionStyle || '',
    fx && fx.lyricColorMode || '',
    fx && fx.lyricColor || '',
    fx && fx.lyricHighlightMode || '',
    fx && fx.lyricHighlightColor || '',
    fx && fx.lyricGlowLinked !== false ? 'glow-linked' : 'glow-detached',
    fx && fx.lyricGlowColor || ''
  ];
  if (!options || !options.omitLivePalette) {
    parts.push(
      stageLyricColorSignature(pal.primary),
      stageLyricColorSignature(pal.secondary),
      stageLyricColorSignature(pal.highlight),
      stageLyricColorSignature(pal.glowColor)
    );
  }
  return parts.join('|');
}


function stageLyricPrewarmBuildGuardKey() {
  return stageLyricPrewarmStyleKey({ omitLivePalette: true });
}


function stageLyricPreparedKey(payload) {
  payload = normalizeStageLyricPayload(payload);
  if (!payload || !payload.key) return '';
  return [
    payload.key,
    payload.trackKey || '',
    payload.trackStart == null ? '' : payload.trackStart,
    payload.trackEnd == null ? '' : payload.trackEnd,
    payload.trackLightweight ? 'light' : 'full',
    Array.isArray(payload.trackEntries) ? payload.trackEntries.length : 0,
    stageLyricPrewarmStyleKey()
  ].join('::');
}


function stageLyricRenderSignatureForCurrentState() {
  var lyricSignature = typeof currentAppliedLyricRenderSignature === 'function' ? currentAppliedLyricRenderSignature() : '';
  if (!lyricSignature) return '';
  return lyricSignature + '::style::' + stageLyricPrewarmStyleKey();
}


function stageLyricCanPreserveSameRender(signature) {
  if (!signature || !stageLyrics || stageLyrics.renderSignature !== signature) return false;
  if (stageLyrics.current || stageLyrics.currentPayload || stageLyrics.currentDisplayKey) return true;
  return !!(stageLyricPrewarm && (stageLyricPrewarm.mesh || stageLyricPrewarm.timer || stageLyricPrewarm.workTimer || stageLyricPrewarm.workRaf || stageLyricPrewarm.build));
}


function stageLyricPrewarmPayload() {
  return stageLyricPrewarm && stageLyricPrewarm.mesh && stageLyricPrewarm.mesh.userData
    ? stageLyricPrewarm.mesh.userData.payload
    : null;
}


function stageLyricLightPrewarmReason(reason) {
  return /^(intro-first-line|renderLyrics|renderLyrics-title|toggleLyricsPanel|setParticleLyricsSilently|track-demand-light|startup-restore|startup-restore-lyrics|playback-resume|playback-started)$/.test(String(reason || ''))
    || /^quality-switch/i.test(String(reason || ''));
}


function clearStageLyricFullTrackWarmup() {
  if (stageLyricFullTrackWarmupTimer) {
    clearTimeout(stageLyricFullTrackWarmupTimer);
    stageLyricFullTrackWarmupTimer = 0;
  }
  if (stageLyricFullTrackWarmupIdle && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(stageLyricFullTrackWarmupIdle);
  }
  stageLyricFullTrackWarmupIdle = 0;
  stageLyricFullTrackWarmupTargetAt = 0;
}


function cancelStageLyricPrewarmBuildOnly() {
  if (stageLyricPrewarm.workTimer) {
    clearTimeout(stageLyricPrewarm.workTimer);
    stageLyricPrewarm.workTimer = 0;
  }
  if (stageLyricPrewarm.workRaf) {
    cancelAnimationFrame(stageLyricPrewarm.workRaf);
    stageLyricPrewarm.workRaf = 0;
  }
  if (stageLyricPrewarm.build && stageLyricPrewarm.build.state && typeof cancelCooperativeLyricMeshBuild === 'function') {
    cancelCooperativeLyricMeshBuild(stageLyricPrewarm.build.state);
  }
  stageLyricPrewarm.build = null;
  if (typeof window !== 'undefined' && window.__mineradioLyricBuildStats) {
    window.__mineradioLyricBuildStats.active = false;
  }
}


function disposeStageLyricPrewarmMesh() {
  if (stageLyricPrewarm.timer) {
    clearTimeout(stageLyricPrewarm.timer);
    stageLyricPrewarm.timer = 0;
  }
  cancelStageLyricPrewarmBuildOnly();
  if (stageLyricPrewarm.mesh) {
    disposeLyricMesh(stageLyricPrewarm.mesh);
    stageLyricPrewarm.mesh = null;
  }
  stageLyricPrewarm.key = '';
  stageLyricPrewarm.targetIndex = null;
  stageLyricPrewarm.lightweight = false;
  stageLyricPrewarm.dueAt = 0;
}


function clearStageLyricSingleLinePrewarmItem(key) {
  if (!stageLyricSingleLinePrewarm || !stageLyricSingleLinePrewarm.items || !key) return;
  var item = stageLyricSingleLinePrewarm.items[key];
  if (!item) return;
  if (item.timer) clearTimeout(item.timer);
  if (item.mesh) disposeLyricMesh(item.mesh);
  delete stageLyricSingleLinePrewarm.items[key];
  stageLyricSingleLinePrewarm.order = (stageLyricSingleLinePrewarm.order || []).filter(function (entryKey) { return entryKey !== key; });
}


function clearStageLyricSingleLinePrewarmCache() {
  if (!stageLyricSingleLinePrewarm || !stageLyricSingleLinePrewarm.items) return;
  Object.keys(stageLyricSingleLinePrewarm.items).forEach(clearStageLyricSingleLinePrewarmItem);
  stageLyricSingleLinePrewarm.order = [];
}


function trimStageLyricSingleLinePrewarmCache() {
  if (!stageLyricSingleLinePrewarm) return;
  var maxItems = Math.max(1, Number(stageLyricSingleLinePrewarm.max) || 4);
  while ((stageLyricSingleLinePrewarm.order || []).length > maxItems) {
    clearStageLyricSingleLinePrewarmItem(stageLyricSingleLinePrewarm.order[0]);
  }
}


function stageLyricNowMs() {
  return window.performance && performance.now ? performance.now() : Date.now();
}


function stageLyricTextLoadInfo() {
  var mode = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode);
  var translationMode = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode);
  var key = stageLyricTrackKeyForMode(mode) + '|native=' + (lyricsHasNativeKaraoke ? 1 : 0);
  if (stageLyricTextLoadCache && stageLyricTextLoadCache.key === key && stageLyricTextLoadCache.info) return stageLyricTextLoadCache.info;
  var total = lyricsLines && lyricsLines.length ? lyricsLines.length : 0;
  var charTotal = 0;
  var cjkTotal = 0;
  var nativeWordLines = 0;
  var translationLines = 0;
  for (var i = 0; i < total; i++) {
    var line = lyricsLines[i] || {};
    var text = normalizeStageLyricText(line.text);
    var translation = normalizeLyricTranslationText(line.translation);
    if (text) {
      charTotal += Array.from(text).length;
      cjkTotal += (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    }
    if (translation) {
      translationLines += 1;
      charTotal += Array.from(translation).length;
      cjkTotal += (translation.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    }
    if (line.words && line.words.length) nativeWordLines += 1;
  }
  var cjkRatio = charTotal > 0 ? cjkTotal / charTotal : 0;
  var multiLineLoad = mode !== 'single';
  var denseCjk = cjkTotal >= 24 && cjkRatio >= 0.18;
  var layeredRows = total * (translationMode !== 'off' ? 2 : 1);
  var preferLightweight = !!(multiLineLoad && denseCjk && (total >= 12 || nativeWordLines >= 4 || layeredRows >= 20));
  var info = {
    total: total,
    cjkTotal: cjkTotal,
    cjkRatio: cjkRatio,
    nativeWordLines: nativeWordLines,
    translationLines: translationLines,
    preferLightweight: preferLightweight
  };
  stageLyricTextLoadCache = { key: key, info: info };
  return info;
}


function stageLyricPreferLightweightTrack() {
  var info = stageLyricTextLoadInfo();
  return !!(info && info.preferLightweight);
}


function stageLyricShouldSkipFullTrackWarmup(reason) {
  if (!stageLyricPreferLightweightTrack()) return false;
  return false;
}


function clearStageLyricRestoreWarmup() {
  stageLyricRestoreWarmup.time = 0;
  stageLyricRestoreWarmup.token = 0;
  stageLyricRestoreWarmup.until = 0;
  stageLyricRestoreWarmup.reason = '';
}


function stageLyricRestoreWarmupSeconds() {
  var seconds = Number(stageLyricRestoreWarmup && stageLyricRestoreWarmup.time) || 0;
  if (seconds < 0.35) return null;
  if (stageLyricRestoreWarmup.token && typeof trackSwitchToken !== 'undefined' && stageLyricRestoreWarmup.token !== trackSwitchToken) {
    clearStageLyricRestoreWarmup();
    return null;
  }
  if ((Number(stageLyricRestoreWarmup.until) || 0) < stageLyricNowMs()) {
    clearStageLyricRestoreWarmup();
    return null;
  }
  var actual = audio && isFinite(Number(audio.currentTime)) ? Math.max(0, Number(audio.currentTime) || 0) : 0;
  if (actual > 0.35 && Math.abs(actual - seconds) <= 1.25) {
    return actual;
  }
  if (actual > seconds + 2.5) {
    clearStageLyricRestoreWarmup();
    return actual;
  }
  return seconds;
}


function stageLyricIndexForSeconds(seconds) {
  if (!lyricsLines || !lyricsLines.length) return -1;
  var lyricT = typeof getAdjustedLyricPlaybackTime === 'function' ? getAdjustedLyricPlaybackTime(seconds) : seconds;
  var idx = findStageLyricIndexAtTime(lyricT);
  if (idx < 0) idx = 0;
  return Math.max(0, Math.min(lyricsLines.length - 1, idx));
}


function scheduleStageLyricRestorePrewarm(reason, delay) {
  var seconds = stageLyricRestoreWarmupSeconds();
  if (seconds == null) return false;
  var idx = stageLyricIndexForSeconds(seconds);
  if (idx < 0) return false;
  scheduleStageLyricPrewarmForIndex(idx, reason || 'startup-restore', delay == null ? 16 : delay);
  return true;
}


function requestStageLyricRestoreWarmup(seconds, token, reason) {
  seconds = Math.max(0, Number(seconds) || 0);
  if (seconds < 0.35) return false;
  stageLyricRestoreWarmup.time = seconds;
  stageLyricRestoreWarmup.token = Number(token) || 0;
  stageLyricRestoreWarmup.until = stageLyricNowMs() + 18000;
  stageLyricRestoreWarmup.reason = reason || 'startup-restore';
  requestStageLyricWarmup(stageLyricRestoreWarmup.reason, 220);
  scheduleStageLyricRestorePrewarm(stageLyricRestoreWarmup.reason, 16);
  if (typeof scheduleStageLyricFullTrackWarmup === 'function') scheduleStageLyricFullTrackWarmup('track-ready-fast', 140);
  return true;
}


function requestStageLyricWarmup(reason, ms) {
  var duration = clampRange(Number(ms) || 120, 24, 900);
  stageLyricWarmup.until = Math.max(Number(stageLyricWarmup.until) || 0, stageLyricNowMs() + duration);
  stageLyricWarmup.reason = reason || '';
}


function clearStageLyricWarmup() {
  stageLyricWarmup.until = 0;
  stageLyricWarmup.reason = '';
}


function invalidateStageLyricPayloadForNewLyrics(reason) {
  stageLyricTrackGeneration += 1;
  if (typeof invalidateLyricQualityTextures === 'function') invalidateLyricQualityTextures(reason || 'new-lyrics');
  cancelStageLyricResidentBuild();
  clearStageLyricFullTrackWarmup();
  disposeStageLyricPrewarmMesh();
  clearStageLyricSingleLinePrewarmCache();
  if (/track-switch-pending/i.test(String(reason || ''))) {
    stageLyricTrackSwitchBootstrapUntil = stageLyricNowMs() + 4800;
  }
  stageLyricTextLoadCache = { key: '', info: null };
  if (typeof stageLyricTrackCache !== 'undefined' && stageLyricTrackCache) {
    stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };
  }
  if (!stageLyrics) return;
  if (stageLyrics.currentIdx >= 0) {
    stageLyrics.currentIdx = -1;
    stageLyrics.currentDisplayKey = '';
    stageLyrics.currentPayload = null;
  }
  stageLyrics.renderSignature = '';
  stageLyricWarmup.reason = reason || stageLyricWarmup.reason || '';
}


function stageLyricWarmupPending() {
  if (stageLyricPrewarm.mesh) return false;
  if (stageLyricPrewarm.timer || stageLyricPrewarm.workTimer || stageLyricPrewarm.workRaf || stageLyricPrewarm.build) return true;
  if (normalizeLyricDisplayMode(fx && fx.lyricDisplayMode) === 'single') {
    var singleLineIndex = stageLyricSingleLineBootstrapIndex();
    if (singleLineIndex >= 0 && stageLyricSingleLineIndexPrewarmReady(singleLineIndex)) return false;
  }
  return (Number(stageLyricWarmup.until) || 0) > stageLyricNowMs();
}


function stageLyricPayloadIsSingleLine(payload) {
  if (!payload) return false;
  return normalizeLyricDisplayMode(payload.mode || (fx && fx.lyricDisplayMode)) === 'single';
}


function lyricVerticalFloatEnabled() {
  return !fx || fx.lyricVerticalFloat !== false;
}


function stageLyricSingleLineTrackStub(index) {
  var idx = Math.max(0, Math.round(Number(index) || 0));
  return { entries: [], activeLine: 0, start: idx, end: idx, lightweight: false };
}


function stageLyricSingleLineNextIndex(index) {
  if (!lyricsLines || !lyricsLines.length || normalizeLyricDisplayMode(fx && fx.lyricDisplayMode) !== 'single') return -1;
  var start = Math.max(0, Math.round(Number(index) || 0)) + 1;
  for (var i = start; i < lyricsLines.length; i++) {
    if (lyricLineDisplayTextAt(i)) return i;
  }
  return -1;
}


function stageLyricSingleLineNextPrewarmReady(currentIndex) {
  var nextIndex = stageLyricSingleLineNextIndex(currentIndex);
  return stageLyricSingleLineIndexPrewarmReady(nextIndex);
}


function stageLyricSingleLineIndexPrewarmReady(index) {
  if (index < 0) return true;
  var payload = buildStageLyricDisplayPayload(index);
  if (!payload) return false;
  if (stageLyricSingleLinePrewarmCanServePayload(payload)) return true;
  if (!stageLyricPrewarm || stageLyricPrewarm.targetIndex !== index) return false;
  return !!(payload && stageLyricPrewarmCanServePayload(payload));
}
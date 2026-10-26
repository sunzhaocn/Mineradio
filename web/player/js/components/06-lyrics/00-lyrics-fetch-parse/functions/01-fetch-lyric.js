'use strict';


async function fetchLyric(songOrId, token, attempt) {
  attempt = Math.max(0, Number(attempt) || 0);
  var song;
  try {
    if (token !== trackSwitchToken) return;
    song = (songOrId && typeof songOrId === 'object') ? songOrId : null;
    var cachedResponse = song ? await readPersistentLyricCache(song) : null;
    if (token !== trackSwitchToken) return;
    if (cachedResponse) {
      var cachedState = applyFetchedLyricResponse(song, token, cachedResponse, { persist: false });
      if (cachedState && cachedState.usableLyric) {
        refreshPersistentLyricCache(song, token);
        return;
      }
    }
    var r = await requestTrackLyricJson(lyricEndpointForSong(song || songOrId), token);
    var state = applyFetchedLyricResponse(song, token, r);
    if (!state) return;
    if (!state.usableLyric && shouldRetryStartupLyricFetch(song, token, attempt)) scheduleStartupLyricFetchRetry(song, token, attempt);
  } catch (e) {
    if (token !== trackSwitchToken) return;
    cancelPendingTrackFallbackLyrics();
    var fallbackLines = withLyricFallbackForSong(song || currentLyricSong(), []);
    setOriginalLyricsState(fallbackLines, false, 'fallback', [], 'none');
    applyPreferredLyricsForCurrent(true);
    if (shouldRetryStartupLyricFetch(song, token, attempt)) scheduleStartupLyricFetchRetry(song, token, attempt);
  }
}

function currentLyricFallbackText() {
  return lyricFallbackTextForSong(currentLyricSong() || {});
}

function isNoLyricText(text) {
  var compact = String(text || '').replace(/\s+/g, '').replace(/[，,。.!！?？、~～]/g, '');
  return !compact ||
    compact === '纯音乐请欣赏' ||
    compact === '暂无歌词' ||
    compact === '暂无歌词敬请期待' ||
    compact === '此歌曲为没有填词的纯音乐请您欣赏';
}

function withLyricFallback(lines) {
  return withLyricFallbackForSong(currentLyricSong(), lines);
}

function lyricsAreFallbackTitleOnly(lines) {
  lines = Array.isArray(lines) ? lines.filter(function (line) { return line && String(line.text || '').trim(); }) : [];
  return lines.length === 1 && !!lines[0].fallback;
}

function lyricTagTimeToSeconds(min, sec, frac) {
  var t = (parseInt(min, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
  if (frac) t += (parseInt(frac, 10) || 0) / Math.pow(10, Math.min(3, frac.length));
  return t;
}

function finalizeLyricLineDurations(lines) {
  lines.sort(function (a, b) { return a.t - b.t; });
  for (var i = 0; i < lines.length; i++) {
    var next = lines[i + 1];
    var inferred = next && next.t > lines[i].t ? next.t - lines[i].t : 4.8;
    if (!isFinite(lines[i].duration) || lines[i].duration <= 0) lines[i].duration = inferred;
    lines[i].duration = Math.max(0.45, Math.min(12, lines[i].duration));
    lines[i].charCount = Math.max(1, lines[i].charCount || String(lines[i].text || '').length);
  }
  return lines;
}

function parseLyricText(text) {
  var lines = [], reg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  text.split(/\r?\n/).forEach(function (line) {
    var tags = [], times = [], m;
    reg.lastIndex = 0;
    while ((m = reg.exec(line))) {
      var t = lyricTagTimeToSeconds(m[1], m[2], m[3]);
      times.push(t);
      tags.push({ t: t, index: m.index, end: reg.lastIndex });
    }
    if (!times.length) return;
    var hasInterleavedText = false;
    for (var i = 0; i < tags.length - 1; i++) {
      if (line.slice(tags[i].end, tags[i + 1].index).trim()) {
        hasInterleavedText = true;
        break;
      }
    }
    if (hasInterleavedText) {
      for (var si = 0; si < tags.length; si++) {
        var segment = line.slice(tags[si].end, si + 1 < tags.length ? tags[si + 1].index : line.length).trim();
        if (segment) lines.push({ t: tags[si].t, text: segment, source: 'lrc' });
      }
      return;
    }
    var txt = line.replace(reg, '').trim();
    if (!txt) return;
    times.forEach(function (t) { lines.push({ t: t, text: txt, source: 'lrc' }); });
  });
  return finalizeLyricLineDurations(lines);
}

function normalizeLyricTranslationText(text) {
  text = normalizeStageLyricText(text);
  if (!text || isNoLyricText(text)) return '';
  return text;
}

function usableLyricTranslationLines(lines) {
  return (Array.isArray(lines) ? lines : []).filter(function (line) {
    return line && normalizeLyricTranslationText(line.text);
  });
}

function isLyricCreditLineText(text) {
  var raw = normalizeStageLyricText(text);
  if (!raw || raw.length > 96) return false;
  if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(raw)) return false;
  var cleaned = raw
    .replace(/^[\s"'([{]+|[\s"'\])}]+$/g, '')
    .replace(/[.:：;；]+$/g, '')
    .trim();
  if (!cleaned) return false;
  var hasCreditPunctuation = /[:：]\s*$/.test(raw);
  var split = cleaned.split(/\s*(?:\/|,|&|\+|;|\band\b|\bfeat\.?\b|\bft\.?\b|\bwith\b)\s*/i);
  var tokens = [];
  split.forEach(function (part) {
    String(part || '').split(/\s+/).forEach(function (token) {
      token = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.'-]+$/g, '');
      if (token) tokens.push(token);
    });
  });
  if (!tokens.length || tokens.length > 10) return false;
  var lyricWords = /\b(?:i|me|my|mine|you|your|yours|we|us|our|ours|he|him|his|she|her|they|them|it|love|die|want|need|know|gotta|gonna|wanna|would|could|should|can|cant|can't|dont|don't|ain't|is|are|am|be|been|being|was|were|do|does|did|go|come|make|take|throw|lock|away|world|force|key|place|baby|girl|boy|night|heart|life)\b/i;
  if (!hasCreditPunctuation && tokens.length > 1 && lyricWords.test(cleaned)) return false;
  var nameLike = 0;
  tokens.forEach(function (token) {
    if (/^(?:the|and|feat|ft|with)$/i.test(token)) {
      nameLike++;
    } else if (/^[A-Z0-9][A-Z0-9.'-]*$/.test(token) || /^[A-Z][A-Za-z0-9.'-]*$/.test(token)) {
      nameLike++;
    }
  });
  if (hasCreditPunctuation) return nameLike >= Math.max(1, tokens.length - 1);
  if (tokens.length <= 2 && /^[A-Z0-9 .,'-]+[.:]?$/.test(raw)) return true;
  return tokens.length >= 2 && nameLike >= tokens.length - 1 && /(?:\/|,|&|\+|\band\b|\bfeat\.?\b|\bft\.?\b|\bwith\b)/i.test(cleaned);
}

function markLyricLineSource(lines, source) {
  return usableLyricTranslationLines(lines || []).map(function (line) {
    var copy = Object.assign({}, line);
    if (Array.isArray(line.words)) copy.words = line.words.map(function (w) { return Object.assign({}, w); });
    copy.source = source || copy.source || 'translation';
    return copy;
  });
}

function mergeLyricTranslationLineSources() {
  var out = [];
  function hasSameLine(candidate) {
    var candidateText = normalizeLyricTranslationText(candidate && candidate.text);
    var candidateTime = Number(candidate && candidate.t) || 0;
    for (var i = 0; i < out.length; i++) {
      var item = out[i];
      if (Math.abs((Number(item.t) || 0) - candidateTime) <= 0.12 &&
        normalizeLyricTranslationText(item.text) === candidateText) return true;
    }
    return false;
  }
  for (var s = 0; s < arguments.length; s++) {
    var lines = usableLyricTranslationLines(arguments[s] || []);
    for (var i = 0; i < lines.length; i++) {
      if (!hasSameLine(lines[i])) out.push(lines[i]);
    }
  }
  return finalizeLyricLineDurations(out);
}

function buildLyricTranslationPayload(response) {
  response = response || {};
  var lrcTranslations = markLyricLineSource(parseLyricText(lyricTranslationTextFromAliases(response)), 'tlyric');
  var yrcTranslations = markLyricLineSource(parseYrcText(response.ytlrc || ''), 'ytlrc');
  var lines = mergeLyricTranslationLineSources(lrcTranslations, yrcTranslations);
  var sources = [];
  if (lrcTranslations.length) sources.push('tlyric');
  if (yrcTranslations.length) sources.push('ytlrc');
  return { lines: lines, source: sources.length ? sources.join('+') : 'none' };
}

function attachLyricTranslations(primaryLines, translationLines) {
  var primary = cloneLyricLines(primaryLines || []);
  var translations = usableLyricTranslationLines(translationLines || []);
  if (!primary.length || !translations.length) return primary;
  var assignments = {};
  var usedTranslations = {};
  function translationToleranceForLine(line) {
    var lineDuration = Math.max(0.9, Math.min(5.5, Number(line && line.duration) || 3.2));
    return Math.max(0.55, Math.min(2.4, lineDuration * 0.62 + 0.18));
  }
  function canUseTranslation(line, tr) {
    var translated = normalizeLyricTranslationText(tr && tr.text);
    return !!(line && tr && translated &&
      !isLyricCreditLineText(line.text) &&
      !isLyricCreditLineText(translated) &&
      translated !== normalizeStageLyricText(line.text));
  }
  function assignTranslation(lineIndex, trIndex, delta, phase) {
    var line = primary[lineIndex];
    var tr = translations[trIndex];
    if (!canUseTranslation(line, tr) || usedTranslations[trIndex]) return false;
    assignments[lineIndex] = { line: tr, delta: delta, index: trIndex, phase: phase || 'time' };
    usedTranslations[trIndex] = true;
    return true;
  }
  primary.forEach(function (line, lineIndex) {
    if (!line || line.fallback) return;
    var bestIndex = -1;
    var bestDelta = Infinity;
    for (var trIndex = 0; trIndex < translations.length; trIndex++) {
      if (usedTranslations[trIndex]) continue;
      var tr = translations[trIndex];
      if (!canUseTranslation(line, tr)) continue;
      var delta = Math.abs((Number(tr.t) || 0) - (Number(line.t) || 0));
      if (delta > translationToleranceForLine(line)) continue;
      if (delta < bestDelta) {
        bestIndex = trIndex;
        bestDelta = delta;
      }
    }
    if (bestIndex >= 0) assignTranslation(lineIndex, bestIndex, bestDelta, 'time');
  });
  if (translations.length >= Math.max(2, primary.length * 0.58)) {
    var orderedPrimaryIndexes = [];
    primary.forEach(function (line, lineIndex) {
      if (line && !line.fallback && !isLyricCreditLineText(line.text)) orderedPrimaryIndexes.push(lineIndex);
    });
    var primaryDen = Math.max(1, orderedPrimaryIndexes.length - 1);
    var translationDen = Math.max(1, translations.length - 1);
    orderedPrimaryIndexes.forEach(function (lineIndex, orderPos) {
      var line = primary[lineIndex];
      if (!line || line.fallback || assignments[lineIndex]) return;
      var expected = Math.round((orderPos / primaryDen) * translationDen);
      var bestIndex = -1;
      var bestScore = Infinity;
      var bestDelta = Infinity;
      for (var trIndex = 0; trIndex < translations.length; trIndex++) {
        if (usedTranslations[trIndex]) continue;
        var tr = translations[trIndex];
        if (!canUseTranslation(line, tr)) continue;
        var orderGap = Math.abs(trIndex - expected);
        if (orderGap > 5 && translations.length <= primary.length * 1.25) continue;
        var delta = Math.abs((Number(tr.t) || 0) - (Number(line.t) || 0));
        var fallbackTolerance = Math.max(translationToleranceForLine(line) * 1.35, 2.8);
        if (delta > fallbackTolerance && orderGap > 2) continue;
        var score = orderGap * 0.72 + Math.min(delta, 8) * 0.22;
        if (score < bestScore) {
          bestIndex = trIndex;
          bestScore = score;
          bestDelta = delta;
        }
      }
      if (bestIndex >= 0) assignTranslation(lineIndex, bestIndex, bestDelta, 'order');
    });
  }
  Object.keys(assignments).forEach(function (key) {
    var lineIndex = Number(key);
    var line = primary[lineIndex];
    var best = assignments[key] && assignments[key].line;
    if (line && best) {
      var translated = normalizeLyricTranslationText(best.text);
      if (translated && translated !== normalizeStageLyricText(line.text)) {
        line.translation = translated;
        line.translationTime = best.t;
        line.translationSource = best.source || 'tlyric';
        line.translationMatch = assignments[key].phase || 'time';
      }
    }
  });
  return primary;
}

function parseYrcText(text) {
  var lines = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var m = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) return;
    var lineStartMs = parseInt(m[1], 10) || 0;
    var lineDurMs = parseInt(m[2], 10) || 0;
    var body = m[3] || '';
    var words = [], fullText = '';
    var reg = /\((\d+),(\d+),\d+\)([^()]*)/g, wm;
    while ((wm = reg.exec(body))) {
      var txt = (wm[3] || '').replace(/\s+/g, ' ');
      if (!txt) continue;
      var rawStart = parseInt(wm[1], 10) || 0;
      var rawDur = parseInt(wm[2], 10) || 0;
      var absStartMs = rawStart >= lineStartMs - 500 ? rawStart : lineStartMs + rawStart;
      var c0 = fullText.length;
      fullText += txt;
      words.push({ text: txt, t: absStartMs / 1000, d: Math.max(0.06, rawDur / 1000), c0: c0, c1: fullText.length });
    }
    if (!fullText) fullText = body.replace(/\(\d+,\d+,\d+\)/g, '').replace(/\s+/g, ' ');
    var leading = (fullText.match(/^\s+/) || [''])[0].length;
    fullText = fullText.replace(/\s+/g, ' ').trim();
    if (!fullText) return;
    if (words.length) {
      words.forEach(function (w) {
        w.c0 = Math.max(0, Math.min(fullText.length, w.c0 - leading));
        w.c1 = Math.max(w.c0, Math.min(fullText.length, w.c1 - leading));
      });
      words = words.filter(function (w) { return w.c1 > w.c0; });
    }
    lines.push({ t: lineStartMs / 1000, duration: lineDurMs / 1000, text: fullText, words: words, charCount: Math.max(1, fullText.length), source: words.length ? 'yrc-word' : 'yrc-line' });
  });
  return finalizeLyricLineDurations(lines);
}

function renderLyrics(options) {
  options = options || {};
  var renderSignature = typeof stageLyricRenderSignatureForCurrentState === 'function' ? stageLyricRenderSignatureForCurrentState() : '';
  if (options.preserveSame && typeof stageLyricCanPreserveSameRender === 'function' && stageLyricCanPreserveSameRender(renderSignature)) {
    if (typeof markStageLyricsPlaybackResume === 'function') markStageLyricsPlaybackResume(options.reason || 'preserve-same-lyrics');
    return;
  }
  var fallbackTitleOnly = lyricsAreFallbackTitleOnly(lyricsLines);
  var warmupReason = fallbackTitleOnly ? 'renderLyrics-title' : 'renderLyrics';
  var restoreWarmup = typeof stageLyricRestoreWarmupSeconds === 'function' && stageLyricRestoreWarmupSeconds() != null;
  var prewarmReason = restoreWarmup ? 'startup-restore-lyrics' : warmupReason;
  if (typeof invalidateStageLyricPayloadForNewLyrics === 'function') invalidateStageLyricPayloadForNewLyrics('renderLyrics');
  else clearStageLyrics();
  if (typeof stageLyrics !== 'undefined' && stageLyrics && renderSignature) stageLyrics.renderSignature = renderSignature;
  if (typeof requestStageLyricWarmup === 'function') requestStageLyricWarmup(prewarmReason, fallbackTitleOnly ? 120 : 900);
  if (restoreWarmup && typeof scheduleStageLyricRestorePrewarm === 'function') {
    scheduleStageLyricRestorePrewarm(prewarmReason, fallbackTitleOnly ? 40 : 16);
  } else if (typeof scheduleStageLyricPrewarm === 'function') {
    scheduleStageLyricPrewarm(warmupReason, fallbackTitleOnly ? 56 : 32);
  }
  if (!fallbackTitleOnly && typeof scheduleStageLyricSingleLineBootstrapPrewarm === 'function') {
    scheduleStageLyricSingleLineBootstrapPrewarm(prewarmReason, restoreWarmup ? 24 : 44);
  }
  if (!fallbackTitleOnly && typeof scheduleStageLyricFullTrackWarmup === 'function') {
    scheduleStageLyricFullTrackWarmup(restoreWarmup ? 'track-ready-fast' : 'lyrics-ready-preload', restoreWarmup ? 120 : 24);
  }
  // v8: 歌词渲染由 stageLyrics 在每帧 tickLyricsParticles 里推动
}

function toggleLyricsPanel(force) {
  if (force === false) fx.particleLyrics = false;
  else if (force === true) fx.particleLyrics = true;
  else fx.particleLyrics = !fx.particleLyrics;
  if (fx.particleLyrics) {
    createLyricsParticles();
    if (typeof requestStageLyricWarmup === 'function') requestStageLyricWarmup('toggleLyricsPanel', 150);
    if (typeof scheduleStageLyricPrewarm === 'function') scheduleStageLyricPrewarm('toggleLyricsPanel', 48);
    if (typeof scheduleStageLyricFullTrackWarmup === 'function') scheduleStageLyricFullTrackWarmup('track-ready', 220);
    showToast('歌词已开启');
  } else {
    clearStageLyrics();
    showToast('歌词已关闭');
  }
  lyricsVisible = fx.particleLyrics;
}

function updateLyricsHighlight() { /* v8: 由 tickLyricsParticles 接管 */ }

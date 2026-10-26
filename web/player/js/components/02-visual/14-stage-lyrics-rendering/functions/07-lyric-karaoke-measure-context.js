'use strict';


function lyricKaraokeMeasureContext() {
  if (!lyricKaraokeMeasureCanvas) lyricKaraokeMeasureCanvas = document.createElement('canvas');
  return lyricKaraokeMeasureCanvas.getContext('2d');
}

function lyricKaraokeMetricsKey(line) {
  return [
    line && line.text || '',
    line && line.words && line.words.length || 0,
    normalizeLyricFontKey(fx && fx.lyricFont),
    Math.round(lyricFontWeightValue()),
    Math.round((Number(fx && fx.lyricLetterSpacing) || 0) * 10000)
  ].join('|');
}

function lyricKaraokeWordRanges(line) {
  if (!line || !line.words || !line.words.length || !line.text) return null;
  var key = lyricKaraokeMetricsKey(line);
  if (line._karaokeMetricKey === key && Array.isArray(line._karaokeWordRanges)) return line._karaokeWordRanges;
  var ctx = lyricKaraokeMeasureContext();
  var text = String(line.text || '');
  var fontSize = 128;
  var fullWidth = Math.max(1, lyricMeasureTextAtSize(ctx, text, fontSize, lyricFontWeightValue()));
  var ranges = line.words.map(function (w) {
    var c0 = Math.max(0, Math.min(text.length, Math.floor(Number(w.c0) || 0)));
    var c1 = Math.max(c0, Math.min(text.length, Math.ceil(Number(w.c1) || c0)));
    var p0 = lyricMeasureTextAtSize(ctx, text.slice(0, c0), fontSize, lyricFontWeightValue()) / fullWidth;
    var p1 = lyricMeasureTextAtSize(ctx, text.slice(0, c1), fontSize, lyricFontWeightValue()) / fullWidth;
    if (!isFinite(p0)) p0 = c0 / Math.max(1, line.charCount || text.length);
    if (!isFinite(p1)) p1 = c1 / Math.max(1, line.charCount || text.length);
    return {
      p0: clampRange(p0, 0, 1),
      p1: clampRange(Math.max(p1, p0), 0, 1)
    };
  });
  line._karaokeMetricKey = key;
  line._karaokeWordRanges = ranges;
  return ranges;
}

function lyricLineHasNativeKaraoke(line) {
  return !!(line && Array.isArray(line.words) && line.words.length && Number(line.charCount) > 0);
}

function getLyricLineProgress(line, nextLine, now) {
  if (!line) return 0;
  if (lyricLineHasNativeKaraoke(line)) {
    now = Math.max(0, Number(now) || 0);
    var ranges = lyricKaraokeWordRanges(line);
    var lastP = 0;
    for (var i = 0; i < line.words.length; i++) {
      var w = line.words[i];
      var ws = w.t;
      var we = w.t + Math.max(0.08, w.d || 0.24);
      if (now < ws) return lastP;
      var local = now >= we ? 1 : (now - ws) / Math.max(0.08, we - ws);
      local = Math.max(0, Math.min(1, local));
      var range = ranges && ranges[i] || null;
      var p0 = range ? range.p0 : ((w.c0 || 0) / line.charCount);
      var p1 = range ? range.p1 : ((w.c1 || 0) / line.charCount);
      var p = p0 + (p1 - p0) * local;
      lastP = Math.max(lastP, p);
      if (now < we) return lastP;
    }
    return 1;
  }
  now += 0.020;
  var nextT = nextLine && nextLine.t > line.t ? nextLine.t : Math.min((audio && audio.duration) || now + 4, line.t + (line.duration || 4.8));
  var span = Math.max(0.75, nextT - line.t);
  var prog = Math.max(0, Math.min(1, (now - line.t) / span));
  return prog * prog * (3 - 2 * prog);
}


function lyricLineDisplayTextAt(index) {
  var line = lyricsLines && lyricsLines[index];
  return normalizeStageLyricText(line && line.text);
}

function lyricLineTranslationTextAt(index) {
  var line = lyricsLines && lyricsLines[index];
  return normalizeLyricTranslationText(line && line.translation);
}

function stageLyricContextEntry(index, currentIndex) {
  var line = lyricsLines && lyricsLines[index];
  var text = lyricLineDisplayTextAt(index);
  if (!text) return null;
  var delta = index - currentIndex;
  var abs = Math.abs(delta);
  var translation = normalizeLyricTranslationText(line && line.translation);
  if (delta === 0) return { text: text, role: 'current', alpha: 1, scale: 1, translation: translation, lineIndex: index, virtualIndex: lyricPrimaryVirtualIndex(index) };
  var mode = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode);
  var contextOpacity = lyricContextOpacityValue();
  var nearAlpha = mode === 'cinema' ? contextOpacity : contextOpacity * 0.92;
  var farAlpha = mode === 'cinema' ? contextOpacity * 0.64 : contextOpacity * 0.52;
  var nearScale = mode === 'cinema' ? 0.90 : 0.88;
  var farScale = mode === 'cinema' ? 0.82 : 0.78;
  return {
    text: text,
    role: delta < 0 ? 'prev' : 'next',
    alpha: clampRange(abs > 1 ? farAlpha : nearAlpha, 0.18, 0.92),
    scale: abs > 1 ? farScale : nearScale,
    translation: translation,
    lineIndex: index,
    virtualIndex: lyricPrimaryVirtualIndex(index)
  };
}

function makeStageLyricTranslationEntry(entry, isCurrent) {
  var text = normalizeLyricTranslationText(entry && entry.translation);
  if (!text) return null;
  var parentRole = entry.role || 'context';
  var scale = lyricTranslationScaleValue();
  var parentIndex = entry && entry.lineIndex != null
    ? Number(entry.lineIndex)
    : (entry && entry.parentIndex != null
      ? Number(entry.parentIndex)
      : (entry && entry.virtualIndex != null ? Number(entry.virtualIndex) : 0));
  var baseAlpha = entry.alpha == null ? (isCurrent ? 1 : 0.58) : entry.alpha;
  return {
    text: text,
    role: 'translation',
    parentRole: parentRole,
    translationLine: true,
    alpha: isCurrent ? clampRange(lyricTranslationOpacityValue() + 0.08, 0.48, 1) : clampRange(baseAlpha * 0.62, 0.24, 0.60),
    scale: isCurrent ? clampRange(scale * 1.08, 0.70, 1.12) : clampRange(scale * 0.92, 0.50, 0.96),
    weight: 650,
    lineOffset: 0,
    parentIndex: parentIndex,
    lineIndex: entry && entry.lineIndex != null ? Number(entry.lineIndex) : undefined,
    virtualIndex: lyricTranslationVirtualIndex(parentIndex)
  };
}

function applyLyricTranslationModeToEntries(entries, activeLine, maxRowsOverride) {
  entries = Array.isArray(entries) ? entries : [];
  activeLine = Math.max(0, Math.min(entries.length - 1, activeLine || 0));
  var mode = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode);
  if (mode === 'off' || !entries.length) return { entries: entries, activeLine: activeLine };
  var activeEntry = entries[activeLine];
  var activeTranslation = makeStageLyricTranslationEntry(activeEntry, true);
  if (!activeTranslation) return { entries: entries, activeLine: activeLine };
  if (mode === 'dual') {
    if (entries.length <= 1) return { entries: [activeEntry, activeTranslation], activeLine: 0 };
    var dualOut = [];
    var dualActiveLine = 0;
    for (var di = 0; di < entries.length; di++) {
      var dualEntry = entries[di];
      if (di === activeLine) dualActiveLine = dualOut.length;
      dualOut.push(dualEntry);
      if (di === activeLine) {
        dualOut.push(activeTranslation);
      } else if (di === activeLine + 1) {
        var nextTranslation = makeStageLyricTranslationEntry(dualEntry, false);
        if (nextTranslation) dualOut.push(nextTranslation);
      }
    }
    return { entries: dualOut, activeLine: dualActiveLine };
  }
  var out = [];
  var nextActiveLine = 0;
  var maxRows = Math.max(1, Math.round(Number(maxRowsOverride) || 10));
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (out.length >= maxRows) break;
    if (i === activeLine) nextActiveLine = out.length;
    out.push(entry);
    var shouldTranslate = i === activeLine || mode === 'multi';
    if (shouldTranslate && out.length < maxRows) {
      var tr = makeStageLyricTranslationEntry(entry, i === activeLine);
      if (tr) out.push(tr);
    }
  }
  return { entries: out.length ? out : entries, activeLine: nextActiveLine };
}

function applyLyricTranslationModeToTrackEntries(entries, activeLine, maxRowsOverride) {
  entries = Array.isArray(entries) ? entries : [];
  activeLine = Math.max(0, Math.min(entries.length - 1, activeLine || 0));
  var mode = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode);
  if (mode === 'off' || !entries.length) return { entries: entries, activeLine: activeLine };
  var maxRows = Math.max(1, Math.round(Number(maxRowsOverride) || 24));
  var out = [];
  var nextActiveLine = 0;
  for (var i = 0; i < entries.length && out.length < maxRows; i++) {
    var entry = entries[i];
    var isCurrentEntry = i === activeLine;
    if (isCurrentEntry) nextActiveLine = out.length;
    var rowEntry = isCurrentEntry
      ? cloneStageLyricEntryForLayer(entry, { role: 'current', alpha: 1, scale: 1 })
      : entry;
    out.push(rowEntry);
    var shouldTranslate = mode !== 'off';
    if (shouldTranslate && out.length < maxRows) {
      var tr = makeStageLyricTranslationEntry(rowEntry, isCurrentEntry);
      if (tr) out.push(tr);
    }
  }
  return { entries: out.length ? out : entries, activeLine: nextActiveLine };
}

function stageLyricTrackKeyForMode(mode) {
  mode = normalizeLyricDisplayMode(mode);
  var first = lyricsLines && lyricsLines[0];
  var last = lyricsLines && lyricsLines.length ? lyricsLines[lyricsLines.length - 1] : null;
  var song = Array.isArray(playQueue) && currentIdx >= 0 && playQueue[currentIdx] ? playQueue[currentIdx] : null;
  var songKey = song ? (typeof songProviderKey === 'function' ? songProviderKey(song) : String(song.id || song.mid || song.name || '')) : '';
  return [
    'track',
    songKey,
    stageLyricTrackGeneration,
    mode,
    normalizeLyricTranslationMode(fx && fx.lyricTranslationMode),
    lyricDisplayLineCountForMode(mode),
    Math.round(lyricContextOpacityValue() * 100),
    Math.round(lyricTranslationGapValue() * 100),
    Math.round(lyricTranslationScaleValue() * 100),
    Math.round(lyricTranslationOpacityValue() * 100),
    lyricsLines ? lyricsLines.length : 0,
    first ? Math.round((first.t || 0) * 1000) : 0,
    last ? Math.round((last.t || 0) * 1000) : 0,
    first ? normalizeStageLyricText(first.text).slice(0, 16) : '',
    last ? normalizeStageLyricText(last.text).slice(0, 16) : '',
    lyricsTranslationLines ? lyricsTranslationLines.length : 0,
    first ? normalizeLyricTranslationText(first.translation).slice(0, 16) : '',
    last ? normalizeLyricTranslationText(last.translation).slice(0, 16) : ''
  ].join('|');
}

function stageLyricTrackBaseEntry(index) {
  var line = lyricsLines && lyricsLines[index];
  var text = lyricLineDisplayTextAt(index);
  if (!text) return null;
  return {
    text: text,
    role: 'context',
    alpha: clampRange(lyricContextOpacityValue(), 0.18, 0.92),
    scale: 0.88,
    translation: normalizeLyricTranslationText(line && line.translation),
    lineIndex: index,
    virtualIndex: lyricPrimaryVirtualIndex(index)
  };
}

function lyricMeshTrackWindow(index, mode, options) {
  options = options || {};
  var last = lyricsLines && lyricsLines.length ? lyricsLines.length - 1 : -1;
  if (last < 0) return { start: 0, end: -1 };
  var idx = Math.max(0, Math.min(last, Math.round(Number(index) || 0)));
  mode = normalizeLyricDisplayMode(mode);
  var lineCount = lyricDisplayLineCountForMode(mode);
  var translationMode = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode);
  var hasTranslations = translationMode !== 'off';
  var total = last + 1;
  var lightweightTrack = !!options.lightweightTrack;
  if (lightweightTrack) {
    var denseMultiLine = mode !== 'single' || translationMode === 'multi' || translationMode === 'dual';
    var lightFullTrackLimit = hasTranslations ? (denseMultiLine ? 6 : 10) : (denseMultiLine ? 10 : 14);
    if (total <= lightFullTrackLimit) return { start: 0, end: last, lightweight: true };
    var lightPageSize = Math.ceil(lineCount * (hasTranslations ? (denseMultiLine ? 0.88 : 1.22) : (denseMultiLine ? 0.96 : 1.12))) + (hasTranslations ? (denseMultiLine ? 4 : 5) : (denseMultiLine ? 5 : 6));
    if (mode === 'cinema' || mode === 'custom') lightPageSize += Math.ceil(lineCount * 0.30);
    var lightMin = denseMultiLine ? Math.max(lineCount + 2, hasTranslations ? 8 : 9) : (hasTranslations ? 9 : 10);
    var lightMax = denseMultiLine ? Math.max(lightMin, hasTranslations ? lineCount + 4 : lineCount + 6) : (hasTranslations ? 18 : 24);
    lightPageSize = Math.max(lightMin, Math.min(total, lightPageSize));
    lightPageSize = Math.min(lightPageSize, lightMax);
    var lightOverlap = Math.max(2, Math.ceil(lineCount * (hasTranslations ? (denseMultiLine ? 0.30 : 0.45) : (denseMultiLine ? 0.26 : 0.35))) + 2);
    lightOverlap = Math.min(Math.floor(lightPageSize * 0.30), lightOverlap);
    var lightStep = Math.max(5, lightPageSize - lightOverlap);
    var lightStart = Math.floor(idx / lightStep) * lightStep - lightOverlap;
    lightStart = Math.max(0, lightStart);
    var lightEnd = Math.min(last, lightStart + lightPageSize - 1);
    if (lightEnd - lightStart + 1 < lightPageSize && lightStart > 0) lightStart = Math.max(0, lightEnd - lightPageSize + 1);
    return { start: lightStart, end: lightEnd, lightweight: true };
  }
  var denseFullMultiLine = mode !== 'single' || translationMode === 'multi' || translationMode === 'dual';
  var fullTrackLimit = hasTranslations ? (denseFullMultiLine ? 180 : 220) : (denseFullMultiLine ? 260 : 320);
  if (total <= fullTrackLimit) return { start: 0, end: last };
  var pageSize = hasTranslations ? (denseFullMultiLine ? 180 : 152) : (denseFullMultiLine ? 260 : 216);
  if (mode === 'cinema' || mode === 'custom') pageSize += Math.ceil(lineCount * 2.2);
  pageSize = Math.max(pageSize, Math.ceil(lineCount * (hasTranslations ? 7.2 : 6.2)) + (hasTranslations ? 42 : 52));
  pageSize = Math.max(denseFullMultiLine ? 160 : 96, Math.min(total, pageSize));
  var overlap = Math.max(denseFullMultiLine ? 64 : 36, Math.ceil(lineCount * (hasTranslations ? 3.4 : 2.8)) + 22);
  overlap = Math.min(Math.floor(pageSize * 0.58), overlap);
  var step = Math.max(48, pageSize - overlap);
  var start = Math.floor(idx / step) * step - overlap;
  start = Math.max(0, start);
  var end = Math.min(last, start + pageSize - 1);
  if (end - start + 1 < pageSize && start > 0) start = Math.max(0, end - pageSize + 1);
  return { start: start, end: end };
}

function buildStageLyricMeshTrackEntries(index, mode, options) {
  mode = normalizeLyricDisplayMode(mode);
  if (!lyricsLines || !lyricsLines.length || index < 0) return { entries: [], activeLine: 0, start: 0, end: -1 };
  var windowInfo = lyricMeshTrackWindow(index, mode, options);
  var start = windowInfo.start;
  var end = windowInfo.end;
  var entries = [];
  var activeLine = 0;
  for (var i = start; i <= end; i++) {
    var entry = stageLyricTrackBaseEntry(i);
    if (!entry) continue;
    if (i === index) activeLine = entries.length;
    entries.push(entry);
  }
  if (!entries.length) return { entries: [], activeLine: 0, start: start, end: end };
  var translated = applyLyricTranslationModeToTrackEntries(entries, activeLine, entries.length * 2 + 2);
  var lineMap = {};
  for (var ri = 0; ri < translated.entries.length; ri++) {
    var row = translated.entries[ri];
    if (row && !row.translationLine && row.lineIndex != null && isFinite(Number(row.lineIndex))) lineMap[Number(row.lineIndex)] = ri;
  }
  return {
    entries: translated.entries,
    activeLine: isFinite(Number(lineMap[Math.max(0, Math.round(Number(index) || 0))])) ? Number(lineMap[Math.max(0, Math.round(Number(index) || 0))]) : translated.activeLine,
    start: start,
    end: end,
    lightweight: !!windowInfo.lightweight
  };
}

function lyricBufferedTrackWindow(index, mode) {
  var last = lyricsLines && lyricsLines.length ? lyricsLines.length - 1 : -1;
  if (last < 0) return { start: 0, end: -1 };
  // The steady multi-line path must be one mesh for the entire song.  The
  // lightweight first paint is still allowed to use a small page, but once
  // this cooperative build takes over, changing lyric lines must only move
  // the existing scroll target rather than swapping in a new page.
  return { start: 0, end: last };
}

function buildStageLyricTrackEntries(index, mode) {
  mode = normalizeLyricDisplayMode(mode);
  if (!lyricsLines || !lyricsLines.length || index < 0) return { entries: [], activeLine: 0, start: 0, end: -1 };
  var windowInfo = lyricBufferedTrackWindow(index, mode);
  var cacheKey = stageLyricTrackKeyForMode(mode) + '|win=' + windowInfo.start + '-' + windowInfo.end;
  if (stageLyricTrackCache && stageLyricTrackCache.key === cacheKey && Array.isArray(stageLyricTrackCache.entries)) {
    var cachedLine = stageLyricTrackCache.lineMap && stageLyricTrackCache.lineMap[Math.max(0, Math.round(Number(index) || 0))];
    return {
      entries: stageLyricTrackCache.entries,
      activeLine: isFinite(Number(cachedLine)) ? Number(cachedLine) : 0,
      start: stageLyricTrackCache.start,
      end: stageLyricTrackCache.end,
      lightweight: !!stageLyricTrackCache.lightweight
    };
  }
  var start = windowInfo.start;
  var end = windowInfo.end;
  var entries = [];
  var activeLine = 0;
  for (var i = start; i <= end; i++) {
    var entry = stageLyricTrackBaseEntry(i);
    if (!entry) continue;
    if (i === index) activeLine = entries.length;
    entries.push(entry);
  }
  if (!entries.length) return { entries: [], activeLine: 0, start: start, end: end };
  var translated = applyLyricTranslationModeToTrackEntries(entries, activeLine, entries.length * 2 + 2);
  var lineMap = {};
  for (var ri = 0; ri < translated.entries.length; ri++) {
    var row = translated.entries[ri];
    if (row && !row.translationLine && row.lineIndex != null && isFinite(Number(row.lineIndex))) lineMap[Number(row.lineIndex)] = ri;
  }
  stageLyricTrackCache = { key: cacheKey, entries: translated.entries, lineMap: lineMap, start: start, end: end, lightweight: false };
  return {
    entries: translated.entries,
    activeLine: isFinite(Number(lineMap[Math.max(0, Math.round(Number(index) || 0))])) ? Number(lineMap[Math.max(0, Math.round(Number(index) || 0))]) : translated.activeLine,
    start: start,
    end: end,
    lightweight: false
  };
}
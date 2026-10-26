'use strict';


function clearCustomCoverForCurrent() {
  var song = currentCoverSong();
  if (!song) {
    showToast('先播放或选择一首歌');
    updateCustomCoverButton();
    return;
  }
  var custom = getCustomCoverForSong(song);
  if (!custom) {
    showToast('当前没有自定义封面');
    updateCustomCoverButton();
    return;
  }
  var key = songCustomCoverKey(song);
  if (key && customCoverMap[key]) {
    delete customCoverMap[key];
    saveCustomCoverMap();
  }
  delete playlistCoverCache[custom];
  delete song.customCover;
  if (key) {
    for (var i = 0; i < playQueue.length; i++) {
      if (songCustomCoverKey(playQueue[i]) === key) delete playQueue[i].customCover;
    }
  }
  if (key && currentLocalSong && songCustomCoverKey(currentLocalSong) === key) delete currentLocalSong.customCover;
  if (currentIdx >= 0 && playQueue[currentIdx] && playQueue[currentIdx].cover) loadCoverFromUrl(coverUrlWithSize(playQueue[currentIdx].cover, 400));
  else loadCoverFromUrl('');
  safeRenderQueuePanel('custom-cover-clear', { scrollCurrent: miniQueueOpen });
  safeShelfRebuild('custom-cover-clear');
  updateCustomCoverButton();
  showToast('已恢复默认封面');
}

function readCustomLyricMap() {
  try {
    var raw = JSON.parse(localStorage.getItem(CUSTOM_LYRIC_STORE_KEY) || '{}') || {};
    var out = {};
    Object.keys(raw).forEach(function (key) {
      var item = raw[key];
      if (typeof item === 'string') out[key] = { text: item, updatedAt: 0 };
      else if (item && typeof item.text === 'string') out[key] = { text: item.text, updatedAt: item.updatedAt || 0 };
    });
    return out;
  } catch (e) {
    return {};
  }
}

function saveCustomLyricMap() {
  try {
    localStorage.setItem(CUSTOM_LYRIC_STORE_KEY, JSON.stringify(customLyricMap || {}));
    return true;
  } catch (e) {
    console.warn('custom lyric save failed:', e);
    return false;
  }
}

function readCustomLyricPrefs() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_LYRIC_PREF_STORE_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}

function saveCustomLyricPrefs() {
  try { localStorage.setItem(CUSTOM_LYRIC_PREF_STORE_KEY, JSON.stringify(customLyricPrefs || {})); } catch (e) { }
}

function songCustomLyricKey(song) {
  return songCustomCoverKey(song);
}

function currentLyricSong() {
  if (currentIdx >= 0 && playQueue[currentIdx]) return playQueue[currentIdx];
  return currentLocalSong || null;
}

function trackDetailLyricKey(song) {
  if (!song) return '';
  var p = typeof normalizePlaybackProvider === 'function' ? normalizePlaybackProvider(songProviderKey(song)) : songProviderKey(song);
  var id = p === 'qq' ? song.mid || song.songmid || song.id : p === 'kugou' ? song.hash || song.id :
    p === 'qishui' ? song.providerSongId || song.id : song.id || song.localKey;
  return id ? p + ':' + id : '';
}

function trackDetailLyricInfo(song, lines, status, message, provider) {
  var names = {netease: '网易云音乐', qq: 'QQ 音乐', kugou: '酷狗音乐', qishui: '汽水音乐', local: '本地文件'};
  return {provider: provider, sourceLabel: status === 'custom' ? '自定义歌词' : (names[provider] || '当前音源'),
    status: status, message: message || '', lines: (lines || []).filter(function (line) {
      return line && !line.fallback && String(line.text || '').trim() && !isNoLyricText(line.text);
    }).map(function (line) { return {time: Number(line.t) || 0, text: String(line.text), translation: line.translation || line.trans || ''}; })};
}

async function loadTrackDetailLyrics(song, options) {
  options = options || {};
  var key = trackDetailLyricKey(song);
  var provider = key.split(':')[0];
  if (!song || !key) return trackDetailLyricInfo(song, [], 'unavailable', '当前歌曲缺少歌词标识', provider);
  var isCurrent = trackDetailLyricKey(currentLyricSong()) === key;
  var custom = typeof getCustomLyricEntry === 'function' ? getCustomLyricEntry(song) : null;
  var preferCustom = custom && (isCurrent ? lyricSourceMode === 'custom' : customLyricPrefs[songCustomLyricKey(song)] === 'custom');
  if (preferCustom) return trackDetailLyricInfo(song, parseCustomLyricText(custom.text), 'custom', '', provider);
  if (!options.force && isCurrent && typeof originalLyricsState !== 'undefined' && originalLyricsState
      && hasUsableLyricLines(originalLyricsState.lines)) {
    return trackDetailLyricInfo(song, originalLyricsState.lines, 'ready', '', provider);
  }
  if (song.type === 'local' || song.source === 'local' || song.localUrl) {
    return trackDetailLyricInfo(song, [], 'unavailable', '本地歌曲未导入歌词，可在歌词设置中导入', 'local');
  }
  var state = loadTrackDetailLyrics.state || (loadTrackDetailLyrics.state = {cache: new Map(), pending: new Map()});
  // 同一平台换账号时不复用旧授权请求的结果。
  var accountScope = '';
  if (window.localMusicCredentials && typeof window.localMusicCredentials.headers === 'function') {
    try { accountScope = JSON.stringify(window.localMusicCredentials.headers(lyricEndpointForSong(song)) || {}); } catch (_) { }
  }
  var cacheKey = key + '|' + accountScope;
  var cached = state.cache.get(cacheKey);
  if (!options.force && cached && Date.now() - cached.at < 60000) return cached.value;
  if (state.pending.has(cacheKey)) return state.pending.get(cacheKey);
  var request = (async function () {
    try {
      var response = await (typeof requestTrackDetailJson==='function'
        ? requestTrackDetailJson(lyricEndpointForSong(song),{timeoutMs:10000})
        : apiJson(lyricEndpointForSong(song),{timeoutMs:10000}));
      if (!response || response.ok === false || response.error) throw new Error('歌词获取失败');
      var merged = typeof mergeInlineLyricResponseForSong === 'function' ? mergeInlineLyricResponseForSong(song, response) : response;
      var parsed = parseLyricResponseToOriginalState(song, merged);
      var instrumental = response.nolyric === true || /纯音乐|没有填词/.test(String(response.lyric || '')) && !parsed.usableLyric;
      var status = parsed.usableLyric ? 'ready' : instrumental ? 'instrumental' : 'unavailable';
      var message = status === 'unavailable' ? '暂无歌词' : '';
      var info = trackDetailLyricInfo(song, parsed.lines, status, message, provider);
      state.cache.set(cacheKey, {at: Date.now(), value: info});
      if (state.cache.size > 60) state.cache.delete(state.cache.keys().next().value);
      return info;
    } catch (_) {
      return trackDetailLyricInfo(song, [], 'error', '歌词获取失败，请重试', provider);
    } finally { state.pending.delete(cacheKey); }
  }());
  state.pending.set(cacheKey, request);
  return request;
}

function getCustomLyricEntry(song) {
  var key = songCustomLyricKey(song);
  return key && customLyricMap[key] ? customLyricMap[key] : null;
}

function hasCustomLyricForSong(song) {
  var entry = getCustomLyricEntry(song);
  return !!(entry && String(entry.text || '').trim());
}

function cloneLyricLine(line) {
  var copy = Object.assign({}, line || {});
  if (line && Array.isArray(line.words)) copy.words = line.words.map(function (w) { return Object.assign({}, w); });
  return copy;
}

function cloneLyricLines(lines) {
  return (Array.isArray(lines) ? lines : []).map(cloneLyricLine);
}

function lyricLineSignaturePart(line) {
  line = line || {};
  var words = Array.isArray(line.words) ? line.words : [];
  var firstWord = words[0] || {};
  var lastWord = words[words.length - 1] || {};
  return [
    Math.round((Number(line.t) || 0) * 1000),
    Math.round((Number(line.duration) || 0) * 1000),
    String(line.text || ''),
    line.fallback ? 1 : 0,
    String(line.source || ''),
    words.length,
    Math.round((Number(firstWord.t) || 0) * 1000),
    Math.round((Number(firstWord.d) || 0) * 1000),
    Math.round((Number(lastWord.t) || 0) * 1000),
    Math.round((Number(lastWord.d) || 0) * 1000),
    String(line.translation || '')
  ].join('\u001f');
}

function lyricLinesSignature(lines) {
  return (Array.isArray(lines) ? lines : []).map(lyricLineSignaturePart).join('\u001e');
}

function currentAppliedLyricRenderSignature() {
  var song = typeof currentLyricSong === 'function' ? currentLyricSong() : null;
  var songKey = songCustomLyricKey(song) || (song && (song.provider || song.source || '') + ':' + (song.id || song.mid || song.hash || song.name || '')) || '';
  return [
    songKey,
    lyricSourceMode || 'original',
    lyricsHasNativeKaraoke ? 1 : 0,
    lyricsTimingSource || '',
    lyricsTranslationSource || '',
    lyricLinesSignature(lyricsLines),
    lyricLinesSignature(lyricsTranslationLines)
  ].join('\u001d');
}

function preparedLyricStateForApply(lines, hasNativeKaraoke, timingSource, translationLines, translationSource) {
  var nextLines = Array.isArray(lines) ? lines : [];
  var nextTranslations = Array.isArray(translationLines) ? translationLines : [];
  var nextTiming = timingSource || 'fallback';
  var nextTranslationSource = translationSource || (nextTranslations.length ? 'translation' : 'none');
  if (!nextLines.length) nextLines = withLyricFallback([]);
  if (nextLines.length && nextLines[0].fallback) nextTiming = 'fallback';
  return {
    lines: nextLines,
    hasNativeKaraoke: !!hasNativeKaraoke,
    timingSource: nextTiming,
    translationLines: nextTranslations,
    translationSource: nextTranslationSource,
    signature: lyricStateRenderSignature(nextLines, hasNativeKaraoke, nextTiming, nextTranslations, nextTranslationSource)
  };
}

function lyricStateRenderSignature(lines, hasNativeKaraoke, timingSource, translationLines, translationSource) {
  var song = typeof currentLyricSong === 'function' ? currentLyricSong() : null;
  var songKey = songCustomLyricKey(song) || (song && (song.provider || song.source || '') + ':' + (song.id || song.mid || song.hash || song.name || '')) || '';
  return [
    songKey,
    lyricSourceMode || 'original',
    hasNativeKaraoke ? 1 : 0,
    timingSource || '',
    translationSource || '',
    lyricLinesSignature(lines),
    lyricLinesSignature(translationLines)
  ].join('\u001d');
}

function skipSameLyricStateRender(prepared, renderOptions, reason) {
  if (!renderOptions || !renderOptions.preserveSame || !prepared || !prepared.signature) return false;
  if (prepared.signature !== currentAppliedLyricRenderSignature()) return false;
  if (typeof markStageLyricsPlaybackResume === 'function') markStageLyricsPlaybackResume(renderOptions.reason || reason || 'same-lyrics-state');
  return true;
}

function setOriginalLyricsState(lines, hasNativeKaraoke, timingSource, translationLines, translationSource) {
  originalLyricsState = {
    lines: cloneLyricLines(lines || []),
    hasNativeKaraoke: !!hasNativeKaraoke,
    timingSource: timingSource || 'fallback',
    translationLines: cloneLyricLines(translationLines || []),
    translationSource: translationSource || 'none'
  };
}

function applyLyricsState(lines, hasNativeKaraoke, timingSource, translationLines, translationSource, renderOptions) {
  var prepared = preparedLyricStateForApply(lines, hasNativeKaraoke, timingSource, translationLines, translationSource);
  if (skipSameLyricStateRender(prepared, renderOptions, 'applyLyricsState')) {
    updateCustomLyricControls();
    return;
  }
  lyricsHasNativeKaraoke = prepared.hasNativeKaraoke;
  lyricsTimingSource = prepared.timingSource;
  lyricsTranslationLines = cloneLyricLines(prepared.translationLines);
  lyricsTranslationSource = prepared.translationSource;
  lyricsLines = cloneLyricLines(prepared.lines);
  renderLyrics(renderOptions || {});
  updateCustomLyricControls();
}

function applyOriginalLyricsState(renderOptions) {
  lyricSourceMode = 'original';
  applyLyricsState(originalLyricsState.lines, originalLyricsState.hasNativeKaraoke, originalLyricsState.timingSource, originalLyricsState.translationLines, originalLyricsState.translationSource, renderOptions);
}

function parseCustomLyricText(text) {
  var raw = String(text || '').trim();
  if (!raw) return [];
  var lrcLines = parseLyricText(raw);
  if (lrcLines.length && !lrcLines.every(function (line) { return isNoLyricText(line.text); })) {
    return lrcLines.map(function (line) {
      var copy = cloneLyricLine(line);
      copy.source = 'custom-lrc';
      return copy;
    });
  }
  var rows = raw.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(function (line) { return line && !isNoLyricText(line); });
  if (!rows.length) return [];
  var duration = audio && isFinite(audio.duration) && audio.duration > 8 ? audio.duration : 0;
  var gap = duration ? Math.max(2.8, Math.min(7.2, duration / Math.max(1, rows.length))) : 4.8;
  return finalizeLyricLineDurations(rows.map(function (line, i) {
    return { t: i * gap, duration: gap, text: line, source: 'custom-text', charCount: Math.max(1, line.length) };
  }));
}

function applyCustomLyricState(song, silent, renderOptions) {
  song = song || currentLyricSong();
  var entry = getCustomLyricEntry(song);
  if (!entry || !String(entry.text || '').trim()) {
    if (!silent) openCustomLyricModal();
    updateCustomLyricControls();
    return false;
  }
  var lines = parseCustomLyricText(entry.text);
  if (!lines.length) {
    if (!silent) showToast('自定义歌词内容为空');
    updateCustomLyricControls();
    return false;
  }
  lyricSourceMode = 'custom';
  var prepared = preparedLyricStateForApply(lines, false, lines[0] && lines[0].source === 'custom-lrc' ? 'custom-lrc' : 'custom-text', [], 'none');
  if (skipSameLyricStateRender(prepared, renderOptions, 'applyCustomLyricState')) {
    updateCustomLyricControls();
    return true;
  }
  lyricsHasNativeKaraoke = prepared.hasNativeKaraoke;
  lyricsTimingSource = prepared.timingSource;
  lyricsTranslationLines = cloneLyricLines(prepared.translationLines);
  lyricsTranslationSource = prepared.translationSource;
  lyricsLines = cloneLyricLines(prepared.lines);
  renderLyrics(renderOptions || {});
  updateCustomLyricControls();
  return true;
}

function preferredLyricSourceForSong(song) {
  var key = songCustomLyricKey(song);
  var hasCustom = hasCustomLyricForSong(song);
  if (!hasCustom) return 'original';
  var pref = key ? customLyricPrefs[key] : '';
  if (pref === 'custom') return 'custom';
  if (pref === 'original') return 'original';
  return originalLyricsState.timingSource === 'fallback' ? 'custom' : 'original';
}

function applyPreferredLyricsForCurrent(silent) {
  var song = currentLyricSong();
  var renderOptions = { preserveSame: true, reason: 'applyPreferredLyricsForCurrent' };
  if (preferredLyricSourceForSong(song) === 'custom' && applyCustomLyricState(song, true, renderOptions)) return;
  applyOriginalLyricsState(renderOptions);
  if (!silent) updateCustomLyricControls();
}

function setLyricSourceMode(mode, silent) {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  mode = mode === 'custom' ? 'custom' : 'original';
  if (mode === 'custom') {
    if (!applyCustomLyricState(song, true)) {
      if (!silent) openCustomLyricModal();
      return false;
    }
    if (!silent) openCustomLyricModal();
  } else {
    applyOriginalLyricsState();
  }
  if (key) {
    customLyricPrefs[key] = mode;
    saveCustomLyricPrefs();
  }
  if (!silent) showToast(mode === 'custom' ? '已切换到自定义歌词' : '已切换到原歌词');
  updateCustomLyricControls();
  return true;
}

function updateCustomLyricControls() {
  var song = currentLyricSong();
  var hasCustom = hasCustomLyricForSong(song);
  var originalBtn = document.getElementById('lyric-source-original');
  var customBtn = document.getElementById('lyric-source-custom');
  if (originalBtn) {
    originalBtn.classList.toggle('active', lyricSourceMode !== 'custom');
    originalBtn.title = '使用当前音源平台提供的歌词';
  }
  if (customBtn) {
    customBtn.classList.toggle('active', lyricSourceMode === 'custom');
    customBtn.classList.toggle('has-custom', hasCustom);
    customBtn.title = hasCustom ? '打开并编辑自定义歌词' : '新增自定义歌词';
  }
}

function updateLyricDisplayModeControls() {
  var mode = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode);
  document.querySelectorAll('#lyric-display-mode-seg button').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function updateLyricTranslationModeControls() {
  var mode = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode);
  document.querySelectorAll('#lyric-translation-mode-seg button').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.translation === mode);
  });
}

function updateLyricMotionStyleControls() {
  var style = normalizeLyricMotionStyle(fx && fx.lyricMotionStyle);
  var seg = document.getElementById('lyric-motion-style-seg');
  if (seg) seg.classList.toggle('glitch-selected', style === 'glitch');
  document.querySelectorAll('#lyric-motion-style-seg button').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.motion === style);
  });
  updateLyricGlitchControls();
}

function updateLyricGlitchControls() {
  var style = normalizeLyricMotionStyle(fx && fx.lyricMotionStyle);
  var panel = document.getElementById('lyric-glitch-controls');
  if (panel) panel.classList.toggle('show', style === 'glitch');
  var bindBtn = document.getElementById('lyric-glitch-camera-bind');
  if (bindBtn) {
    bindBtn.classList.toggle('active', !!(fx && fx.lyricGlitchCameraBind));
    bindBtn.textContent = fx && fx.lyricGlitchCameraBind ? '已跟随鼓点故障' : '跟随鼓点故障';
  }
}

function toggleLyricGlitchCameraBind() {
  fx.lyricGlitchCameraBind = !fx.lyricGlitchCameraBind;
  updateLyricGlitchControls();
  refreshStageLyricDisplayMode();
  saveLyricLayout({ user: true, reason: 'lyricGlitchCameraBind' });
  showToast(fx.lyricGlitchCameraBind ? '故障歌词已跟随鼓点' : '故障歌词已取消鼓点跟随');
}

function refreshStageLyricDisplayMode() {
  refreshCurrentLyricStyle();
}

function refreshStageLyricVisualOptions() {
  refreshStageLyricDisplayMode();
  pushDesktopLyricsState(true);
}

function setLyricDisplayMode(mode) {
  fx.lyricDisplayMode = normalizeLyricDisplayMode(mode);
  updateLyricDisplayModeControls();
  refreshStageLyricDisplayMode();
  saveLyricLayout({ user: true, reason: 'lyricDisplayMode' });
  showToast('歌词行数已切换');
}

function setLyricTranslationMode(mode) {
  fx.lyricTranslationMode = normalizeLyricTranslationMode(mode);
  updateLyricTranslationModeControls();
  refreshStageLyricDisplayMode();
  saveLyricLayout({ user: true, reason: 'lyricTranslationMode' });
  showToast('双语翻译已切换');
}

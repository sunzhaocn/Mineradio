'use strict';

function hasUsableLyricLines(lines) {
  return (Array.isArray(lines) ? lines : []).some(function (line) {
    return line && !line.fallback && !isNoLyricText(line.text);
  });
}

function lyricTranslationTextFromAliases(source) {
  source = source || {};
  return source.tlyric || source.trans || source.translatedLyric || source.translation || source.translated_lyric || '';
}

function trackLyricRequestRuntime() {
  if (!trackLyricRequestRuntime.state) trackLyricRequestRuntime.state = { requests: new Set() };
  return trackLyricRequestRuntime.state;
}

function obsoleteLyricRequestError() {
  var error = new Error('Lyrics superseded by a new song');
  error.name = 'AbortError';
  return error;
}

function cancelObsoleteTrackLyricRequests(token) {
  trackLyricRequestRuntime().requests.forEach(function (request) {
    if (request.token !== token && request.controller) request.controller.abort();
  });
  if (typeof lyricQueuePrefetchTimer !== 'undefined' && lyricQueuePrefetchTimer) clearTimeout(lyricQueuePrefetchTimer);
  lyricQueuePrefetchTimer = 0;
  if (typeof lyricQueuePrefetchToken === 'number') lyricQueuePrefetchToken++;
  runQueueLyricPrefetch.active = null;
  lyricQueuePrefetchBusy = false;
}

async function requestTrackLyricJson(url, token, options) {
  if (token !== trackSwitchToken) throw obsoleteLyricRequestError();
  var state = trackLyricRequestRuntime();
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var request = { token: token, controller: controller };
  state.requests.add(request);
  try {
    var response = await apiJson(url, Object.assign({ timeoutMs: 8000 }, options || {}, controller ? { signal: controller.signal } : {}));
    if (token !== trackSwitchToken || controller && controller.signal.aborted) throw obsoleteLyricRequestError();
    return response;
  } finally {
    state.requests.delete(request);
  }
}

function lyricEndpointForSong(songOrId) {
  var song = (songOrId && typeof songOrId === 'object') ? songOrId : null;
  var provider = song ? songProviderKey(song) : 'netease';
  if (provider === 'qq') {
    var mid = song.mid || song.songmid || song.id || '';
    var qqId = song.qqId || (/^\d+$/.test(String(song.id || '')) ? song.id : '');
    return '/api/qq/lyric?mid=' + encodeURIComponent(mid) + '&id=' + encodeURIComponent(qqId);
  }
  if (provider === 'kugou') {
    return '/api/kugou/lyric?hash=' + encodeURIComponent(song.hash || song.fileHash || song.audioHash || song.id || '') +
      '&albumAudioId=' + encodeURIComponent(song.albumAudioId || song.album_audio_id || song.mixSongId || '') +
      '&duration=' + encodeURIComponent(playbackDurationFromSong(song) || '');
  }
  if (provider === 'qishui') {
    return '/api/qishui/lyric?id=' + encodeURIComponent(song.id || song.providerSongId || '');
  }
  if (provider === 'spotify') {
    return '/api/spotify/lyric?id=' + encodeURIComponent(song.id || song.providerSongId || song.spotifyId || '');
  }
  var songId = song ? song.id : songOrId;
  return '/api/lyric?id=' + encodeURIComponent(songId);
}


function persistentLyricCacheKey(song) {
  song = song || {};
  var provider = typeof songProviderKey === 'function' ? songProviderKey(song) : (song.source || song.provider || 'netease');
  var id = song.id || song.mid || song.songmid || song.hash || '';
  var artist = song.artist || song.singer || song.artists || '';
  return ['lyrics-v1', provider, id, song.name || song.title || '', artist].join('|');
}


function readPersistentLyricCache(song) {
  var api = window.desktopWindow && typeof window.desktopWindow.readLyricCache === 'function' ? window.desktopWindow : window.browserLocalMusic;
  if (!api || typeof api.readLyricCache !== 'function') return Promise.resolve(null);
  return api.readLyricCache(persistentLyricCacheKey(song)).then(function (result) {
    return result && result.ok && result.hit && result.payload ? result.payload : null;
  }).catch(function () { return null; });
}


function writePersistentLyricCache(song, payload) {
  var api = window.desktopWindow && typeof window.desktopWindow.writeLyricCache === 'function' ? window.desktopWindow : window.browserLocalMusic;
  if (!api || typeof api.writeLyricCache !== 'function' || !payload || typeof payload !== 'object') return;
  api.writeLyricCache(persistentLyricCacheKey(song), payload).catch(function () {});
}


function lyricQueuePrefetchCandidate(song) {
  if (!song || song.type === 'podcast' || song.type === 'local' || song.source === 'local' || song.localUrl) return false;
  return !!(song.id || song.mid || song.songmid || song.hash || song.name || song.title);
}


function nextQueueLyricPrefetchSong(fromIndex) {
  if (!Array.isArray(playQueue) || playQueue.length < 2) return null;
  var total = playQueue.length;
  var from = isFinite(Number(fromIndex)) ? Math.round(Number(fromIndex)) : currentIdx;
  for (var step = 1; step < total; step++) {
    var index = (from + step + total) % total;
    if (index === currentIdx) continue;
    var song = playQueue[index];
    if (!lyricQueuePrefetchCandidate(song)) continue;
    var key = persistentLyricCacheKey(song);
    if (!key || lyricQueuePrefetchKeys[key]) continue;
    return { song: song, key: key };
  }
  return null;
}


function scheduleQueueLyricPrefetch(fromIndex, delay) {
  if (lyricQueuePrefetchTimer) clearTimeout(lyricQueuePrefetchTimer);
  lyricQueuePrefetchTimer = 0;
  if (lyricQueuePrefetchBusy || !Array.isArray(playQueue) || playQueue.length < 2) return false;
  var token = ++lyricQueuePrefetchToken;
  var wait = Math.max(1200, Number(delay) || 2400);
  lyricQueuePrefetchTimer = setTimeout(function () {
    lyricQueuePrefetchTimer = 0;
    runQueueLyricPrefetch(fromIndex, token);
  }, wait);
  return true;
}


async function runQueueLyricPrefetch(fromIndex, token) {
  if (token !== lyricQueuePrefetchToken || lyricQueuePrefetchBusy) return false;
  if (audio && audio.paused) return false;
  var candidate = nextQueueLyricPrefetchSong(fromIndex);
  if (!candidate) return false;
  lyricQueuePrefetchKeys[candidate.key] = true;
  lyricQueuePrefetchBusy = true;
  var task = { trackToken: trackSwitchToken };
  runQueueLyricPrefetch.active = task;
  var complete = false;
  try {
    var cached = await readPersistentLyricCache(candidate.song);
    if (token !== lyricQueuePrefetchToken) return false;
    if (cached) { complete = true; return true; }
    var response = await requestTrackLyricJson(lyricEndpointForSong(candidate.song), task.trackToken);
    if (token !== lyricQueuePrefetchToken) return false;
    var merged = mergeInlineLyricResponseForSong(candidate.song, response || {});
    var state = parseLyricResponseToOriginalState(candidate.song, merged);
    if (!state || !state.usableLyric) return false;
    writePersistentLyricCache(candidate.song, merged);
    complete = true;
    return true;
  } catch (_) {
    return false;
  } finally {
    if (!complete) delete lyricQueuePrefetchKeys[candidate.key];
    if (runQueueLyricPrefetch.active === task) {
      runQueueLyricPrefetch.active = null;
      lyricQueuePrefetchBusy = false;
    }
  }
}


function applyFetchedLyricResponse(song, token, response, options) {
  options = options || {};
  if (token !== trackSwitchToken) return null;
  var mergedResponse = mergeInlineLyricResponseForSong(song, response || {});
  cancelPendingTrackFallbackLyrics();
  var state = parseLyricResponseToOriginalState(song, mergedResponse);
  setOriginalLyricsState(state.lines, state.hasNativeKaraoke, state.timingSource, state.translationLines, state.translationSource);
  applyPreferredLyricsForCurrent(true);
  scheduleNeteaseLyricTranslationFallback(song, token, state);
  if (state.usableLyric && options.persist !== false) writePersistentLyricCache(song, mergedResponse);
  return state;
}


function refreshPersistentLyricCache(song, token) {
  token = token == null ? trackSwitchToken : token;
  requestTrackLyricJson(lyricEndpointForSong(song), token).then(function (response) {
    var mergedResponse = mergeInlineLyricResponseForSong(song, response || {});
    var state = parseLyricResponseToOriginalState(song, mergedResponse);
    if (state && state.usableLyric) writePersistentLyricCache(song, mergedResponse);
  }).catch(function () {});
}

function mergeInlineLyricResponseForSong(song, response) {
  response = Object.assign({}, response || {});
  if (!response.tlyric) response.tlyric = lyricTranslationTextFromAliases(response);
  if (!song || typeof song !== 'object') return response;
  if (!response.lyric && song.lyric) response.lyric = song.lyric;
  if (!response.tlyric) response.tlyric = lyricTranslationTextFromAliases(song);
  if (!response.yrc && (song.yrc || song.qrc)) response.yrc = song.yrc || song.qrc;
  if (!response.ytlrc && song.ytlrc) response.ytlrc = song.ytlrc;
  return response;
}

function lyricTranslationFallbackKey(song) {
  song = song || {};
  return [
    simpleSearchNorm(song.name || song.title || ''),
    simpleSearchNorm(song.artist || ''),
    simpleSearchNorm(song.album || '')
  ].join('|');
}

function shouldFetchNeteaseLyricTranslationFallback(song, state) {
  if (!song || !state || !state.usableLyric) return false;
  if (song.type === 'local' || song.source === 'local' || song.localUrl || song.type === 'podcast') return false;
  if (songProviderKey(song) === 'netease') return false;
  if (state.translationLines && state.translationLines.length) return false;
  if (!String(song.name || song.title || '').trim()) return false;
  var key = lyricTranslationFallbackKey(song);
  var missedAt = lyricTranslationFallbackMissCache[key] || 0;
  return !missedAt || Date.now() - missedAt > 10 * 60 * 1000;
}

function lyricNeteaseFallbackSearchQuery(song) {
  song = song || {};
  var artist = String(song.artist || '').split(/\s*\/\s*|\s*,\s*|\s*&\s*/)[0] || '';
  return [song.name || song.title || '', artist].filter(Boolean).join(' ').trim();
}

async function findNeteaseLyricFallbackCandidate(song, token) {
  var query = lyricNeteaseFallbackSearchQuery(song);
  if (!query) return null;
  token = token == null ? trackSwitchToken : token;
  var data = await requestTrackLyricJson('/api/search?keywords=' + encodeURIComponent(query) + '&limit=8', token, { timeoutMs: 4800 });
  var list = data && (data.songs || data.result || []);
  if (!Array.isArray(list) || !list.length) return null;
  list = list.filter(function (candidate) {
    return !(typeof sourceCandidateRejectReason === 'function' && sourceCandidateRejectReason(song, candidate, 'netease'));
  });
  if (!list.length) return null;
  for (var i = 0; i < list.length; i++) {
    if (typeof isSameTitleArtist === 'function' && isSameTitleArtist(song, list[i])) return list[i];
  }
  list = list.slice().sort(function (a, b) {
    var sa = typeof scoreSongSearchResult === 'function' ? scoreSongSearchResult(a, query, 0) : 0;
    var sb = typeof scoreSongSearchResult === 'function' ? scoreSongSearchResult(b, query, 0) : 0;
    if (a && a.playable === false) sa -= 20;
    if (b && b.playable === false) sb -= 20;
    return sb - sa;
  });
  var best = list[0];
  var bestScore = typeof scoreSongSearchResult === 'function' ? scoreSongSearchResult(best, query, 0) : 0;
  return best && best.id && bestScore >= 28 ? best : null;
}

function mergeNeteaseFallbackTranslationsIntoCurrent(song, token, payload, cacheKey) {
  if (!payload || !payload.lines || !payload.lines.length) return false;
  if (token !== trackSwitchToken) return false;
  var currentSong = typeof currentLyricSong === 'function' ? currentLyricSong() : null;
  if (lyricTranslationFallbackKey(currentSong) !== cacheKey) return false;
  if (originalLyricsState && originalLyricsState.translationLines && originalLyricsState.translationLines.length) return false;
  var mergedLines = attachLyricTranslations(originalLyricsState.lines || [], payload.lines);
  var attached = mergedLines.some(function (line) { return line && line.translation; });
  if (!attached) return false;
  setOriginalLyricsState(
    mergedLines,
    originalLyricsState.hasNativeKaraoke,
    originalLyricsState.timingSource,
    payload.lines,
    'netease-fallback+' + (payload.source || 'tlyric')
  );
  applyPreferredLyricsForCurrent(true);
  return true;
}

async function fetchNeteaseLyricTranslationFallback(song, token, cacheKey) {
  if (!song || token !== trackSwitchToken) return false;
  var cached = lyricTranslationFallbackCache[cacheKey];
  if (cached) return mergeNeteaseFallbackTranslationsIntoCurrent(song, token, cached, cacheKey);
  try {
    var candidate = await findNeteaseLyricFallbackCandidate(song, token);
    if (token !== trackSwitchToken || !candidate || !candidate.id) return false;
    var response = await requestTrackLyricJson('/api/lyric?id=' + encodeURIComponent(candidate.id), token, { timeoutMs: 5200 });
    if (token !== trackSwitchToken) return false;
    var translationPayload = buildLyricTranslationPayload(response || {});
    if (!translationPayload.lines.length) {
      lyricTranslationFallbackMissCache[cacheKey] = Date.now();
      return false;
    }
    cached = {
      lines: cloneLyricLines(translationPayload.lines),
      source: translationPayload.source,
      candidateId: candidate.id,
      cachedAt: Date.now()
    };
    lyricTranslationFallbackCache[cacheKey] = cached;
    Object.keys(lyricTranslationFallbackCache).slice(0, -20).forEach(function (key) { delete lyricTranslationFallbackCache[key]; });
    return mergeNeteaseFallbackTranslationsIntoCurrent(song, token, cached, cacheKey);
  } catch (err) {
    if (token !== trackSwitchToken || err && err.name === 'AbortError') return false;
    lyricTranslationFallbackMissCache[cacheKey] = Date.now();
    console.warn('[LyricTranslationFallback]', err);
    return false;
  }
}

function scheduleNeteaseLyricTranslationFallback(song, token, state) {
  if (!shouldFetchNeteaseLyricTranslationFallback(song, state)) return;
  var cacheKey = lyricTranslationFallbackKey(song);
  var cached = lyricTranslationFallbackCache[cacheKey];
  if (cached) {
    setTimeout(function () { mergeNeteaseFallbackTranslationsIntoCurrent(song, token, cached, cacheKey); }, 0);
    return;
  }
  var start = function () {
    if (token === trackSwitchToken) fetchNeteaseLyricTranslationFallback(song, token, cacheKey);
  };
  setTimeout(function () {
    if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 1800 });
    else start();
  }, 420);
}

function lyricFallbackTextForSong(song) {
  song = song || {};
  var title = String(song.name || song.title || '').trim();
  var artist = String(song.artist || '').trim();
  if (!title && document) title = String(document.getElementById('thumb-title') && document.getElementById('thumb-title').textContent || '').trim();
  if (!artist && document) artist = String(document.getElementById('thumb-artist') && document.getElementById('thumb-artist').textContent || '').trim();
  if (!title) return '';
  return artist ? title + ' - ' + artist : title;
}

function withLyricFallbackForSong(song, lines) {
  lines = Array.isArray(lines) ? lines.filter(function (line) { return line && String(line.text || '').trim(); }) : [];
  if (lines.length && !lines.every(function (line) { return isNoLyricText(line.text); })) return lines;
  var text = lyricFallbackTextForSong(song);
  return text ? [{ t: 0, text: text, duration: 9999, charCount: Math.max(1, text.length), fallback: true }] : [];
}

function parseLyricResponseToOriginalState(song, response) {
  response = response || {};
  var nativeLines = parseYrcText(response.yrc || '');
  var lrcLines = parseLyricText(response.lyric || '');
  var translationPayload = buildLyricTranslationPayload(response);
  var translationLines = translationPayload.lines;
  var hasNativeKaraoke = nativeLines.some(function (line) { return line.words && line.words.length; });
  var timingSource = hasNativeKaraoke ? 'yrc-word' : (nativeLines.length ? 'yrc-line' : (lrcLines.length ? 'lrc-line' : 'fallback'));
  var primaryLines = nativeLines.length ? nativeLines : lrcLines;
  var lines = withLyricFallbackForSong(song, attachLyricTranslations(primaryLines, translationLines));
  if (lines.length && lines[0].fallback) timingSource = 'fallback';
  return {
    lines: cloneLyricLines(lines),
    hasNativeKaraoke: hasNativeKaraoke,
    timingSource: timingSource,
    translationLines: cloneLyricLines(translationLines),
    translationSource: translationPayload.source,
    usableLyric: hasUsableLyricLines(lines),
    cachedAt: Date.now()
  };
}

function shouldRetryStartupLyricFetch(song, token, attempt) {
  if (!song || token !== trackSwitchToken || (attempt || 0) >= 3) return false;
  if (song.type === 'local' || song.source === 'local' || song.localKey || song.type === 'podcast') return false;
  return !!(startupAutoplayPreference || restoredLastPlaybackSnapshot || pendingPlaybackResumeAt > 0);
}

function scheduleStartupLyricFetchRetry(song, token, attempt) {
  var delays = [700, 1600, 3200];
  var delay = delays[Math.max(0, Math.min(delays.length - 1, attempt || 0))];
  setTimeout(function () {
    if (token === trackSwitchToken) fetchLyric(song, token, (attempt || 0) + 1);
  }, delay);
}

function cancelPendingTrackFallbackLyrics() {
  if (pendingTrackFallbackLyricTimer) {
    clearTimeout(pendingTrackFallbackLyricTimer);
    pendingTrackFallbackLyricTimer = 0;
  }
}

function resetLyricsForTrackSwitch() {
  cancelObsoleteTrackLyricRequests(trackSwitchToken);
  cancelPendingTrackFallbackLyrics();
  setOriginalLyricsState([], false, 'pending', [], 'none');
  lyricsHasNativeKaraoke = false;
  lyricsTimingSource = 'pending';
  lyricsTranslationLines = [];
  lyricsTranslationSource = 'none';
  lyricsLines = [];
  if (typeof invalidateStageLyricPayloadForNewLyrics === 'function') invalidateStageLyricPayloadForNewLyrics('track-switch-pending');
  else if (typeof clearStageLyrics === 'function') clearStageLyrics();
  updateCustomLyricControls();
}

function scheduleTrackSwitchFallbackLyrics(song, token, delay) {
  cancelPendingTrackFallbackLyrics();
  var multiLineDelay = (typeof stageLyricMultiLineWarmupLoad === 'function' && stageLyricMultiLineWarmupLoad()) ? 1850 : 180;
  pendingTrackFallbackLyricTimer = setTimeout(function () {
    pendingTrackFallbackLyricTimer = 0;
    if (token != null && token !== trackSwitchToken) return;
    if (hasUsableLyricLines(originalLyricsState && originalLyricsState.lines)) return;
    setOriginalLyricsState(withLyricFallbackForSong(song || currentLyricSong(), []), false, 'fallback', [], 'none');
    applyPreferredLyricsForCurrent(true);
  }, Math.max(multiLineDelay, Number(delay) || 720));
}

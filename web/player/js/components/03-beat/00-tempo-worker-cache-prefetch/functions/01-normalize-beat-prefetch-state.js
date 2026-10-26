'use strict';



function normalizeBeatPrefetchState(state) {
  state = state || {};
  return {
    keys: Object.assign({}, state.keys || state),
    count: Math.max(0, Number(state.count) || 0)
  };
}


async function fetchBeatPrefetchAudioUrl(song) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return null;
  if (!song) return null;
  if (typeof resolveAlbumGaplessPlaybackData === 'function') {
    var resolved = await resolveAlbumGaplessPlaybackData(song);
    if (!resolved || !resolved.url || resolved.trial) return null;
    var resolvedUrl = '/api/audio?url=' + encodeURIComponent(resolved.url);
    return window.localMusicCredentials ? window.localMusicCredentials.url(resolvedUrl, songProviderKey(song)) : resolvedUrl;
  }
  var isQQ = songProviderKey(song) === 'qq';
  var requestedQuality = normalizePlaybackQualityForProvider(getPlaybackQualityForSong(song), isQQ ? 'qq' : 'netease');
  if (!isQQ && requestedQuality === 'jymaster' && !hasProviderSvip('netease', loginStatus)) requestedQuality = 'hires';
  var runtimeQualityCap = playbackQualityCapValue(song, isQQ ? 'qq' : 'netease');
  if (playbackQualityAboveCap(requestedQuality, isQQ ? 'qq' : 'netease', runtimeQualityCap)) requestedQuality = runtimeQualityCap;
  var qualityParam = '&quality=' + encodeURIComponent(requestedQuality);
  var neteaseMatchQuery = typeof neteasePlaybackMatchQuery === 'function' ? neteasePlaybackMatchQuery(song) : '';
  var data = isQQ
    ? await apiJson('/api/qq/song/url?mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '') + '&mediaMid=' + encodeURIComponent(song.mediaMid || song.media_mid || '') + qualityParam, { timeoutMs: 15000 })
    : await apiJson('/api/song/url?id=' + encodeURIComponent(song.id) + neteaseMatchQuery + qualityParam, { timeoutMs: 14000 });
  if (!data || !data.url || data.trial) return null;
  var audioUrl = '/api/audio?url=' + encodeURIComponent(data.url);
  return window.localMusicCredentials ? window.localMusicCredentials.url(audioUrl, songProviderKey(song)) : audioUrl;
}


function scheduleQueueBeatPrefetch(fromIdx, delayMs, state) {
  cancelBeatPrefetchTimer();
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  if (!QUEUE_BEAT_AUDIO_PREFETCH_ENABLED) return;
  if (!playQueue.length || beatPrefetchBusy || localBeatAnalysis.active) return;
  var prefetchState = normalizeBeatPrefetchState(state);
  if (prefetchState.count >= BEAT_PREFETCH_LIMIT) return;
  var token = beatMapToken;
  var seq = ++beatPrefetchToken;
  var startIdx = isFinite(fromIdx) ? fromIdx : currentIdx;
  var waitMs = delayMs == null ? 1800 : delayMs;
  if (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) waitMs = Math.max(waitMs, 2200);
  beatPrefetchTimer = setTimeout(function () {
    beatPrefetchTimer = null;
    runQueueBeatPrefetch(startIdx, token, seq, prefetchState);
  }, waitMs);
}


async function runQueueBeatPrefetch(fromIdx, token, seq, state) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  if (!QUEUE_BEAT_AUDIO_PREFETCH_ENABLED) return;
  if (token !== beatMapToken || seq !== beatPrefetchToken || beatPrefetchBusy || !playQueue.length) return;
  if (audio && audio.paused) return;
  state = normalizeBeatPrefetchState(state);
  if (state.count >= BEAT_PREFETCH_LIMIT) return;
  var idx = findNextBeatPrefetchIndex(fromIdx, state.keys);
  if (idx < 0) return;
  var song = hydrateCustomCover(playQueue[idx]);
  var key = beatMapSongKey(song);
  if (!key) return;
  state.keys[key] = true;
  state.count++;
  beatPrefetchBusy = true;
  beatPrefetchLastKey = key;
  try {
    if (token !== beatMapToken || seq !== beatPrefetchToken) return;
    var diskMap = await readBeatDiskCache(key);
    if (diskMap) {
      console.log('队列节奏D盘缓存命中:', song.name || key, diskMap.visualBeatCount || 0);
      return;
    }
    var audioUrl = await fetchBeatPrefetchAudioUrl(song);
    if (token !== beatMapToken || seq !== beatPrefetchToken || !audioUrl || beatMapCache[key]) return;
    while (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive() && token === beatMapToken && seq === beatPrefetchToken) {
      await yieldToIdle(isHiddenForBackgroundOptimization() ? 30 : 320);
    }
    if (token !== beatMapToken || seq !== beatPrefetchToken || beatMapCache[key]) return;
    while (beatMapBusy && token === beatMapToken && seq === beatPrefetchToken) {
      await yieldToIdle(isHiddenForBackgroundOptimization() ? 30 : 240);
    }
    if (token !== beatMapToken || seq !== beatPrefetchToken || beatMapCache[key]) return;
    var map = await analyzeAudioBeats(audioUrl, null, token, {
      background: true,
      prefetch: true,
      song: song
    });
    if (token !== beatMapToken || seq !== beatPrefetchToken || !map) return;
    beatMapCache[key] = map;
    writeBeatDiskCache(key, map, song, 'mr');
    console.log('队列节奏预热完成:', song.name || key, map.visualBeatCount || 0);
  } catch (err) {
    console.warn('queue beat prefetch failed:', err && err.message ? err.message : err);
  } finally {
    beatPrefetchBusy = false;
    if (state.count < BEAT_PREFETCH_LIMIT && token === beatMapToken && seq === beatPrefetchToken && playQueue.length && !(audio && audio.paused)) {
      scheduleQueueBeatPrefetch(idx, 1600, state);
    }
  }
}

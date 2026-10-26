'use strict';



function readCuefieldAutoMixPreference() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return false;
  try { return localStorage.getItem(CUEFIELD_AUTOMIX_STORE_KEY) === '1'; } catch (_) { return false; }
}


function saveCuefieldAutoMixPreference() {
  try { localStorage.setItem(CUEFIELD_AUTOMIX_STORE_KEY, cuefieldAutoMixEnabled ? '1' : '0'); } catch (_) { }
}


function cuefieldSongKey(song) {
  return typeof beatMapSongKey === 'function' ? String(beatMapSongKey(song) || '') : '';
}


function cuefieldAutoMixNextIndex(index) {
  if (!Array.isArray(playQueue) || playQueue.length < 2 || playMode === 'single') return -1;
  index = isFinite(Number(index)) ? Math.round(Number(index)) : currentIdx;
  return (index + 1 + playQueue.length) % playQueue.length;
}


function cuefieldAutoMixStatusText(status) {
  return {
    disabled: '已关闭',
    waiting: '等待播放',
    preparing: '正在分析下一首',
    'waiting-beatmap': '正在准备节拍图',
    'missing-audio': '下一首暂不可用',
    fallback: '本组歌曲暂不适合混音',
    'technical-error': '分析暂不可用',
    ready: '过渡已准备',
    handoff: '正在自动过渡',
    error: '准备失败'
  }[status] || status || '待命';
}


function updateCuefieldAutoMixUi(status) {
  var button = document.getElementById('cuefield-automix-btn');
  if (!button) return;
  var snapshot = cuefieldAutoMix && cuefieldAutoMix.snapshot ? cuefieldAutoMix.snapshot() : null;
  var ready = !!(snapshot && snapshot.pending);
  button.classList.toggle('cuefield-automix-on', !!cuefieldAutoMixEnabled);
  button.classList.toggle('cuefield-automix-ready', !!cuefieldAutoMixEnabled && ready);
  button.setAttribute('aria-pressed', cuefieldAutoMixEnabled ? 'true' : 'false');
  button.title = cuefieldAutoMixEnabled
    ? ('Cuefield AutoMix · ' + (ready ? '过渡已准备' : cuefieldAutoMixStatusText(status || (snapshot && snapshot.lastStatus))))
    : 'Cuefield AutoMix（实验功能，默认关闭）';
}


function cuefieldAutoMixAudioDescriptor(song) {
  var key = cuefieldSongKey(song);
  var cached = key && cuefieldAudioDescriptorCache[key];
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached);
  return Promise.resolve(typeof fetchBeatPrefetchAudioUrl === 'function' ? fetchBeatPrefetchAudioUrl(song) : null).then(function (proxyUrl) {
    if (!proxyUrl) return null;
    var descriptor = {
      proxyUrl: proxyUrl,
      playbackData: { url: proxyUrl, source: songProviderKey(song), level: '' },
      expiresAt: Date.now() + 4 * 60 * 1000
    };
    if (key) cuefieldAudioDescriptorCache[key] = descriptor;
    return descriptor;
  });
}


function cuefieldLinesToLrc(lines) {
  return (Array.isArray(lines) ? lines : []).slice(0, 800).map(function (line) {
    if (!line || line.fallback || !isFinite(Number(line.t != null ? line.t : line.time))) return '';
    var seconds = Math.max(0, Number(line.t != null ? line.t : line.time) || 0);
    var minutes = Math.floor(seconds / 60);
    var remain = seconds - minutes * 60;
    var stamp = String(minutes).padStart(2, '0') + ':' + remain.toFixed(3).padStart(6, '0');
    var text = String(line.text || '').replace(/[\r\n]+/g, ' ').trim();
    return text ? ('[' + stamp + ']' + text) : '';
  }).filter(Boolean).join('\n');
}


async function cuefieldLyricTextForSong(song, current) {
  if (!song) return '';
  if (current) {
    var liveLines = originalLyricsState && originalLyricsState.lines && originalLyricsState.lines.length
      ? originalLyricsState.lines
      : lyricsLines;
    var liveLrc = cuefieldLinesToLrc(liveLines);
    if (liveLrc) return liveLrc;
  }
  if (typeof readPersistentLyricCache !== 'function') return '';
  try {
    var payload = await readPersistentLyricCache(song);
    if (!payload && typeof lyricEndpointForSong === 'function') {
      payload = await apiJson(lyricEndpointForSong(song), { timeoutMs: 4200 });
      if (payload && typeof writePersistentLyricCache === 'function') writePersistentLyricCache(song, payload);
    }
    if (!payload) return '';
    if (String(payload.lyric || '').trim()) return String(payload.lyric).trim();
    if (typeof parseLyricResponseToOriginalState === 'function') {
      var state = parseLyricResponseToOriginalState(song, payload);
      return cuefieldLinesToLrc(state && state.lines);
    }
  } catch (_) { }
  return '';
}


async function ensureCuefieldAutoMixBeatMap(song, key, context) {
  if (!song || !key) return false;
  if (beatMapCache[key]) return true;
  if (context && context.currentIndex === currentIdx && currentBeatMap && key === cuefieldSongKey(playQueue[currentIdx])) {
    beatMapCache[key] = currentBeatMap;
    if (typeof writeBeatDiskCache === 'function') {
      try { await writeBeatDiskCache(key, currentBeatMap, song, 'cuefield'); } catch (_) { }
    }
    return true;
  }
  var diskMap = typeof readBeatDiskCache === 'function' ? await readBeatDiskCache(key) : null;
  if (diskMap) return true;
  function contextStillCurrent() {
    return !context || (context.token === trackSwitchToken && context.currentIndex === currentIdx);
  }
  if (!contextStillCurrent() || !cuefieldAutoMixEnabled || !isBeatPrefetchCandidate(song) || beatMapBusy || cuefieldAutoMixVisualTransitionBusy()) return false;
  var analysisToken = beatMapToken;
  var descriptor = await cuefieldAutoMixAudioDescriptor(song);
  if (!contextStillCurrent() || analysisToken !== beatMapToken || beatMapBusy || cuefieldAutoMixVisualTransitionBusy()) return !!beatMapCache[key];
  if (!descriptor || !descriptor.proxyUrl || beatMapCache[key]) return !!beatMapCache[key];
  var map = await analyzeAudioBeats(descriptor.proxyUrl, null, analysisToken, {
    background: true,
    prefetch: true,
    cuefieldAutoMix: true,
    song: song
  });
  if (!map || !contextStillCurrent() || analysisToken !== beatMapToken) return false;
  beatMapCache[key] = map;
  if (typeof writeBeatDiskCache === 'function') await writeBeatDiskCache(key, map, song, 'cuefield');
  return true;
}


function initCuefieldAutoMix() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return null;
  if (cuefieldAutoMix || !window.CuefieldAutoMix || typeof window.CuefieldAutoMix.createCuefieldAutoMix !== 'function') return cuefieldAutoMix;
  cuefieldAutoMix = window.CuefieldAutoMix.createCuefieldAutoMix({
    allowWeak: false,
    allowSafetyFallback: true,
    allowLiveEndCrossfadeFallback: true,
    minMixConfidence: 0.64,
    getKey: cuefieldSongKey,
    ensureBeatMap: ensureCuefieldAutoMixBeatMap,
    planTransition: async function (fromKey, toKey, context) {
      var fromSong = context && context.currentSong;
      var toSong = context && context.nextSong;
      var lyricPair = await Promise.all([
        cuefieldLyricTextForSong(fromSong, true),
        cuefieldLyricTextForSong(toSong, false)
      ]);
      return apiJson('/api/cuefield/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromKey: fromKey,
          toKey: toKey,
          fromLrc: lyricPair[0] || '',
          toLrc: lyricPair[1] || '',
          exitBias: 'late',
          maxEntryTime: 32,
          recentRecipes: cuefieldRecentRecipes.slice(-2),
          minimumListenUntil: context && context.minimumListenUntil,
          enableLiveEndCrossfadeFallback: true
        })
      });
    },
    prepareAudioUrl: cuefieldAutoMixAudioDescriptor
  });
  cuefieldAutoMix.setEnabled(cuefieldAutoMixEnabled);
  return cuefieldAutoMix;
}


function clearCuefieldAutoMixTimer() {
  if (cuefieldAutoMixPrepareTimer) clearTimeout(cuefieldAutoMixPrepareTimer);
  cuefieldAutoMixPrepareTimer = 0;
}


function clearCuefieldTimelineTimers() {
  while (cuefieldDelayWaiters.length) {
    var waiter = cuefieldDelayWaiters.pop();
    clearTimeout(waiter.timer);
    waiter.resolve(false);
  }
  cancelCuefieldMediaFade();
  cuefieldDeckVolumeSerial.A++;
  cuefieldDeckVolumeSerial.B++;
  if (cuefieldSourceLoopRuntime && cuefieldSourceLoopRuntime.stop) cuefieldSourceLoopRuntime.stop('timeline-clear', false);
  if (cuefieldBridgeEngine && cuefieldBridgeEngine.stop) cuefieldBridgeEngine.stop('timeline-clear');
}


function cancelCuefieldMediaFade() {
  cuefieldMediaFadeSerial++;
  if (cuefieldMediaFadeRaf) cancelAnimationFrame(cuefieldMediaFadeRaf);
  if (cuefieldMediaFadeTimer) clearInterval(cuefieldMediaFadeTimer);
  cuefieldMediaFadeRaf = 0;
  cuefieldMediaFadeTimer = 0;
  if (cuefieldPairFadeResolve) {
    var resolve = cuefieldPairFadeResolve;
    cuefieldPairFadeResolve = null;
    resolve(false);
  }
}


function claimCuefieldPreparedAudioForPlayback(media) {
  if (!media) return false;
  cancelCuefieldMediaFade();
  if (media.__mineradioPreparedAudioGraph) media.__mineradioPreparedAudioGraph.adopted = true;
  if (media === cuefieldAutoMixPreparedAudio) cuefieldAutoMixPreparedAudio = null;
  return true;
}


function disposeCuefieldPreparedAudioGraph(media) {
  var graph = media && media.__mineradioPreparedAudioGraph;
  if (!graph || graph.adopted) return;
  [graph.source, graph.filterNode, graph.bassNode, graph.midNode, graph.highNode,
    graph.analyser, graph.beatAnalyser, graph.gainNode, graph.echoSendNode,
    graph.echoDelayNode, graph.echoFeedbackNode, graph.echoWetNode].forEach(function (node) {
    try { if (node) node.disconnect(); } catch (_) { }
  });
  try { delete media.__mineradioPreparedAudioGraph; } catch (_) { }
}


function stopCuefieldPreparedAudio(media) {
  media = media || cuefieldAutoMixPreparedAudio;
  if (!media) return;
  // Once the preloaded B deck has become Mineradio's active deck it no longer
  // belongs to Cuefield. A later C-deck preparation must never pause or unload it.
  if (typeof audio !== 'undefined' && media === audio) {
    claimCuefieldPreparedAudioForPlayback(media);
    return;
  }
  disposeCuefieldPreparedAudioGraph(media);
  try { media.pause(); } catch (_) { }
  try { media.removeAttribute('src'); media.load(); } catch (_) { }
  if (media === cuefieldAutoMixPreparedAudio) cuefieldAutoMixPreparedAudio = null;
}


function resetCuefieldAutoMix(reason, options) {
  options = options || {};
  var activeContext = cuefieldActiveTransitionContext;
  var shouldRestoreOutgoing = !!(
    activeContext
    && reason !== 'manual-pause'
    && reason !== 'manual-seek'
    && reason !== 'track-switch'
    && reason !== 'cuefield-handoff'
    && activeContext.outgoingToken === trackSwitchToken
    && activeContext.outgoingIndex === currentIdx
    && activeContext.outgoingMedia === audio
    && audio
    && !audio.paused
    && !audio.ended
  );
  cuefieldTransitionGeneration++;
  clearCuefieldAutoMixTimer();
  clearCuefieldTimelineTimers();
  if (!options.preserveExecution) cuefieldAutoMixExecuting = false;
  if (!options.preservePreparedAudio) stopCuefieldPreparedAudio();
  if (shouldRestoreOutgoing && typeof rampAudioOutputGain === 'function') rampAudioOutputGain(targetVolume, 120);
  if (!options.preserveExecution) cuefieldActiveTransitionContext = null;
  if (cuefieldAutoMix) cuefieldAutoMix.reset(reason || 'reset');
  updateCuefieldAutoMixUi(reason || 'idle');
}


function cuefieldAutoMixPostSwitchDelay(isCuefieldHandoff) {
  return isCuefieldHandoff ? CUEFIELD_AUTOMIX_HANDOFF_SETTLE_MS : CUEFIELD_AUTOMIX_NORMAL_START_SETTLE_MS;
}


function cuefieldAutoMixVisualTransitionBusy() {
  if (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) return true;
  if (typeof colorMixTween !== 'undefined' && colorMixTween) return true;
  if (typeof coverDepthTween !== 'undefined' && coverDepthTween) return true;
  if (typeof loadingTween !== 'undefined' && loadingTween) return true;
  return false;
}


function cuefieldAutoMixBlockedByAlbumGapless(index) {
  return typeof albumGaplessQueueCanAdvance === 'function' && albumGaplessQueueCanAdvance(index);
}


function toggleCuefieldAutoMix() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  cuefieldAutoMixEnabled = !cuefieldAutoMixEnabled;
  saveCuefieldAutoMixPreference();
  var runtime = initCuefieldAutoMix();
  if (runtime) runtime.setEnabled(cuefieldAutoMixEnabled);
  if (!cuefieldAutoMixEnabled) resetCuefieldAutoMix('disabled');
  updateCuefieldAutoMixUi(cuefieldAutoMixEnabled ? 'waiting' : 'disabled');
  showToast(cuefieldAutoMixEnabled ? 'Cuefield AutoMix 已开启：只在当前队列自动过渡' : 'Cuefield AutoMix 已关闭');
  if (cuefieldAutoMixEnabled) scheduleCuefieldAutoMixPrepare(trackSwitchToken, currentIdx, 720);
}


function scheduleCuefieldAutoMixPrepare(token, index, delay, attempt) {
  clearCuefieldAutoMixTimer();
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return false;
  if (!cuefieldAutoMixEnabled || !audio || audio.paused || !playQueue || playQueue.length < 2) return false;
  var runtime = initCuefieldAutoMix();
  if (!runtime) return false;
  var currentIndex = isFinite(Number(index)) ? Math.round(Number(index)) : currentIdx;
  if (cuefieldAutoMixBlockedByAlbumGapless(currentIndex)) return false;
  var nextIndex = cuefieldAutoMixNextIndex(currentIndex);
  if (nextIndex < 0 || nextIndex === currentIndex) return false;
  updateCuefieldAutoMixUi('preparing');
  cuefieldAutoMixPrepareTimer = setTimeout(function () {
    cuefieldAutoMixPrepareTimer = 0;
    runCuefieldAutoMixPrepare(token, currentIndex, nextIndex, attempt || 0);
  }, Math.max(260, Number(delay) || 1200));
  return true;
}


async function runCuefieldAutoMixPrepare(token, currentIndex, nextIndex, attempt) {
  if (!cuefieldAutoMixEnabled || !cuefieldAutoMix || token !== trackSwitchToken || currentIndex !== currentIdx) return;
  if (cuefieldAutoMixBlockedByAlbumGapless(currentIndex)) return;
  if (cuefieldAutoMixVisualTransitionBusy()) {
    scheduleCuefieldAutoMixPrepare(token, currentIndex, 900, attempt || 0);
    return;
  }
  var currentSong = playQueue[currentIndex];
  var nextSong = playQueue[nextIndex];
  if (!currentSong || !nextSong) return;
  updateCuefieldAutoMixUi('preparing');
  var result = await cuefieldAutoMix.prepare({
    token: token,
    currentIndex: currentIndex,
    nextIndex: nextIndex,
    currentSong: currentSong,
    nextSong: nextSong,
    leadSec: 4,
      introBedLeadSec: 12
  });
  if (
    token !== trackSwitchToken
    || currentIndex !== currentIdx
    || !audio
    || audio.paused
    || cuefieldSongKey(playQueue[currentIndex]) !== cuefieldSongKey(currentSong)
    || cuefieldSongKey(playQueue[nextIndex]) !== cuefieldSongKey(nextSong)
  ) return;
  updateCuefieldAutoMixUi(result && result.status);
  if (result && result.status === 'ready' && result.pending) {
    prepareCuefieldPendingAudio(result.pending);
    showToast('Cuefield 已准备下一首过渡');
    return;
  }
  if (result && (result.status === 'waiting-beatmap' || result.status === 'missing-audio' || result.status === 'busy') && attempt < 3) {
    scheduleCuefieldAutoMixPrepare(token, currentIndex, 2600, attempt + 1);
  }
}


function cuefieldPendingDescriptor(pending) {
  var source = pending && pending.audioUrl;
  if (!source) return null;
  return typeof source === 'string' ? { proxyUrl: source, playbackData: { url: source } } : source;
}

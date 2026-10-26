'use strict';

function nextTrackPreloadRuntime() {
  if (!nextTrackPreloadRuntime.state) {
    nextTrackPreloadRuntime.state = { serial: 0, accountEpoch: 0, entry: null, monitorTimer: 0, verdicts: Object.create(null), verdictScope: '' };
  }
  return nextTrackPreloadRuntime.state;
}

function nextTrackPreloadVerdicts() {
  var state = nextTrackPreloadRuntime();
  var scope = nextTrackPreloadQueueSignature() + '|' + nextTrackPreloadPreferenceSignature() + '|' + state.accountEpoch;
  if (state.verdictQueue !== playQueue || state.verdictScope !== scope) {
    state.verdictQueue = playQueue; state.verdictScope = scope; state.verdicts = Object.create(null);
  }
  return state.verdicts;
}

function nextTrackPreloadVerdict(index, verdicts) {
  verdicts = verdicts || nextTrackPreloadVerdicts();
  var key = queueItemKey(playQueue[index]), verdict = verdicts[key];
  if (verdict && verdict.expiresAt <= Date.now()) { delete verdicts[key]; return null; }
  return verdict || null;
}

// Only next/automatic navigation uses this hint. Direct row selection and
// quality/repeat operations retain their existing, explicit target.
function nextTrackPrecheckedIndex(requestedIndex) {
  if (!playQueue.length || requestedIndex < 0) return requestedIndex;
  if (typeof albumGaplessQueueCanAdvance === 'function' && albumGaplessQueueCanAdvance(currentIdx)
    || typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting) return requestedIndex;
  var firstUnknown = -1, state = nextTrackPreloadRuntime(), entry = state.entry, verdicts = nextTrackPreloadVerdicts();
  var ready = entry && nextTrackPreloadStillCurrent(entry, false) && entry.status === 'prepared'
    && entry.media && !entry.media.error && entry.media.readyState >= 2 ? entry : null;
  for (var step = 0; step < playQueue.length; step++) {
    var index = (requestedIndex + step) % playQueue.length;
    if (index === currentIdx && requestedIndex !== currentIdx) break;
    var verdict = nextTrackPreloadVerdict(index, verdicts);
    if (ready && ready.index === index) return index;
    if (!verdict) return firstUnknown >= 0 ? firstUnknown : index;
    if (verdict.status === 'unknown' && firstUnknown < 0) firstUnknown = index;
  }
  return firstUnknown;
}

function nextTrackPreloadRequest(entry, operation, timeoutMs) {
  var remaining = Math.min(timeoutMs, entry.deadlineAt - Date.now(), entry.scanDeadlineAt - Date.now());
  if (remaining <= 0) { entry.uncertain = true; return Promise.resolve(null); }
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var signal = entry.controller && entry.controller.signal, timer, onAbort;
  return new Promise(function (resolve) {
    var settled = false;
    function finish(value, uncertain) {
      if (settled) return; settled = true;
      if (timer) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      if (uncertain) entry.uncertain = true;
      resolve(value);
    }
    onAbort = function () { if (controller) controller.abort(); finish(null, true); };
    if (signal) { if (signal.aborted) { onAbort(); return; } signal.addEventListener('abort', onAbort, { once: true }); }
    timer = setTimeout(function () { if (controller) controller.abort(); finish(null, true); }, remaining);
    var result;
    try { result = operation(controller ? controller.signal : signal); }
    catch (_) { finish(null, true); return; }
    Promise.resolve(result).then(function (value) {
      var serviceError = value && typeof value === 'object' && (value.error || value.ok === false || value.success === false
        || Number(value.code) >= 400 || /rate.?limit|too many|限流|频繁|请求失败|服务器|超时/i.test(String(value.message || '')));
      finish(serviceError ? null : value, !!serviceError);
    }, function () { finish(null, true); });
  });
}

function nextTrackPreloadQueueSignature() {
  return JSON.stringify(playQueue.map(function (song) {
    return [queueItemKey(song), song && song.localUrl || ''];
  }));
}

function nextTrackPreloadPreferenceSignature() {
  return JSON.stringify(['netease', 'qq', 'kugou', 'qishui', 'spotify'].map(function (provider) {
    var status = typeof platformStatus === 'function' ? platformStatus(provider) || {} : {};
    return [provider, getProviderPlaybackQuality(provider), !!status.loggedIn,
      status.userId || status.uid || status.userid || '', status.vipLevel || '',
      !!status.isVip, !!status.isSvip, !!status.playbackKeyReady];
  }));
}

function nextTrackPreloadIndex() {
  if (!Array.isArray(playQueue) || playQueue.length < 2 || currentIdx < 0 || currentIdx >= playQueue.length) return -1;
  // The shuffle player stores its already shuffled order in playQueue. Single
  // repeat keeps the active media; its manual next button still advances here.
  if (currentIdx === playQueue.length - 1 && typeof queueHydrationState !== 'undefined'
    && queueHydrationState && queueHydrationState.queueRef === playQueue
    && (queueHydrationState.active || queueHydrationState.loading) && !queueHydrationState.error) return -1;
  return (currentIdx + 1) % playQueue.length;
}

function disposeNextTrackPreload(entry) {
  if (!entry || !entry.media) return;
  var media = entry.media;
  if (typeof audio !== 'undefined' && media === audio) return;
  if (entry.cancelMediaWait) { entry.cancelMediaWait(); entry.cancelMediaWait = null; }
  media.onerror = null;
  try {
    media.pause();
    media.removeAttribute('src');
    media.load();
  } catch (_) { }
}

function clearNextTrackPreload(reason) {
  var state = nextTrackPreloadRuntime();
  state.serial++;
  if (state.monitorTimer) clearInterval(state.monitorTimer);
  state.monitorTimer = 0;
  var entry = state.entry;
  state.entry = null;
  if (entry && entry.controller) entry.controller.abort();
  disposeNextTrackPreload(entry);
}

function nextTrackPreloadStillCurrent(entry, requireSourceIndex) {
  var state = nextTrackPreloadRuntime();
  return !!(entry && state.entry === entry && state.serial === entry.serial
    && entry.token === trackSwitchToken && entry.sourceMedia === audio
    && (!requireSourceIndex || currentIdx === entry.sourceIndex)
    && playQueue === entry.queueRef && playMode === entry.playMode
    && (entry.queueSignature === nextTrackPreloadQueueSignature()
      || window.webPersonalRadio && typeof window.webPersonalRadio.ownsQueue === 'function'
        && window.webPersonalRadio.ownsQueue(playQueue) && entry.key === queueItemKey(playQueue[entry.index]))
    && entry.preferenceSignature === nextTrackPreloadPreferenceSignature()
    && entry.accountEpoch === state.accountEpoch
    && Date.now() - entry.createdAt < 600000);
}

function armNextTrackPreloadMonitor(entry) {
  var state = nextTrackPreloadRuntime();
  if (state.monitorTimer) clearInterval(state.monitorTimer);
  state.monitorTimer = setInterval(function () {
    if (state.entry !== entry) return;
    if (nextTrackPreloadStillCurrent(entry, true)) {
      if ((entry.status === 'failed' || entry.status === 'deferred' || entry.status === 'exhausted') && Date.now() >= entry.retryAt) {
        clearNextTrackPreload('precheck-retry');
        scheduleNextTrackPreloadForCurrent(trackSwitchToken, 'precheck-retry');
      }
      return;
    }
    var canPrepare = entry.token === trackSwitchToken && entry.sourceMedia === audio
      && audio && !audio.ended && currentIdx >= 0;
    clearNextTrackPreload('context-changed');
    if (canPrepare) scheduleNextTrackPreloadForCurrent(trackSwitchToken, 'context-changed');
  }, 1200);
}

async function resolveNextTrackPreloadCandidate(entry, song, skipDirect) {
  if (song && (song.type === 'local' || song.source === 'local' || song.localUrl)) {
    if (song.localFileId && window.browserLocalMusic) {
      try {
        var restored = await browserLocalMusic.getLocalMusicTrack(song.localFileId);
        if (!nextTrackPreloadStillCurrent(entry, true)) return null;
        song = restored ? Object.assign({}, song, restored) : null;
      } catch (_) { song = null; }
    }
    if (!song) return null;
    return song.localUrl ? { song: song, data: { url: song.localUrl }, local: true } : null;
  }
  var data = null;
  if (!skipDirect) {
    entry.triedProviders[normalizePlaybackProvider(songProviderKey(song))] = true;
    data = await nextTrackPreloadRequest(entry, function (signal) {
      return resolveAlbumGaplessPlaybackData(song, { signal: signal, background: true,
        isCurrent: function () { return nextTrackPreloadStillCurrent(entry, true); } });
    }, 6500);
    if (!nextTrackPreloadStillCurrent(entry, true)) return null;
    if (data && data.url) return { song: song, data: data };
  }
  if (typeof searchAlternatePlatformSong !== 'function') return null;
  var providers = typeof alternatePlaybackProviders === 'function' ? alternatePlaybackProviders(song) : [];
  for (var i = 0; i < providers.length && i < 3; i++) {
    if (!nextTrackPreloadStillCurrent(entry, true)) return null;
    var target = normalizePlaybackProvider(providers[i]);
    if (entry.triedProviders[target]) continue;
    entry.triedProviders[target] = true;
    try {
      var candidate = await nextTrackPreloadRequest(entry, function (signal) {
        return searchAlternatePlatformSong(song, providers[i], null, { signal: signal, background: true });
      }, 5000);
      if (!nextTrackPreloadStillCurrent(entry, true)) return null;
      if (!candidate) continue;
      var candidateData = await nextTrackPreloadRequest(entry, function (signal) {
        return resolveAlbumGaplessPlaybackData(candidate, { signal: signal, background: true,
          isCurrent: function () { return nextTrackPreloadStillCurrent(entry, true); } });
      }, 6500);
      if (!nextTrackPreloadStillCurrent(entry, true)) return null;
      if (candidateData && candidateData.url) return { song: candidate, data: candidateData };
    } catch (_) { entry.uncertain = true; }
  }
  return null;
}

async function prepareNextTrackPreloadMedia(entry, candidate) {
  var state = nextTrackPreloadRuntime();
  if (!nextTrackPreloadStillCurrent(entry, true)) return false;
  entry.song = candidate.song;
  entry.data = candidate.data;
  entry.local = !!candidate.local;
  var provider = normalizePlaybackProvider(songProviderKey(candidate.song));
  var url = entry.local ? candidate.data.url : '/api/audio?url=' + encodeURIComponent(candidate.data.url);
  if (!entry.local && window.localMusicCredentials) url = window.localMusicCredentials.url(url, provider);
  if (!entry.local && window.mineradioMediaCache) {
    var cachedUrl = await nextTrackPreloadRequest(entry, function (signal) {
      return mineradioMediaCache.audioSource(candidate.song, url,
        String(candidate.data.nativeQuality || candidate.data.level || getProviderPlaybackQuality(provider)), signal);
    }, 20000);
    if (!nextTrackPreloadStillCurrent(entry, true)) return false;
    if (cachedUrl) url = cachedUrl;
  }
  entry.proxyAudioUrl = url;
  var media = new Audio();
  entry.media = media;
  media.crossOrigin = 'anonymous';
  media.autoplay = false;
  media.preload = 'auto';
  media.volume = 0;
  // No play() or muted preroll: the following song must not advance or sound
  // before a normal queue switch. Reuse this element to retain its buffer.
  media.muted = false;
  entry.status = 'buffering';
  if (typeof applyAudioOutputDevice === 'function') await nextTrackPreloadRequest(entry, function () { return applyAudioOutputDevice(media); }, 2500);
  if (!nextTrackPreloadStillCurrent(entry, true)) {
    disposeNextTrackPreload({ media: media });
    return false;
  }
  var ready = await nextTrackPreloadRequest(entry, function (signal) {
    return new Promise(function (resolve) {
      var finished = false;
      function finish(result) {
        if (finished) return; finished = true;
        if (media.removeEventListener) ['loadeddata', 'canplay', 'canplaythrough'].forEach(function (name) { media.removeEventListener(name, onReady); });
        if (signal) signal.removeEventListener('abort', onCancel);
        if (media.onerror === onError) media.onerror = null;
        if (entry.cancelMediaWait === onCancel) entry.cancelMediaWait = null;
        resolve(result);
      }
      function onReady() { if (media.readyState >= 2 && !media.error) finish(true); }
      function onCancel() { finish(false); }
      function onError() {
        // Decode/unsupported failures are evidence against this source.
        // Network/rate limits/timeouts remain uncertain and can be retried.
        if (!media.error || [3, 4].indexOf(Number(media.error.code)) < 0) entry.uncertain = true;
        finish(false);
      }
      entry.cancelMediaWait = onCancel;
      ['loadeddata', 'canplay', 'canplaythrough'].forEach(function (name) { media.addEventListener(name, onReady); });
      if (signal) { if (signal.aborted) { onCancel(); return; } signal.addEventListener('abort', onCancel, { once: true }); }
      media.onerror = onError;
      media.src = url;
      media.load();
      onReady();
    });
  }, 8000);
  if (!nextTrackPreloadStillCurrent(entry, true) || !ready || media.error || media.readyState < 2) return false;
  entry.status = 'prepared';
  media.onerror = function () {
    if (state.entry !== entry || entry.media !== media) return;
    entry.recoveryPromise = recoverNextTrackPreloadMedia(entry);
  };
  delete nextTrackPreloadVerdicts()[entry.key];
  return true;
}

async function recoverNextTrackPreloadMedia(entry) {
  var state = nextTrackPreloadRuntime();
  if (!nextTrackPreloadStillCurrent(entry, true)) return false;
  entry.status = 'retrying';
  if (entry.media && entry.media.error && [3, 4].indexOf(Number(entry.media.error.code)) < 0) entry.uncertain = true;
  disposeNextTrackPreload(entry);
  entry.media = null;
  var provider = normalizePlaybackProvider(songProviderKey(entry.song));
  var failures = entry.failures[provider] || (entry.failures[provider] = { qualities: [], urls: [] });
  var quality = entry.data && (entry.data.nativeQuality || entry.data.level);
  if (quality && failures.qualities.indexOf(quality) < 0) failures.qualities.push(quality);
  if (entry.data && entry.data.url && failures.urls.indexOf(entry.data.url) < 0) failures.urls.push(entry.data.url);
  entry.mediaFailures++;
  if (entry.local || entry.mediaFailures > 8 || Date.now() >= entry.deadlineAt) return await advanceNextTrackPreloadCandidate(entry);
  try {
    var data = null;
    if (typeof window.resolvePlaybackDataWithQualityFallback === 'function') {
      data = await nextTrackPreloadRequest(entry, function (signal) {
        return window.resolvePlaybackDataWithQualityFallback(entry.song, {
          data: entry.data, signal: signal,
          excludedQualities: failures.qualities.slice(), excludedUrls: failures.urls.slice(),
          isCurrent: function () { return nextTrackPreloadStillCurrent(entry, true); }
        });
      }, 6500);
    }
    if (!nextTrackPreloadStillCurrent(entry, true)) return false;
    var candidate = data && data.url && failures.urls.indexOf(data.url) < 0
      ? { song: entry.song, data: data }
      : await resolveNextTrackPreloadCandidate(entry, entry.originalSong, true);
    if (!nextTrackPreloadStillCurrent(entry, true)) return false;
    if (!candidate) return await advanceNextTrackPreloadCandidate(entry);
    if (await prepareNextTrackPreloadMedia(entry, candidate)) return true;
    if (!nextTrackPreloadStillCurrent(entry, true)) return false;
    return await recoverNextTrackPreloadMedia(entry);
  } catch (_) {
    entry.uncertain = true;
    if (state.entry !== entry) return false;
    return await advanceNextTrackPreloadCandidate(entry);
  }
}

async function advanceNextTrackPreloadCandidate(entry, preserveVerdict) {
  if (!nextTrackPreloadStillCurrent(entry, true)) return false;
  disposeNextTrackPreload(entry); entry.media = null;
  // These hints live only in this client/session. Credentials, quality changes,
  // queue edits and explicit row choices do not inherit permanent failures.
  if (!preserveVerdict) nextTrackPreloadVerdicts()[entry.key] = { status: entry.uncertain ? 'unknown' : 'unavailable',
    expiresAt: Date.now() + (entry.uncertain ? 15000 : 120000) };
  entry.visited[entry.index] = true;
  if (Date.now() >= entry.scanDeadlineAt) {
    entry.status = 'deferred'; entry.retryAt = Date.now() + 15000; return false;
  }
  var verdicts = nextTrackPreloadVerdicts();
  for (var step = 1; step < playQueue.length; step++) {
    var index = (entry.index + step) % playQueue.length;
    if (index === entry.sourceIndex) break;
    if (entry.visited[index]) continue;
    var verdict = nextTrackPreloadVerdict(index, verdicts);
    if (verdict) { entry.visited[index] = true; continue; }
    entry.index = index; entry.key = queueItemKey(playQueue[index]); entry.originalSong = playQueue[index];
    entry.song = null; entry.data = null; entry.local = false; entry.uncertain = false;
    entry.deadlineAt = Date.now() + 30000;
    entry.triedProviders = Object.create(null); entry.failures = Object.create(null); entry.mediaFailures = 0;
    return await prepareNextTrackPreloadCandidate(entry);
  }
  entry.status = 'exhausted'; entry.retryAt = Date.now() + 15000;
  return false;
}

async function prepareNextTrackPreloadCandidate(entry) {
  if (nextTrackPreloadVerdict(entry.index)) return await advanceNextTrackPreloadCandidate(entry, true);
  var candidate = await resolveNextTrackPreloadCandidate(entry, entry.originalSong);
  if (!nextTrackPreloadStillCurrent(entry, true)) return false;
  if (!candidate) return await advanceNextTrackPreloadCandidate(entry);
  if (await prepareNextTrackPreloadMedia(entry, candidate)) return true;
  if (!nextTrackPreloadStillCurrent(entry, true)) return false;
  return await recoverNextTrackPreloadMedia(entry);
}

async function scheduleNextTrackPreloadForCurrent(token, reason) {
  if (token !== trackSwitchToken) return false;
  var state = nextTrackPreloadRuntime();
  var index = nextTrackPreloadIndex();
  if (index < 0 || !audio
    || (typeof albumGaplessQueueCanAdvance === 'function' && albumGaplessQueueCanAdvance(currentIdx))
    || (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting)) {
    clearNextTrackPreload(reason || 'not-eligible');
    return false;
  }
  if (state.entry && nextTrackPreloadStillCurrent(state.entry, true)) {
    return state.entry.status === 'prepared';
  }
  clearNextTrackPreload(reason || 'new-preload');
  var song = playQueue[index];
  var entry = {
    serial: state.serial, token: token, sourceMedia: audio, sourceIndex: currentIdx,
    index: index, key: queueItemKey(song), queueRef: playQueue,
    queueSignature: nextTrackPreloadQueueSignature(), playMode: playMode,
    preferenceSignature: nextTrackPreloadPreferenceSignature(), accountEpoch: state.accountEpoch,
    createdAt: Date.now(), deadlineAt: Date.now() + 30000, scanDeadlineAt: Date.now() + 90000,
    status: 'resolving', media: null, originalSong: song, uncertain: false, visited: Object.create(null),
    controller: typeof AbortController === 'function' ? new AbortController() : null,
    triedProviders: Object.create(null), failures: Object.create(null), mediaFailures: 0
  };
  state.entry = entry;
  armNextTrackPreloadMonitor(entry);
  try {
    return await prepareNextTrackPreloadCandidate(entry);
  } catch (_) {
    disposeNextTrackPreload(entry);
    if (state.entry === entry) { entry.media = null; entry.status = 'failed'; entry.retryAt = Date.now() + 15000; }
    return false;
  }
}

function consumeNextTrackPreload(index, opts) {
  opts = opts || {};
  var state = nextTrackPreloadRuntime();
  var entry = state.entry;
  if (opts.albumGaplessHandoff || opts.cuefieldAutoMix || opts.qualitySwitch || opts.sourceSwitch
    || opts.resumeRecovery || opts.preResolvedPlaybackData || opts.qualityOverride || Number(opts.resumeAt) > 0
    || !entry || entry.index !== index || entry.key !== queueItemKey(playQueue[index])
    || !nextTrackPreloadStillCurrent(entry, false) || entry.status !== 'prepared'
    || !entry.media || entry.media.error || entry.media.readyState < 2 || !entry.media.src) {
    clearNextTrackPreload('switch-without-cache');
    return opts;
  }
  // Transfer ownership before the normal switch invalidates every pending task.
  state.entry = null;
  state.serial++;
  if (state.monitorTimer) clearInterval(state.monitorTimer);
  state.monitorTimer = 0;
  entry.media.onerror = null;
  if (entry.song !== playQueue[index]) {
    var adoptedSong = typeof mergeSearchSongSources === 'function'
      ? mergeSearchSongSources(entry.song, playQueue[index]) : entry.song;
    playQueue[index] = typeof hydrateCustomCover === 'function' ? hydrateCustomCover(adoptedSong) : adoptedSong;
  }
  return Object.assign({}, opts, {
    nextTrackPreloadHandoff: true,
    preloadedAudio: entry.media,
    preloadedData: entry.data,
    preResolvedPlaybackData: entry.data,
    preloadedProxyAudioUrl: entry.proxyAudioUrl
  });
}

function invalidateNextTrackPreloadAccounts() {
  var state = nextTrackPreloadRuntime();
  state.accountEpoch++;
  clearNextTrackPreload('accounts-changed');
  if (typeof trackSwitchToken !== 'undefined' && typeof currentIdx !== 'undefined'
    && currentIdx >= 0 && typeof audio !== 'undefined' && audio && !audio.paused && !audio.ended) {
    scheduleNextTrackPreloadForCurrent(trackSwitchToken, 'accounts-changed');
  }
}

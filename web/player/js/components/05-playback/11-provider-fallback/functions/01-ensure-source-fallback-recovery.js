'use strict';


function ensureSourceFallbackRecovery(opts, song, idx, token) {
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (recovery) {
    if (opts && opts.playbackResolutionOwner) recovery.signal = opts.playbackResolutionOwner.signal;
    return sourceFallbackRecoveryIdentityActive(recovery) ? recovery : null;
  }
  cancelSourceFallbackRecovery('new-recovery');
  recovery = {
    id: 'source-fallback-' + Date.now() + '-' + (++sourceFallbackRecoverySerial),
    startedAt: Date.now(),
    deadlineAt: Date.now() + SOURCE_FALLBACK_RECOVERY_TIMEOUT_MS,
    rootIndex: idx,
    rootToken: token,
    queueLimit: playQueue.length,
    queueAdvances: 0,
    providerAttempts: 0,
    silent: !!(opts && opts.startupAutoplay),
    signal: opts && opts.playbackResolutionOwner && opts.playbackResolutionOwner.signal,
    visitedSongKeys: Object.create(null),
    attemptedProviderKeys: Object.create(null),
    terminal: false,
    cancelled: false,
    completed: false
  };
  var songKey = sourceFallbackRecoveryContentKey(song);
  if (songKey) recovery.visitedSongKeys[songKey] = true;
  activeSourceFallbackRecovery = recovery;
  return recovery;
}

function sourceFallbackQueuePlaybackOptions(opts, recovery) {
  var next = Object.assign({}, opts || {});
  delete next.fallbackOriginalSong;
  delete next.fallbackCandidateSong;
  delete next.preResolvedPlaybackData;
  delete next.preloadedAudio;
  delete next.preloadedData;
  delete next.preloadedProxyAudioUrl;
  // 这些状态只属于失败的那首，不能把试听进度或精确档位带给下一首。
  ['qualityOverride', 'qualitySwitch', 'sourceSwitch', 'resumeRecovery', 'resumeAt',
    'startPaused', 'autoRepeat', 'albumGaplessHandoff', 'albumGaplessMixed',
    'nextTrackPreloadHandoff', 'cuefieldAutoMix', 'qqQualityTried', 'nativeQualityTried', 'nativeQualityUrlsTried',
    'context'].forEach(function (key) { delete next[key]; });
  next.fallbackDepth = 0;
  next.sourceFallbackRecovery = recovery;
  return next;
}

function sourceFallbackRecoveryFailureOptions(opts) {
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (!recovery) return null;
  return {
    silent: !!recovery.silent,
    playbackOpts: sourceFallbackQueuePlaybackOptions(opts, recovery),
    sourceFallbackRecovery: recovery
  };
}

function settleExpiredSourceFallbackPlayback(idx, token, opts, message) {
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (!sourceFallbackRecoveryIdentityActive(recovery)) return false;
  if (opts && opts.fallbackOriginalSong && opts.fallbackCandidateSong) {
    restoreSourceFallbackQueueItem(idx, opts.fallbackOriginalSong, opts.fallbackCandidateSong, token);
  }
  if (opts && opts.fallbackDepth > 0) return false;
  return skipFailedQueueItem(
    currentIdx,
    trackSwitchToken,
    message || '当前歌曲取源超时，正在寻找下一首可播放歌曲。',
    sourceFallbackRecoveryFailureOptions(opts) || { sourceFallbackRecovery: recovery }
  );
}

function sourceFallbackProviderAttemptKey(recovery, song, provider) {
  return (sourceFallbackRecoveryContentKey(song) || sourceFallbackSongKey(song)) + '|' + normalizePlaybackProvider(provider);
}

function beginSourceFallbackProviderAttempt(recovery, song, provider) {
  if (!sourceFallbackRecoveryCanContinue(recovery)) return false;
  var key = sourceFallbackProviderAttemptKey(recovery, song, provider);
  if (recovery.attemptedProviderKeys[key]) return false;
  recovery.attemptedProviderKeys[key] = true;
  recovery.providerAttempts++;
  return true;
}

function awaitSourceFallbackBudget(promise, recovery) {
  if (!recovery) return Promise.resolve(promise);
  var remaining = sourceFallbackRecoveryRemainingMs(recovery);
  if (remaining <= 0) return Promise.resolve(sourceFallbackBudgetTimeoutResult);
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      resolve(sourceFallbackBudgetTimeoutResult);
    }, remaining);
    Promise.resolve(promise).then(function (value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, function (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}


function sourceFallbackProviderTitle(provider) {
  if (provider === 'qq') return 'QQ 音乐';
  if (provider === 'kugou') return '酷狗音乐';
  if (provider === 'qishui') return '汽水音乐';
  return '网易云';
}

function sourceFallbackProviderReady(provider) {
  provider = normalizePlaybackProvider(provider);
  if (SOURCE_FALLBACK_DIRECT_PROVIDERS.indexOf(provider) < 0) return false;
  // 游客也可能有合法公开音源；可用性由平台歌曲接口判断。
  return true;
}

function alternatePlaybackProviders(song) {
  var currentProvider = normalizePlaybackProvider(songProviderKey(song));
  var ordered = typeof accountProviderOrder === 'function'
    ? accountProviderOrder()
    : SOURCE_FALLBACK_DIRECT_PROVIDERS.slice();
  var seen = {};
  var providers = [];
  ordered.concat(SOURCE_FALLBACK_DIRECT_PROVIDERS).forEach(function (provider) {
    provider = normalizePlaybackProvider(provider);
    if (seen[provider] || provider === currentProvider || !sourceFallbackProviderReady(provider)) return;
    seen[provider] = true;
    providers.push(provider);
  });
  return providers;
}

function alternatePlaybackProvider(song) {
  return alternatePlaybackProviders(song)[0] || '';
}

async function searchAlternatePlatformSong(song, requestedTarget, recovery, requestOptions) {
  var target = requestedTarget || alternatePlaybackProvider(song);
  if (!target || !sourceFallbackProviderReady(target)) return null;
  if (recovery && !sourceFallbackRecoveryCanContinue(recovery)) return null;
  var artist = artistNameParts(song)[0] || '';
  var query = [song.name || song.title || '', song.artist || artist].filter(Boolean).join(' ').trim();
  if (!query) return null;
  var url = target === 'qq'
    ? '/api/qq/search?keywords=' + encodeURIComponent(query) + '&limit=8'
    : (target === 'kugou'
      ? '/api/kugou/search?keywords=' + encodeURIComponent(query) + '&limit=8'
      : (target === 'qishui'
        ? '/api/qishui/search?keywords=' + encodeURIComponent(query) + '&limit=8'
        : '/api/search?keywords=' + encodeURIComponent(query) + '&limit=12'));
  var data = await awaitSourceFallbackBudget(
    apiJson(url, { timeoutMs: SOURCE_FALLBACK_SEARCH_TIMEOUT_MS, signal: requestOptions && requestOptions.signal || recovery && recovery.signal }),
    recovery
  );
  if (data === sourceFallbackBudgetTimeoutResult || (recovery && !sourceFallbackRecoveryCanContinue(recovery))) return null;
  if (requestOptions && requestOptions.background && data && (data.error || data.ok === false || data.success === false || Number(data.code) >= 400
    || /rate.?limit|too many|限流|频繁|请求失败|服务器|超时/i.test(String(data.message || '')))) throw new Error('后台同曲搜索暂时不可用');
  var list = data && (data.songs || data.result || []);
  for (var i = 0; i < list.length; i++) {
    if (typeof sourceCandidateRejectReason === 'function' && sourceCandidateRejectReason(song, list[i], target)) continue;
    if (isSameTitleArtist(song, list[i])) return cloneSong(list[i]);
  }
  return null;
}

function sourceFallbackSongKey(song) {
  if (!song) return '';
  if (typeof queueItemKey === 'function') return queueItemKey(song);
  return [songProviderKey(song), song.id || song.mid || song.hash || '', song.name || song.title || '', song.artist || ''].join(':');
}

function restoreSourceFallbackQueueItem(idx, originalSong, candidateSong, expectedToken) {
  if (!originalSong || idx < 0 || idx >= playQueue.length) return false;
  if (expectedToken != null && expectedToken !== trackSwitchToken) return false;
  if (currentIdx !== idx || sourceFallbackSongKey(playQueue[idx]) !== sourceFallbackSongKey(candidateSong)) return false;
  playQueue[idx] = hydrateCustomCover(originalSong);
  if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(playQueue[idx]);
  var title = document.getElementById('thumb-title');
  var artist = document.getElementById('thumb-artist');
  if (title) title.textContent = playQueue[idx].name || playQueue[idx].title || '';
  if (artist) artist.textContent = playQueue[idx].artist || '';
  safeRenderQueuePanel('source-fallback-rollback', { scrollCurrent: miniQueueOpen });
  safeShelfRebuild('source-fallback-rollback');
  return true;
}

function settleSourceFallbackTerminal(idx, token, message, opts) {
  opts = opts || {};
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (token !== trackSwitchToken || currentIdx !== idx) return false;
  if (recovery) {
    if (!sourceFallbackRecoveryIdentityActive(recovery)) return false;
    recovery.terminal = true;
    recovery.terminalAt = Date.now();
    if (activeSourceFallbackRecovery === recovery) activeSourceFallbackRecovery = null;
  }
  hideLoading();
  forcePlaybackControlsInteractive();
  playToggleBusy = false;
  markQueueItemPlaybackFailed(idx, recovery);
  if (typeof clearAlbumGaplessPreload === 'function') clearAlbumGaplessPreload('source-fallback-terminal');
  if (typeof clearNextTrackPreload === 'function') clearNextTrackPreload('source-fallback-terminal');
  if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('source-fallback-terminal');
  if (typeof clearPlaybackResumeWatchdogs === 'function') clearPlaybackResumeWatchdogs();
  if (typeof playbackResumeRecovery !== 'undefined' && playbackResumeRecovery) {
    playbackResumeRecovery.serial = (Number(playbackResumeRecovery.serial) || 0) + 1;
    playbackResumeRecovery.pending = false;
  }
  if (audio) {
    try {
      audioFadeSerial++;
      clearAudioFadeTimers();
      audio.onended = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.__mineradioQueueItemKey = '';
      audio.__mineradioTrackSwitchToken = 0;
      audio.load();
    } catch (e) { }
  }
  playing = false;
  setPlayIcon(false);
  if (typeof setPlaybackLoadingNotice === 'function') setPlaybackLoadingNotice(false, token, 'terminal');
  if (typeof syncPlaybackStateFromAudioEvent === 'function') syncPlaybackStateFromAudioEvent('source-fallback-terminal');
  if (!opts.silent) showSourceFallbackNotice('当前没有可用音源', message || '队列中的歌曲均未找到可播放音源，请添加其它歌曲或稍后重试。');
  return false;
}

function markQueueItemPlaybackFailed(idx, recovery) {
  if (!playQueue[idx]) return;
  playQueue[idx]._lastPlaybackFailAt = Date.now();
  playQueue[idx]._lastPlaybackFailRecoveryId = recovery && recovery.id ? recovery.id : '';
}

function nextUnblockedQueueIndex(idx, recovery) {
  var now = Date.now();
  for (var step = 1; step < playQueue.length; step++) {
    var nextIdx = (idx + step) % playQueue.length;
    var prechecked = typeof nextTrackPreloadVerdict === 'function' ? nextTrackPreloadVerdict(nextIdx) : null;
    if (prechecked && prechecked.status === 'unavailable') continue;
    var failedAt = Number(playQueue[nextIdx] && playQueue[nextIdx]._lastPlaybackFailAt) || 0;
    var recoveryKey = sourceFallbackRecoveryContentKey(playQueue[nextIdx]);
    if (recovery && recoveryKey && recovery.visitedSongKeys[recoveryKey]) continue;
    var failedInRecovery = !recovery
      || (playQueue[nextIdx] && playQueue[nextIdx]._lastPlaybackFailRecoveryId === recovery.id);
    if (!failedInRecovery || !failedAt || now - failedAt > 18000) return nextIdx;
  }
  return -1;
}

function isQueueItemRecentlyPlaybackFailed(idx) {
  var failedAt = Number(playQueue[idx] && playQueue[idx]._lastPlaybackFailAt) || 0;
  return !!(failedAt && Date.now() - failedAt <= 18000);
}

async function skipFailedQueueItem(idx, token, message, opts) {
  opts = opts || {};
  if (token !== trackSwitchToken) return false;
  var recovery = ensureSourceFallbackRecovery(opts, playQueue[idx], idx, token);
  if (!recovery) return false;
  var terminalOpts = Object.assign({}, opts, { sourceFallbackRecovery: recovery });
  if (!sourceFallbackRecoveryIdentityActive(recovery)) return false;
  hideLoading();
  markQueueItemPlaybackFailed(idx, recovery);
  var currentRecoveryKey = sourceFallbackRecoveryContentKey(playQueue[idx]);
  if (currentRecoveryKey) recovery.visitedSongKeys[currentRecoveryKey] = true;
  if (playQueue.length <= 1) {
    return settleSourceFallbackTerminal(idx, token, message || '当前歌曲不可播放，队列里没有其他歌曲。', terminalOpts);
  }
  if (recovery.queueAdvances >= Math.max(0, recovery.queueLimit - 1)) {
    return settleSourceFallbackTerminal(idx, token, '已检查当前队列，暂时没有可播放的歌曲。', terminalOpts);
  }
  var nextIdx = nextUnblockedQueueIndex(idx, recovery);
  if (nextIdx < 0) {
    return settleSourceFallbackTerminal(idx, token, '已尝试绕开受限歌曲，当前队列没有新的可播放项。', terminalOpts);
  }
  if (!opts.silent) showSourceFallbackNotice('已跳过受限歌曲', message || '未找到同名同歌手的另一个平台版本，正在播放下一首。');
  recovery.queueAdvances++;
  recovery.deadlineAt = Date.now() + SOURCE_FALLBACK_RECOVERY_TIMEOUT_MS;
  var nextRecoveryKey = sourceFallbackRecoveryContentKey(playQueue[nextIdx]);
  if (nextRecoveryKey) recovery.visitedSongKeys[nextRecoveryKey] = true;
  var nextPlaybackOpts = Object.assign(
    {},
    sourceFallbackQueuePlaybackOptions(opts.playbackOpts || {}, recovery),
    { skipShuffleOrder: true }
  );
  var nextStarted = await playQueueAt(nextIdx, nextPlaybackOpts);
  if (nextStarted === true) completeSourceFallbackRecovery(recovery);
  else if (sourceFallbackRecoveryIdentityActive(recovery) && !sourceFallbackRecoveryCanContinue(recovery)) {
    return settleSourceFallbackTerminal(currentIdx, trackSwitchToken, '自动恢复已达到时间上限，请稍后手动重试。', terminalOpts);
  }
  return nextStarted === true;
}

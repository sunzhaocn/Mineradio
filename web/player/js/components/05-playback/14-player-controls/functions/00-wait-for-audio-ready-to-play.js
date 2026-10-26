'use strict';

function waitForAudioReadyToPlay(media, timeoutMs) {
  if (!media) return Promise.resolve(false);
  if (media.readyState >= 2) return Promise.resolve(true);
  return new Promise(function (resolve) {
    var done = false;
    var timer = null;
    function cleanup() {
      if (timer) clearTimeout(timer);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('loadeddata', onReady);
      media.removeEventListener('error', onError);
    }
    function finish(ok) {
      if (done) return;
      done = true;
      cleanup();
      resolve(!!ok);
    }
    function onReady() { finish(true); }
    function onError() { finish(false); }
    media.addEventListener('canplay', onReady, { once: true });
    media.addEventListener('loadeddata', onReady, { once: true });
    media.addEventListener('error', onError, { once: true });
    timer = setTimeout(function () { finish(media.readyState >= 2); }, timeoutMs || 1000);
  });
}


function isSameAudioPlaybackTarget(media, src) {
  return !!(audio && media && audio === media && (audio.currentSrc || audio.src || '') === src);
}


function clearPlaybackResumeWatchdogs() {
  if (!playbackResumeRecovery || !Array.isArray(playbackResumeRecovery.timerIds)) return;
  playbackResumeRecovery.timerIds.forEach(function (timerId) { clearTimeout(timerId); });
  playbackResumeRecovery.timerIds = [];
}


function clearPlaybackResumePauseMarker() {
  if (!playbackResumeRecovery) return;
  playbackResumeRecovery.pausedAt = 0;
  playbackResumeRecovery.pausedSongKey = '';
  playbackResumeRecovery.pausedSrc = '';
  playbackResumeRecovery.pausedPosition = 0;
}


function updatePlaybackResumePauseMarker(reason) {
  if (!playbackResumeRecovery) return;
  if (reason === 'pause' || reason === 'manual-pause') {
    var song = playQueue && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
    var src = audio && (audio.currentSrc || audio.src || '') || '';
    if (!song || !src || !audio || audio.ended) {
      clearPlaybackResumePauseMarker();
      return;
    }
    playbackResumeRecovery.pausedAt = Date.now();
    playbackResumeRecovery.pausedSongKey = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
    playbackResumeRecovery.pausedSrc = src;
    playbackResumeRecovery.pausedPosition = isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
    return;
  }
  if (reason === 'play' || reason === 'playing' || reason === 'ended' || reason === 'emptied' || reason === 'abort' || reason === 'error' || reason === 'track-switch') {
    clearPlaybackResumePauseMarker();
  }
}


function currentResumeSeconds(fallback) {
  if (audio && isFinite(audio.currentTime) && audio.currentTime > 0) return audio.currentTime;
  if (typeof getPlaybackCurrentSeconds === 'function') {
    var current = getPlaybackCurrentSeconds();
    if (isFinite(current) && current > 0) return current;
  }
  return Math.max(0, Number(fallback) || 0);
}


function canRefreshCurrentPlaybackUrlForResume(song) {
  if (!song || song.type === 'local' || song.source === 'local' || song.localUrl) return false;
  var provider = normalizePlaybackProvider(songProviderKey(song));
  return provider === 'netease' || provider === 'qq' || provider === 'kugou' || provider === 'qishui';
}


function playbackResumeProvider(song) {
  return song ? normalizePlaybackProvider(songProviderKey(song)) : '';
}


function playbackResumeLongPauseThresholdMs(song) {
  var provider = playbackResumeProvider(song);
  var providerMs = PLAYBACK_RESUME_LONG_PAUSE_PROVIDER_MS && PLAYBACK_RESUME_LONG_PAUSE_PROVIDER_MS[provider];
  return Math.max(30000, Number(providerMs || PLAYBACK_RESUME_LONG_PAUSE_MS || 0) || (8 * 60 * 1000));
}


function playbackResumePausedLongEnough(song) {
  if (!playbackResumeRecovery || !playbackResumeRecovery.pausedAt) return false;
  if (!song || !canRefreshCurrentPlaybackUrlForResume(song)) return false;
  var markerKey = playbackResumeRecovery.pausedSongKey || '';
  var currentKey = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
  if (markerKey && currentKey && markerKey !== currentKey) return false;
  var markerSrc = playbackResumeRecovery.pausedSrc || '';
  var currentSrc = audio && (audio.currentSrc || audio.src || '') || '';
  if (markerSrc && currentSrc && markerSrc !== currentSrc) return false;
  return Date.now() - playbackResumeRecovery.pausedAt >= playbackResumeLongPauseThresholdMs(song);
}


function trackSwitchStallRecoveryAllowed(song, opts) {
  opts = opts || {};
  // 四个平台都可能在 play() 成功后停住时钟；重取链接仍受单曲预算保护。
  return true;
}


function isQishuiTrackStartStalled(song, opts, media, startTime, current) {
  opts = opts || {};
  if (!(opts.trackSwitch || opts.manual || opts.fastResume) || opts.resumeRecovery) return false;
  if (playbackResumeProvider(song) !== 'qishui') return false;
  if (!media || media.seeking || media.ended) return false;
  var start = Math.max(0, Number(startTime) || 0);
  var now = Math.max(0, Number(current) || 0);
  return start < 0.18 && now < 0.24;
}


function qishuiTrackStartNudgeSeconds(media) {
  var target = 0.22;
  var duration = media && isFinite(media.duration) ? Number(media.duration) : 0;
  if (duration > 0) target = Math.min(target, Math.max(0.05, duration - 0.75));
  return Math.max(0.05, target);
}


async function nudgeQishuiTrackStart(media, src, token) {
  if (!isSameAudioPlaybackTarget(media, src) || token !== trackSwitchToken || media.paused || media.ended) return false;
  var current = isFinite(media.currentTime) ? media.currentTime : 0;
  if (current >= 0.24) return false;
  try {
    if (media.readyState < 1) await waitForAudioReadyToPlay(media, 700);
    if (!isSameAudioPlaybackTarget(media, src) || token !== trackSwitchToken || media.paused || media.ended) return false;
    var target = qishuiTrackStartNudgeSeconds(media);
    media.currentTime = target;
    if (typeof syncBeatMapPlaybackCursor === 'function') syncBeatMapPlaybackCursor(target, true);
    if (typeof syncPodcastDjMapCursor === 'function') syncPodcastDjMapCursor(target, true);
    updatePlaybackProgressUi();
    await media.play();
    return isSameAudioPlaybackTarget(media, src) && token === trackSwitchToken && !media.paused && !media.ended;
  } catch (err) {
    console.warn('[PlaybackResumeRecovery] qishui start nudge failed:', err && (err.message || err));
    return false;
  }
}


function qishuiTrackStartResumeSeconds(media, current, startTime) {
  var target = Math.max(Number(current) || 0, Number(startTime) || 0, qishuiTrackStartNudgeSeconds(media));
  var duration = media && isFinite(media.duration) ? Number(media.duration) : 0;
  if (duration > 0) target = Math.min(target, Math.max(0, duration - 0.75));
  return Math.max(0, target);
}


function showQishuiTrackStartStallNotice() {
  var now = performance.now();
  if (now - (playbackResumeRecovery.lastQishuiStartNoticeAt || 0) < 8000) return;
  playbackResumeRecovery.lastQishuiStartNoticeAt = now;
  var title = '汽水播放未响应';
  var body = '音频开头解码卡住，已尝试重新接入；如果仍不播放，请拖动一下进度或切换音质。';
  if (typeof showSourceFallbackNotice === 'function') showSourceFallbackNotice(title, body);
  else if (typeof showToast === 'function') showToast(title + '：' + body);
}


function playbackFreshUrlRecoverySongKey(song) {
  if (typeof queueItemKey === 'function') return queueItemKey(song);
  return song ? [songProviderKey(song), song.id || song.mid || song.hash || ''].join(':') : '';
}


function resetPlaybackFreshUrlRecoveryBudget(song) {
  if (!playbackResumeRecovery) return;
  playbackResumeRecovery.freshUrlSongKey = playbackFreshUrlRecoverySongKey(song);
  playbackResumeRecovery.freshUrlAttemptCount = 0;
}


function playbackStallRecoveryTransaction(song, opts) {
  opts = opts || {};
  var recovery = typeof sourceFallbackRecoveryFromOptions === 'function'
    ? sourceFallbackRecoveryFromOptions(opts)
    : null;
  var recoverySongKey = typeof sourceFallbackRecoveryContentKey === 'function'
    ? sourceFallbackRecoveryContentKey(song)
    : '';
  if (
    !recovery
    && typeof sourceFallbackRecoveryIdentityActive === 'function'
    && sourceFallbackRecoveryIdentityActive(activeSourceFallbackRecovery)
    && (!recoverySongKey || activeSourceFallbackRecovery.visitedSongKeys[recoverySongKey])
  ) {
    recovery = activeSourceFallbackRecovery;
  }
  if (!recovery && typeof ensureSourceFallbackRecovery === 'function') {
    recovery = ensureSourceFallbackRecovery({}, song, currentIdx, trackSwitchToken);
  }
  return recovery;
}


async function recoverCurrentTrackPlaybackFromFreshUrl(reason, opts) {
  opts = opts || {};
  if (typeof isPlaybackActionRequiredError === 'function' && isPlaybackActionRequiredError(opts.originalError)) return false;
  if (!playQueue.length || currentIdx < 0 || currentIdx >= playQueue.length) return false;
  var song = playQueue[currentIdx];
  if (!canRefreshCurrentPlaybackUrlForResume(song)) return false;
  var songKey = playbackFreshUrlRecoverySongKey(song);
  if (playbackResumeRecovery.freshUrlSongKey !== songKey) resetPlaybackFreshUrlRecoveryBudget(song);
  var now = performance.now();
  if (playbackResumeRecovery.pending || now - (playbackResumeRecovery.lastAttemptAt || 0) < 1200) return false;
  var recovery = playbackStallRecoveryTransaction(song, opts);
  if (!recovery) return false;
  if ((Number(playbackResumeRecovery.freshUrlAttemptCount) || 0) >= 1) {
    playbackResumeRecovery.pending = true;
    try {
      return await tryAutoPlaybackFallback(song, { url: null, reason: 'media_start_failed' }, currentIdx, trackSwitchToken,
        { resumeAt: currentResumeSeconds(opts.resumeAt), sourceFallbackRecovery: recovery, startupAutoplay: !!opts.silent });
    } finally {
      playbackResumeRecovery.pending = false;
    }
  }
  playbackResumeRecovery.freshUrlAttemptCount = (Number(playbackResumeRecovery.freshUrlAttemptCount) || 0) + 1;
  playbackResumeRecovery.pending = true;
  playbackResumeRecovery.lastAttemptAt = now;
  playbackResumeRecovery.lastReason = reason || 'resume-recovery';
  playbackResumeRecovery.serial++;
  clearPlaybackResumeWatchdogs();
  var resumeAt = currentResumeSeconds(opts.resumeAt);
  try {
    if (!opts.silent && typeof showSourceFallbackNotice === 'function') {
      showSourceFallbackNotice('播放恢复保护', '旧播放链接可能已失效，正在重新取链并回到原进度。');
    }
    var recovered = await playQueueAt(currentIdx, {
      manual: true,
      resumeAt: resumeAt,
      preserveHomeState: true,
      suppressPlayFailureNotice: true,
      resumeRecovery: true,
      sourceFallbackRecovery: recovery
    });
    if (recovered === true) return true;
    if (sourceFallbackRecoveryIdentityActive(recovery)) {
      return await skipFailedQueueItem(
        currentIdx,
        trackSwitchToken,
        '当前歌曲重新取链后仍无法播放，正在寻找下一首可播放歌曲。',
        { silent: !!opts.silent, sourceFallbackRecovery: recovery }
      );
    }
    return false;
  } catch (recoveryErr) {
    console.warn('[PlaybackResumeRecovery]', reason, recoveryErr);
    if (sourceFallbackRecoveryIdentityActive(recovery)) {
      return await skipFailedQueueItem(
        currentIdx,
        trackSwitchToken,
        '当前歌曲恢复失败，正在寻找下一首可播放歌曲。',
        { silent: !!opts.silent, sourceFallbackRecovery: recovery }
      );
    }
    return false;
  } finally {
    playbackResumeRecovery.pending = false;
    forcePlaybackControlsInteractive();
  }
}


function playbackStallRecoveryOwnerStillCurrent(media, src, token, recoverySerial, queueKey) {
  if (!isSameAudioPlaybackTarget(media, src)) return false;
  if (token !== trackSwitchToken || recoverySerial !== playbackResumeRecovery.serial) return false;
  if (media.paused || media.ended || media.seeking) return false;
  if (queueKey && String(media.__mineradioQueueItemKey || '') !== queueKey) return false;
  if (typeof playbackMediaMatchesCurrentQueueItem === 'function' && !playbackMediaMatchesCurrentQueueItem(media)) return false;
  return true;
}


function schedulePlaybackStallRecovery(reason, opts) {
  opts = opts || {};
  var media = opts.ownerMedia || audio;
  if (!media || media !== audio || !media.src) return;
  if (opts.ownerToken != null && Number(opts.ownerToken) !== Number(trackSwitchToken)) return;
  var queueKey = String(opts.ownerQueueItemKey || media.__mineradioQueueItemKey || '');
  if (queueKey && String(media.__mineradioQueueItemKey || '') !== queueKey) return;
  if (typeof playbackMediaMatchesCurrentQueueItem === 'function' && !playbackMediaMatchesCurrentQueueItem(media)) return;
  var song = playQueue[currentIdx];
  if (!trackSwitchStallRecoveryAllowed(song, opts)) return;
  if (!canRefreshCurrentPlaybackUrlForResume(song)) return;
  if (reason === 'error' && media.error && media.__mineradioPlaybackStarted) {
    // 解码/网络硬错误有时会把元素置为 paused，不能等待“仍在播放”的卡顿定时器。
    var errorToken = trackSwitchToken;
    recoverCurrentTrackPlaybackFromFreshUrl('media-error', { silent: !!opts.silent, originalError: media.error }).catch(function (err) {
      console.warn('[PlaybackResumeRecovery] media error recovery failed:', err);
    }).finally(function () {
      if (errorToken !== trackSwitchToken) return;
      var pending = typeof playbackResolutionRuntime === 'function' && playbackResolutionRuntime().active;
      if (pending && !pending.wasCancelled && pending.token === errorToken) return;
      if (typeof setPlaybackLoadingNotice === 'function') setPlaybackLoadingNotice(false, errorToken, 'terminal');
    });
    return;
  }
  clearPlaybackResumeWatchdogs();
  playbackResumeRecovery.serial = (Number(playbackResumeRecovery.serial) || 0) + 1;
  var src = media.currentSrc || media.src || '';
  var token = trackSwitchToken;
  var startTime = isFinite(media.currentTime) ? media.currentTime : 0;
  var recoverySerial = playbackResumeRecovery.serial;
  PLAYBACK_RESUME_STALL_DELAYS.forEach(function (delayMs) {
    var timerId = setTimeout(async function () {
      if (!playbackStallRecoveryOwnerStillCurrent(media, src, token, recoverySerial, queueKey)) return;
      var current = isFinite(media.currentTime) ? media.currentTime : 0;
      var minAdvance = delayMs > 2000 ? 0.28 : 0.08;
      if (current >= startTime + minAdvance) return;
      var qishuiStartStall = isQishuiTrackStartStalled(song, opts, media, startTime, current);
      if (qishuiStartStall && delayMs < 3000) {
        try {
          await ensurePlaybackAudioGraph('qishui-start-stall-before-nudge');
          ensureAudiblePlaybackGain('qishui-start-stall-before-nudge');
        } catch (nudgeGraphErr) {
          console.warn('[PlaybackResumeRecovery] qishui graph precheck failed:', nudgeGraphErr);
        }
        if (!playbackStallRecoveryOwnerStillCurrent(media, src, token, recoverySerial, queueKey)) return;
        if (await nudgeQishuiTrackStart(media, src, token)) return;
        return;
      }
      if (delayMs < 3000 && media.readyState >= 2 && media.networkState !== media.NETWORK_NO_SOURCE) return;
      try {
        await ensurePlaybackAudioGraph('resume-stall-before-refresh');
        ensureAudiblePlaybackGain('resume-stall-before-refresh');
      } catch (graphErr) {
        console.warn('[PlaybackResumeRecovery] graph precheck failed:', graphErr);
      }
      if (!playbackStallRecoveryOwnerStillCurrent(media, src, token, recoverySerial, queueKey)) return;
      current = isFinite(media.currentTime) ? media.currentTime : 0;
      if (current >= startTime + minAdvance) return;
      qishuiStartStall = isQishuiTrackStartStalled(song, opts, media, startTime, current);
      var recovered = await recoverCurrentTrackPlaybackFromFreshUrl(qishuiStartStall ? 'qishui-track-start-stalled' : (reason || 'resume-stalled'), {
        resumeAt: qishuiStartStall ? qishuiTrackStartResumeSeconds(media, current, startTime) : (current || startTime),
        silent: opts.silent
      });
      if (!playbackStallRecoveryOwnerStillCurrent(media, src, token, recoverySerial, queueKey)) return;
      if (!recovered && qishuiStartStall) showQishuiTrackStartStallNotice();
    }, delayMs);
    playbackResumeRecovery.timerIds.push(timerId);
  });
}


function playbackAttemptStillCurrent(media, token) {
  return !!(media && audio === media && token === trackSwitchToken);
}

function mediaPlayRequestTimeoutMs(media, explicitTimeoutMs) {
  var normalTimeout = Math.max(1000, Number(explicitTimeoutMs) || AUDIO_PLAY_REQUEST_TIMEOUT_MS);
  if (Number(explicitTimeoutMs) > 0 || !window.MINERADIO_LOCAL_WEB || !media) return normalTimeout;
  var song = playQueue && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
  if (!song || normalizePlaybackProvider(songProviderKey(song)) !== 'qishui') return normalTimeout;
  try {
    var sourceUrl = new URL(media.currentSrc || media.src || '', window.location.href);
    if (sourceUrl.origin !== window.location.origin || sourceUrl.pathname !== '/api/audio' ||
        sourceUrl.hash || Array.from(sourceUrl.searchParams.keys()).join(',') !== 'url') return normalTimeout;
    var upstreamUrl = new URL(sourceUrl.searchParams.get('url'));
    if (upstreamUrl.protocol !== 'http:' || upstreamUrl.hostname !== '127.0.0.1' ||
        upstreamUrl.username || upstreamUrl.password || upstreamUrl.hash || upstreamUrl.pathname !== '/qishui/audio' ||
        !/^[1-9]\d{0,24}$/.test(upstreamUrl.searchParams.get('id') || '') ||
        !/^(medium|higher|highest|lossless|spatial|hi_res)$/.test(upstreamUrl.searchParams.get('quality') || '') ||
        Array.from(upstreamUrl.searchParams.keys()).join(',') !== 'id,quality') return normalTimeout;
    // The local API may spend up to 85 seconds preparing a cold protected source.
    // Keep the regular platform timeout while allowing that fixed endpoint to finish.
    return Math.max(normalTimeout, 100000);
  } catch (error) {
    return normalTimeout;
  }
}

function awaitMediaPlayWithTimeout(media, playPromise, token, timeoutMs) {
  timeoutMs = mediaPlayRequestTimeoutMs(media, timeoutMs);
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (playbackAttemptStillCurrent(media, token)) {
        try { media.pause(); } catch (e) { }
      }
      var timeoutError = new Error('AUDIO_PLAY_TIMEOUT: media.play() did not start within ' + timeoutMs + 'ms');
      timeoutError.code = 'AUDIO_PLAY_TIMEOUT';
      reject(timeoutError);
    }, timeoutMs);
    Promise.resolve(playPromise).then(function (value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, function (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

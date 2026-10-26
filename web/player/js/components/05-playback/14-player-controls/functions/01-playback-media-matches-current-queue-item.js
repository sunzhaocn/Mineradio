'use strict';


function playbackMediaMatchesCurrentQueueItem(media) {
  if (!media || !media.src || currentIdx < 0 || currentIdx >= playQueue.length) return false;
  var song = playQueue[currentIdx];
  var expectedKey = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
  var mediaKey = String(media.__mineradioQueueItemKey || '');
  return !!(expectedKey && mediaKey && expectedKey === mediaKey);
}

function playbackPlayAttemptAllowed(media, token, opts) {
  return playbackAttemptStillCurrent(media, token) && (!opts || !opts.isPlayingRequested || opts.isPlayingRequested());
}

function playToggleRuntime() {
  if (!playToggleRuntime.state) playToggleRuntime.state = { serial: 0, active: null };
  return playToggleRuntime.state;
}

function togglePendingPlaybackIntent() {
  var pending = typeof playbackResolutionRuntime === 'function' ? playbackResolutionRuntime().active : null;
  if (!pending || pending.wasCancelled || pending.token !== trackSwitchToken || !pending.options) return null;
  pending.options.startPaused = !pending.options.startPaused;
  if (pending.options.startPaused && audio) {
    audio.autoplay = false;
    audioFadeSerial++;
    clearAudioFadeTimers();
    audio.pause();
    playing = false;
  }
  setPlayIcon(!pending.options.startPaused);
  if (typeof setPlaybackLoadingNotice === 'function') setPlaybackLoadingNotice(!pending.options.startPaused, pending.token);
  hideLoading();
  forcePlaybackControlsInteractive();
  return !pending.options.startPaused;
}


async function completeAudioPlayStart(opts, reason, expectedMedia, expectedToken) {
  opts = opts || {};
  if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
  await ensurePlaybackAudioGraph(reason || 'playback-started');
  if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
  switchPlaybackVisualToEmily();
  playing = true; setPlayIcon(true);
  expectedMedia.__mineradioPlaybackStarted = true;
  if (typeof markStageLyricsPlaybackResume === 'function') markStageLyricsPlaybackResume(reason || 'playback-started');
  if (opts.trackSwitch) primeCinemaAfterTrackStart(reason || 'track-switch');
  if (opts.trackSwitch && !opts.resumeRecovery && typeof resetPlaybackFreshUrlRecoveryBudget === 'function') {
    var startedSong = playQueue && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
    resetPlaybackFreshUrlRecoveryBudget(startedSong);
  }
  schedulePlaybackAnalyserRecovery(reason || 'playback-started');
  if (opts.fade !== false) startPlaybackFadeIn();
  else if (!opts.preserveGain) restorePlaybackGain();
  schedulePlaybackStallRecovery(reason || 'playback-started', opts);
  forcePlaybackControlsInteractive();
  hideLoading();
  return true;
}


function canResumePausedAudioFast(opts) {
  opts = opts || {};
  return !!(
    opts.manual &&
    !opts.trackSwitch &&
    !opts.resumeRecovery &&
    audio &&
    audio.src &&
    playbackMediaMatchesCurrentQueueItem(audio) &&
    audio.paused &&
    !audio.ended
  );
}


function schedulePausedAudioResumeMaintenance(media, src, token, reason, opts) {
  opts = opts || {};
  setTimeout(async function () {
    if (!isSameAudioPlaybackTarget(media, src) || token !== trackSwitchToken || media.paused || media.ended) return;
    try {
      await applyAudioOutputDevice(media);
      await ensurePlaybackAudioGraph((reason || 'manual-resume-fast') + '-deferred-graph');
      ensureAudiblePlaybackGain((reason || 'manual-resume-fast') + '-deferred-gain');
    } catch (err) {
      console.warn('[PlaybackResumeFast] deferred maintenance failed:', err);
    }
    if (!isSameAudioPlaybackTarget(media, src) || token !== trackSwitchToken || media.paused || media.ended) return;
    schedulePlaybackAnalyserRecovery(reason || 'manual-resume-fast');
    schedulePlaybackStallRecovery(reason || 'manual-resume-fast', opts);
  }, 48);
}


async function resumePausedAudioFast(opts) {
  opts = opts || {};
  if (!canResumePausedAudioFast(opts)) return null;
  var media = audio;
  var src = media.currentSrc || media.src || '';
  var token = trackSwitchToken;
  try {
    restorePlaybackGain();
    await awaitMediaPlayWithTimeout(media, media.play(), token);
    if (!isSameAudioPlaybackTarget(media, src) || token !== trackSwitchToken) return false;
    switchPlaybackVisualToEmily();
    playing = true; setPlayIcon(true);
    if (typeof markStageLyricsPlaybackResume === 'function') {
      setTimeout(function () {
        if (isSameAudioPlaybackTarget(media, src) && token === trackSwitchToken && !media.paused && !media.ended) {
          markStageLyricsPlaybackResume('manual-resume-fast');
        }
      }, 0);
    }
    forcePlaybackControlsInteractive();
    hideLoading();
    schedulePausedAudioResumeMaintenance(media, src, token, 'manual-resume-fast', { manual: true, silent: true, fastResume: true });
    return true;
  } catch (err) {
    console.warn('[PlaybackResumeFast]', err && (err.message || err));
    return null;
  }
}


async function retryTrackSwitchAudioPlayOnce(opts, originalErr, expectedMedia, expectedToken) {
  var retryAudio = expectedMedia;
  var retrySrc = retryAudio && (retryAudio.currentSrc || retryAudio.src || '');
  if (!retryAudio || !retrySrc) throw originalErr;
  await waitForAudioReadyToPlay(retryAudio, opts.manual ? 650 : 900);
  if (!playbackPlayAttemptAllowed(retryAudio, expectedToken, opts) || !isSameAudioPlaybackTarget(retryAudio, retrySrc)) return null;
  if (retryAudio.readyState === 0 || retryAudio.networkState === retryAudio.NETWORK_EMPTY) {
    try { retryAudio.load(); } catch (e) { }
  }
  if (!audioGraphHealthy()) initAudio();
  await applyAudioOutputDevice(retryAudio);
  if (!playbackPlayAttemptAllowed(retryAudio, expectedToken, opts)) return null;
  await ensurePlaybackAudioGraph('track-switch-retry-before-play');
  if (!playbackPlayAttemptAllowed(retryAudio, expectedToken, opts)) return null;
  var retryPlay = retryAudio.play();
  await ensurePlaybackAudioGraph('track-switch-retry-after-play-request');
  await awaitMediaPlayWithTimeout(retryAudio, retryPlay, expectedToken);
  if (!playbackPlayAttemptAllowed(retryAudio, expectedToken, opts)) return null;
  return await completeAudioPlayStart(opts, 'track-switch-retry-started', retryAudio, expectedToken);
}


async function attemptAudioPlay(opts) {
  opts = opts || {};
  var expectedMedia = opts.expectedMedia || audio;
  var expectedToken = opts.expectedToken == null ? trackSwitchToken : Number(opts.expectedToken);
  if (expectedMedia) expectedMedia.__mineradioLastPlayError = null;
  try {
    if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
    if (typeof setPlaybackLoadingNotice === 'function' && expectedMedia.readyState < 3) setPlaybackLoadingNotice(true, expectedToken);
    var currentSongForResume = playQueue && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
    if (opts.manual && !opts.trackSwitch && !opts.resumeRecovery && audio && audio.src && audio.paused && !audio.ended && playbackResumePausedLongEnough(currentSongForResume)) {
      var staleResumeAt = currentResumeSeconds(playbackResumeRecovery && playbackResumeRecovery.pausedPosition);
      var refreshedResume = await recoverCurrentTrackPlaybackFromFreshUrl('long-pause-stale-source', {
        resumeAt: staleResumeAt,
        silent: opts.silent !== false
      });
      if (refreshedResume) return true;
    }
    if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
    var fastResume = await resumePausedAudioFast(opts);
    if (fastResume === true) return true;
    if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
    if (!audioGraphHealthy()) initAudio();
    if (opts.fade !== false) preparePlaybackFadeIn();
    if (opts.manual || opts.trackSwitch) {
      var directPlay = expectedMedia.play();
      await applyAudioOutputDevice(expectedMedia);
      if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) {
        Promise.resolve(directPlay).catch(function () { });
        return false;
      }
      await ensurePlaybackAudioGraph(opts.manual ? 'manual-after-play-request' : 'track-switch-after-play-request');
      await awaitMediaPlayWithTimeout(expectedMedia, directPlay, expectedToken);
    } else {
      await applyAudioOutputDevice(expectedMedia);
      if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
      await ensurePlaybackAudioGraph(opts.startupAutoplay ? 'startup-before-play' : 'auto-before-play');
      if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
      var autoPlay = expectedMedia.play();
      await ensurePlaybackAudioGraph(opts.startupAutoplay ? 'startup-after-play-request' : 'auto-after-play-request');
      await awaitMediaPlayWithTimeout(expectedMedia, autoPlay, expectedToken);
    }
    if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
    return await completeAudioPlayStart(opts, 'playback-started', expectedMedia, expectedToken);
  } catch (err) {
    if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
    expectedMedia.__mineradioLastPlayError = err;
    if (opts.trackSwitch && expectedMedia && expectedMedia.src) {
      try {
        var recovered = await retryTrackSwitchAudioPlayOnce(opts, err, expectedMedia, expectedToken);
        if (recovered) return true;
        return false;
      } catch (retryErr) {
        err = retryErr;
        expectedMedia.__mineradioLastPlayError = err;
      }
    }
    console.warn('Audio play blocked:', err && (err.message || err));
    if (!opts.trackSwitch && !opts.resumeRecovery) {
      var resumed = await recoverCurrentTrackPlaybackFromFreshUrl('play-rejected', { originalError: err, silent: opts.silent });
      if (resumed) return true;
    }
    if (!playbackPlayAttemptAllowed(expectedMedia, expectedToken, opts)) return false;
    restorePlaybackGain();
    playing = false; setPlayIcon(false);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!opts.silent && !opts.trackSwitch) showToast(opts.manual ? '播放启动失败, 请重新选择歌曲' : '播放被系统拦截, 请点击播放按钮');
    return false;
  } finally {
    if (typeof settlePlaybackLoadingNotice === 'function') settlePlaybackLoadingNotice(expectedToken);
  }
}

async function playAudio(opts) {
  opts = opts || {};
  return attemptAudioPlay({ manual: !!opts.manual, silent: !!opts.silent || !!opts.startupAutoplay || !!opts.trackSwitch, startupAutoplay: !!opts.startupAutoplay, fade: opts.fade, preserveGain: !!opts.preserveGain, trackSwitch: !!opts.trackSwitch, resumeRecovery: !!opts.resumeRecovery, expectedMedia: opts.expectedMedia || audio, expectedToken: opts.expectedToken == null ? trackSwitchToken : opts.expectedToken, isPlayingRequested: opts.isPlayingRequested });
}

async function togglePlay() {
  if (togglePendingPlaybackIntent() !== null) return;
  if (playToggleBusy) return;
  var toggleState = playToggleRuntime();
  var toggleOwner = { serial: ++toggleState.serial, token: trackSwitchToken, media: audio };
  toggleState.active = toggleOwner;
  playToggleBusy = true;
  try {
    forcePlaybackControlsInteractive();
    if ((!audio || !audio.src) && playQueue.length && currentIdx >= 0) {
      await playQueueAt(currentIdx, { manual: true });
      return;
    }
    if (audio && audio.src && playQueue.length && currentIdx >= 0 && !playbackMediaMatchesCurrentQueueItem(audio)) {
      await playQueueAt(currentIdx, { manual: true, suppressPlayFailureNotice: true });
      return;
    }
    if ((!audio || !audio.src) && currentLocalSong && (currentLocalSong.localMissing || !currentLocalSong.localUrl)) {
      showToast('上次播放的是本地文件，请重新导入后继续');
      return;
    }
    if (!audio) return;
    if (audio.paused || audio.ended) {
      await attemptAudioPlay({ manual: true });
    } else {
      if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting && typeof resetCuefieldAutoMix === 'function') {
        resetCuefieldAutoMix('manual-pause');
      }
      if (
        typeof albumGaplessState !== 'undefined'
        && albumGaplessState
        && albumGaplessState.preload
        && (albumGaplessState.preload.mixPending || albumGaplessState.preload.mixStarted)
        && typeof clearAlbumGaplessPreload === 'function'
      ) clearAlbumGaplessPreload('manual-pause');
      await fadeOutAndPauseAudio();
      if (toggleState.active !== toggleOwner || toggleOwner.token !== trackSwitchToken || toggleOwner.media !== audio) return;
      playing = false;
      setPlayIcon(false);
      hideLoading();
      safePlaybackStep('listen-stats-pause', function () { updateListenStatsTick(true); });
      forcePlaybackControlsInteractive();
      safePlaybackStep('sync-pause-state', function () { syncPlaybackStateFromAudioEvent('manual-pause'); });
      safePlaybackStep('pause-controls-hide', function () { scheduleControlsHide(520); });
    }
  } catch (err) {
    if (toggleState.active !== toggleOwner || toggleOwner.token !== trackSwitchToken || toggleOwner.media !== audio) return;
    console.warn('[TogglePlay]', err);
    playing = !!(audio && !audio.paused);
    setPlayIcon(playing);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!audio || !audio.src) showToast('播放控制失败');
  } finally {
    if (toggleState.active === toggleOwner) {
      toggleState.active = null;
      playToggleBusy = false;
    }
  }
}

function setPlayIcon(p) {
  document.getElementById('play-icon').innerHTML = p
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<path d="M8 5v14l11-7z"/>';
}

function shuffleArrayInPlace(items) {
  for (var i = items.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

function reorderQueueForShufflePlaybackOrder(startIdx, opts) {
  opts = opts || {};
  if (!playQueue.length) return -1;
  startIdx = Math.round(Number(startIdx));
  if (!isFinite(startIdx) || startIdx < 0 || startIdx >= playQueue.length) {
    startIdx = currentIdx >= 0 && currentIdx < playQueue.length ? currentIdx : 0;
  }
  if (playQueue.length > 1) {
    var currentSong = playQueue[startIdx];
    var upcoming = [];
    for (var i = 0; i < playQueue.length; i++) {
      if (i !== startIdx) upcoming.push(playQueue[i]);
    }
    shuffleArrayInPlace(upcoming);
    playQueue.length = 0;
    playQueue.push(currentSong);
    for (var j = 0; j < upcoming.length; j++) playQueue.push(upcoming[j]);
  }
  currentIdx = 0;
  if (opts.renderPanel !== false) safeRenderQueuePanel(opts.reason || 'shuffle-playback-order', { animate: false, scrollCurrent: false, deferWhenHidden: false });
  if (opts.rebuildShelf !== false) safeShelfRebuild(opts.reason || 'shuffle-playback-order', true);
  if (opts.persistSnapshot !== false && typeof saveLastPlaybackSnapshot === 'function') saveLastPlaybackSnapshot(true, opts.reason || 'shuffle-playback-order');
  return currentIdx;
}

function queueNavigationRuntime() {
  if (!queueNavigationRuntime.state) queueNavigationRuntime.state = { serial: 0, pending: null };
  return queueNavigationRuntime.state;
}

function pendingQueueNavigationCurrent(pending) {
  var state = queueNavigationRuntime();
  return !!(pending && state.pending === pending && pending.serial === state.serial &&
    pending.queue === playQueue && pending.token === trackSwitchToken);
}

function nextTrack(userInitiated) {
  if (!playQueue.length) return;
  playToggleBusy = false;
  forcePlaybackControlsInteractive();
  var navigation = queueNavigationRuntime();
  if (pendingQueueNavigationCurrent(navigation.pending)) {
    // Keep every click while the next page is loading. The worker will select
    // the final requested index, rather than replaying the same first row.
    navigation.pending.targetIndex++;
    navigation.pending.manual = navigation.pending.manual || !!userInitiated;
    return navigation.pending.promise;
  }
  if (currentIdx >= playQueue.length - 1 && queueHydrationState && queueHydrationState.queueRef === playQueue && (queueHydrationState.active || queueHydrationState.loading) && !queueHydrationState.error) {
    var pending = { queue: playQueue, token: trackSwitchToken, serial: ++navigation.serial,
      targetIndex: currentIdx + 1, manual: !!userInitiated };
    navigation.pending = pending;
    pending.promise = (async function () {
      try {
        while (pendingQueueNavigationCurrent(pending) && pending.targetIndex >= playQueue.length &&
          queueHydrationState && queueHydrationState.queueRef === playQueue &&
          (queueHydrationState.active || queueHydrationState.loading) && !queueHydrationState.error) {
          var previousLength = playQueue.length;
          await hydratePlaylistQueueNextPage('queue-tail');
          if (!pendingQueueNavigationCurrent(pending)) return false;
          if (playQueue.length <= previousLength) break;
        }
        if (!pendingQueueNavigationCurrent(pending)) return false;
        if (pending.targetIndex >= playQueue.length && queueHydrationState && queueHydrationState.error) {
          showToast('后续歌曲载入失败，当前歌曲保持不变');
          return false;
        }
        if (!playQueue.length) return false;
        var targetIndex = pending.targetIndex % playQueue.length;
        navigation.pending = null;
        if (typeof nextTrackPrecheckedIndex === 'function') targetIndex = nextTrackPrecheckedIndex(targetIndex);
        if (targetIndex < 0) return stopAfterNextTrackPrecheck();
        var tailOpts = pending.manual ? { manual: true, suppressPlayFailureNotice: true } : { suppressPlayFailureNotice: true };
        if (playMode === 'shuffle') tailOpts.skipShuffleOrder = true;
        return await playQueueAt(targetIndex, tailOpts);
      } catch (_) {
        if (pendingQueueNavigationCurrent(pending)) showToast('后续歌曲载入失败，当前歌曲保持不变');
        return false;
      } finally {
        if (navigation.pending === pending) navigation.pending = null;
        forcePlaybackControlsInteractive();
      }
    })();
    return pending.promise;
  }
  var nextIndex = currentIdx < 0 ? 0 : (currentIdx + 1) % playQueue.length;
  if (typeof nextTrackPrecheckedIndex === 'function') nextIndex = nextTrackPrecheckedIndex(nextIndex);
  if (nextIndex < 0) return Promise.resolve(stopAfterNextTrackPrecheck());
  var opts = userInitiated ? { manual: true, suppressPlayFailureNotice: true } : { suppressPlayFailureNotice: true };
  if (playMode === 'shuffle') opts.skipShuffleOrder = true;
  return Promise.resolve(playQueueAt(nextIndex, opts)).finally(forcePlaybackControlsInteractive);
}

function stopAfterNextTrackPrecheck() {
  // Stopping is a new playback intent: a late source/play promise must not
  // restart the current song after every following song was ruled out.
  var stoppedToken = trackSwitchToken;
  trackSwitchToken++;
  var pending = typeof playbackResolutionRuntime === 'function' && playbackResolutionRuntime().active;
  if (pending && pending.cancel) pending.cancel();
  if (typeof cancelSourceFallbackRecovery === 'function') cancelSourceFallbackRecovery('precheck-exhausted');
  if (typeof audio !== 'undefined' && audio && Number(audio.__mineradioTrackSwitchToken) === Number(stoppedToken)) {
    audio.__mineradioTrackSwitchToken = trackSwitchToken;
  }
  if (typeof clearNextTrackPreload === 'function') clearNextTrackPreload('no-playable-next');
  if (typeof audio !== 'undefined' && audio) audio.pause();
  playing = false; setPlayIcon(false);
  if (typeof setPlaybackLoadingNotice === 'function') setPlaybackLoadingNotice(false, trackSwitchToken, 'terminal');
  forcePlaybackControlsInteractive();
  showToast('已检查后续歌曲，暂时没有可播放的音源；可手动选择歌曲重试');
  return false;
}

function prevTrack(userInitiated) {
  if (!playQueue.length) return;
  playToggleBusy = false;
  forcePlaybackControlsInteractive();
  var navigation = queueNavigationRuntime();
  navigation.serial++;
  navigation.pending = null;
  var previousIndex = (currentIdx - 1 + playQueue.length) % playQueue.length;
  var opts = userInitiated ? { manual: true, suppressPlayFailureNotice: true } : { suppressPlayFailureNotice: true };
  if (playMode === 'shuffle') opts.skipShuffleOrder = true;
  return Promise.resolve(playQueueAt(previousIndex, opts)).finally(forcePlaybackControlsInteractive);
}

function shuffleQueue() {
  reorderQueueForShufflePlaybackOrder(currentIdx, { reason: 'shuffle-queue' });
  showToast('队列已随机');
}

function clearQueue() {
  if (typeof cancelPlaylistQueueHydration === 'function') cancelPlaylistQueueHydration('clear-queue');
  playQueue = []; currentIdx = -1;
  currentLocalSong = null;
  startupRestoreHomePending = false;
  pendingPlaybackResumeAt = 0;
  restoredLastPlaybackSnapshot = null;
  try { localStorage.removeItem(LAST_PLAYBACK_STORE_KEY); } catch (e) { }
  safeRenderQueuePanel('clear-queue');
  safeShelfRebuild('clear-queue');
  updateCustomCoverButton();
  updateCustomLyricControls();
  updateEmptyHomeVisibility({ forceLoad: false });
}

function removeFromQueue(idx) {
  if (idx < 0 || idx >= playQueue.length) return;
  playQueue.splice(idx, 1);
  if (currentIdx >= playQueue.length) currentIdx = playQueue.length - 1;
  safeRenderQueuePanel('remove-queue-item');
  safeShelfRebuild('remove-queue-item');
  updateCustomCoverButton();
  updateCustomLyricControls();
  updateEmptyHomeVisibility({ forceLoad: false });
}

function playModeLabel(mode) {
  return { loop: '列表循环', shuffle: '随机播放', single: '单曲循环' }[mode] || '列表循环';
}


function playModeIconMarkup(mode) {
  if (mode === 'shuffle') {
    return '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>';
  }
  if (mode === 'single') {
    return '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M12 9v6"/><path d="M10.5 10.5 12 9l1.5 1.5"/>';
  }
  return '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>';
}

'use strict';

async function playQueueAt(idx, opts) {
  const _invocationState = {idx: idx, opts: opts};
  _invocationState.markPlayPhase = playQueueAtMarkPlayPhase.bind(undefined, _invocationState);
  _invocationState.playbackInvocationStillCurrent = playQueueAtPlaybackInvocationStillCurrent.bind(undefined, _invocationState);
  _invocationState.disposeStalePlaybackInvocationMedia = playQueueAtDisposeStalePlaybackInvocationMedia.bind(undefined, _invocationState);
  _invocationState.startTrackLyricFetch = playQueueAtStartTrackLyricFetch.bind(undefined, _invocationState);

  _invocationState.opts = _invocationState.opts || {};
  _invocationState.coalesceManualNavigation = typeof shouldCoalesceManualPlayback === 'function' &&
    shouldCoalesceManualPlayback(_invocationState.idx, _invocationState.opts, opts == null);
  if (typeof beginSourceFallbackPlaybackInvocation === 'function' && !beginSourceFallbackPlaybackInvocation(_invocationState.opts)) return false;
  if (_invocationState.idx < 0 || _invocationState.idx >= playQueue.length) return false;
  if (!_invocationState.coalesceManualNavigation && typeof ensurePlaylistQueueHydratedAhead === 'function') ensurePlaylistQueueHydratedAhead(_invocationState.idx);
  _invocationState.albumGaplessHandoff = !!(_invocationState.opts.albumGaplessHandoff && _invocationState.opts.preloadedAudio && _invocationState.opts.preloadedData);
  _invocationState.albumGaplessMixed = !!(_invocationState.albumGaplessHandoff && _invocationState.opts.albumGaplessMixed);
  _invocationState.albumGaplessPreviousAudio = _invocationState.albumGaplessHandoff ? audio : null;
  _invocationState.albumGaplessAdoptedGain = 0;
  _invocationState.playbackMedia = null;
  _invocationState.previousSongForTransition = currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
  if (
    !_invocationState.coalesceManualNavigation && playMode === 'shuffle'
    && !_invocationState.opts.skipShuffleOrder
    && !_invocationState.opts.autoRepeat
    && !_invocationState.opts.qualitySwitch
    && !_invocationState.opts.sourceSwitch
    && !_invocationState.opts.resumeRecovery
    && !_invocationState.opts.fallbackDepth
    && typeof reorderQueueForShufflePlaybackOrder === 'function'
  ) {
    _invocationState.idx = reorderQueueForShufflePlaybackOrder(_invocationState.idx, { reason: 'shuffle-play-queue-at', renderPanel: false, rebuildShelf: false, persistSnapshot: false });
  }
  if (!_invocationState.coalesceManualNavigation && typeof consumeNextTrackPreload === 'function') {
    _invocationState.opts = consumeNextTrackPreload(_invocationState.idx, _invocationState.opts);
  }
  _invocationState.qualitySwitch = !!_invocationState.opts.qualitySwitch;
  startupRestoreHomePending = false;
  markRenderInteraction(_invocationState.qualitySwitch ? 'quality-switch' : 'track-switch', _invocationState.qualitySwitch ? 520 : 1500);
  _invocationState.playPhase = 'start';
  
  try {
    _invocationState.markPlayPhase('session-finalize');
    safePlaybackStep('session-finalize', function () {
      var reloadingCurrentTrack = _invocationState.opts.qualitySwitch || _invocationState.opts.sourceSwitch
        || _invocationState.opts.resumeRecovery || _invocationState.opts.fallbackDepth;
      var sameListenSession = reloadingCurrentTrack && typeof listenSessionMatchesSong === 'function'
        && listenSessionMatchesSong(listenSession, playQueue[_invocationState.idx]);
      if (!sameListenSession) finalizeListenSession(false);
    });
    homeForcedOpen = false;
    if (!_invocationState.opts.preserveHomeState) homeSuppressed = false;
    currentIdx = _invocationState.idx;
    trackSwitchToken++;
    if (typeof beginPlaybackResolution === 'function') {
      _invocationState.resolutionOwner = beginPlaybackResolution(trackSwitchToken, _invocationState.idx, _invocationState.opts);
      _invocationState.opts = Object.assign({}, _invocationState.opts, { playbackResolutionOwner: _invocationState.resolutionOwner });
      _invocationState.resolutionOwner.options = _invocationState.opts;
    }
    _invocationState.token = trackSwitchToken;
    _invocationState.queueRef = playQueue;
    if (!_invocationState.opts.qualitySwitch && !_invocationState.opts.sourceSwitch && !_invocationState.opts.resumeRecovery) {
      safePlaybackStep('pending-track-presentation', function () {
        showPendingManualPlaybackSelection(playQueue[_invocationState.idx], _invocationState.opts);
        if (typeof cancelPendingCoverLoad === 'function') cancelPendingCoverLoad();
        if (typeof setControlCoverSrc === 'function') setControlCoverSrc('');
        var thumb = document.getElementById('thumb-cover');
        if (thumb && thumb.removeAttribute) thumb.removeAttribute('src');
        if (typeof resetLyricsForTrackSwitch === 'function') resetLyricsForTrackSwitch(playQueue[_invocationState.idx], _invocationState.token);
      });
    }
    if (_invocationState.coalesceManualNavigation) {
      safePlaybackStep('manual-navigation-release-media', releaseMediaForManualNavigation);
      safePlaybackStep('manual-navigation-title', function () {
        showPendingManualPlaybackSelection(playQueue[_invocationState.idx], _invocationState.opts);
      });
    }
    if (typeof clearNextTrackPreload === 'function') clearNextTrackPreload('track-switch');
    _invocationState.markPlayPhase('cancel-previous-track');
    cancelBeatAnalysisTimer();
    cancelBeatPrefetchTimer();
    if (typeof resetCuefieldAutoMix === 'function') {
      resetCuefieldAutoMix(_invocationState.opts.cuefieldAutoMix ? 'cuefield-handoff' : 'track-switch', {
        preservePreparedAudio: !!_invocationState.opts.cuefieldAutoMix,
        preserveExecution: !!_invocationState.opts.cuefieldAutoMix
      });
    }
    if (!_invocationState.albumGaplessHandoff) clearAlbumGaplessPreload('track-switch');
    if (localBeatAnalysis.active) cancelLocalBeatAnalysis();
    closeGsapModal(document.getElementById('local-beat-modal'));
    beatMapToken++;
    _invocationState.token = trackSwitchToken;
    if (_invocationState.coalesceManualNavigation && _invocationState.resolutionOwner) {
      _invocationState.markPlayPhase('manual-navigation-quiet-window');
      var ready = await waitForManualPlaybackQuietWindow(_invocationState.resolutionOwner);
      if (!ready || _invocationState.token !== trackSwitchToken || currentIdx !== _invocationState.idx ||
          _invocationState.queueRef !== playQueue) return false;
      if (typeof ensurePlaylistQueueHydratedAhead === 'function') ensurePlaylistQueueHydratedAhead(_invocationState.idx);
      if (playMode === 'shuffle' && !_invocationState.opts.skipShuffleOrder && typeof reorderQueueForShufflePlaybackOrder === 'function') {
        _invocationState.idx = reorderQueueForShufflePlaybackOrder(_invocationState.idx,
          { reason: 'shuffle-play-queue-at', renderPanel: false, rebuildShelf: false, persistSnapshot: false });
        currentIdx = _invocationState.idx;
        _invocationState.resolutionOwner.index = currentIdx;
      }
    }
    
    
    _invocationState.firstVisualPlay = !firstPlayDone;
    _invocationState.markPlayPhase('track-setup');
    _invocationState.song = safePlaybackStep('hydrate-song', function () { return hydrateCustomCover(playQueue[_invocationState.idx]); }) || playQueue[_invocationState.idx];
    playQueue[_invocationState.idx] = _invocationState.song;
    _invocationState.sameAlbumCoverSwitch = albumGaplessSameAlbumCover(_invocationState.previousSongForTransition, _invocationState.song);
    _invocationState.earlyLyricFetchStarted = false;
    
    _invocationState.restoreResumeAt = 0;
    if (
      _invocationState.opts.resumeAt == null
      && pendingPlaybackResumeAt > 0
      && restoredLastPlaybackSnapshot
      && restoredLastPlaybackSnapshot.current
      && queueItemKey(_invocationState.song) === queueItemKey(restoredLastPlaybackSnapshot.current)
      && !_invocationState.opts.autoRepeat
      && !_invocationState.opts.qualitySwitch
    ) {
      _invocationState.restoreResumeAt = pendingPlaybackResumeAt;
    }
    if (_invocationState.restoreResumeAt > 0 && typeof requestStageLyricRestoreWarmup === 'function') {
      requestStageLyricRestoreWarmup(_invocationState.restoreResumeAt, _invocationState.token, 'startup-restore');
    }
    _invocationState.playbackContext = _invocationState.opts.context || (_invocationState.song && _invocationState.song.radioContext) || null;
    activeRadioContext = _invocationState.playbackContext || null;
    safeRenderQueuePanel('play-queue-at-switch', { scrollCurrent: miniQueueOpen });
    safePlaybackStep('shelf-preview-suppress', suppressShelfPreviewForPlaybackSwitch);
    if (!_invocationState.albumGaplessHandoff) pauseCurrentAudioForTrackSwitch();
    else {
      playToggleBusy = false;
      forcePlaybackControlsInteractive();
    }
    _invocationState.bmKey = safePlaybackStep('beatmap-key', function () { return beatMapSongKey(_invocationState.song); }) || '';
    _invocationState.podcastDjMode = !!safePlaybackStep('podcast-mode', function () { return isPodcastSong(_invocationState.song); });
    safePlaybackStep('dj-mode', function () { setDjModeActive(_invocationState.podcastDjMode, _invocationState.song); });
    safePlaybackStep('visual-switch', switchPlaybackVisualToEmily);
    currentLocalSong = null;
    safePlaybackStep('cover-button', updateCustomCoverButton);
    safePlaybackStep('like-buttons', function () { updateLikeButtons(_invocationState.song); });
    safePlaybackStep('like-status', function () { syncLikeStatusForSong(_invocationState.song); });
    safePlaybackStep('cinema-track-profile', function () { if (!_invocationState.qualitySwitch) resetCinemaTrackProfile(_invocationState.song); });
    safePlaybackStep('empty-home', function () { if (!_invocationState.opts.preserveHomeState) updateEmptyHomeVisibility(); });
    safePlaybackStep('track-ui', function () {
      document.getElementById('hint').classList.add('hidden');
      document.getElementById('thumb-title').textContent = _invocationState.song.name;
      document.getElementById('thumb-artist').textContent = _invocationState.song.artist;
      updateControlTrackInfo(_invocationState.song);
      document.getElementById('thumb-wrap').classList.add('visible');
    });
    _invocationState.markPlayPhase('lyric-prep');
    safePlaybackStep('lyric-prep', function () {
      if (_invocationState.qualitySwitch) {
        if (typeof cancelPendingTrackFallbackLyrics === 'function') cancelPendingTrackFallbackLyrics();
        if (typeof markStageLyricsPlaybackResume === 'function') markStageLyricsPlaybackResume('quality-switch-preserve-lyrics');
        applyPreferredLyricsForCurrent(true);
      } else {
        if (typeof resetLyricsForTrackSwitch === 'function') resetLyricsForTrackSwitch(_invocationState.song, _invocationState.token);
        else {
          var initialLyricLines = withLyricFallback([]);
          setOriginalLyricsState(initialLyricLines, false, 'fallback');
          applyPreferredLyricsForCurrent(true);
        }
        _invocationState.startTrackLyricFetch();
        if (typeof scheduleTrackSwitchFallbackLyrics === 'function') scheduleTrackSwitchFallbackLyrics(_invocationState.song, _invocationState.token, 1500);
      }
    });

    _invocationState.markPlayPhase('cover-load');
    safePlaybackStep('cover-load', function () {
      if (_invocationState.qualitySwitch) return;
      var customCover = getCustomCoverForSong(_invocationState.song);
      var coverOpts = {
        trackToken: _invocationState.token,
        deferHeavy: true,
        delay: _invocationState.firstVisualPlay ? 320 : (_invocationState.sameAlbumCoverSwitch ? 80 : 520),
        timeout: _invocationState.firstVisualPlay ? 1300 : 1700,
        seamlessTrackSwitch: !_invocationState.firstVisualPlay,
        noCoverTransition: _invocationState.sameAlbumCoverSwitch,
        colorMixDuration: _invocationState.sameAlbumCoverSwitch ? 1 : undefined
      };
      if (customCover) applyCoverDataUrl(customCover, coverOpts);
      else loadCoverFromUrl(_invocationState.song.cover ? coverUrlWithSize(_invocationState.song.cover, 400) : '', coverOpts);
    });
    safePlaybackStep('trial-banner-reset', function () { document.getElementById('trial-banner').classList.remove('show'); });
    if (_invocationState.song.type === 'local' || _invocationState.song.source === 'local' || _invocationState.song.localUrl) {
      _invocationState.markPlayPhase('local-audio');
      var localPlayback = playLocalQueueSong(_invocationState.song, _invocationState.idx, _invocationState.token, _invocationState.firstVisualPlay, _invocationState.opts, _invocationState.restoreResumeAt);
      _invocationState.localStarted = await (_invocationState.resolutionOwner
        ? Promise.race([localPlayback, _invocationState.resolutionOwner.cancelled]) : localPlayback);
      if (_invocationState.localStarted === true && typeof completeSourceFallbackRecovery === 'function') {
        completeSourceFallbackRecovery(sourceFallbackRecoveryFromOptions(_invocationState.opts));
      }
      return _invocationState.localStarted === true;
    }
    safePlaybackStep('show-loading', function () { showLoading({ trackSwitch: true, seamlessCover: true }); });
    safePlaybackStep('pending-play-icon', function () { setPlayIcon(!_invocationState.opts.startPaused); });
    if (!_invocationState.qualitySwitch) lyricSunEnergy = 0; lyricSunTarget = 0; lyricSunHold = 0; lyricSunAvg = 0; lyricSunPeak = 0.55;

    // 首次播放: 粒子从暗处浮出 (Apple 风格)
    if (_invocationState.firstVisualPlay) {
      safePlaybackStep('first-visual-alpha', function () {
        firstPlayDone = true;
        tweenParticleAlpha(uniforms.uAlpha.value || 0, 1.0, 220);
      });
    }

    var resolvedPlayback = playQueueAtResolveAndStart(_invocationState);
    return await (_invocationState.resolutionOwner
      ? Promise.race([resolvedPlayback, _invocationState.resolutionOwner.cancelled]) : resolvedPlayback);
  } catch (setupErr) {
    if (_invocationState.resolutionOwner && _invocationState.resolutionOwner.wasCancelled) return false;
    if (_invocationState.token != null && _invocationState.token !== trackSwitchToken) return false;
    console.error('Play setup failed:', { phase: _invocationState.playPhase, error: setupErr }, setupErr);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (_invocationState.opts.sourceSwitch) return false;
    _invocationState.setupRecovery = typeof sourceFallbackRecoveryFromOptions === 'function'
      ? sourceFallbackRecoveryFromOptions(_invocationState.opts)
      : null;
    if (_invocationState.opts.startupAutoplay && !_invocationState.setupRecovery) {
      return false;
    }
    if (_invocationState.setupRecovery && _invocationState.opts.fallbackDepth > 0) return false;
      if (!isPlaybackRecursionError(setupErr) && typeof _invocationState.token !== 'undefined' && _invocationState.token === trackSwitchToken && !_invocationState.opts.manual && (_invocationState.setupRecovery || playQueue.length > 1)) {
        return await skipFailedQueueItem(
          _invocationState.idx,
          _invocationState.token,
          '当前歌曲切换失败，正在尝试队列里的下一首。',
          _invocationState.setupRecovery ? sourceFallbackRecoveryFailureOptions(_invocationState.opts) : { playbackOpts: _invocationState.opts }
        );
    }
    if (_invocationState.opts.suppressPlayFailureNotice) return false;
    _invocationState.setupFailText = playbackFailureToastText(setupErr);
    showToast(_invocationState.setupFailText);
    if (typeof showSourceFallbackNotice === 'function') showSourceFallbackNotice('播放失败', _invocationState.setupFailText);
    return false;
  } finally {
    if (_invocationState.resolutionOwner && typeof finishPlaybackResolution === 'function') {
      finishPlaybackResolution(_invocationState.resolutionOwner);
    }
  }
}

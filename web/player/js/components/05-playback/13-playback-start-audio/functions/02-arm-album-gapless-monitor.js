'use strict';



function armAlbumGaplessMonitor(token) {
  if (albumGaplessState.monitorTimer) clearInterval(albumGaplessState.monitorTimer);
  var ownerSerial = albumGaplessState.serial;
  var timer = setInterval(function () {
    if (albumGaplessState.monitorTimer !== timer || albumGaplessState.serial !== ownerSerial) return;
    var preload = albumGaplessState.preload;
    if (
      !preload
      || token !== trackSwitchToken
      || preload.token !== token
      || preload.index !== currentIdx + 1
      || queueItemKey(playQueue[preload.index]) !== preload.key
      || preload.isCurrent && !preload.isCurrent()
      || !albumGaplessQueueCanAdvance(currentIdx)
    ) {
      var canPrepareAgain = preload && token === trackSwitchToken && preload.sourceMedia === audio
        && preload.queueRef === playQueue && preload.sourceIndex === currentIdx;
      restoreAlbumGaplessOutgoingIfCurrent(preload, 120);
      clearAlbumGaplessPreload('album-gapless-monitor-invalid');
      if (canPrepareAgain) scheduleAlbumGaplessPreloadForCurrent(trackSwitchToken, 'album-context-changed');
      return;
    }
    if (!audio || !isFinite(audio.duration) || audio.duration <= 0 || !isFinite(audio.currentTime)) return;
    if (preload.status && preload.status !== 'prepared') return;
    var remaining = audio.duration - audio.currentTime;
    if (remaining <= ALBUM_GAPLESS_MUTED_PREROLL_SECONDS) startAlbumGaplessPreroll(preload);
    if (!preload.media || preload.media.readyState < 2) return;
    var nowMs = performance.now();
    var tailProbe = albumGaplessTailSilenceProbe(remaining);
    var longTailSilence = remaining > ALBUM_GAPLESS_LONG_SILENCE_SECONDS;
    if (tailProbe.smoothedQuiet && (!longTailSilence || !tailProbe.residualTail)) {
      if (!preload.quietSince) preload.quietSince = nowMs;
    } else {
      preload.quietSince = 0;
    }
    if (tailProbe.directQuiet) {
      if (!preload.directQuietSince) preload.directQuietSince = nowMs;
    } else {
      preload.directQuietSince = 0;
    }
    var silenceHoldMs = longTailSilence ? ALBUM_GAPLESS_FAST_SILENCE_HOLD_MS : ALBUM_GAPLESS_SILENCE_HOLD_MS;
    var smoothedSilenceReady = !!(preload.quietSince && nowMs - preload.quietSince >= silenceHoldMs);
    var directHoldMs = tailProbe.deepQuiet ? ALBUM_GAPLESS_DEEP_SILENCE_HOLD_MS : ALBUM_GAPLESS_DIRECT_SILENCE_HOLD_MS;
    var directSilenceReady = !!(longTailSilence && preload.directQuietSince && nowMs - preload.directQuietSince >= directHoldMs);
    var silenceReady = smoothedSilenceReady || directSilenceReady;
    var boundaryReady = remaining <= ALBUM_GAPLESS_BOUNDARY_RELEASE_SECONDS;
    if (!silenceReady && !boundaryReady) return;
    startAlbumGaplessMix(preload, silenceReady ? (directSilenceReady ? 'tail-direct-silence-crossmix' : (longTailSilence ? 'tail-silence-fast-crossmix' : 'tail-silence-preroll-mix')) : 'boundary-crossmix-reset', remaining);
  }, 70);
  albumGaplessState.monitorTimer = timer;
}

function fallbackAlbumGaplessPrecheck(preload, reason) {
  if (!preload || albumGaplessState.preload !== preload || !preload.isCurrent()) return Promise.resolve(false);
  restoreAlbumGaplessOutgoingIfCurrent(preload, 120);
  // Suspend this transition only; the user's album preference survives and
  // the next track token automatically becomes eligible for seamless playback.
  albumGaplessState.fallbackToken = preload.token;
  clearAlbumGaplessPreload(reason || 'album-precheck-failed');
  if (typeof scheduleNextTrackPreloadForCurrent !== 'function') return Promise.resolve(false);
  return Promise.resolve(scheduleNextTrackPreloadForCurrent(preload.token, reason || 'album-precheck-failed'));
}

function waitForAlbumGaplessPrecheckMedia(preload, signal) {
  var media = preload.media;
  return new Promise(function (resolve) {
    var finished = false;
    function finish(ok) {
      if (finished) return; finished = true;
      ['loadeddata', 'canplay', 'canplaythrough'].forEach(function (name) { media.removeEventListener(name, onReady); });
      if (signal) signal.removeEventListener('abort', onCancel);
      if (media.onerror === onError) media.onerror = null;
      if (preload.cancelMediaWait === onCancel) preload.cancelMediaWait = null;
      resolve(ok);
    }
    function onReady() { if (!media.error && media.readyState >= 2) finish(true); }
    function onError() { finish(false); }
    function onCancel() { finish(false); }
    preload.cancelMediaWait = onCancel;
    ['loadeddata', 'canplay', 'canplaythrough'].forEach(function (name) { media.addEventListener(name, onReady); });
    if (signal) { if (signal.aborted) { onCancel(); return; } signal.addEventListener('abort', onCancel, { once: true }); }
    media.onerror = onError;
    media.src = preload.proxyAudioUrl;
    media.load();
    onReady();
  });
}


async function scheduleAlbumGaplessPreloadForCurrent(token, reason) {
  if (token !== trackSwitchToken) return false;
  if (!albumGaplessQueueCanAdvance(currentIdx)) {
    if (!albumGaplessState.handoff) clearAlbumGaplessPreload(reason || 'album-gapless-not-eligible');
    if (typeof scheduleNextTrackPreloadForCurrent === 'function') scheduleNextTrackPreloadForCurrent(token, reason);
    return false;
  }
  if (typeof clearNextTrackPreload === 'function') clearNextTrackPreload('album-gapless-preload');
  var sourceIdx = currentIdx;
  var nextIdx = sourceIdx + 1;
  var nextSong = playQueue[nextIdx];
  var nextKey = queueItemKey(nextSong);
  if (albumGaplessState.preload && albumGaplessState.preload.index === nextIdx && albumGaplessState.preload.key === nextKey
    && (!albumGaplessState.preload.isCurrent || albumGaplessState.preload.isCurrent())) return albumGaplessState.preload.status === 'prepared';
  clearAlbumGaplessPreload(reason || 'album-gapless-new-preload');
  var serial = ++albumGaplessState.serial;
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  albumGaplessState.resolutionController = controller;
  var queueRef = playQueue, queueSignature = nextTrackPreloadQueueSignature(), sourceMedia = audio;
  var preferenceSignature = nextTrackPreloadPreferenceSignature(), accountEpoch = nextTrackPreloadRuntime().accountEpoch;
  var requestOptions = { signal: controller && controller.signal, isCurrent: function () {
    return serial === albumGaplessState.serial && token === trackSwitchToken && sourceIdx === currentIdx
      && sourceMedia === audio && queueRef === playQueue && queueSignature === nextTrackPreloadQueueSignature()
      && nextKey === queueItemKey(playQueue[nextIdx]) && preferenceSignature === nextTrackPreloadPreferenceSignature()
      && accountEpoch === nextTrackPreloadRuntime().accountEpoch;
  } };
  var preload = { index: nextIdx, key: nextKey, token: token, serial: serial, sourceIndex: sourceIdx,
    sourceMedia: sourceMedia, queueRef: queueRef, media: null, status: 'resolving', isCurrent: requestOptions.isCurrent };
  albumGaplessState.preload = preload;
  armAlbumGaplessMonitor(token);
  var budget = { controller: controller, deadlineAt: Date.now() + 15000, scanDeadlineAt: Date.now() + 15000 };
  try {
    var data = await nextTrackPreloadRequest(budget, function (signal) {
      return resolveAlbumGaplessPlaybackData(nextSong, { signal: signal, background: true, isCurrent: requestOptions.isCurrent });
    }, 6500);
    if (!requestOptions.isCurrent()) return false;
    if (
      serial !== albumGaplessState.serial
      || token !== trackSwitchToken
      || sourceIdx !== currentIdx
      || queueItemKey(playQueue[nextIdx]) !== nextKey
      || !albumGaplessQueueCanAdvance(currentIdx)
    ) return false;
    if (!data || !data.url) return await fallbackAlbumGaplessPrecheck(preload, 'album-source-unavailable');
    var proxyAudioUrl = '/api/audio?url=' + encodeURIComponent(data.url);
    if (window.localMusicCredentials) proxyAudioUrl = window.localMusicCredentials.url(proxyAudioUrl, songProviderKey(playQueue[nextIdx]));
    var media = new Audio(); preload.media = media;
    media.crossOrigin = 'anonymous';
    media.preload = 'auto';
    media.volume = 0;
    preload.proxyAudioUrl = proxyAudioUrl; preload.data = data; preload.song = nextSong;
    preload.status = 'buffering';
    await nextTrackPreloadRequest(budget, function () { return applyAudioOutputDevice(media); }, 2500);
    if (
      serial !== albumGaplessState.serial
      || token !== trackSwitchToken
      || sourceIdx !== currentIdx
      || queueItemKey(playQueue[nextIdx]) !== nextKey
      || !albumGaplessQueueCanAdvance(currentIdx)
    ) {
      disposeAlbumGaplessPreload({ media: media });
      return false;
    }
    var ready = await nextTrackPreloadRequest(budget, function (signal) { return waitForAlbumGaplessPrecheckMedia(preload, signal); }, 8000);
    if (!requestOptions.isCurrent()) return false;
    if (!ready || media.error || media.readyState < 2) return await fallbackAlbumGaplessPrecheck(preload, 'album-media-unavailable');
    preload.status = 'prepared';
    media.onerror = function () { preload.recoveryPromise = fallbackAlbumGaplessPrecheck(preload, 'album-prepared-media-error'); };
    return true;
  } catch (err) {
    if (typeof media !== 'undefined' && media && (!albumGaplessState.preload || albumGaplessState.preload.media !== media)) {
      disposeAlbumGaplessPreload({ media: media });
    }
    if (requestOptions.isCurrent()) return await fallbackAlbumGaplessPrecheck(preload, 'album-precheck-failed');
    return false;
  }
}


function playAlbumGaplessNextOnEnded(token) {
  if (!albumGaplessQueueCanAdvance(currentIdx)) return false;
  var nextIdx = currentIdx + 1;
  setTimeout(function () {
    if (token !== trackSwitchToken) return;
    playQueueAt(nextIdx, { skipShuffleOrder: true, suppressPlayFailureNotice: true, preserveHomeState: true });
  }, 0);
  return true;
}


function applyLocalTrackLyricOnDemand(song, token) {
  var localApi=typeof localMusicLibraryApi==='function' ? localMusicLibraryApi() : window.desktopWindow || window.browserLocalMusic;
  if (typeof cancelPendingTrackFallbackLyrics === 'function') cancelPendingTrackFallbackLyrics();
  if (song && song.lyric) {
    applyFetchedLyricResponse(song, token, { lyric: song.lyric }, { persist: false });
    return;
  }
  setOriginalLyricsState(withLyricFallback([]), false, 'fallback');
  applyPreferredLyricsForCurrent(true);
  if (
    !song
    || !song.hasLyric
    || !song.localFileId
    || !localApi
    || typeof localApi.readLocalMusicLyric !== 'function'
  ) return;
  localApi.readLocalMusicLyric(song.localFileId).then(function (result) {
    if (
      token !== trackSwitchToken
      || !currentLocalSong
      || queueItemKey(currentLocalSong) !== queueItemKey(song)
      || !result
      || result.ok !== true
      || !result.lyric
    ) return;
    song.lyric = result.lyric;
    song.lyricSource = result.lyricSource || song.lyricSource || '';
    applyFetchedLyricResponse(song, token, { lyric: result.lyric }, { persist: false });
  }).catch(function () { });
}


async function playLocalQueueSong(song, idx, token, firstVisualPlay, opts, resumeAt) {
  opts = opts || {};
  // A playlist/history snapshot may contain the previous page's blob URL.
  // Rehydrate only from the browser's explicitly imported library.
  var localApi=typeof localMusicLibraryApi==='function' ? localMusicLibraryApi() : window.desktopWindow || window.browserLocalMusic;
  if (localApi && localApi===window.browserLocalMusic && song && song.localFileId) {
    try {
      var restored=await localApi.getLocalMusicTrack(song.localFileId);
      if (token !== trackSwitchToken) return false;
      song=restored ? Object.assign({},song,restored) : null;
    } catch (_) { song=null; }
  }
  if (!song || !song.localUrl) {
    showToast('本地文件已失效，请重新导入后继续');
    forcePlaybackControlsInteractive();
    return false;
  }
  currentLocalSong = song;
  playQueue[idx] = song;
  updateCustomCoverButton();
  document.getElementById('trial-banner').classList.remove('show');
  var nextPreloadHandoff = !!(opts.nextTrackPreloadHandoff && opts.preloadedAudio && opts.preloadedAudio.src);
  if (nextPreloadHandoff) {
    if (audio && audio !== opts.preloadedAudio) audio.pause();
    audio = opts.preloadedAudio;
  }
  else if (!audio) { audio = new Audio(); audio.crossOrigin = 'anonymous'; }
  else {
    audioFadeSerial++;
    clearAudioFadeTimers();
    audio.pause();
  }
  resetPlaybackAudioGraphForSourceSwitch('local-track-switch');
  audio.autoplay = !opts.startPaused;
  audio.preload = 'auto';
  syncActiveAudioRepeatMode(audio);
  bindPlaybackProgressEvents(audio);
  applyVolumeToAudio();
  var playbackMedia = audio;
  await applyAudioOutputDevice(playbackMedia);
  if (token !== trackSwitchToken || currentIdx !== idx || audio !== playbackMedia) return false;
  if (!nextPreloadHandoff) audio.src = song.localUrl;
  audio.__mineradioQueueItemKey = queueItemKey(song);
  audio.__mineradioTrackSwitchToken = token;
  updatePlaybackProgressUi();
  lyricSunEnergy = 0; lyricSunTarget = 0; lyricSunHold = 0; lyricSunAvg = 0; lyricSunPeak = 0.55;
  audio.onended = function () {
    if (token !== trackSwitchToken) return;
    if (this && this.__mineradioCuefieldEndedRecoveryToken === token) return;
    if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting) {
      if (typeof noteCuefieldAutoMixOutgoingEnded === 'function') noteCuefieldAutoMixOutgoingEnded(this, token, currentIdx);
      return;
    }
    if (restartSingleRepeatMedia(this, token, currentIdx, 'local-ended')) return;
    finalizeListenSession(true);
    if (playAlbumGaplessNextOnEnded(token)) return;
    if (playMode === 'single') setTimeout(function () { playQueueAt(currentIdx, { autoRepeat: true, suppressPlayFailureNotice: true }); }, 0);
    else setTimeout(nextTrack, 0);
  };
  audio.onloadedmetadata = function () {
    if (token !== trackSwitchToken || !currentLocalSong || currentLocalSong.localKey !== song.localKey) return;
    var duration = audio && isFinite(audio.duration) ? audio.duration : 0;
    currentLocalSong.duration = duration;
    if (playQueue[idx]) playQueue[idx].duration = duration;
    if (lyricSourceMode === 'custom') applyCustomLyricState(currentLocalSong, true);
    safeRenderQueuePanel('local-metadata', { scrollCurrent: miniQueueOpen });
  };
  scheduleAudioResumePosition(audio, opts.resumeAt != null ? opts.resumeAt : resumeAt, token);
  if (resumeAt > 0) pendingPlaybackResumeAt = 0;
  if (!nextPreloadHandoff) audio.load();
  currentBeatMap = null;
  beatMapNextIdx = 0;
  resetAudioVisualState();
  resetBeatCameraSync(0);
  cancelBeatAnalysisTimer();
  cancelDjBeatAnalysisTimer();
  beatMapToken++;
  djBeatMapToken++;
  resetDjBeatMapState();
  setDjModeActive(false);
  var playbackStarted = opts.startPaused ? true : await playAudio({ manual: !!opts.manual, silent: !!opts.startupAutoplay || !opts.manual, startupAutoplay: !!opts.startupAutoplay, trackSwitch: true, resumeRecovery: !!opts.resumeRecovery,
    expectedMedia: playbackMedia, expectedToken: token, isPlayingRequested: function () { return !opts.startPaused; } });
  if (token !== trackSwitchToken || currentIdx !== idx || audio !== playbackMedia) return false;
  if (opts.startPaused) {
    playbackMedia.autoplay = false;
    playbackMedia.pause();
    playing = false; setPlayIcon(false); hideLoading();
    playbackStarted = true;
  }
  if (!playbackStarted) {
    forcePlaybackControlsInteractive();
    if (opts.startupAutoplay) {
      return false;
    }
    if (!opts.suppressPlayFailureNotice) {
      if (opts.manual) showToast('播放启动失败，请重新选择本地音乐');
      else showSourceFallbackNotice('本地音乐已载入', '点击播放器中间的播放按钮继续播放。');
    }
    return false;
  }
  forcePlaybackControlsInteractive();
  if (!opts.startPaused) beginListenSession(song, null);
  applyLocalTrackLyricOnDemand(song, token);
  safeRenderQueuePanel('play-local-queue', { scrollCurrent: miniQueueOpen });
  scheduleShelfRebuild('play-local-queue', true);
  scheduleAlbumGaplessPreloadForCurrent(token, 'local-started');
  setTimeout(function () {
    if (token === trackSwitchToken && currentLocalSong && currentLocalSong.localKey === song.localKey) {
      prepareLocalBeatAnalysis(currentLocalSong, song.localUrl);
    }
  }, firstVisualPlay ? 680 : 520);
  return true;
}

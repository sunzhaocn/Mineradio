'use strict';

function albumGaplessSongKey(song) {
  if (!song) return '';
  if (song.__albumGaplessKey) return String(song.__albumGaplessKey);
  var provider = normalizePlaybackProvider(songProviderKey(song));
  if (provider === 'qq') {
    var albumMid = song.albumMid || song.albummid || song.album_mid || '';
    return albumMid ? 'qq:' + albumMid : '';
  }
  if (provider === 'spotify') {
    var spotifyAlbumId = song.albumId || song.spotifyAlbumId || '';
    return spotifyAlbumId ? 'spotify:' + spotifyAlbumId : '';
  }
  if (provider === 'netease') {
    var albumId = song.albumId || song.album_id || '';
    return albumId ? 'netease:' + albumId : '';
  }
  if (provider === 'kugou') {
    var kugouAlbumId = song.albumId || song.album_id || '';
    return kugouAlbumId ? 'kugou:' + kugouAlbumId : '';
  }
  return '';
}


function albumGaplessCoverKey(song) {
  if (!song) return '';
  return String(song.customCover || song.cover || song.picUrl || song.albumCover || song.coverUrl || '').trim();
}


function albumGaplessSameAlbumCover(prevSong, nextSong) {
  var prevAlbum = albumGaplessSongKey(prevSong);
  var nextAlbum = albumGaplessSongKey(nextSong);
  if (!prevAlbum || prevAlbum !== nextAlbum) return false;
  var prevCover = albumGaplessCoverKey(prevSong);
  var nextCover = albumGaplessCoverKey(nextSong);
  return !!(prevCover && nextCover && prevCover === nextCover);
}


function syncActiveAudioRepeatMode(media) {
  media = media || audio;
  if (!media) return false;
  var shouldLoop = playMode === 'single';
  try { media.loop = shouldLoop; } catch (e) { }
  return shouldLoop;
}


function restartSingleRepeatMedia(media, token, index, reason) {
  if (
    playMode !== 'single'
    || !media
    || token !== trackSwitchToken
    || index !== currentIdx
    || audio !== media
  ) return false;
  try { media.loop = true; } catch (e) { }
  setTimeout(function () {
    if (
      playMode !== 'single'
      || token !== trackSwitchToken
      || index !== currentIdx
      || audio !== media
    ) return;
    try { media.currentTime = 0; } catch (e) { }
    try {
      var playPromise = media.play && media.play();
      playing = true;
      if (typeof setPlayIcon === 'function') setPlayIcon(true);
      if (typeof updatePlaybackProgressUi === 'function') updatePlaybackProgressUi();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function () {
          if (playMode !== 'single' || token !== trackSwitchToken || index !== currentIdx || audio !== media) return;
          playQueueAt(index, {
            autoRepeat: true,
            preserveHomeState: true,
            suppressPlayFailureNotice: true,
          });
        });
      }
    } catch (e) {
      if (playMode !== 'single' || token !== trackSwitchToken || index !== currentIdx || audio !== media) return;
      playQueueAt(index, {
        autoRepeat: true,
        preserveHomeState: true,
        suppressPlayFailureNotice: true,
      });
    }
  }, 0);
  return true;
}


function disposeAlbumGaplessPreload(preload) {
  if (!preload) return;
  if (preload) {
    if (preload.handoffTimer) clearTimeout(preload.handoffTimer);
    if (preload.cleanupTimer) clearTimeout(preload.cleanupTimer);
    if (preload.fadeFrame) cancelAnimationFrame(preload.fadeFrame);
    if (preload.fadeWatchdogTimer) clearInterval(preload.fadeWatchdogTimer);
    preload.fadeFrame = 0;
    preload.fadeWatchdogTimer = 0;
    preload.mixPending = false;
    preload.mixStarted = false;
    if (preload.fadeResolve) {
      var resolveFade = preload.fadeResolve;
      preload.fadeResolve = null;
      resolveFade(false);
    }
  }
  if (preload.previousAudio && preload.previousAudio === audio && preload.previousAudioOnEnded) {
    preload.previousAudio.onended = preload.previousAudioOnEnded;
  }
  if (preload && preload.media) {
    preload.media.onerror = null;
    if (preload.cancelMediaWait) { preload.cancelMediaWait(); preload.cancelMediaWait = null; }
    try {
      preload.media.pause();
      preload.media.removeAttribute('src');
      preload.media.load();
    } catch (e) { }
  }
}


function clearAlbumGaplessPreload(reason) {
  if (!albumGaplessState) return;
  albumGaplessState.serial++;
  if (albumGaplessState.resolutionController) albumGaplessState.resolutionController.abort();
  albumGaplessState.resolutionController = null;
  if (albumGaplessState.monitorTimer) {
    clearInterval(albumGaplessState.monitorTimer);
    albumGaplessState.monitorTimer = 0;
  }
  var preload = albumGaplessState.preload;
  albumGaplessState.preload = null;
  disposeAlbumGaplessPreload(preload);
}


function restoreAlbumGaplessOutgoingIfCurrent(preload, durationMs) {
  if (
    !preload
    || preload.transitionToken !== trackSwitchToken
    || preload.transitionIndex !== currentIdx
    || !preload.previousAudio
    || preload.previousAudio !== audio
    || preload.previousAudio.paused
    || preload.previousAudio.ended
  ) return false;
  if (typeof rampAudioOutputGain === 'function') rampAudioOutputGain(targetVolume, Math.max(80, Number(durationMs) || 120));
  return true;
}


function albumGaplessDefaultEnabledForContext(context) {
  var albumKey = context && context.albumKey ? String(context.albumKey) : '';
  if (albumGaplessState && albumGaplessState.enabled && albumKey && albumGaplessState.albumKey === albumKey) return true;
  if (albumGaplessState && albumKey && albumGaplessState.disabledAlbumKey === albumKey) return false;
  return !albumGaplessState || albumGaplessState.defaultEnabled !== false;
}


function albumGaplessTailLevel() {
  return Math.max(
    Math.abs(Number(audioEnergy) || 0),
    Math.abs(Number(smoothEnergy) || 0),
    Math.abs(Number(bass) || 0) * 0.55,
    Math.abs(Number(mid) || 0) * 0.42,
    Math.abs(Number(treble) || 0) * 0.32
  );
}


function albumGaplessDirectTailSample() {
  if (!analyser || !audio || audio.paused) return null;
  try {
    var size = Math.max(32, Number(analyser.fftSize) || FFT_SIZE || 2048);
    if (!albumGaplessTailTimeData || albumGaplessTailTimeData.length !== size) {
      albumGaplessTailTimeData = new Uint8Array(size);
    }
    var freqSize = Math.max(16, Number(analyser.frequencyBinCount) || Math.floor(size / 2));
    if (!albumGaplessTailFreqData || albumGaplessTailFreqData.length !== freqSize) {
      albumGaplessTailFreqData = new Uint8Array(freqSize);
    }
    analyser.getByteTimeDomainData(albumGaplessTailTimeData);
    analyser.getByteFrequencyData(albumGaplessTailFreqData);
    var stride = Math.max(1, Math.floor(albumGaplessTailTimeData.length / 384));
    var sum = 0;
    var peak = 0;
    var count = 0;
    for (var i = 0; i < albumGaplessTailTimeData.length; i += stride) {
      var v = Math.abs((albumGaplessTailTimeData[i] - 128) / 128);
      sum += v * v;
      if (v > peak) peak = v;
      count++;
    }
    var freqStride = Math.max(1, Math.floor(albumGaplessTailFreqData.length / 256));
    var freqSum = 0;
    var freqPeak = 0;
    var freqCount = 0;
    for (var j = 0; j < albumGaplessTailFreqData.length; j += freqStride) {
      var f = albumGaplessTailFreqData[j] / 255;
      freqSum += f;
      if (f > freqPeak) freqPeak = f;
      freqCount++;
    }
    return {
      rms: Math.sqrt(sum / Math.max(1, count)),
      peak: peak,
      freqAvg: freqSum / Math.max(1, freqCount),
      freqPeak: freqPeak
    };
  } catch (e) {
    return null;
  }
}


function albumGaplessTailSilenceProbe(remaining) {
  if (!isFinite(remaining) || remaining > ALBUM_GAPLESS_PREROLL_SECONDS) {
    return { quiet: false, smoothedQuiet: false, directQuiet: false, deepQuiet: false, level: 1, rms: 1, peak: 1 };
  }
  var level = albumGaplessTailLevel();
  var sample = albumGaplessDirectTailSample();
  var rms = sample ? sample.rms : 1;
  var peak = sample ? sample.peak : 1;
  var freqAvg = sample ? sample.freqAvg : 1;
  var freqPeak = sample ? sample.freqPeak : 1;
  var deepQuiet = !!(sample && rms <= ALBUM_GAPLESS_DEEP_SILENCE_RMS && peak <= ALBUM_GAPLESS_DEEP_SILENCE_PEAK);
  var residualTail = !!(sample && !deepQuiet && (freqAvg > ALBUM_GAPLESS_RESIDUAL_FREQ_AVG || freqPeak > ALBUM_GAPLESS_RESIDUAL_FREQ_PEAK));
  var directQuiet = !!(sample && !residualTail && rms <= ALBUM_GAPLESS_DIRECT_SILENCE_RMS && peak <= ALBUM_GAPLESS_DIRECT_SILENCE_PEAK);
  var smoothedQuiet = level <= ALBUM_GAPLESS_SILENCE_LEVEL;
  return {
    quiet: smoothedQuiet || directQuiet,
    smoothedQuiet: smoothedQuiet,
    directQuiet: directQuiet,
    deepQuiet: deepQuiet,
    residualTail: residualTail,
    level: level,
    rms: rms,
    peak: peak,
    freqAvg: freqAvg,
    freqPeak: freqPeak
  };
}


function albumGaplessCurrentTailQuiet(remaining) {
  return albumGaplessTailSilenceProbe(remaining).quiet;
}


function startAlbumGaplessPreroll(preload) {
  if (!preload || !preload.media || preload.prerollStarted || preload.prerollPending || preload.prerollFailed) return false;
  preload.prerollPending = true;
  preload.prerollStarted = true;
  preload.prerollStartedAt = performance.now();
  preload.prerollStartTime = isFinite(preload.media.currentTime) ? preload.media.currentTime : 0;
  try {
    preload.media.muted = true;
    preload.media.volume = 0;
    preload.media.play().then(function () {
      preload.prerollPending = false;
      preload.prerollPlaying = true;
      preload.prerollLiveAt = performance.now();
    }).catch(function (err) {
      preload.prerollPending = false;
      preload.prerollFailed = true;
      console.warn('[AlbumGapless] preroll play failed:', err);
    });
    return true;
  } catch (err) {
    preload.prerollPending = false;
    preload.prerollFailed = true;
    console.warn('[AlbumGapless] preroll start failed:', err);
    return false;
  }
}


function albumGaplessDirectVolumeTarget() {
  return clampRange(Number(targetVolume) || 0, 0, 1);
}


function albumGaplessEqualPowerGains(progress, outgoingStart, incomingTarget) {
  var t = clampRange(Number(progress) || 0, 0, 1);
  var theta = t * Math.PI * 0.5;
  return {
    outgoing: clampRange((Number(outgoingStart) || 0) * Math.cos(theta), 0, 1),
    incoming: clampRange((Number(incomingTarget) || 0) * Math.sin(theta), 0, 1)
  };
}


function albumGaplessEqualPowerEntryProgress(elapsedMs, durationMs) {
  durationMs = Math.max(1, Number(durationMs) || 1);
  elapsedMs = clampRange(Number(elapsedMs) || 0, 0, durationMs);
  var whole = clampRange(elapsedMs / durationMs, 0, 1);
  if (whole >= 1) return 1;
  var attackMs = Math.min(ALBUM_GAPLESS_NEXT_ATTACK_MS, Math.max(1, durationMs - 1));
  var floorAngleProgress = Math.asin(ALBUM_GAPLESS_NEXT_ENTRY_FLOOR) / (Math.PI * 0.5);
  if (elapsedMs <= attackMs) {
    var attackT = clampRange(elapsedMs / attackMs, 0, 1);
    var attackEased = attackT * attackT * (3 - 2 * attackT);
    return floorAngleProgress * attackEased;
  }
  var releaseT = clampRange((elapsedMs - attackMs) / Math.max(1, durationMs - attackMs), 0, 1);
  var releaseEased = releaseT * releaseT * (3 - 2 * releaseT);
  return floorAngleProgress + (1 - floorAngleProgress) * releaseEased;
}


function runAlbumGaplessBalancedCrossfade(preload, durationMs) {
  if (!preload || !preload.media) return Promise.resolve(false);
  if (preload.fadeFrame) cancelAnimationFrame(preload.fadeFrame);
  var media = preload.media;
  var serial = ++audioFadeSerial;
  clearAudioFadeTimers();
  var startCurrent = currentAudioOutputGain();
  var initialTarget = Math.max(0.0001, albumGaplessDirectVolumeTarget());
  var outgoingRatio = clampRange(startCurrent / initialTarget, 0, 1);
  try {
    media.muted = false;
    media.volume = 0;
  } catch (e0) { }
  var started = performance.now();
  durationMs = Math.max(1, Number(durationMs) || 1);
  preload.fadeCompleted = false;
  return new Promise(function (resolve) {
    var settled = false;
    preload.fadeResolve = resolve;
    function finish(ok) {
      if (settled) return;
      settled = true;
      if (preload.fadeResolve === resolve) preload.fadeResolve = null;
      if (preload.fadeFrame) cancelAnimationFrame(preload.fadeFrame);
      if (preload.fadeWatchdogTimer) clearInterval(preload.fadeWatchdogTimer);
      preload.fadeFrame = 0;
      preload.fadeWatchdogTimer = 0;
      preload.fadeCompleted = !!ok;
      resolve(!!ok);
    }
    function applyStep(nowMs) {
      if (settled) return;
      if (serial !== audioFadeSerial || !preload.mixStarted || albumGaplessState.preload !== preload) {
        finish(false);
        return;
      }
      var elapsedMs = clampRange(nowMs - started, 0, durationMs);
      var t = clampRange(elapsedMs / durationMs, 0, 1);
      var curveProgress = albumGaplessEqualPowerEntryProgress(elapsedMs, durationMs);
      var liveTarget = albumGaplessDirectVolumeTarget();
      var gains = albumGaplessEqualPowerGains(curveProgress, liveTarget * outgoingRatio, liveTarget);
      writeAudioOutputGain(gains.outgoing);
      try {
        media.muted = false;
        media.volume = gains.incoming;
      } catch (e) { }
      if (t >= 1) {
        writeAudioOutputGain(0);
        try { media.volume = liveTarget; } catch (e2) { }
        finish(true);
      }
    }
    function tick(nowMs) {
      applyStep(nowMs);
      if (!settled) preload.fadeFrame = requestAnimationFrame(tick);
    }
    preload.fadeWatchdogTimer = setInterval(function () {
      applyStep(performance.now());
    }, ALBUM_GAPLESS_GAIN_STEP_MS);
    preload.fadeFrame = requestAnimationFrame(tick);
  });
}

'use strict';


function progressSeekPreviewVisualReady() {
  if (!lyricsLines || !lyricsLines.length || (fx && fx.particleLyrics === false)) return true;
  if (typeof stageLyricProgressSeekVisualReady !== 'function') return true;
  return stageLyricProgressSeekVisualReady(getProgressPreviewClockSeconds());
}

function clearProgressPreviewHold(serial) {
  if (serial && progressDragState.previewHoldSerial && serial !== progressDragState.previewHoldSerial) return false;
  progressDragState.previewHoldUntil = 0;
  progressDragState.previewHoldSerial = 0;
  progressDragState.previewClockRunning = false;
  progressDragState.previewClockShouldRun = false;
  progressDragState.previewAudioSettled = false;
  progressDragState.previewReleaseAt = 0;
  progressDragState.previewSettleTarget = 0;
  progressDragState.previewSettleStartedAt = 0;
  progressDragState.previewSettleMedia = null;
  progressDragState.previewSettleMediaSrc = '';
  return true;
}

function isProgressDragPreviewActive() {
  if (!progressDragState || progressDragState.previewDuration <= 0) return false;
  if (progressDragState.active) return true;
  var now = performance.now();
  if (progressDragState.previewHoldSerial) {
    if (progressDragState.previewAudioSettled && progressSeekPreviewVisualReady()) {
      if (!progressDragState.previewReleaseAt) {
        progressDragState.previewReleaseAt = now + Math.max(34, Number(progressDragState.previewReleaseDelay) || 96);
      }
      if (now < progressDragState.previewReleaseAt) return true;
      clearProgressPreviewHold(progressDragState.previewHoldSerial);
      return false;
    }
    progressDragState.previewReleaseAt = 0;
    if (progressDragState.previewHoldUntil > now) return true;
    var settleAge = now - (Number(progressDragState.previewSettleStartedAt) || now);
    var settleMedia = progressDragState.previewSettleMedia;
    if (settleAge < 5200 && settleMedia && progressSeekMediaStillCurrent(settleMedia, progressDragState.previewSettleMediaSrc)) {
      progressDragState.previewHoldUntil = now + 420;
      return true;
    }
    clearProgressPreviewHold(progressDragState.previewHoldSerial);
    return false;
  }
  progressDragState.previewClockRunning = false;
  return false;
}

function getProgressPreviewClockSeconds() {
  var t = Number(progressDragState.previewTime) || 0;
  if (!progressDragState.active && progressDragState.previewClockRunning && progressDragState.previewHoldUntil > performance.now()) {
    var elapsed = Math.max(0, (performance.now() - (Number(progressDragState.previewClockStartedAt) || performance.now())) / 1000);
    t = (Number(progressDragState.previewClockBase) || 0) + elapsed;
    if (progressDragState.previewDuration > 0) t = Math.min(t, progressDragState.previewDuration);
    progressDragState.previewTime = t;
  }
  return t;
}

function getProgressDragPreviewSeconds() {
  return isProgressDragPreviewActive() ? getProgressPreviewClockSeconds() : null;
}

function beginProgressPreviewHold(serial, holdMs, runClock, media, mediaSrc, targetTime) {
  progressDragState.previewHoldSerial = serial || progressDragState.previewHoldSerial || 0;
  progressDragState.previewClockRunning = false;
  progressDragState.previewClockShouldRun = !!runClock;
  progressDragState.previewAudioSettled = false;
  progressDragState.previewReleaseAt = 0;
  progressDragState.previewReleaseDelay = 96;
  progressDragState.previewSettleTarget = Math.max(0, Number(targetTime) || Number(progressDragState.previewTime) || 0);
  progressDragState.previewSettleStartedAt = performance.now();
  progressDragState.previewSettleMedia = media || null;
  progressDragState.previewSettleMediaSrc = mediaSrc || '';
  progressDragState.previewClockBase = Number(progressDragState.previewTime) || 0;
  progressDragState.previewClockStartedAt = performance.now();
  progressDragState.previewHoldUntil = performance.now() + Math.max(1200, Number(holdMs) || 2800);
  scheduleProgressLyricPreviewTick();
}

function finishProgressPreviewHold(serial, settleMs) {
  if (serial && progressDragState.previewHoldSerial && serial !== progressDragState.previewHoldSerial) return;
  var settleMedia = progressDragState.previewSettleMedia;
  var mediaSeconds = settleMedia && isFinite(Number(settleMedia.currentTime)) ? Math.max(0, Number(settleMedia.currentTime)) : null;
  if (mediaSeconds != null) progressDragState.previewTime = mediaSeconds;
  progressDragState.previewAudioSettled = true;
  progressDragState.previewReleaseDelay = Math.max(34, Number(settleMs) || 96);
  if (progressDragState.previewClockShouldRun) {
    progressDragState.previewClockRunning = true;
    progressDragState.previewClockBase = Number(progressDragState.previewTime) || 0;
    progressDragState.previewClockStartedAt = performance.now();
  }
  scheduleProgressLyricPreviewTick();
}

function scheduleProgressLyricPreviewTick() {
  if (typeof markRenderInteraction === 'function') markRenderInteraction('progress-drag', 420);
  if (typeof wakeMainLoopFromBackground === 'function') wakeMainLoopFromBackground();
  if (progressLyricPreviewRaf) return;
  var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 16); };
  progressLyricPreviewRaf = raf(function () {
    progressLyricPreviewRaf = 0;
    if (!isProgressDragPreviewActive()) return;
    // The main rAF loop is the sole lyric tick owner.  Calling it here as well
    // made a seek preview update the same track twice in one display frame.
    if (typeof wakeMainLoopFromBackground === 'function') wakeMainLoopFromBackground();
    if (isProgressDragPreviewActive()) scheduleProgressLyricPreviewTick();
  });
}

function normalizePlaybackDurationSeconds(value) {
  var raw = Number(value);
  if (!isFinite(raw) || raw <= 0) return 0;
  return raw > 1000 ? raw / 1000 : raw;
}

function playbackDurationFromSong(song) {
  if (!song) return 0;
  return normalizePlaybackDurationSeconds(song.duration || song.durationMs || song.dt || 0);
}

function getPlaybackDurationSeconds() {
  if (audio && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  return playbackDurationFromSong(currentCoverSong());
}

function getPlaybackCurrentSeconds() {
  return audio && isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime : 0;
}

function setProgressVisual(percent) {
  percent = clampRange(percent || 0, 0, 100);
  var fill = document.getElementById('progress-fill');
  var thumb = document.getElementById('progress-thumb');
  if (fill) { fill.style.width = '100%'; fill.style.transformOrigin = 'left center'; fill.style.transform = 'scaleX(' + percent / 100 + ')'; }
  if (thumb) thumb.style.left = percent + '%';
}

function updatePlaybackProgressUi() {
  if (isProgressDragPreviewActive() && progressDragState.previewDuration > 0) {
    renderProgressPreview(getProgressPreviewClockSeconds(), progressDragState.previewDuration);
    return;
  }
  var durationSec = getPlaybackDurationSeconds();
  var currentSec = getPlaybackCurrentSeconds();
  if (durationSec > 0 && currentSec > durationSec) currentSec = durationSec;
  setProgressVisual(durationSec > 0 ? (currentSec / durationSec * 100) : 0);
  var timeDisplay = document.getElementById('time-display');
  var label = formatProgramTime(currentSec) + ' / ' + (durationSec > 0 ? formatProgramTime(durationSec) : '0:00');
  if (timeDisplay && timeDisplay.textContent !== label) timeDisplay.textContent = label;
}

// Media timeupdate is typically only 4 Hz. One lightweight foreground rAF
// follows the audio clock without starting the visualizer or a second timer.
var playbackProgressFrame = 0;
function syncSmoothPlaybackProgress() {
  if (playbackProgressFrame) cancelAnimationFrame(playbackProgressFrame);
  playbackProgressFrame = 0;
  if (document.hidden || !audio || audio.paused || audio.ended || audio.seeking || audio.readyState < 2) return;
  playbackProgressFrame = requestAnimationFrame(function () {
    playbackProgressFrame = 0;
    updatePlaybackProgressUi(); syncSmoothPlaybackProgress();
  });
}


function playbackTransitionHasAudibleNextDeck() {
  var cuefieldMedia = typeof cuefieldAutoMixPreparedAudio !== 'undefined' ? cuefieldAutoMixPreparedAudio : null;
  if (
    typeof cuefieldAutoMixExecuting !== 'undefined'
    && cuefieldAutoMixExecuting
    && cuefieldMedia
    && cuefieldMedia !== audio
    && !cuefieldMedia.paused
    && !cuefieldMedia.ended
    && Number(cuefieldMedia.volume) > 0.001
  ) return true;
  var preload = typeof albumGaplessState !== 'undefined' && albumGaplessState ? albumGaplessState.preload : null;
  return !!(
    preload
    && preload.mixStarted
    && preload.media
    && preload.media !== audio
    && !preload.media.paused
    && !preload.media.ended
    && Number(preload.media.volume) > 0.001
  );
}


function bindPlaybackProgressEvents(audioEl) {
  if (!audioEl || audioEl._mineradioProgressBound) return;
  audioEl._mineradioProgressBound = true;
  ['playing', 'canplay', 'seeked', 'pause', 'ended', 'waiting', 'error', 'emptied'].forEach(function (name) {
    audioEl.addEventListener(name, function () { if (audioEl === audio) syncSmoothPlaybackProgress(); });
  });
  if (!bindPlaybackProgressEvents.visibilityBound) {
    bindPlaybackProgressEvents.visibilityBound = true;
    document.addEventListener('visibilitychange', function () { updatePlaybackProgressUi(); syncSmoothPlaybackProgress(); });
  }
  ['play', 'playing', 'waiting', 'stalled', 'canplay', 'timeupdate', 'seeked', 'pause', 'ended', 'error', 'abort', 'emptied'].forEach(function (name) {
    audioEl.addEventListener(name, function () {
      if (typeof syncPlaybackLoadingFromMediaEvent === 'function') syncPlaybackLoadingFromMediaEvent(audioEl, name);
    });
  });
  ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'play', 'pause', 'emptied'].forEach(function (name) {
    audioEl.addEventListener(name, updatePlaybackProgressUi);
  });
  audioEl.addEventListener('timeupdate', function () {
    if (typeof tickCuefieldAutoMix === 'function') tickCuefieldAutoMix();
  });
  ['play', 'playing', 'pause', 'ended', 'emptied', 'abort', 'error'].forEach(function (name) {
    audioEl.addEventListener(name, function () {
      if (audioEl !== audio) return;
      if (Number(audioEl.__mineradioTrackSwitchToken) !== Number(trackSwitchToken)) return;
      if (
        name !== 'emptied'
        && typeof playbackMediaMatchesCurrentQueueItem === 'function'
        && !playbackMediaMatchesCurrentQueueItem(audioEl)
      ) return;
      if (name === 'ended' && audioEl === audio && playbackTransitionHasAudibleNextDeck()) return;
      syncPlaybackStateFromAudioEvent(name);
      saveLastPlaybackSnapshot(name === 'pause' || name === 'ended', name);
    });
  });
  ['error', 'stalled'].forEach(function (name) {
    audioEl.addEventListener(name, function () {
      if (audioEl !== audio) return;
      if (Number(audioEl.__mineradioTrackSwitchToken) !== Number(trackSwitchToken)) return;
      if (typeof playbackMediaMatchesCurrentQueueItem === 'function' && !playbackMediaMatchesCurrentQueueItem(audioEl)) return;
      if (typeof schedulePlaybackStallRecovery === 'function') {
        schedulePlaybackStallRecovery(name, {
          silent: name !== 'error',
          ownerMedia: audioEl,
          ownerToken: trackSwitchToken,
          ownerQueueItemKey: String(audioEl.__mineradioQueueItemKey || '')
        });
      }
    });
  });
}

function emitProgressDragParticles(x, y) {
  var now = performance.now();
  if (now - progressDragState.lastParticleAt < 46) return;
  progressDragState.lastParticleAt = now;
  for (var i = 0; i < 3; i++) {
    var dot = document.createElement('span');
    dot.className = 'progress-drag-particle';
    var dx = (Math.random() - 0.5) * 34;
    var dy = -10 - Math.random() * 28;
    dot.style.setProperty('--px', x + 'px');
    dot.style.setProperty('--py', y + 'px');
    dot.style.setProperty('--dx', dx + 'px');
    dot.style.setProperty('--dy', dy + 'px');
    document.body.appendChild(dot);
    setTimeout((function (el) { return function () { if (el && el.parentNode) el.parentNode.removeChild(el); }; })(dot), 700);
  }
}

function renderProgressPreview(currentSec, durationSec) {
  currentSec = Math.max(0, Number(currentSec) || 0);
  durationSec = Math.max(0, Number(durationSec) || 0);
  if (durationSec > 0 && currentSec > durationSec) currentSec = durationSec;
  setProgressVisual(durationSec > 0 ? (currentSec / durationSec * 100) : 0);
  var timeDisplay = document.getElementById('time-display');
  if (timeDisplay) timeDisplay.textContent = formatProgramTime(currentSec) + ' / ' + (durationSec > 0 ? formatProgramTime(durationSec) : '0:00');
}

function progressPointerPreviewFromEvent(e) {
  var durationSec = getPlaybackDurationSeconds();
  if (!audio || !durationSec) return null;
  var bar = document.getElementById('progress-bar');
  if (!bar) return null;
  var rect = progressDragState.active && progressDragState.barRect
    ? progressDragState.barRect
    : bar.getBoundingClientRect();
  var width = Math.max(1, rect.width || 1);
  var ratio = clampRange((e.clientX - rect.left) / width, 0, 1);
  return { ratio: ratio, time: ratio * durationSec, duration: durationSec, rect: rect };
}

function queueProgressPointerPreview(e, emitParticles) {
  if (!e) return;
  progressDragState.pendingPointer = { clientX: Number(e.clientX) || 0, clientY: Number(e.clientY) || 0, emitParticles: !!emitParticles };
  if (progressDragState.pointerPreviewRaf) return;
  progressDragState.pointerPreviewRaf = requestAnimationFrame(function () {
    progressDragState.pointerPreviewRaf = 0;
    var pending = progressDragState.pendingPointer;
    progressDragState.pendingPointer = null;
    if (pending && progressDragState.active) previewProgressPointer(pending, pending.emitParticles);
  });
}

function flushProgressPointerPreview(e) {
  if (progressDragState.pointerPreviewRaf) {
    cancelAnimationFrame(progressDragState.pointerPreviewRaf);
    progressDragState.pointerPreviewRaf = 0;
  }
  var pending = progressDragState.pendingPointer;
  progressDragState.pendingPointer = null;
  if (e && isFinite(Number(e.clientX))) previewProgressPointer(e, false);
  else if (pending) previewProgressPointer(pending, false);
}

function previewProgressPointer(e, emitParticles) {
  var preview = progressPointerPreviewFromEvent(e);
  if (!preview) return false;
  progressDragState.previewTime = preview.time;
  progressDragState.previewDuration = preview.duration;
  progressDragState.previewClockRunning = false;
  renderProgressPreview(preview.time, preview.duration);
  // Beat-map cursors are committed once on pointer release.  Rewinding and
  // rescanning long beat arrays for every raw pointermove steals rAF time from
  // the continuous lyric track without changing audible playback.
  scheduleProgressLyricPreviewTick();
  if (emitParticles) emitProgressDragParticles(e.clientX, preview.rect.top + preview.rect.height / 2);
  return true;
}

function progressSeekTargetReached(media, targetTime, serial) {
  if (!media || serial !== progressDragState.commitSerial) return false;
  if (!progressSeekMediaStillCurrent(media, progressDragState.previewSettleMediaSrc)) return false;
  if (media.seeking || media.readyState < 2 || !isFinite(Number(media.currentTime))) return false;
  var current = Math.max(0, Number(media.currentTime) || 0);
  var target = Math.max(0, Number(targetTime) || 0);
  return current >= Math.max(0, target - 0.45) && current <= target + 1.5;
}

function waitForProgressSeekReady(media, targetTime, serial, timeoutMs) {
  if (!media) return Promise.resolve(false);
  if (progressSeekTargetReached(media, targetTime, serial)) return Promise.resolve(true);
  return new Promise(function (resolve) {
    var done = false;
    var timer = null;
    function cleanup() {
      if (timer) clearTimeout(timer);
      media.removeEventListener('seeked', onReady);
      media.removeEventListener('timeupdate', onReady);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('loadeddata', onReady);
      media.removeEventListener('playing', onReady);
      media.removeEventListener('error', onError);
    }
    function finish(ok) {
      if (done) return;
      done = true;
      cleanup();
      resolve(!!ok);
    }
    function onReady() {
      if (progressSeekTargetReached(media, targetTime, serial)) finish(true);
    }
    function onError() { finish(false); }
    media.addEventListener('seeked', onReady, { once: true });
    media.addEventListener('timeupdate', onReady);
    media.addEventListener('canplay', onReady);
    media.addEventListener('loadeddata', onReady);
    media.addEventListener('playing', onReady);
    media.addEventListener('error', onError, { once: true });
    timer = setTimeout(function () { finish(progressSeekTargetReached(media, targetTime, serial)); }, timeoutMs || 1800);
  });
}

function progressSeekMediaStillCurrent(media, mediaSrc) {
  return !!(media && audio === media && (media.currentSrc || media.src || '') === mediaSrc);
}

function restoreProgressSeekAudio(media, mediaSrc, resumeAfterSeek, serial) {
  if (serial !== progressDragState.commitSerial) return;
  if (!progressSeekMediaStillCurrent(media, mediaSrc)) {
    clearProgressPreviewHold(serial);
    return;
  }
  if (!resumeAfterSeek) {
    progressDragState.resumePlaySerial = 0;
    finishProgressPreviewHold(serial, 96);
    try { if (media && !media.paused) media.pause(); } catch (pauseErr) { }
    if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
    return;
  }
  if (progressDragState.resumePlaySerial !== serial || (media && media.paused)) {
    primeProgressSeekPlayback(media, mediaSrc, serial);
  }
  finishProgressPreviewHold(serial, 96);
}

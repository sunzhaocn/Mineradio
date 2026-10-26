'use strict';


function primeProgressSeekPlayback(media, mediaSrc, serial) {
  if (serial !== progressDragState.commitSerial) return false;
  if (!progressSeekMediaStillCurrent(media, mediaSrc)) return false;
  progressDragState.resumePlaySerial = serial;
  if (typeof attemptAudioPlay === 'function') {
    attemptAudioPlay({ manual: true, silent: true, fade: true });
    return true;
  }
  try {
    var playResult = media.play();
    if (playResult && playResult.then) {
      playResult.then(function () {
        if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return;
        if (typeof startPlaybackFadeIn === 'function') startPlaybackFadeIn();
        else if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
      }).catch(function () {
        if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return;
        if (typeof restorePlaybackGain === 'function') restorePlaybackGain();
      });
    }
    return true;
  } catch (e) {
    finishProgressPreviewHold(serial, 48);
    if (progressSeekMediaStillCurrent(media, mediaSrc) && typeof restorePlaybackGain === 'function') restorePlaybackGain();
    return false;
  }
}

function commitProgressSeek(targetTime, resumeAfterSeek) {
  var media = progressDragState.media || audio;
  if (!media) return;
  var durationSec = progressDragState.previewDuration || getPlaybackDurationSeconds();
  if (!durationSec) return;
  targetTime = clampRange(Number(targetTime) || 0, 0, durationSec);
  var mediaSrc = progressDragState.mediaSrc || (media.currentSrc || media.src || '');
  var serial = ++progressDragState.commitSerial;
  if (!progressSeekMediaStillCurrent(media, mediaSrc)) {
    clearProgressPreviewHold();
    progressDragState.resumePlaySerial = 0;
    return false;
  }
  progressDragState.previewTime = targetTime;
  progressDragState.previewDuration = durationSec;
  beginProgressPreviewHold(serial, 2800, !!resumeAfterSeek, media, mediaSrc, targetTime);
  if (typeof setAudioOutputGainImmediate === 'function') setAudioOutputGainImmediate(0);
  try {
    media.currentTime = targetTime;
  } catch (err) {
    console.warn('[ProgressSeek] commit failed:', err && (err.message || err));
    progressDragState.previewClockRunning = false;
    finishProgressPreviewHold(serial, 48);
    restoreProgressSeekAudio(media, mediaSrc, false, serial);
    return;
  }
  if (resumeAfterSeek) primeProgressSeekPlayback(media, mediaSrc, serial);
  renderProgressPreview(targetTime, durationSec);
  syncBeatMapPlaybackCursor(targetTime, true);
  saveLastPlaybackSnapshot(true, 'seek');
  waitForProgressSeekReady(media, targetTime, serial, 1800).then(function (ready) {
    if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return false;
    if (ready) return true;
    try { media.currentTime = targetTime; } catch (retryErr) { }
    return waitForProgressSeekReady(media, targetTime, serial, 1200);
  }).then(function (ready) {
    if (serial !== progressDragState.commitSerial || !progressSeekMediaStillCurrent(media, mediaSrc)) return;
    if (!ready) console.warn('[ProgressSeek] target did not settle before fallback handoff');
    restoreProgressSeekAudio(media, mediaSrc, !!resumeAfterSeek && !!ready, serial);
  });
}

function endProgressDrag(e, commit) {
  if (!progressDragState.active) return;
  flushProgressPointerPreview(e);
  var targetTime = progressDragState.previewTime;
  var resumeAfterSeek = progressDragState.resumeAfterSeek;
  var dragMedia = progressDragState.media;
  var dragMediaSrc = progressDragState.mediaSrc;
  progressDragState.active = false;
  progressDragState.barRect = null;
  progressBar.classList.remove('is-dragging');
  try { if (e && e.pointerId != null) progressBar.releasePointerCapture(e.pointerId); } catch (err) { }
  if (commit !== false) commitProgressSeek(targetTime, resumeAfterSeek);
  else {
    clearProgressPreviewHold();
    progressDragState.resumePlaySerial = 0;
    if (progressSeekMediaStillCurrent(dragMedia, dragMediaSrc) && typeof restorePlaybackGain === 'function') restorePlaybackGain();
  }
  progressDragState.media = null;
  progressDragState.mediaSrc = '';
  progressDragState.resumeAfterSeek = false;
  if (commit !== false && typeof scheduleCuefieldAutoMixPrepare === 'function') {
    scheduleCuefieldAutoMixPrepare(trackSwitchToken, currentIdx, 900);
  }
}
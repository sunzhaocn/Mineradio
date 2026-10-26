'use strict';

var progressDragState = {
  active: false,
  lastParticleAt: 0,
  previewTime: 0,
  previewDuration: 0,
  resumeAfterSeek: false,
  media: null,
  mediaSrc: '',
  commitSerial: 0,
  previewHoldUntil: 0,
  previewHoldSerial: 0,
  previewClockBase: 0,
  previewClockStartedAt: 0,
  previewClockRunning: false,
  previewClockShouldRun: false,
  previewAudioSettled: false,
  previewReleaseAt: 0,
  previewReleaseDelay: 96,
  previewSettleTarget: 0,
  previewSettleStartedAt: 0,
  previewSettleMedia: null,
  previewSettleMediaSrc: '',
  resumePlaySerial: 0,
  barRect: null,
  pendingPointer: null,
  pointerPreviewRaf: 0
};

var progressLyricPreviewRaf = 0;

var progressBar = document.getElementById('progress-bar');

progressBar.addEventListener('pointerdown', function (e) {
  if (!audio || !getPlaybackDurationSeconds()) return;
  if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('manual-seek');
  if (
    typeof albumGaplessState !== 'undefined'
    && albumGaplessState
    && albumGaplessState.preload
    && (albumGaplessState.preload.mixPending || albumGaplessState.preload.mixStarted)
    && typeof clearAlbumGaplessPreload === 'function'
  ) clearAlbumGaplessPreload('manual-seek');
  progressDragState.active = true;
  progressDragState.media = audio;
  progressDragState.mediaSrc = audio.currentSrc || audio.src || '';
  progressDragState.resumeAfterSeek = !!(audio && !audio.paused && !audio.ended && playing);
  progressDragState.previewTime = getPlaybackCurrentSeconds();
  progressDragState.previewDuration = getPlaybackDurationSeconds();
  progressDragState.barRect = progressBar.getBoundingClientRect();
  progressBar.classList.add('is-dragging');
  if (progressDragState.resumeAfterSeek) {
    if (typeof setAudioOutputGainImmediate === 'function') setAudioOutputGainImmediate(0);
    try { audio.pause(); } catch (pauseErr) { }
  }
  try { progressBar.setPointerCapture(e.pointerId); } catch (err) { }
  previewProgressPointer(e, true);
  scheduleProgressLyricPreviewTick();
});

progressBar.addEventListener('pointermove', function (e) {
  if (!progressDragState.active) return;
  queueProgressPointerPreview(e, true);
});

progressBar.addEventListener('pointerup', function (e) { endProgressDrag(e, true); });

progressBar.addEventListener('pointercancel', function (e) { endProgressDrag(e, false); });

progressBar.addEventListener('lostpointercapture', function (e) { endProgressDrag(e, true); });

setInterval(function () {
  if (!audio) {
    if (restoredLastPlaybackSnapshot && pendingPlaybackResumeAt > 0) applyRestoredPlaybackProgressUi(restoredLastPlaybackSnapshot);
    else updatePlaybackProgressUi();
    return;
  }
  if (progressDragState.active) {
    updatePlaybackProgressUi();
    return;
  }
  updateListenStatsTick(false);
  updatePlaybackProgressUi();
  saveLastPlaybackSnapshot(false, 'tick');
  if (audio.currentTime) updateLyricsHighlight();
}, 200);

// ============================================================
//  文件拖放

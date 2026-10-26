'use strict';

if (typeof window.addEventListener === 'function') window.addEventListener('mineradio:playback-intent', function (event) {
  cancelObsoleteTrackLyricRequests(event.detail && event.detail.token);
});


var lyricTranslationFallbackCache = {};

var lyricTranslationFallbackMissCache = {};

var lyricQueuePrefetchTimer = 0;

var lyricQueuePrefetchToken = 0;

var lyricQueuePrefetchBusy = false;

var lyricQueuePrefetchKeys = {};

var pendingTrackFallbackLyricTimer = 0;

// ============================================================
//  播放列表面板

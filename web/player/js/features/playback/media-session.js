'use strict';

// The hosted player also runs in Safari/WKWebView, where the local iOS bridge
// is absent. Publish only playback metadata through the standard media API.
(function () {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
  if (!navigator.mediaSession || typeof MediaMetadata !== 'function') return;
  var session = navigator.mediaSession, bound = null, signature = '';
  var fallback = new URL('/icons/icon-512.png', location.href).href;
  function currentSong() {
    return typeof currentIdx !== 'undefined' && Array.isArray(window.playQueue)
      ? window.playQueue[currentIdx] : null;
  }
  function artwork(song) {
    var cover = typeof songCoverSrc === 'function' ? songCoverSrc(song, 512) : song.cover;
    if (!cover) return fallback;
    try {
      var url = new URL(cover, location.href);
      if (url.protocol === 'blob:' || url.protocol === 'data:') return url.href;
      if (url.origin === location.origin) return url.href;
      return new URL('/api/cover?url=' + encodeURIComponent(url.href), location.href).href;
    } catch (_) { return fallback; }
  }
  function report() {
    if (window.mineradioIOSNativeMedia) return;
    var media = window.audio;
    if (!media) return;
    var channel = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mineradioAudio;
    if (channel) channel.postMessage({ op:'audio', playing:!media.paused && !media.ended,
      hidden:document.hidden, position:Number.isFinite(media.currentTime) ? media.currentTime : 0 });
    if (media !== bound) {
      if (bound) events.forEach(function (name) { bound.removeEventListener(name, report); });
      bound = media;
      events.forEach(function (name) { media.addEventListener(name, report); });
    }
    var song = currentSong();
    if (!song) return;
    var metadata = { title: String(song.name || song.title || 'Mineradio'),
      artist: String(song.artist || song.author || ''), album: String(song.album || ''),
      artwork: [{ src: artwork(song), sizes: '512x512' }] };
    var key = JSON.stringify(metadata);
    if (key !== signature) {
      try { session.metadata = new MediaMetadata(metadata); signature = key; } catch (_) {}
    }
    try { session.playbackState = media.paused || media.ended ? 'paused' : 'playing'; } catch (_) {}
    if (typeof session.setPositionState === 'function' && Number.isFinite(media.duration) && media.duration > 0) {
      try { session.setPositionState({ duration: media.duration,
        position: Math.max(0, Math.min(media.duration, Number(media.currentTime) || 0)),
        playbackRate: media.playbackRate > 0 ? media.playbackRate : 1 }); } catch (_) {}
    }
  }
  function action(name, value) {
    if (window.mineradioIOSNativeMedia || !window.audio) return;
    var media = window.audio;
    var active = typeof playbackResolutionRuntime === 'function' ? playbackResolutionRuntime().active : null;
    if (active && active.options && (name === 'play' || name === 'pause')) active.options.startPaused = name !== 'play';
    if (name === 'pause') {
      if (typeof audioFadeSerial !== 'undefined') audioFadeSerial++;
      if (typeof clearAudioFadeTimers === 'function') clearAudioFadeTimers();
      media.pause();
      if (typeof playing !== 'undefined') playing = false;
      if (typeof setPlayIcon === 'function') setPlayIcon(false);
      if (typeof syncPlaybackStateFromAudioEvent === 'function') syncPlaybackStateFromAudioEvent('media-session-pause');
    } else if (name === 'play' && (!active || !active.options)) {
      var promise = typeof attemptAudioPlay === 'function' ? attemptAudioPlay({ manual: true, fade: false }) : media.play();
      Promise.resolve(promise).catch(function () {});
    } else if (name === 'next' && typeof nextTrack === 'function') nextTrack(true);
    else if (name === 'previous' && typeof prevTrack === 'function') prevTrack(true);
    else if (name === 'seek' && Number.isFinite(value) && Number.isFinite(media.duration)) {
      media.currentTime = Math.max(0, Math.min(media.duration, value));
    }
    report();
  }
  var events = ['playing', 'pause', 'ended', 'seeked', 'loadedmetadata', 'durationchange', 'ratechange'];
  [['play','play'], ['pause','pause'], ['nexttrack','next'], ['previoustrack','previous']].forEach(function (pair) {
    try { session.setActionHandler(pair[0], function () { action(pair[1]); }); } catch (_) {}
  });
  try { session.setActionHandler('seekto', function (event) { action('seek', event.seekTime); }); } catch (_) {}
  window.addEventListener('mineradio:ready', report);
  window.addEventListener('mineradio:playback-intent', function () { setTimeout(report, 0); });
  document.addEventListener('visibilitychange', report);
  // Main audio can be replaced by gapless/automix and is not always in the DOM.
  setInterval(report, 500);
  report();
}());

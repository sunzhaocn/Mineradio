'use strict';
(function () {
  var scheduled = false;
  function reserved(media) {
    if (media === window.audio || !media.paused) return true;
    var next = typeof nextTrackPreloadRuntime === 'function' ? nextTrackPreloadRuntime().entry : null;
    if (next && next.media === media) return true;
    if (typeof albumGaplessState !== 'undefined' && albumGaplessState.preload && albumGaplessState.preload.media === media) return true;
    return typeof cuefieldAutoMixPreparedAudio !== 'undefined' && cuefieldAutoMixPreparedAudio === media;
  }
  function collect() {
    scheduled = false;
    document.querySelectorAll('audio#web-audio, audio[data-mineradio-managed]').forEach(function (media) {
      if (reserved(media)) return;
      media.onended = media.onerror = null;
      media.removeAttribute('src'); media.load(); media.remove();
    });
  }
  function schedule() { if (!scheduled) { scheduled = true; setTimeout(collect, 200); } }
  document.addEventListener('pause', schedule, true);
  document.addEventListener('ended', schedule, true);
  window.addEventListener('mineradio:playback-intent', schedule);
  document.addEventListener('visibilitychange', function () { if (document.hidden) schedule(); });
  window.mineradioMediaLifecycle = { collect: collect };
})();

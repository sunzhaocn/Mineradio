'use strict';
// Reflect media state on the phone. Track transitions have one separate owner.
(function () {
  var body = document.body, media = null, scheduled = false;
  var events = ['play', 'playing', 'pause', 'ended', 'emptied', 'error'];
  function visible() {
    return !document.hidden && body.classList.contains('web-adapter')
      && body.classList.contains('web-mobile-active') && body.dataset.mobilePage === 'player';
  }
  function bind(next) {
    if (media === next) return;
    if (media) events.forEach(function (name) { media.removeEventListener(name, sync); });
    media = next;
    if (media) events.forEach(function (name) { media.addEventListener(name, sync); });
  }
  function sync() {
    scheduled = false;
    bind(visible() && typeof audio !== 'undefined' && audio ? audio : null);
    var playing = !!(media && !media.paused && !media.ended && !media.error);
    if (body.classList.contains('web-player-playing') !== playing) body.classList.toggle('web-player-playing', playing);
  }
  function schedule() { if (!scheduled) { scheduled = true; Promise.resolve().then(sync); } }
  new MutationObserver(schedule).observe(body, { attributes: true, attributeFilter: ['class', 'data-mobile-page'] });
  var icon = document.getElementById('play-icon');
  if (icon) new MutationObserver(schedule).observe(icon, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('mineradio:ready', sync);
  window.addEventListener('pagehide', function () {
    bind(null); body.classList.remove('web-player-playing');
  });
  window.addEventListener('pageshow', sync);
  sync();
})();

'use strict';
(function () {
  var previous = -1, queue, effects = [], gesture, lastIntent = 0, lastDirection = 1;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  function cancel() { effects.forEach(function (effect) { effect.cancel(); }); effects = []; }
  window.addEventListener('mineradio:playback-intent', function (e) {
    var detail = e.detail || {}, index = detail.index;
    var direction = queue === window.playQueue && index < previous ? -1 : 1;
    var changed = queue !== window.playQueue || index !== previous;
    queue = window.playQueue; previous = index;
    lastIntent = performance.now(); lastDirection = direction;
    cancel();
    if (!changed || document.hidden || reduce.matches) return;
    ['control-cover', 'thumb-cover', 'control-title', 'control-artist'].forEach(function (id) {
      var node = document.getElementById(id);
      if (!node || !node.animate) return;
      var effect = node.animate([{ transform: 'translateX(' + direction * 36 + 'px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.7,.25,1)' });
      effects.push(effect);
      effect.finished.catch(function () {}).finally(function () { effects = effects.filter(function (item) { return item !== effect; }); });
    });
  });
  var artwork = document.getElementById('control-cover'), lastArtwork = '';
  if (artwork) new MutationObserver(function () {
    var current = artwork.style.backgroundImage;
    if (current === lastArtwork) return;
    lastArtwork = current;
    if (!current || current === 'none' || document.hidden || reduce.matches || performance.now() - lastIntent > 4000) return;
    var effect = artwork.animate([{ opacity: 0, transform: 'translateX(' + lastDirection * 24 + 'px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 300, easing: 'ease-out' });
    effects.push(effect);
    effect.finished.catch(function () {}).finally(function () { effects = effects.filter(function (item) { return item !== effect; }); });
  }).observe(artwork, { attributes: true, attributeFilter: ['style'] });
  // Only the artwork responds to horizontal gestures; lyrics retain scrolling.
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' || !e.target.closest('#control-cover, #thumb-cover')) return;
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }, { passive: true });
  document.addEventListener('pointerup', function (e) {
    var start = gesture; gesture = null;
    if (!start || start.id !== e.pointerId) return;
    var dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    e.preventDefault(); e.stopPropagation();
    if (dx < 0 && typeof nextTrack === 'function') nextTrack(true);
    else if (dx > 0 && typeof prevTrack === 'function') prevTrack();
    // Suppress the compatibility click which otherwise opens lyrics.
    var block = function (click) { click.preventDefault(); click.stopImmediatePropagation(); };
    document.addEventListener('click', block, { capture: true, once: true });
    setTimeout(function () { document.removeEventListener('click', block, true); }, 400);
  }, true);
  document.addEventListener('pointercancel', function () { gesture = null; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancel(); });
  window.addEventListener('pagehide', cancel);
})();

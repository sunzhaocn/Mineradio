'use strict';

// Keep scrollable content above the actual console, including text/zoom changes.
(function () {
  var body = document.body;
  var bar = document.getElementById('bottom-bar');
  var compact = window.matchMedia('(max-width: 1100px)');
  var frame = 0, visibilityKey = '';
  function sync() {
    frame = 0;
    if (!body.classList.contains('web-adapter') && !body.classList.contains('desktop-shell')) return;
    var viewport = window.visualViewport;
    var height = viewport ? viewport.height : window.innerHeight;
    var input = document.activeElement;
    var editing = input && (input.matches('input, textarea, select') || input.isContentEditable);
    body.classList.toggle('web-keyboard-open', !!(editing && viewport && window.innerHeight - height > 140));
    var shown = bar && bar.classList.contains('visible') && !body.classList.contains('home-controls-locked');
    if (!window.mineradioRemoteApp && shown && window.innerWidth <= 900 && bar.classList.contains('soft-hidden')
      && !body.classList.contains('immersive-mode') && typeof setControlsHidden === 'function') setControlsHidden(false);
    // Read layout before changing inherited variables. A desktop player needs
    // no console measurement; unchanged values must not invalidate the scene.
    var reserve = 24;
    if (shown && bar) {
      var bottom = parseFloat(getComputedStyle(bar).bottom) || 0;
      reserve = Math.ceil(bar.offsetHeight + bottom + 12);
    }
    var viewportValue = Math.round(height) + 'px', spaceValue = reserve + 'px';
    var actions = document.getElementById('top-right');
    if (actions) {
      var actionsValue = Math.ceil(actions.getBoundingClientRect().bottom) + 'px';
      if (body.style.getPropertyValue('--player-actions-bottom') !== actionsValue) body.style.setProperty('--player-actions-bottom',actionsValue);
    }
    if (body.style.getPropertyValue('--web-viewport-height') !== viewportValue) body.style.setProperty('--web-viewport-height', viewportValue);
    if (body.style.getPropertyValue('--web-player-space') !== spaceValue) body.style.setProperty('--web-player-space', spaceValue);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(sync); }
  function visibilityChanged() {
    var key = [body.classList.contains('web-adapter'), body.classList.contains('home-controls-locked'),
      body.classList.contains('immersive-mode'), body.classList.contains('web-mobile-active'),
      bar && bar.classList.contains('visible'), bar && bar.classList.contains('soft-hidden')].join('|');
    if (key === visibilityKey) return;
    visibilityKey = key; schedule();
  }
  if (window.ResizeObserver && bar) new ResizeObserver(schedule).observe(bar);
  var actions = document.getElementById('top-right');
  if (window.ResizeObserver && actions) new ResizeObserver(schedule).observe(actions);
  new MutationObserver(visibilityChanged).observe(body, { attributes: true, attributeFilter: ['class'] });
  if (bar) new MutationObserver(visibilityChanged).observe(bar, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('mineradio:ready', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule, { passive: true });
    window.visualViewport.addEventListener('scroll', schedule, { passive: true });
  }
  schedule();
})();

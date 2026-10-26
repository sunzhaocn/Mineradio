'use strict';

(function () {
  // Motion is a presentation layer: the library keeps ownership of its data,
  // focus, navigation and click handlers.
  function initialize() {
    var body = document.body;
    var mask = document.getElementById('web-library-mask');
    var content = document.getElementById('web-library-content');
    if (!body || !mask || !content || typeof MutationObserver !== 'function') return;

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var animations = new Set();
    var feedback = new WeakMap();
    var frame = 0;
    var visible = false;
    var signature = '';

    function available() {
      return !mask.hidden && body.classList.contains('web-adapter')
        && !body.classList.contains('web-mobile-active');
    }

    function stop(record) {
      animations.delete(record);
      record.animation.cancel();
    }

    function cancelAll() {
      Array.from(animations).forEach(stop);
    }

    function animate(node, keyframes, options, kind) {
      if (reducedMotion.matches || document.hidden || !node || typeof node.animate !== 'function') return;
      var animation = node.animate(keyframes, options);
      var record = { node: node, animation: animation, kind: kind };
      animations.add(record);
      function release() {
        animations.delete(record);
        if (feedback.get(node) === record) feedback.delete(node);
      }
      // Do not read Animation.finished: cancellation must not create rejected
      // promises when the user switches routes or filters rapidly.
      animation.addEventListener('finish', release, { once: true });
      animation.addEventListener('cancel', release, { once: true });
      return record;
    }

    function structureSignature() {
      var active = mask.querySelector('#web-library-tabs .active');
      var manage = document.getElementById('web-library-manage');
      var parts = [active ? active.textContent : '', manage ? manage.getAttribute('aria-pressed') : ''];
      // Playlist names, counts and import progress may update many times while
      // render() replaces every node. Only a structural change replays motion.
      content.querySelectorAll('[data-library-provider], [data-library-key], .web-library-provider-notice, .web-library-empty, .web-library-manage-hint, .web-library-restore').forEach(function (node) {
        if (node.dataset.libraryProvider) {
          var toggle = node.querySelector('.web-library-platform-toggle');
          parts.push('provider', node.dataset.libraryProvider, toggle ? toggle.textContent : '');
        } else if (node.dataset.libraryKey) {
          parts.push('card', node.dataset.libraryKey, node.classList.contains('is-hidden') ? 'hidden' : 'visible');
        } else parts.push(node.className);
      });
      return JSON.stringify(parts);
    }

    function reveal(full) {
      Array.from(animations).forEach(function (record) {
        if (record.kind === 'reveal') stop(record);
      });
      if (full) {
        ['.web-library-head', '.web-library-toolbar'].forEach(function (selector, index) {
          animate(mask.querySelector(selector), [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ], { duration: 300, delay: index * 35, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }, 'reveal');
        });
      }
      animate(content, [
        { opacity: 0.45, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' }, 'reveal');

      // Bound both the stagger and the work. Cards below the scroll viewport
      // stay fully visible and never wait for an entrance animation.
      var bounds = content.getBoundingClientRect();
      var cards = content.querySelectorAll('.web-library-card, .web-library-provider-notice');
      var count = 0;
      for (var index = 0; index < cards.length && index < 32 && count < 12; index++) {
        var card = cards[index];
        var rect = card.getBoundingClientRect();
        if (rect.top >= bounds.bottom) break;
        if (rect.bottom <= bounds.top) continue;
        var opacity = window.getComputedStyle(card).opacity;
        animate(card, [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: opacity, transform: 'translateY(0)' }
        ], { duration: 280, delay: count * 24, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }, 'reveal');
        count++;
      }
    }

    function sync() {
      frame = 0;
      if (!available()) {
        visible = false;
        signature = '';
        cancelAll();
        return;
      }
      // Identical rerenders detach card nodes; release their animations even
      // when the signature correctly prevents a new entrance.
      Array.from(animations).forEach(function (record) {
        if (!record.node.isConnected) stop(record);
      });
      var next = structureSignature();
      var full = !visible;
      visible = true;
      if (full || next !== signature) reveal(full);
      signature = next;
    }

    function schedule() {
      if (!available()) {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        sync();
      } else if (!frame) frame = window.requestAnimationFrame(sync);
    }

    function press(event) {
      if (!available() || reducedMotion.matches || document.hidden) return;
      if (event.type === 'pointerdown' && (event.isPrimary === false || event.button !== 0)) return;
      if (event.type === 'click' && event.detail !== 0) return;
      var node = event.target.closest && event.target.closest('button');
      if (!node || !mask.contains(node) || node.disabled) return;
      var previous = feedback.get(node);
      if (previous) stop(previous);
      var record = animate(node, [
        { transform: 'scale(1)' },
        { transform: 'scale(.97)', offset: 0.35 },
        { transform: 'scale(1)' }
      ], { duration: 210, easing: 'ease-out' }, 'press');
      if (record) feedback.set(node, record);
    }

    new MutationObserver(schedule).observe(mask, { attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(schedule).observe(body, { attributes: true, attributeFilter: ['class', 'data-mobile-page'] });
    new MutationObserver(schedule).observe(content, { childList: true, subtree: true });
    mask.addEventListener('pointerdown', press, { capture: true, passive: true });
    mask.addEventListener('click', press, { capture: true, passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) cancelAll();
    });
    function motionPreferenceChanged() {
      if (reducedMotion.matches) cancelAll();
    }
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', motionPreferenceChanged);
    else if (reducedMotion.addListener) reducedMotion.addListener(motionPreferenceChanged);
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();

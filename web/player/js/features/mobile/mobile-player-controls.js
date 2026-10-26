'use strict';

// Move the real controls so their event listeners, state and popover anchors stay
// intact. Comment markers restore the exact desktop/mini-player DOM on exit.
(function () {
  var body = document.body;
  var mobile = window.matchMedia('(max-width: 900px)');
  var moves = [], labels = [], mounted = false, scheduled = false;
  var stage, dock, more, moreButton;
  var mainIds = ['play-mode-btn', 'prev-btn', 'play-btn', 'next-btn'];
  var secondary = [
    ['heart-btn', '喜欢'], ['web-download-btn', '下载'], ['collect-btn', '收藏歌单'],
    ['lyric-timing-control', '歌词与校准', 'lyrics-toggle-btn'],
    ['volume-control', '淡入淡出', 'volume-btn'],
    ['quality-control', '音质', 'quality-btn'],
    ['personal-radio-toggle', '随心听'], ['control-title-badges', '切换音源', null, true]
  ];

  function available() {
    return mobile.matches && body.classList.contains('web-adapter')
      && body.classList.contains('web-mobile-active') && body.dataset.mobilePage === 'player';
  }
  function find(selector) {
    return selector.charAt(0) === '.' ? document.querySelector(selector) : document.getElementById(selector);
  }
  function create(tag, id) {
    var element = document.createElement(tag);
    if (id) element.id = id;
    return element;
  }
  function move(element, parent) {
    if (!element || !element.parentNode) return;
    var marker = document.createComment('mobile-player: ' + (element.id || element.className));
    element.parentNode.insertBefore(marker, element);
    moves.push({ element: element, marker: marker });
    parent.appendChild(element);
  }
  function label(button, text) {
    if (!button) return;
    var caption = create('span'); caption.className = 'web-player-more-label'; caption.textContent = text;
    labels.push({ button: button, caption: caption, aria: button.getAttribute('aria-label') });
    button.appendChild(caption);
    button.setAttribute('aria-label', text);
  }
  function closeMore(returnFocus) {
    if (!more || more.hidden) return;
    var anchor = window.webAnchoredMenus && window.webAnchoredMenus.activeAnchor();
    if (anchor && more.contains(anchor)) window.webAnchoredMenus.closeAll('mobile-player-more-closed');
    var focused = document.activeElement;
    if (focused && more.contains(focused) && focused.blur) focused.blur();
    if (typeof closeVolumePanel === 'function') closeVolumePanel();
    if (typeof closeLyricTimingPopover === 'function') closeLyricTimingPopover(true);
    var timing = document.getElementById('lyric-timing-control');
    if (timing) timing.classList.remove('web-mobile-player-timing-open');
    if (typeof closeControlSourceSwitcher === 'function') closeControlSourceSwitcher();
    more.hidden = true;
    body.classList.remove('web-mobile-more-open');
    if (stage) { stage.inert = false; stage.removeAttribute('aria-hidden'); }
    moreButton.setAttribute('aria-expanded', 'false');
    if (returnFocus && moreButton.focus) moreButton.focus({ preventScroll: true });
  }
  function toggleMore(event) {
    event.preventDefault();
    if (!mounted) return;
    if (!more.hidden) { closeMore(); return; }
    more.hidden = false;
    body.classList.add('web-mobile-more-open');
    if (stage) { stage.inert = true; stage.setAttribute('aria-hidden', 'true'); }
    moreButton.setAttribute('aria-expanded', 'true');
    if (event.detail === 0) {
      var first = more.querySelector('button');
      if (first && first.focus) first.focus({ preventScroll: true });
    }
  }
  function mount() {
    var bar = document.getElementById('bottom-bar');
    var track = bar && bar.querySelector('.control-track');
    if (!bar || !track || !document.getElementById('play-btn')) return;
    stage = create('div', 'web-player-stage');
    dock = create('div', 'web-player-dock');
    var timeRow = create('div'); timeRow.className = 'web-player-time-row';
    var row = create('div', 'web-player-controls-row');
    more = create('section', 'web-player-more'); more.hidden = true;
    more.setAttribute('aria-label', '更多播放控制');
    var heading = create('div'); heading.className = 'web-player-more-heading'; heading.textContent = '更多播放控制';
    more.appendChild(heading);
    moreButton = create('button', 'web-player-more-btn');
    moreButton.type = 'button'; moreButton.className = 'ctrl-btn';
    moreButton.title = '更多播放控制'; moreButton.setAttribute('aria-label', '更多播放控制');
    moreButton.setAttribute('aria-expanded', 'false'); moreButton.setAttribute('aria-controls', more.id);
    moreButton.innerHTML = '<svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
    moreButton.addEventListener('click', toggleMore);
    bar.append(stage, dock);
    move(track, stage);
    move(document.getElementById('progress-bar'), dock);
    dock.append(timeRow, row, more);
    move(document.getElementById('time-display'), timeRow);
    mainIds.forEach(function (id) { move(document.getElementById(id), row); });
    row.appendChild(moreButton);
    secondary.forEach(function (definition) {
      var element = find(definition[0]);
      if (!element) return;
      var badge = element.id === 'heart-btn' && element.nextElementSibling;
      if (badge && !badge.classList.contains('web-heart-badges')) badge = null;
      var item = create('div'); item.className = 'web-player-more-item';
      if (definition[3]) item.classList.add('web-player-more-item-source');
      more.appendChild(item);
      move(element, item);
      if (badge) move(badge, item);
      if (definition[3]) {
        // This badge container is replaced on track changes. Keep its caption
        // outside so refreshed provider buttons retain their original behavior.
        var caption = create('span'); caption.className = 'web-player-more-label'; caption.textContent = definition[1];
        item.appendChild(caption);
      } else label(definition[2] ? document.getElementById(definition[2]) : element, definition[1]);
    });
    mounted = true;
    body.classList.add('web-mobile-player-controls');
    window.dispatchEvent(new Event('web-mobile-player-layout'));
  }
  function restore() {
    if (!mounted) return;
    closeMore();
    var heart = document.getElementById('heart-btn');
    var freshBadge = heart && heart.nextElementSibling;
    if (!freshBadge || !freshBadge.classList.contains('web-heart-badges')
      || moves.some(function (entry) { return entry.element === freshBadge; })) freshBadge = null;
    labels.forEach(function (entry) {
      entry.caption.remove();
      // A provider may update the real button's state while More is open.
      if (entry.button.getAttribute('aria-label') === entry.caption.textContent) {
        if (entry.aria === null) entry.button.removeAttribute('aria-label');
        else entry.button.setAttribute('aria-label', entry.aria);
      }
    });
    labels = [];
    moves.forEach(function (entry) {
      if (entry.marker.parentNode) entry.marker.parentNode.insertBefore(entry.element, entry.marker);
      entry.marker.remove();
    });
    moves = [];
    if (freshBadge && heart) heart.insertAdjacentElement('afterend', freshBadge);
    // Lyrics retain their own DOM references and attach to the next stage on
    // the layout event. Remove this stage immediately to avoid duplicate IDs
    // when the user leaves and returns before queued observers have run.
    stage.remove();
    dock.remove();
    stage = dock = more = moreButton = null;
    mounted = false;
    body.classList.remove('web-mobile-player-controls');
    window.dispatchEvent(new Event('web-mobile-player-layout'));
  }
  function sync() {
    scheduled = false;
    if (available()) { if (!mounted) mount(); }
    else restore();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(sync);
  }
  document.addEventListener('pointerdown', function (event) {
    if (!mounted || !more || more.hidden || more.contains(event.target) || moreButton.contains(event.target)) return;
    // Quality/download menus are portaled to body. Keep their real anchors
    // visible in More until the user finishes interacting with those menus.
    if (event.target.closest && (event.target.closest('.web-anchored-menu') || event.target.closest('.control-source-switcher'))) return;
    closeMore();
  }, true);
  document.addEventListener('keydown', function (event) {
    if (mounted && event.target.id === 'lyrics-toggle-btn' && event.key === 'ArrowDown') {
      event.preventDefault(); event.stopImmediatePropagation();
      var timing = document.getElementById('lyric-timing-control');
      timing.classList.add('web-mobile-player-timing-open');
      var action = timing.querySelector('[data-lyric-offset-reset]');
      if (action) action.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Escape' && more && !more.hidden) { event.preventDefault(); closeMore(true); }
  });
  // The desktop hover handler opens Volume before pointerdown. Expanding a
  // grid cell at that point moves a different button under the pointer.
  ['mouseenter', 'mouseleave'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (mounted && event.target.id === 'volume-control') event.stopImmediatePropagation();
    }, true);
  });
  new MutationObserver(schedule).observe(body, { attributes: true, attributeFilter: ['class', 'data-mobile-page'] });
  mobile.addEventListener('change', sync);
  window.addEventListener('mineradio:ready', sync);
  window.webMobilePlayerControls = { sync: sync, closeMore: closeMore };
  sync();
})();

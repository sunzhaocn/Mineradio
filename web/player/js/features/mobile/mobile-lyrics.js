'use strict';

// Album and lyrics share one stage; the transport never moves between views.
(function () {
  var panel, list, button, cover, timer = 0, pressedAt = 0, manualUntil = 0;
  var source = null, token = null, lines = [], rows = [], current = -1, opened = false;
  var gesture = null, dragged = false;
  var requestedKey = '', loadingKey = '', playbackLoading = false;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function available() {
    var nav = window.webMobileNavigation;
    return !!(nav && nav.active() && nav.current() === 'player');
  }
  function stopUpdates() { clearInterval(timer); timer = 0; }
  function semantics() {
    cover = document.getElementById('control-cover');
    button = document.getElementById('lyrics-toggle-btn');
    if (button) {
      button.setAttribute('aria-controls', 'web-mobile-lyrics');
      button.setAttribute('aria-expanded', String(opened));
    }
    if (!cover || !available()) return;
    cover.setAttribute('aria-label', '显示歌词'); cover.setAttribute('title', '轻点查看歌词');
    cover.setAttribute('aria-expanded', String(opened));
    cover.setAttribute('aria-controls', 'web-mobile-lyrics');
    cover.setAttribute('aria-hidden', String(opened));
    cover.tabIndex = opened ? -1 : 0;
  }
  function close(focusCover) {
    opened = false; stopUpdates();
    if (document.body.classList.contains('web-mobile-lyrics-open')) document.body.classList.remove('web-mobile-lyrics-open');
    if (panel) { panel.inert = true; panel.setAttribute('aria-hidden', 'true'); }
    semantics();
    if (focusCover && cover && available()) cover.focus({ preventScroll: true });
  }
  function ensurePanel() {
    var stage = document.getElementById('web-player-stage');
    if (!stage) return false;
    if (!panel) {
      panel = document.createElement('section'); panel.id = 'web-mobile-lyrics';
      panel.setAttribute('aria-label', '当前歌曲歌词'); panel.setAttribute('aria-hidden', 'true'); panel.inert = true;
      list = document.createElement('div'); list.className = 'web-mobile-lyric-list';
      list.tabIndex = 0; list.setAttribute('aria-label', '上下滑动浏览歌词，轻点或按回车返回唱片');
      function manual() { manualUntil = Date.now() + 4000; }
      list.addEventListener('pointerdown', function (event) {
        manual(); gesture = { x: event.clientX, y: event.clientY, scroll: list.scrollTop }; dragged = false;
      }, { passive: true });
      list.addEventListener('pointermove', function (event) {
        if (gesture && (Math.abs(event.clientX - gesture.x) > 8 || Math.abs(event.clientY - gesture.y) > 8)) dragged = true;
      }, { passive: true });
      list.addEventListener('pointercancel', function () { dragged = true; gesture = null; }, { passive: true });
      list.addEventListener('wheel', function () { manual(); dragged = true; }, { passive: true });
      list.addEventListener('keydown', function (event) {
        manual();
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); close(true); }
      });
      list.addEventListener('click', function (event) {
        if (dragged || (gesture && Math.abs(list.scrollTop - gesture.scroll) > 8)) { dragged = false; gesture = null; return; }
        event.stopPropagation(); close(true); gesture = null;
      });
      panel.append(list);
    }
    if (panel.parentElement !== stage) stage.appendChild(panel);
    return true;
  }
  function rebuild(raw, nextToken) {
    source = raw; token = nextToken; current = -1;
    lines = raw.filter(function (line) {
      return line && !line.fallback && isFinite(Number(line.t)) && String(line.text || '').trim()
        && !(typeof isNoLyricText === 'function' && isNoLyricText(line.text));
    }).slice().sort(function (a, b) { return Number(a.t) - Number(b.t); });
    rows = []; list.replaceChildren(); list.scrollTop = 0; manualUntil = 0;
    if (!lines.length) {
      var empty = document.createElement('p'); empty.className = 'web-mobile-lyric-empty';
      empty.textContent = loadingKey ? '正在加载歌词…' : '暂无歌词'; list.appendChild(empty);
    }
    lines.forEach(function (line) {
      var row = document.createElement('p'); row.className = 'web-mobile-lyric-line';
      row.textContent = String(line.text);
      if (line.translation) {
        var translation = document.createElement('small'); translation.textContent = String(line.translation); row.appendChild(translation);
      }
      rows.push(row); list.appendChild(row);
    });
  }
  function update() {
    if (!opened) return;
    if (!available()) { close(false); return; }
    if (document.hidden) return;
    if (typeof playbackLyricsAreLoading === 'function' && playbackLyricsAreLoading()) {
      if (!playbackLoading) {
        var waiting = document.createElement('p'); waiting.className = 'web-mobile-lyric-audio-loading';
        waiting.textContent = '音乐加载中…'; waiting.setAttribute('role', 'status');
        list.replaceChildren(waiting); source = null; token = null; lines = []; rows = []; current = -1;
      }
      playbackLoading = true;
      var loadingRow = list.querySelector('.web-mobile-lyric-audio-loading');
      if (loadingRow && typeof playbackLoadingLyricRevealProgress === 'function') loadingRow.style.opacity = String(playbackLoadingLyricRevealProgress());
      return;
    }
    if (playbackLoading) { playbackLoading = false; source = null; token = null; }
    var raw = typeof lyricsLines !== 'undefined' && Array.isArray(lyricsLines) ? lyricsLines : [];
    var nextToken = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : null;
    // Restored paused songs may not have fetched lyrics yet. Use the normal
    // token-guarded loader once for this song; opening lyrics never starts audio.
    if (!raw.length && typeof fetchLyric === 'function' && typeof currentLyricSong === 'function') {
      var song = currentLyricSong();
      var key = song && [nextToken, song.source || song.provider || '', song.id || song.hash || song.name || song.title || ''].join(':');
      if (song && key !== requestedKey) {
        requestedKey = loadingKey = key;
        Promise.resolve().then(function () { return fetchLyric(song, nextToken); }).catch(function () {}).then(function () {
          if (loadingKey !== key) return;
          loadingKey = ''; source = null;
          if (opened && available()) update();
        });
      }
    }
    if (source !== raw || token !== nextToken) rebuild(raw, nextToken);
    var time = typeof getPlaybackCurrentSeconds === 'function' ? getPlaybackCurrentSeconds()
      : (typeof audio !== 'undefined' && audio ? Number(audio.currentTime) || 0 : 0);
    if (typeof getAdjustedLyricPlaybackTime === 'function') time = getAdjustedLyricPlaybackTime(time);
    var lo = 0, hi = lines.length - 1, next = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (Number(lines[mid].t) <= time) { next = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (next === current) return;
    if (rows[current]) { rows[current].classList.remove('current'); rows[current].removeAttribute('aria-current'); }
    current = next;
    if (rows[current]) {
      rows[current].classList.add('current'); rows[current].setAttribute('aria-current', 'true');
      if (Date.now() > manualUntil) list.scrollTo({ top: Math.max(0, rows[current].offsetTop - list.clientHeight * 0.4), behavior: 'auto' });
    }
  }
  function toggle() {
    if (opened) { close(true); return; }
    if (!ensurePanel()) return;
    opened = true; source = null; dragged = false; gesture = null;
    panel.inert = false; panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('web-mobile-lyrics-open'); semantics();
    if (typeof closeLyricTimingPopover === 'function') closeLyricTimingPopover(true);
    if (window.webMobilePlayerControls) window.webMobilePlayerControls.closeMore();
    update(); if (!document.hidden) timer = setInterval(update, 250);
    list.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', function (event) {
    if (available() && event.target.closest('#lyrics-toggle-btn')) pressedAt = performance.now();
  }, true);
  document.addEventListener('click', function (event) {
    if (!available() || !event.target.closest('#lyrics-toggle-btn, #control-cover')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    var held = event.detail && pressedAt ? performance.now() - pressedAt : 0; pressedAt = 0;
    if (event.target.closest('#lyrics-toggle-btn') && held > 450) {
      var timing = document.getElementById('lyric-timing-control');
      if (timing) timing.classList.add('web-mobile-player-timing-open');
      return;
    }
    toggle();
  }, true);
  document.addEventListener('keydown', function (event) {
    if (available() && event.target.closest('#control-cover') && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopImmediatePropagation(); toggle();
    } else if (opened && event.key === 'Escape') { event.preventDefault(); close(true); }
  }, true);
  function sync() {
    if (!available()) {
      close(false);
      if (panel && panel.parentElement) panel.remove();
      if (cover) {
        cover.removeAttribute('aria-expanded'); cover.removeAttribute('aria-controls'); cover.removeAttribute('aria-hidden'); cover.tabIndex = 0;
        cover.title = window.webMobileNavigation && window.webMobileNavigation.active() ? '打开播放页' : '专辑详情';
      }
      if (button) { button.removeAttribute('aria-controls'); button.removeAttribute('aria-expanded'); }
      return;
    }
    ensurePanel(); semantics();
  }
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-mobile-page'] });
  document.addEventListener('visibilitychange', function () {
    stopUpdates(); if (opened && !document.hidden && available()) { update(); timer = setInterval(update, 250); }
  });
  window.addEventListener('pagehide', function () { close(false); });
  window.addEventListener('mineradio:ready', sync);
  window.addEventListener('web-mobile-player-layout', sync);
  sync();
})();


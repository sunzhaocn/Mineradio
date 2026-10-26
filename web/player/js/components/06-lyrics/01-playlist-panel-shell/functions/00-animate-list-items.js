'use strict';

// ============================================================
function animateListItems(container, selector, opts) {
  if (!container) return;
  opts = opts || {};
  var items = Array.prototype.slice.call(container.querySelectorAll(selector));
  if (!items.length) return;
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) {
    if (window.gsap) window.gsap.killTweensOf(items);
    items.forEach(function (item) {
      ['opacity', 'visibility', 'transform', 'filter'].forEach(function (property) { item.style.removeProperty(property); });
    });
    return;
  }
  if (!window.gsap) return;
  var limit = opts.limit || 18;
  var targets = items.slice(0, limit);
  window.gsap.killTweensOf(targets);
  window.gsap.fromTo(targets, {
    autoAlpha: 0,
    y: opts.y == null ? 8 : opts.y,
    x: opts.x == null ? -6 : opts.x
  }, {
    autoAlpha: 1,
    y: 0,
    x: 0,
    duration: opts.duration || 0.22,
    stagger: opts.stagger || 0.012,
    ease: opts.ease || 'power2.out',
    force3D: true,
    overwrite: true
  });
}

function smoothScrollToItem(scroller, item, opts) {
  if (!scroller || !item) return;
  opts = opts || {};
  var target = item.offsetTop - Math.max(0, (scroller.clientHeight - item.offsetHeight) * (opts.align == null ? 0.42 : opts.align));
  target = Math.max(0, Math.min(target, Math.max(0, scroller.scrollHeight - scroller.clientHeight)));
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) {
    if (typeof scroller.__syncSmoothWheelTarget === 'function') scroller.__syncSmoothWheelTarget(target);
    if (window.gsap) window.gsap.killTweensOf(scroller);
    scroller.scrollTop = target;
    return;
  }
  if (window.gsap) {
    if (typeof scroller.__syncSmoothWheelTarget === 'function') scroller.__syncSmoothWheelTarget(target);
    window.gsap.killTweensOf(scroller);
    window.gsap.to(scroller, { scrollTop: target, duration: opts.duration || 0.30, ease: opts.ease || 'power2.out', overwrite: true });
  } else if (scroller.scrollTo) {
    scroller.scrollTo({ top: target, behavior: 'smooth' });
  } else {
    scroller.scrollTop = target;
  }
}

function bindSmoothWheelScroll(scroller) {
  if (!scroller || scroller.__smoothWheelBound) return;
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  scroller.__smoothWheelBound = true;
  var targetTop = scroller.scrollTop;
  var tween = null;
  scroller.__syncSmoothWheelTarget = function (top) {
    if (tween) {
      tween.kill();
      tween = null;
    }
    targetTop = isFinite(top) ? top : scroller.scrollTop;
  };
  scroller.addEventListener('wheel', function (e) {
    if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) {
      if (tween) tween.kill();
      tween = null;
      targetTop = scroller.scrollTop;
      return;
    }
    if (!window.gsap || e.ctrlKey) return;
    var max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (max <= 0 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    var delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 18;
    else if (e.deltaMode === 2) delta *= scroller.clientHeight;
    var current = tween ? targetTop : scroller.scrollTop;
    var next = Math.max(0, Math.min(max, current + delta));
    if (next === current && ((delta < 0 && scroller.scrollTop <= 0) || (delta > 0 && scroller.scrollTop >= max - 1))) {
      targetTop = scroller.scrollTop;
      return;
    }
    e.preventDefault();
    targetTop = next;
    if (tween) tween.kill();
    tween = window.gsap.to(scroller, {
      scrollTop: targetTop,
      duration: 0.24,
      ease: 'power2.out',
      overwrite: true,
      onComplete: function () {
        tween = null;
        targetTop = scroller.scrollTop;
      }
    });
  }, { passive: false });
  scroller.addEventListener('scroll', function () {
    if (!tween) targetTop = scroller.scrollTop;
  }, { passive: true });
}

function bindSmoothQueueScrolling() {
  if (smoothWheelScrollBound) return;
  smoothWheelScrollBound = true;
  [
    'mini-queue-list',
    'search-results',
    'fx-panel',
    'playlist-panel',
    'track-detail-body'
  ].forEach(function (id) {
    bindSmoothWheelScroll(document.getElementById(id));
  });
}

function animateVisiblePanelList(listEl, selector, scroller, activeSelector, opts) {
  if (!listEl) return;
  opts = opts || {};
  requestAnimationFrame(function () {
    animateListItems(listEl, selector, { x: -8, y: 6, stagger: 0.01, duration: 0.20, limit: 16 });
    var active = activeSelector ? listEl.querySelector(activeSelector) : null;
    if (active && scroller && opts.scrollActive !== false) smoothScrollToItem(scroller, active, { duration: 0.32 });
  });
}

function miniQueueSkeleton() {
  return '<div class="mini-queue-skeleton"></div><div class="mini-queue-skeleton"></div><div class="mini-queue-skeleton"></div>';
}

function queueHydrationExpectedTotal() {
  var loaded = playQueue && playQueue.length || 0;
  if (!queueHydrationState || queueHydrationState.queueRef !== playQueue) return loaded;
  if (!queueHydrationState.active && !queueHydrationState.loading && !queueHydrationState.error) return loaded;
  return Math.max(loaded, Number(queueHydrationState.total) || 0);
}

function queueHydrationFooterHtml(compact) {
  if (!queueHydrationState || queueHydrationState.queueRef !== playQueue) return '';
  var loaded = playQueue.length;
  var total = queueHydrationExpectedTotal();
  if (!queueHydrationState.active && !queueHydrationState.error && (!total || loaded >= total)) return '';
  var label = queueHydrationState.error
    ? ('后续歌曲载入中断 · 已准备 ' + loaded + (total ? '/' + total : ''))
    : (queueHydrationState.loading
      ? ('正在载入下一批 · ' + loaded + (total ? '/' + total : ''))
      : ('已准备 ' + loaded + (total ? '/' + total : '') + ' · 播放或滚动到末尾时继续'));
  var retry = queueHydrationState.error
    ? '<button type="button" class="queue-hydration-retry" onclick="event.stopPropagation();retryPlaylistQueueHydration()">重试</button>'
    : (queueHydrationState.active && !queueHydrationState.loading
      ? '<button type="button" class="queue-hydration-retry" onclick="event.stopPropagation();requestPlaylistQueueHydrationForBrowse()">再载一批</button>'
      : '');
  return '<div class="queue-hydration-status' + (compact ? ' compact' : '') + '">' +
    '<span class="queue-hydration-spinner' + (queueHydrationState.loading ? ' spinning' : '') + '"></span>' +
    '<span>' + label + '</span>' + retry + '</div>';
}

function togglePlaylistPanel(force) {
  var el = document.getElementById('playlist-panel');
  var opening = typeof force === 'boolean' ? force : !(el.classList.contains('show') || el.classList.contains('peek'));
  if (peekTimers.pl) { clearTimeout(peekTimers.pl); peekTimers.pl = null; }
  if (!opening) {
    el.classList.remove('show','peek');
    el.classList.add('playlist-panel-closing');
    el.__dismissedUntil = performance.now()+800;
    if (playlistPanelPinned) setPlaylistPanelPinned(false, true);
    markPlaylistPanelMotion(el, playlistPanelMotionMs('close'));
    setTimeout(function () {el.classList.remove('playlist-panel-closing');},playlistPanelMotionMs('close')+80);
    return;
  }
  el.__dismissedUntil = 0;
  el.classList.remove('playlist-panel-closing');
  el.classList.add('show');
  if (el.classList.contains('show')) {
    markPlaylistPanelMotion(el, playlistPanelMotionMs('open'));
    var runPlaylistOpenAnimation = shouldAnimatePlaylistPanelOpen(el);
    scheduleUiWarmTask(function () {
      flushDeferredQueuePanel('playlist-panel-open');
      preparePlaylistPanelTabOnOpen(el);
      if (runPlaylistOpenAnimation) animatePlaylistPanelCurrentTab(el, { scrollActive: false });
    }, 180);
  }
}

function closePlaylistPanelSoft(reason) {
  var panel = document.getElementById('playlist-panel');
  if (!panel || playlistPanelPinned) return false;
  if (!panel.classList.contains('peek') && !panel.classList.contains('show')) return false;
  if (peekTimers.pl) { clearTimeout(peekTimers.pl); peekTimers.pl = null; }
  if (typeof resetSecondaryPlaylistEdgeGuard === 'function') resetSecondaryPlaylistEdgeGuard();
  panel.classList.add('playlist-panel-closing');
  panel.classList.remove('peek', 'show');
  markPlaylistPanelMotion(panel, playlistPanelMotionMs('close'));
  setTimeout(function () { panel.classList.remove('playlist-panel-closing'); }, playlistPanelMotionMs('close') + 80);
  return true;
}

function applyPlaylistPanelPinState(openPanel) {
  var panel = document.getElementById('playlist-panel');
  var btn = document.getElementById('playlist-pin-btn');
  if (panel) {
    panel.classList.toggle('pinned', !!playlistPanelPinned);
    if (playlistPanelPinned || openPanel) {
      panel.dataset.preserveTabOnOpen = '1';
      setPeek(panel, true, 'pl');
    }
  }
  if (btn) {
    btn.classList.toggle('active', !!playlistPanelPinned);
    btn.title = playlistPanelPinned ? '取消常开歌单' : '常开歌单';
  }
}

function setPlaylistPanelPinned(on, silent) {
  playlistPanelPinned = !!on;
  saveBooleanPreference(PLAYLIST_PANEL_PIN_STORE_KEY, playlistPanelPinned);
  applyPlaylistPanelPinState(playlistPanelPinned);
  if (!silent) showToast(playlistPanelPinned ? '左侧歌单已常开' : '左侧歌单已恢复自动隐藏');
}

function togglePlaylistPanelPinned() {
  setPlaylistPanelPinned(!playlistPanelPinned);
}

function scrollPlaylistPanelToCurrent() {
  var panel = document.getElementById('playlist-panel');
  var list = document.getElementById('queue-list');
  if (!panel || !list || queueViewTab !== 'queue') return;
  var now = performance.now();
  if (panel.__lastCurrentScrollAt && now - panel.__lastCurrentScrollAt < 650) return;
  panel.__lastCurrentScrollAt = now;
  requestAnimationFrame(function () {
    renderQueuePanel({ animate: false, scrollCurrent: true });
    smoothScrollToItem(panel, list.querySelector('.queue-item.now'), { duration: 0.28, align: 0.34 });
  });
}

function animatePlaylistPanelCurrentTab(panel, opts) {
  opts = opts || {};
  panel = panel || document.getElementById('playlist-panel');
  if (queueViewTab === 'queue') {
    animateVisiblePanelList(document.getElementById('queue-list'), '.queue-item', panel, '.queue-item.now', { scrollActive: opts.scrollActive !== false });
  } else if (queueViewTab === 'playlists') {
    animateVisiblePanelList(document.getElementById('pl-list'), '.pl-card', panel);
  } else {
    animateVisiblePanelList(document.getElementById('podcast-list'), '.pl-card', panel);
  }
}

function preparePlaylistPanelTabOnOpen(panel) {
  var preserve = !!(panel && panel.dataset && panel.dataset.preserveTabOnOpen === '1');
  if (preserve && panel.dataset) {
    delete panel.dataset.preserveTabOnOpen;
  } else if (!playQueue.length && queueViewTab === 'queue') {
    switchPlaylistTab('playlists', { save: false, animate: false, refresh: false });
  }
  if (queueViewTab === 'queue') scrollPlaylistPanelToCurrent();
  else if (queueViewTab === 'playlists' || queueViewTab === 'podcasts') refreshUserPlaylists();
}

function switchPlaylistTab(tab, opts) {
  opts = opts || {};
  tab = normalizePlaylistPanelTab(tab);
  queueViewTab = tab;
  if (opts.save !== false) savePlaylistPanelTabPreference(tab);
  var queueTab = document.getElementById('tab-queue');
  var playlistTab = document.getElementById('tab-pl');
  if (queueTab) queueTab.classList.toggle('active', tab === 'queue');
  if (playlistTab) playlistTab.classList.toggle('active', tab === 'playlists');
  var podcastTab = document.getElementById('tab-podcast');
  if (podcastTab) podcastTab.classList.toggle('active', tab === 'podcasts');
  var queuePane = document.getElementById('queue-pane');
  var playlistPane = document.getElementById('pl-pane');
  if (queuePane) queuePane.style.display = tab === 'queue' ? '' : 'none';
  if (playlistPane) playlistPane.style.display = tab === 'playlists' ? '' : 'none';
  var podcastPane = document.getElementById('podcast-pane');
  if (podcastPane) podcastPane.style.display = tab === 'podcasts' ? '' : 'none';
  if ((tab === 'playlists' || tab === 'podcasts') && opts.refresh !== false) refreshUserPlaylists();
  if (opts.animate !== false) animatePlaylistPanelCurrentTab(document.getElementById('playlist-panel'));
}

function setMiniQueueOpen(open) {
  miniQueueOpen = !!open;
  var pop = document.getElementById('mini-queue-popover');
  var btn = document.getElementById('mini-queue-btn');
  if (pop) pop.classList.toggle('show', miniQueueOpen);
  if (btn) btn.classList.toggle('active', miniQueueOpen);
  if (miniQueueOpen) {
    var seq = ++miniQueueRenderSeq;
    requestAnimationFrame(function () {
      if (seq !== miniQueueRenderSeq || !miniQueueOpen) return;
      renderMiniQueuePanel({ animate: true, scrollCurrent: true });
    });
    revealBottomControls(1300);
  }
}

function toggleMiniQueue(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  setMiniQueueOpen(!miniQueueOpen);
}

function closeMiniQueue() {
  setMiniQueueOpen(false);
}

function openPlaylistPanelTab(tab, preserve) {
  tab = normalizePlaylistPanelTab(tab);
  var panel = document.getElementById('playlist-panel');
  if (panel && panel.dataset && preserve !== false) panel.dataset.preserveTabOnOpen = '1';
  switchPlaylistTab(tab);
  setPeek(panel, true, 'pl');
}

function renderMiniQueuePanel(opts) {
  opts = opts || {};
  var $list = document.getElementById('mini-queue-list');
  var $count = document.getElementById('mini-queue-count');
  if (!$list || !$count) return;
  var total = playQueue.length;
  var expectedTotal = queueHydrationExpectedTotal();
  $count.textContent = total ? ((expectedTotal > total ? (total + '/' + expectedTotal) : total) + ' 首' + (currentIdx >= 0 ? ' · 正在播放 ' + (currentIdx + 1) : '')) : '0 首';
  if (!miniQueueOpen && !opts.animate && !opts.scrollCurrent) return;
  if (!total) {
    $list.innerHTML = '<div class="mini-queue-empty">队列为空，先搜索或打开歌单</div>';
    return;
  }
  var windowInfo = queuePanelVirtualWindow($list, $list, total, true, opts.scrollCurrent ? currentIdx : -1);
  var visibleQueue = playQueue.slice(windowInfo.start, windowInfo.end);
  $list.innerHTML = queueVirtualSpacerHtml(windowInfo.top) + visibleQueue.map(function (song, localIndex) {
    var i = windowInfo.start + localIndex;
    var thumb = songCoverSrc(song, 60);
    var imgTag = thumb ? '<img src="' + thumb + '" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0.2">' : '<div class="mini-queue-cover"></div>';
    return '<div class="mini-queue-item' + (i === currentIdx ? ' now' : '') + '" data-queue-index="' + i + '" onclick="if(window.__mineradioSuppressReorderClick)return;playQueueAt(' + i + ')">' +
      imgTag +
      '<div class="mini-queue-info"><div class="mini-queue-name">' + escHtml(song.name) + '</div><div class="mini-queue-sub">' + escHtml(song.artist || '') + '</div></div>' +
      '<button class="mini-queue-remove mini-queue-next" onclick="event.stopPropagation();queueIndexNext(' + i + ')" title="下一首播放">下</button>' +
      '<button class="mini-queue-remove" onclick="event.stopPropagation();removeFromQueue(' + i + ')" title="移除">×</button>' +
      '</div>';
  }).join('') + queueVirtualSpacerHtml(windowInfo.bottom) + queueHydrationFooterHtml(true);
  if (opts.animate || opts.scrollCurrent) {
    requestAnimationFrame(function () {
      if (opts.animate) animateListItems($list, '.mini-queue-item', { x: 0, y: 6, stagger: 0.01, duration: 0.20, limit: 16 });
      if (opts.scrollCurrent) smoothScrollToItem($list, $list.querySelector('.mini-queue-item.now'), { duration: 0.30, align: 0.42 });
    });
  }
}

function clearPanelReorderClasses() {
  document.body.classList.remove('panel-reordering');
  Array.prototype.forEach.call(document.querySelectorAll('.reorder-pressing,.is-reordering,.is-reordering-list'), function (node) {
    node.classList.remove('reorder-pressing', 'is-reordering', 'is-reordering-list');
  });
}

function markPanelReorderSuppressed(ms) {
  panelReorderState.suppressClickUntil = performance.now() + (ms || 420);
  window.__mineradioSuppressReorderClick = true;
  setTimeout(function () {
    if (performance.now() >= panelReorderState.suppressClickUntil) window.__mineradioSuppressReorderClick = false;
  }, ms || 420);
}

function panelReorderClickSuppressed() {
  return performance.now() < (panelReorderState.suppressClickUntil || 0);
}

function cancelPanelReorder(markSuppress) {
  if (panelReorderState.timer) clearTimeout(panelReorderState.timer);
  if (markSuppress && panelReorderState.active && panelReorderState.kind === 'queue' && typeof saveLastPlaybackSnapshot === 'function') {
    saveLastPlaybackSnapshot(true, 'queue-reorder-final');
  }
  if (markSuppress && panelReorderState.active) markPanelReorderSuppressed(520);
  clearPanelReorderClasses();
  panelReorderState.timer = 0;
  panelReorderState.active = false;
  panelReorderState.pointerId = null;
}

function panelReorderBlockedTarget(target) {
  return !!(target && target.closest && target.closest('button,a,input,textarea,select,[data-pl-load-more],[data-pl-detail-load-more],[data-pl-detail-top],[data-pl-detail-play],[data-pl-detail-artist],[data-pl-detail-row],.pl-inline-detail'));
}

function panelReorderHitFromTarget(target) {
  if (!target || !target.closest || panelReorderBlockedTarget(target)) return null;
  var queueItem = target.closest('.queue-item[data-queue-index],.mini-queue-item[data-queue-index]');
  if (queueItem) {
    var queueRoot = queueItem.closest('#queue-list,#mini-queue-list');
    if (!queueRoot) return null;
    var queueIndex = Number(queueItem.getAttribute('data-queue-index'));
    if (!isFinite(queueIndex)) return null;
    return { kind: 'queue', item: queueItem, rootId: queueRoot.id, index: queueIndex, provider: '' };
  }
  var card = target.closest('.pl-card[data-playlist-index]');
  if (card && card.closest('#pl-list')) {
    var playlistIndex = Number(card.getAttribute('data-playlist-index'));
    if (!isFinite(playlistIndex) || playlistIndex < 0) return null;
    return {
      kind: 'playlist',
      item: card,
      rootId: 'pl-list',
      index: playlistIndex,
      provider: card.getAttribute('data-playlist-provider') || ''
    };
  }
  return null;
}

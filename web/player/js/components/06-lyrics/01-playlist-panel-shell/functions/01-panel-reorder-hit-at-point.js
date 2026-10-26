'use strict';


function panelReorderHitAtPoint(x, y, state) {
  var el = document.elementFromPoint(x, y);
  var hit = panelReorderHitFromTarget(el);
  if (!hit || !state || hit.kind !== state.kind || hit.rootId !== state.rootId) return null;
  if (state.kind === 'playlist' && state.provider && hit.provider !== state.provider) return null;
  return hit;
}

function markPanelReorderItem(state) {
  if (!state || !state.rootId) return;
  requestAnimationFrame(function () {
    var root = document.getElementById(state.rootId);
    if (!root) return;
    root.classList.add('is-reordering-list');
    var attr = state.kind === 'playlist' ? 'data-playlist-index' : 'data-queue-index';
    var item = root.querySelector('[' + attr + '="' + state.currentIndex + '"]');
    if (item) item.classList.add('is-reordering');
  });
}

function bindLongPressPanelReorder() {
  if (document.__mineradioPanelReorderBound) return;
  document.__mineradioPanelReorderBound = true;
  document.addEventListener('click', function (e) {
    if (!panelReorderClickSuppressed()) return;
    if (!e.target || !e.target.closest || !e.target.closest('#queue-list,#mini-queue-list,#pl-list')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (e.button != null && e.button !== 0) return;
    var hit = panelReorderHitFromTarget(e.target);
    if (!hit) return;
    cancelPanelReorder(false);
    panelReorderState = {
      timer: 0,
      active: false,
      pointerId: e.pointerId,
      kind: hit.kind,
      rootId: hit.rootId,
      provider: hit.provider,
      startX: e.clientX,
      startY: e.clientY,
      currentIndex: hit.index,
      suppressClickUntil: panelReorderState.suppressClickUntil || 0
    };
    hit.item.classList.add('reorder-pressing');
    panelReorderState.timer = setTimeout(function () {
      if (panelReorderState.pointerId !== e.pointerId) return;
      panelReorderState.active = true;
      document.body.classList.add('panel-reordering');
      markPanelReorderItem(panelReorderState);
      if (typeof markRenderInteraction === 'function') markRenderInteraction('panel-reorder', 900);
    }, reorderLongPressMs);
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (panelReorderState.pointerId == null || e.pointerId !== panelReorderState.pointerId) return;
    var dx = e.clientX - panelReorderState.startX;
    var dy = e.clientY - panelReorderState.startY;
    if (!panelReorderState.active) {
      if (Math.sqrt(dx * dx + dy * dy) > reorderMoveCancelPx) cancelPanelReorder(false);
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (typeof markRenderInteraction === 'function') markRenderInteraction('panel-reorder', 900);
    var hit = panelReorderHitAtPoint(e.clientX, e.clientY, panelReorderState);
    if (!hit || hit.index === panelReorderState.currentIndex) return;
    var moved = panelReorderState.kind === 'queue'
      ? (typeof moveQueueIndex === 'function' && moveQueueIndex(panelReorderState.currentIndex, hit.index, { rebuildShelf: true, renderPanel: true, persistSnapshot: false }))
      : (typeof moveUserPlaylistIndex === 'function' && moveUserPlaylistIndex(panelReorderState.currentIndex, hit.index, { rebuildShelf: true, renderPanel: true }));
    if (!moved) return;
    panelReorderState.currentIndex = hit.index;
    clearPanelReorderClasses();
    document.body.classList.add('panel-reordering');
    markPanelReorderItem(panelReorderState);
  }, { capture: true, passive: false });
  document.addEventListener('pointerup', function (e) {
    if (panelReorderState.pointerId == null || e.pointerId !== panelReorderState.pointerId) return;
    cancelPanelReorder(true);
  }, true);
  document.addEventListener('pointercancel', function (e) {
    if (panelReorderState.pointerId == null || e.pointerId !== panelReorderState.pointerId) return;
    cancelPanelReorder(false);
  }, true);
}

function renderQueuePanel(opts) {
  opts = opts || {};
  var $ql = document.getElementById('queue-list');
  var seq = ++queueRenderSeq;
  if (!playQueue.length) {
    $ql.innerHTML = '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">队列为空，搜索后点 + 设为下一首</div>';
    renderMiniQueuePanel();
    var panel = document.getElementById('playlist-panel');
    if (panel && (panel.classList.contains('show') || panel.classList.contains('peek')) && queueViewTab === 'queue') switchPlaylistTab('playlists', { save: false });
    return;
  }
  var total = playQueue.length;
  var panelScroller = document.getElementById('playlist-panel');
  var windowInfo = queuePanelVirtualWindow($ql, panelScroller, total, false, opts.scrollCurrent ? currentIdx : -1);
  var visibleQueue = playQueue.slice(windowInfo.start, windowInfo.end);
  $ql.innerHTML = queueVirtualSpacerHtml(windowInfo.top) + visibleQueue.map(function (song, localIndex) {
    var i = windowInfo.start + localIndex;
    var thumb = songCoverSrc(song, 60);
    var imgTag = thumb ? '<img src="' + thumb + '" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0.2">' : '<div style="width:38px;height:38px;border-radius:6px;background:rgba(255,255,255,.06);flex-shrink:0"></div>';
    return '<div class="queue-item' + (i === currentIdx ? ' now' : '') + '" data-queue-index="' + i + '" onclick="if(window.__mineradioSuppressReorderClick)return;playQueueAt(' + i + ')">' +
      imgTag +
      '<div class="qi-info"><div class="qi-name">' + escHtml(song.name) + '</div><div class="qi-sub"><button class="queue-artist-link" type="button" onclick="event.stopPropagation();openQueueArtist(' + i + ')">' + escHtml(song.artist || '未知歌手') + '</button></div></div>' +
      '<div class="qi-act">' +
      '<button class="' + (isSongLiked(song) ? 'liked' : '') + '" onclick="event.stopPropagation();toggleLikeQueueIndex(' + i + ')" title="' + (isSongLiked(song) ? '取消红心' : '红心喜欢') + '">' + heartIconSvg() + '</button>' +
      '<button class="queue-next" onclick="event.stopPropagation();queueIndexNext(' + i + ')" title="下一首播放">下</button>' +
      '<button onclick="event.stopPropagation();collectQueueIndex(' + i + ')" title="收藏到歌单">' + playlistPlusIconSvg() + '</button>' +
      '<button onclick="event.stopPropagation();removeFromQueue(' + i + ')" title="移除">×</button>' +
      '</div>' +
      '</div>';
  }).join('') + queueVirtualSpacerHtml(windowInfo.bottom) + queueHydrationFooterHtml(false);
  if (opts.animate && seq === queueRenderSeq) animateVisiblePanelList($ql, '.queue-item', document.getElementById('playlist-panel'), '.queue-item.now');
  renderMiniQueuePanel({ scrollCurrent: opts.scrollCurrent !== false && miniQueueOpen });
}

function playlistCatalogProviderArray(provider) {
  if (provider === 'netease') return neteasePlaylists;
  if (provider === 'qq') return qqPlaylists;
  if (provider === 'kugou') return kugouPlaylists;
  if (provider === 'qishui') return qishuiPlaylists;
  if (provider === 'spotify') return spotifyPlaylists;
  return [];
}

function setPlaylistCatalogProviderArray(provider, rows) {
  rows = Array.isArray(rows) ? rows : [];
  if (provider === 'netease') neteasePlaylists = rows;
  else if (provider === 'qq') qqPlaylists = rows;
  else if (provider === 'kugou') kugouPlaylists = rows;
  else if (provider === 'qishui') qishuiPlaylists = rows;
  else if (provider === 'spotify') spotifyPlaylists = rows;
}

function playlistCatalogProviderLoggedIn(provider) {
  if (provider === 'netease') return !!loginStatus.loggedIn;
  if (provider === 'qq') return !!qqLoginStatus.loggedIn;
  if (provider === 'kugou') return !!kugouLoginStatus.loggedIn;
  if (provider === 'qishui') return !!qishuiLoginStatus.loggedIn;
  if (provider === 'spotify') return !!spotifyLoginStatus.loggedIn;
  return false;
}

function playlistCatalogPageUrl(provider, offset, limit) {
  offset = Math.max(0, Number(offset) || 0);
  limit = Math.max(1, Number(limit) || PLAYLIST_CATALOG_FIRST_PAGE_SIZE);
  if (provider === 'netease') return '/api/user/playlists?paged=1&limit=' + limit + '&offset=' + offset;
  if (provider === 'spotify') return '/api/spotify/user/playlists?limit=' + Math.min(500, limit) + '&offset=' + offset;
  if (provider === 'qq') return '/api/qq/user/playlists';
  if (provider === 'kugou') return '/api/kugou/user/playlists';
  if (provider === 'qishui') return '/api/qishui/user/playlists';
  return '';
}

function mergePlaylistCatalogRows(existing, incoming, provider) {
  var seen = Object.create(null);
  var out = [];
  (existing || []).concat(incoming || []).forEach(function (pl) {
    if (!pl) return;
    pl.provider = provider;
    pl.source = provider;
    var key = String(pl.id || '');
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(pl);
  });
  return out;
}

function rebuildUserPlaylistsFromCatalog(opts) {
  opts = opts || {};
  userPlaylists = builtInPlaylists.concat(neteasePlaylists, qqPlaylists, kugouPlaylists, qishuiPlaylists, spotifyPlaylists);
  if (typeof applyUserPlaylistOrder === 'function') applyUserPlaylistOrder();
  playlistCatalogRevision += 1;
  renderUserPlaylistsList({ animate: !!opts.animate, reset: !!opts.reset, preserveScroll: opts.preserveScroll !== false });
  if (emptyHomeActive) renderHomeDiscover();
  scheduleShelfRebuild(opts.reason || 'playlist-catalog-page', true);
}

async function loadPlaylistCatalogProviderPage(provider, reason) {
  var root = playlistCatalogSyncState;
  var state = root.providers && root.providers[provider];
  if (!state || state.loading || !state.hasMore || !playlistCatalogProviderLoggedIn(provider)) return false;
  var token = root.token;
  var first = state.nextOffset === 0 && !state.loaded;
  var limit = first ? PLAYLIST_CATALOG_FIRST_PAGE_SIZE : PLAYLIST_CATALOG_BACKGROUND_PAGE_SIZE;
  var requestOffset = state.nextOffset;
  var url = playlistCatalogPageUrl(provider, requestOffset, limit);
  if (!url) return false;
  state.loading = true;
  try {
    var r = await apiJson(url, { timeoutMs: 15000 });
    if (playlistCatalogSyncState.token !== token) return false;
    var incoming = (r && r.playlists || []).map(function (pl) { pl.provider = provider; pl.source = provider; return pl; });
    if (r && r.error && !incoming.length) throw new Error(r.message || r.error);
    var current = first ? [] : playlistCatalogProviderArray(provider);
    var merged = mergePlaylistCatalogRows(current, incoming, provider);
    setPlaylistCatalogProviderArray(provider, merged);
    state.loaded = merged.length;
    state.total = Math.max(state.loaded, Number(r && r.total) || 0);
    state.nextOffset = r && r.nextOffset != null ? Math.max(0, Number(r.nextOffset) || 0) : (requestOffset + incoming.length);
    var supportsPaging = provider === 'netease' || provider === 'spotify';
    state.hasMore = supportsPaging ? !!(r && r.hasMore) : false;
    if (state.total && state.nextOffset >= state.total) state.hasMore = false;
    if (!incoming.length) state.hasMore = false;
    state.error = (r && r.error) || '';
    rebuildUserPlaylistsFromCatalog({ animate: first && isPlaylistPanelVisibleForRender(), reset: first, preserveScroll: !first, reason: reason || 'playlist-catalog-page' });
    return incoming.length > 0;
  } catch (e) {
    if (playlistCatalogSyncState.token !== token) return false;
    console.warn('[PlaylistCatalogPage]', provider, e);
    state.error = e && e.message || 'PLAYLIST_CATALOG_PAGE_FAILED';
    state.hasMore = false;
    playlistCatalogSyncState.error = state.error;
    if (userPlaylists.length) renderUserPlaylistsList({ preserveScroll: true });
    return false;
  } finally {
    if (playlistCatalogSyncState.token === token) state.loading = false;
  }
}

function playlistCatalogHasPendingPages() {
  var providers = playlistCatalogSyncState.providers || {};
  return Object.keys(providers).some(function (key) { return providers[key] && (providers[key].loading || providers[key].hasMore); });
}

function requestNextPlaylistCatalogPage(reason) {
  var root = playlistCatalogSyncState;
  if (!root || !root.providers) return false;
  var order = ['netease', 'spotify', 'qq', 'kugou', 'qishui'];
  var provider = order.find(function (key) {
    var state = root.providers[key];
    return state && state.hasMore && !state.loading;
  });
  if (!provider) {
    root.loading = playlistCatalogHasPendingPages();
    return false;
  }
  loadPlaylistCatalogProviderPage(provider, reason || 'background').finally(function () {
    if (playlistCatalogSyncState !== root || !playlistCatalogHasPendingPages()) {
      root.loading = false;
      if (userPlaylists.length) renderUserPlaylistsList({ preserveScroll: true });
      return;
    }
    if (root.timer) clearTimeout(root.timer);
    root.timer = setTimeout(function () {
      root.timer = 0;
      requestNextPlaylistCatalogPage('background');
    }, 180);
  });
  return true;
}

async function refreshUserPlaylists(force) {
  if (typeof refreshBuiltInPlaylists === 'function') await refreshBuiltInPlaylists(!!force);
  if (!loginStatus.loggedIn && !qqLoginStatus.loggedIn && !kugouLoginStatus.loggedIn && !qishuiLoginStatus.loggedIn && !spotifyLoginStatus.loggedIn) {
    resetPlaylistPanelRenderLimit();
    userPlaylists = builtInPlaylists.slice();
    playlistCatalogRevision += 1;
    renderUserPlaylistsList({ animate: isPlaylistPanelVisibleForRender(), preserveScroll: true });
    var podcastListLoggedOut = document.getElementById('podcast-list');
    if (podcastListLoggedOut) podcastListLoggedOut.innerHTML = '<div style="text-align:center;padding:14px 0;color:rgba(255,255,255,.28);font-size:11.5px">登录后显示我的播客</div>';
    return;
  }
  var catalogNeedsNewProvider = playlistCatalogSyncState.loading && ['netease', 'qq', 'kugou', 'qishui', 'spotify'].some(function (provider) {
    var state = playlistCatalogSyncState.providers && playlistCatalogSyncState.providers[provider];
    return playlistCatalogProviderLoggedIn(provider) && (!state || !state.enabled);
  });
  if (playlistCatalogSyncState.loading && !catalogNeedsNewProvider && (!force || Date.now() - Number(playlistCatalogSyncState.startedAt || 0) < 1200)) {
    if (userPlaylists.length) renderUserPlaylistsList({ animate: isPlaylistPanelVisibleForRender(), preserveScroll: true });
    return;
  }
  if (!force && (userPlaylists.length || myPodcastCollections.length)) {
    var cachedAnimate = isPlaylistPanelVisibleForRender();
    renderUserPlaylistsList({ animate: cachedAnimate, preserveScroll: true });
    renderMyPodcastCollections({ animate: cachedAnimate });
    return;
  }
  var $pl = document.getElementById('pl-list');
  if ($pl) {
    $pl.innerHTML = miniQueueSkeleton();
    if (window.gsap) animateListItems($pl, '.mini-queue-skeleton', { x: 0, y: 6, stagger: 0.018, duration: 0.18, limit: 3 });
  }
  var $pod = document.getElementById('podcast-list');
  if ($pod) $pod.innerHTML = miniQueueSkeleton();
  if (playlistCatalogSyncState.timer) clearTimeout(playlistCatalogSyncState.timer);
  var token = playlistCatalogSyncState.token + 1;
  playlistCatalogSyncState = { token: token, loading: true, timer: 0, providers: {}, error: '', startedAt: Date.now() };
  ['netease', 'qq', 'kugou', 'qishui', 'spotify'].forEach(function (provider) {
    if (force && playlistCatalogProviderLoggedIn(provider)) setPlaylistCatalogProviderArray(provider, []);
    playlistCatalogSyncState.providers[provider] = {
      enabled: playlistCatalogProviderLoggedIn(provider),
      loaded: playlistCatalogProviderArray(provider).length,
      total: playlistCatalogProviderArray(provider).length,
      nextOffset: 0,
      hasMore: playlistCatalogProviderLoggedIn(provider),
      loading: false,
      error: ''
    };
  });
  if (force) {
    userPlaylists = builtInPlaylists.slice();
    playlistCatalogRevision += 1;
  }
  var firstPageTasks = Object.keys(playlistCatalogSyncState.providers).filter(playlistCatalogProviderLoggedIn).map(function (provider) {
    return loadPlaylistCatalogProviderPage(provider, 'first-page');
  });
  var podcastTask = loginStatus.loggedIn
    ? apiJson('/api/podcast/my', { timeoutMs: 12000 }).then(function (r) {
      if (playlistCatalogSyncState.token !== token) return;
      myPodcastCollections = r && r.collections || [];
      renderMyPodcastCollections({ animate: isPlaylistPanelVisibleForRender() });
    }).catch(function (e) { console.warn('[PodcastCatalog]', e); })
    : Promise.resolve();
  await Promise.allSettled(firstPageTasks.concat([podcastTask]));
  if (playlistCatalogSyncState.token !== token) return;
  playlistCatalogSyncState.loading = playlistCatalogHasPendingPages();
  if (userPlaylists.length) renderUserPlaylistsList({ animate: isPlaylistPanelVisibleForRender(), preserveScroll: true });
  if (playlistCatalogSyncState.loading) requestNextPlaylistCatalogPage('after-first-pages');
}
'use strict';


function queueVirtualSpacerHtml(height) {
  height = Math.max(0, Math.round(Number(height) || 0));
  return height ? '<div class="queue-virtual-spacer" aria-hidden="true" style="height:' + height + 'px"></div>' : '';
}

function queuePanelVirtualWindow(list, scroller, total, selfScroll, forceIndex) {
  total = Math.max(0, Number(total) || 0);
  if (!total) return { start: 0, end: 0, top: 0, bottom: 0 };
  var rowStep = QUEUE_VIRTUAL_ROW_STEP;
  var viewport = Math.max(rowStep * 4, Number(scroller && scroller.clientHeight) || rowStep * 9);
  var visibleRows = Math.max(4, Math.ceil(viewport / rowStep));
  var start = 0;
  if (forceIndex != null && forceIndex >= 0 && forceIndex < total) {
    start = Math.max(0, Math.floor(forceIndex - visibleRows * 0.42) - QUEUE_VIRTUAL_OVERSCAN);
  } else if (selfScroll) {
    start = Math.max(0, Math.floor((Number(scroller && scroller.scrollTop) || 0) / rowStep) - QUEUE_VIRTUAL_OVERSCAN);
  } else if (list && scroller && list.getBoundingClientRect && scroller.getBoundingClientRect) {
    var listRect = list.getBoundingClientRect();
    var scrollerRect = scroller.getBoundingClientRect();
    var visibleTop = Math.max(0, scrollerRect.top - listRect.top);
    start = Math.max(0, Math.floor(visibleTop / rowStep) - QUEUE_VIRTUAL_OVERSCAN);
  }
  var maxRows = visibleRows + QUEUE_VIRTUAL_OVERSCAN * 2;
  var end = Math.min(total, start + maxRows);
  start = Math.max(0, Math.min(start, Math.max(0, total - maxRows)));
  end = Math.min(total, Math.max(end, start + maxRows));
  return { start: start, end: end, top: start * rowStep, bottom: Math.max(0, total - end) * rowStep };
}

function scheduleQueuePanelVirtualRender() {
  if (queuePanelVirtualState.raf) return;
  queuePanelVirtualState.raf = requestAnimationFrame(function () {
    queuePanelVirtualState.raf = 0;
    if (miniQueueOpen) renderMiniQueuePanel({ animate: false, scrollCurrent: false });
    if (queueViewTab === 'queue' && isPlaylistPanelVisibleForRender()) {
      renderQueuePanel({ animate: false, scrollCurrent: false });
    }
  });
}

function maybeRequestPlaylistQueuePageFromScroller(scroller) {
  if (!scroller || typeof requestPlaylistQueueHydrationForBrowse !== 'function') return false;
  if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - QUEUE_VIRTUAL_ROW_STEP * 6) return false;
  return requestPlaylistQueueHydrationForBrowse();
}

function queuePanelItemKey(song, fallback) {
  try {
    if (typeof queueItemKey === 'function') return queueItemKey(song) || fallback;
  } catch (e) { }
  return song && (song.id || song.mid || song.localKey || song.name) || fallback;
}

function queuePanelListKey() {
  var total = playQueue && playQueue.length || 0;
  if (!total) return '0';
  return [
    total,
    queuePanelItemKey(playQueue[0], 'first'),
    queuePanelItemKey(playQueue[Math.max(0, total - 1)], 'last')
  ].join('|');
}

function resetQueuePanelRenderLimit() {
  queuePanelRenderLimit = QUEUE_PANEL_BATCH_SIZE;
  queuePanelRenderKey = queuePanelListKey();
}

function queuePanelVisibleLimit(total) {
  total = Math.max(0, Number(total) || 0);
  if (!total) {
    queuePanelRenderLimit = QUEUE_PANEL_BATCH_SIZE;
    queuePanelRenderKey = '0';
    return 0;
  }
  var key = queuePanelListKey();
  if (key !== queuePanelRenderKey) {
    queuePanelRenderKey = key;
    queuePanelRenderLimit = QUEUE_PANEL_BATCH_SIZE;
  }
  var base = Math.max(QUEUE_PANEL_BATCH_SIZE, queuePanelRenderLimit || QUEUE_PANEL_BATCH_SIZE);
  if (currentIdx >= 0 && currentIdx < total) {
    base = Math.max(base, Math.ceil((currentIdx + 1) / QUEUE_PANEL_BATCH_SIZE) * QUEUE_PANEL_BATCH_SIZE);
  }
  queuePanelRenderLimit = Math.min(total, base);
  return queuePanelRenderLimit;
}

function growQueuePanelRenderLimit(amount) {
  if (!playQueue.length) return false;
  var total = playQueue.length;
  var current = queuePanelVisibleLimit(total);
  var next = Math.min(total, current + (amount || QUEUE_PANEL_BATCH_SIZE));
  if (next <= current) return false;
  var panel = document.getElementById('playlist-panel');
  var keepTop = panel ? panel.scrollTop : 0;
  var miniList = document.getElementById('mini-queue-list');
  var keepMiniTop = miniList ? miniList.scrollTop : 0;
  queuePanelRenderLimit = next;
  renderQueuePanel({ animate: true, scrollCurrent: false });
  if (panel) panel.scrollTop = keepTop;
  if (miniList) {
    miniList = document.getElementById('mini-queue-list');
    if (miniList) miniList.scrollTop = keepMiniTop;
  }
  return true;
}

function maybeGrowQueuePanelRenderLimit() {
  var panel = document.getElementById('playlist-panel');
  if (!panel || queueViewTab !== 'queue' || !playQueue.length) return;
  if (queuePanelVisibleLimit(playQueue.length) >= playQueue.length) return;
  if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 220) growQueuePanelRenderLimit();
}

function bindMiniQueueLazyRender() {
  var list = document.getElementById('mini-queue-list');
  if (!list || miniQueueLazyBound) return;
  miniQueueLazyBound = true;
  list.addEventListener('scroll', function () {
    if (!miniQueueOpen) return;
    scheduleQueuePanelVirtualRender();
    maybeRequestPlaylistQueuePageFromScroller(list);
  }, { passive: true });
}

function normalizePlaylistProvider(provider) {
  if (provider === 'mineradio') return 'mineradio';
  if (provider === 'qq' || provider === 'kugou' || provider === 'qishui' || provider === 'spotify') return provider;
  return 'netease';
}

function playlistProviderLabel(provider) {
  provider = normalizePlaylistProvider(provider);
  if (provider === 'mineradio') return 'MR';
  return provider === 'qq' ? 'QQ' : (provider === 'kugou' ? 'KG' : (provider === 'qishui' ? 'QS' : (provider === 'spotify' ? 'SP' : 'NE')));
}

function playlistProviderName(provider) {
  provider = normalizePlaylistProvider(provider);
  if (provider === 'mineradio') return 'Mineradio 内置歌单';
  if (provider === 'spotify') return 'Spotify';
  return provider === 'qq' ? 'QQ 音乐' : (provider === 'kugou' ? '酷狗音乐' : (provider === 'qishui' ? '汽水音乐' : '网易云音乐'));
}

function playlistPanelKey(provider, id) {
  provider = normalizePlaylistProvider(provider);
  return provider + ':' + String(id || '');
}

function playlistPanelProviderId(provider, id) {
  provider = normalizePlaylistProvider(provider);
  if (provider === 'mineradio') return 'mineradio:' + id;
  if (provider === 'qq') return 'qq:' + id;
  if (provider === 'kugou') return 'kugou:' + id;
  if (provider === 'qishui') return 'qishui:' + id;
  if (provider === 'spotify') return 'spotify:' + id;
  return id;
}

function playlistCardPriority(pl) {
  if (!pl) return 10;
  if (pl.virtual || String(pl.id || '') === 'spotify-liked' || Number(pl.specialType || 0) === 5) return 0;
  return 1;
}

function prioritizePlaylistGroupItems(items) {
  return (items || []).map(function (pl, idx) {
    return { pl: pl, idx: idx, priority: playlistCardPriority(pl) };
  }).sort(function (a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.idx - b.idx;
  }).map(function (entry) { return entry.pl; });
}

function playlistPanelNoticeHtml(text, isError) {
  text = String(text || '').trim();
  if (!text) text = '歌单暂无可播放歌曲';
  return '<div style="text-align:center;padding:14px 10px;color:' + (isError ? 'rgba(255,180,160,.82)' : 'rgba(255,255,255,.30)') + ';font-size:11.5px;line-height:1.55">' + escHtml(text) + '</div>';
}

function playlistPanelDetailRowsHtml(options) {
  options = options || {};
  var st = playlistPanelDetailState;
  var entries = window.mineradioPlaylistFilter ? mineradioPlaylistFilter.rows(st) : (st.tracks || []).map(function (song, index) { return { song: song, index: index }; });
  var tracks = entries.map(function (entry) { return entry.song; });
  if (st.loading && !tracks.length) {
    return '<div class="pl-detail-row pl-detail-loading-row"><span class="queue-hydration-spinner spinning"></span><div style="flex:1;min-width:0"><div class="pl-detail-row-title">正在载入首批歌曲</div><div class="pl-detail-row-artist">首批完成后即可浏览和播放</div></div></div>';
  }
  if (!tracks.length) return playlistPanelNoticeHtml(st.message || st.error || '', !!st.error);
  var viewport = Math.max(280, Number(options.viewport) || Math.min(620, Math.round((window.innerHeight || 800) * 0.72)));
  var localScrollTop = Math.max(0, Number(options.scrollTop) || 0);
  var start = Math.max(0, Math.floor(localScrollTop / PLAYLIST_DETAIL_ROW_STEP) - PLAYLIST_DETAIL_VIRTUAL_OVERSCAN);
  var maxRows = Math.ceil(viewport / PLAYLIST_DETAIL_ROW_STEP) + PLAYLIST_DETAIL_VIRTUAL_OVERSCAN * 2;
  var end = Math.min(tracks.length, start + maxRows);
  start = Math.max(0, Math.min(start, Math.max(0, tracks.length - maxRows)));
  end = Math.min(tracks.length, Math.max(end, start + maxRows));
  var rows = '<div class="pl-detail-virtual-spacer" aria-hidden="true" style="height:' + (start * PLAYLIST_DETAIL_ROW_STEP) + 'px"></div>';
  rows += tracks.slice(start, end).map(function (song, localIndex) {
    var i = entries[start + localIndex].index;
    var thumb = songCoverSrc(song, 60);
    var imgTag = thumb ? '<img src="' + escHtml(thumb) + '" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0.2">' : '<div style="width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,.06);flex:0 0 auto"></div>';
    var removeButton = normalizePlaylistProvider((st.key || '').split(':')[0]) === 'mineradio' && !(st.playlist && st.playlist.readonly)
      ? '<button type="button" class="pl-detail-remove" data-pl-detail-remove="' + i + '" title="从内置歌单移除" aria-label="从内置歌单移除">×</button>'
      : '';
    return '<div class="pl-detail-row" data-pl-detail-row="' + i + '">' +
      imgTag +
      '<div style="flex:1;min-width:0"><div class="pl-detail-row-title">' + escHtml(song.name || '') + '</div>' +
      '<button type="button" class="pl-detail-row-artist" data-pl-detail-artist="' + i + '">' + escHtml(song.artist || '未知歌手') + '</button></div>' +
      '<button type="button" class="web-detail-heart' + (isSongLiked(song) ? ' liked' : '') + '" data-web-heart-source="detail" data-web-heart-index="' + i + '" onclick="event.stopPropagation();toggleLikeSong(playlistPanelDetailState.tracks[' + i + '])" title="单击加入本机喜欢；长按选择平台歌单">' + heartIconSvg() + '</button>' + removeButton +
      '</div>';
  }).join('');
  rows += '<div class="pl-detail-virtual-spacer" aria-hidden="true" style="height:' + (Math.max(0, tracks.length - end) * PLAYLIST_DETAIL_ROW_STEP) + 'px"></div>';
  if (st.error) {
    rows += '<div class="pl-detail-progress">后续歌曲载入失败，重新打开歌单可继续</div>';
  } else if (st.hasMore || st.loadingMore) {
    rows += '<div class="pl-detail-progress"><span class="queue-hydration-spinner' + (st.loadingMore ? ' spinning' : '') + '"></span><span>' +
      (st.loadingMore ? '正在预载后续歌曲 ' : '继续滚动加载 ') + tracks.length + (st.total ? '/' + st.total : '') + '</span></div>';
  } else if (tracks.length > PLAYLIST_DETAIL_INITIAL_RENDER) {
    rows += '<div class="pl-detail-progress">已加载全部 ' + tracks.length + ' 首</div>';
  }
  return rows;
}

function playlistReorderKey(pl) {
  if (!pl) return '';
  return playlistPanelKey(normalizePlaylistProvider(pl.provider), pl.id);
}

function readPlaylistReorderKeys() {
  try {
    var raw = localStorage.getItem(PLAYLIST_REORDER_STORE_KEY);
    var keys = raw ? JSON.parse(raw) : [];
    return Array.isArray(keys) ? keys.filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

function savePlaylistReorderKeys() {
  try {
    localStorage.setItem(PLAYLIST_REORDER_STORE_KEY, JSON.stringify(userPlaylists.map(playlistReorderKey).filter(Boolean)));
  } catch (e) { }
}

function applyUserPlaylistOrder() {
  if (!userPlaylists || !userPlaylists.length) return false;
  var keys = readPlaylistReorderKeys();
  if (!keys.length) return false;
  var rank = {};
  keys.forEach(function (key, idx) {
    if (rank[key] == null) rank[key] = idx;
  });
  userPlaylists = userPlaylists.map(function (pl, idx) {
    return { pl: pl, idx: idx, rank: rank[playlistReorderKey(pl)] };
  }).sort(function (a, b) {
    var ar = a.rank;
    var br = b.rank;
    var ah = ar != null;
    var bh = br != null;
    if (ah && bh) return ar - br;
    if (ah) return -1;
    if (bh) return 1;
    return a.idx - b.idx;
  }).map(function (entry) { return entry.pl; });
  return true;
}

function moveUserPlaylistIndex(fromIdx, toIdx, opts) {
  opts = opts || {};
  fromIdx = Math.round(Number(fromIdx));
  toIdx = Math.round(Number(toIdx));
  if (!userPlaylists || !userPlaylists.length) return false;
  if (!isFinite(fromIdx) || !isFinite(toIdx)) return false;
  if (fromIdx < 0 || fromIdx >= userPlaylists.length) return false;
  toIdx = Math.max(0, Math.min(userPlaylists.length - 1, toIdx));
  if (fromIdx === toIdx) return false;
  var item = userPlaylists.splice(fromIdx, 1)[0];
  userPlaylists.splice(toIdx, 0, item);
  playlistCatalogRevision += 1;
  savePlaylistReorderKeys();
  if (opts.renderPanel !== false) renderUserPlaylistsList({ animate: false });
  if (opts.rebuildShelf !== false) safeShelfRebuild('playlist-reorder', true);
  return true;
}

function playlistTracksEndpoint(provider, id, params) {
  provider = normalizePlaylistProvider(provider);
  var query = 'id=' + encodeURIComponent(id);
  if (params) {
    Object.keys(params).forEach(function (key) {
      if (params[key] == null || params[key] === '') return;
      query += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    });
  }
  if (provider === 'qq') return '/api/qq/playlist/tracks?' + query;
  if (provider === 'kugou') return '/api/kugou/playlist/tracks?' + query;
  if (provider === 'qishui') return '/api/qishui/playlist/tracks?' + query;
  if (provider === 'spotify') return '/api/spotify/playlist/tracks?' + query;
  return '/api/playlist/tracks?' + query;
}

function fetchPlaylistTracksPage(provider, id, params, requestOptions) {
  provider = normalizePlaylistProvider(provider);
  if (provider === 'mineradio') return builtInPlaylistTracksPage(id, params || {});
  return apiJson(playlistTracksEndpoint(provider, id, params), requestOptions || {});
}

function playlistPanelDetailHtml(pl, provider, detailWindow) {
  provider = normalizePlaylistProvider(provider);
  var key = playlistPanelKey(provider, pl && pl.id);
  if (playlistPanelDetailState.key !== key) return '';
  var tracks = playlistPanelDetailState.tracks || [];
  var loading = playlistPanelDetailState.loading;
  var cover = pl && pl.cover ? (typeof coverProxySrc === 'function' ? coverProxySrc(pl.cover) || pl.cover : pl.cover) : '';
  var img = cover ? '<img class="pl-detail-cover" src="' + escHtml(cover) + '" alt="" decoding="async" onerror="this.style.opacity=0.2">' : '<div class="pl-detail-cover"></div>';
  var expectedTotal = Math.max(tracks.length, Number(playlistPanelDetailState.total) || Number(pl.trackCount) || 0);
  var rows = playlistPanelDetailRowsHtml(detailWindow);
  var canUncollect = !!(pl && pl.subscribed && !pl.virtual && (provider === 'netease' || provider === 'qishui' || provider === 'spotify'));
  var collectionButton = canUncollect
    ? '<button class="fx-mini-btn ghost pl-detail-top-btn" type="button" data-pl-detail-collection="0">取消收藏</button>'
    : '';
  var builtInActions = provider === 'mineradio' && !pl.readonly
    ? '<button class="fx-mini-btn ghost pl-detail-top-btn" type="button" data-pl-detail-rename="1">重命名</button><button class="fx-mini-btn ghost pl-detail-top-btn danger" type="button" data-pl-detail-delete="1">删除</button>'
    : '';
  var topButton = provider === 'mineradio' ? '' : '<button class="fx-mini-btn ghost pl-detail-top-btn" type="button" data-pl-detail-top="1">回到顶部</button>';
  return '<div class="pl-inline-detail" data-pl-detail="' + escHtml(key) + '" style="height:' + playlistPanelDetailShellHeight() + 'px">' +
    '<div class="pl-detail-sticky">' +
    '<div class="pl-detail-head">' + img + '<div style="flex:1;min-width:0"><div class="pl-detail-title">' + escHtml(pl.name || '歌单详情') + '</div><div class="pl-detail-sub">' + escHtml((expectedTotal || tracks.length || 0) + ' 首 · ' + (pl.creator || playlistProviderName(provider))) + '</div></div><div class="pl-detail-count">' + (loading && !tracks.length ? '载入中' : (tracks.length + (expectedTotal > tracks.length ? '/' + expectedTotal : ''))) + '</div></div>' +
    '<div class="pl-detail-actions"><button class="pl-detail-play" type="button" data-pl-detail-play="' + escHtml(key) + '"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>播放歌单</button>' + collectionButton + builtInActions + topButton + '</div>' +
    '</div>' +
    (window.mineradioPlaylistFilter ? mineradioPlaylistFilter.markup(playlistPanelDetailState) : '') +
    '<div class="pl-detail-list" data-pl-detail-scroll="' + escHtml(key) + '">' + rows + '</div>' +
    '</div>';
}

function renderPlaylistPanelDetailState() {
  renderUserPlaylistsList();
}

function scrollPlaylistPanelToTop() {
  var panel = document.getElementById('playlist-panel');
  if (!panel) return;
  try { panel.scrollTo({ top: 0, behavior: 'smooth' }); }
  catch (e) { panel.scrollTop = 0; }
}

function scrollPlaylistPanelDetailIntoView(key) {
  var panel = document.getElementById('playlist-panel');
  if (!panel || !key) return;
  requestAnimationFrame(function () {
    var detail = null;
    Array.prototype.some.call(panel.querySelectorAll('[data-pl-detail]'), function (node) {
      if (node.getAttribute('data-pl-detail') === key) {
        detail = node;
        return true;
      }
      return false;
    });
    if (!detail) return;
    var anchor = detail.previousElementSibling || detail;
    var toolbar = panel.querySelector('.queue-toolbar');
    var safeOffset = 126;
    if (toolbar) {
      var toolbarTop = 82;
      try { toolbarTop = parseFloat(getComputedStyle(toolbar).top) || toolbarTop; } catch (e) { }
      safeOffset = Math.max(safeOffset, toolbarTop + toolbar.offsetHeight + 12);
    }
    var top = Math.max(0, anchor.offsetTop - safeOffset);
    try { panel.scrollTo({ top: top, behavior: 'smooth' }); }
    catch (e) { panel.scrollTop = top; }
  });
}

function cancelPlaylistPanelDetailRequest() {
  if (playlistPanelDetailState.warmTimer) clearTimeout(playlistPanelDetailState.warmTimer);
  playlistPanelDetailState.warmTimer = 0;
  if (playlistPanelDetailState.controller) {
    try { playlistPanelDetailState.controller.abort(); } catch (e) { }
  }
  playlistPanelDetailState.controller = null;
}

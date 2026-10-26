'use strict';


function appendPlaylistPanelDetailTracks(target, incoming) {
  var seen = Object.create(null);
  (target || []).forEach(function (song, index) { seen[queuePanelItemKey(song, 'old:' + index)] = true; });
  var added = 0;
  (incoming || []).forEach(function (song, index) {
    var key = queuePanelItemKey(song, 'new:' + index);
    if (!song || seen[key]) return;
    seen[key] = true;
    target.push(song);
    added += 1;
  });
  return added;
}

function renderPlaylistPanelDetailRows() {
  if (!playlistPanelDetailState.key) return;
  renderUserPlaylistsList({ animate: false, preserveScroll: true });
}

function bindPlaylistPanelDetailScroller() {
  // 歌单详情与左栏共用 #playlist-panel 的单一滚动轴；行窗口由外层滚动位置驱动。
}

async function loadMorePlaylistPanelDetailTracks(reason) {
  var st = playlistPanelDetailState;
  if (!st.key || st.loadingMore || (reason !== 'initial' && !st.hasMore)) return false;
  var parts = st.key.split(':');
  var provider = normalizePlaylistProvider(parts[0]);
  var pid = parts.slice(1).join(':');
  var offset = reason === 'initial' ? 0 : Math.max(0, Number(st.nextOffset) || st.tracks.length);
  var token = st.token;
  var controller = window.AbortController ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, 12000) : 0;
  st.controller = controller;
  st.loadingMore = reason !== 'initial';
  if (st.loadingMore) renderPlaylistPanelDetailRows();
  try {
    var r = await fetchPlaylistTracksPage(provider, pid, { limit: PLAYLIST_DETAIL_BATCH_SIZE, offset: offset }, controller ? { signal: controller.signal } : { timeoutMs: 12000 });
    if (playlistPanelDetailState.token !== token || playlistPanelDetailState.key !== st.key) return false;
    var rawTracks = r && r.tracks || [];
    if (r && r.error && !rawTracks.length) throw new Error(r.message || r.error);
    var mapped = rawTracks.map(cloneSong);
    var added = appendPlaylistPanelDetailTracks(st.tracks, mapped);
    var responseTotal = Number(r && (r.total || (r.playlist && r.playlist.trackCount))) || 0;
    st.total = Math.max(st.total || 0, responseTotal, st.tracks.length);
    st.nextOffset = Math.max(offset + rawTracks.length, Number(r && r.nextOffset) || 0);
    st.hasMore = !!(r && r.hasMore);
    if (!rawTracks.length || (!added && st.nextOffset <= offset)) st.hasMore = false;
    st.loading = false;
    st.loadingMore = false;
    st.error = (r && r.error) || '';
    st.message = (r && (r.message || r.warning)) || '';
    if (r && r.playlist) st.playlist = Object.assign({}, st.playlist || {}, r.playlist);
    if (reason === 'initial') {
      renderPlaylistPanelDetailState();
      scrollPlaylistPanelDetailIntoView(st.key);
      if (st.hasMore) {
        st.warmTimer = setTimeout(function () {
          st.warmTimer = 0;
          if (playlistPanelDetailState.token === token && playlistPanelDetailState.key === st.key) loadMorePlaylistPanelDetailTracks('warm');
        }, 320);
      }
    } else {
      renderPlaylistPanelDetailRows();
    }
    return added > 0;
  } catch (e) {
    if (playlistPanelDetailState.token !== token || (e && e.name === 'AbortError')) return false;
    console.warn('[PlaylistPanelDetailPage]', pid, reason, e);
    st.loading = false;
    st.loadingMore = false;
    st.hasMore = false;
    st.error = 'PLAYLIST_DETAIL_PAGE_FAILED';
    st.message = st.tracks.length ? '后续歌曲载入失败，可继续滚动重试' : '歌单详情加载失败，请稍后重试';
    if (reason === 'initial') renderPlaylistPanelDetailState();
    else renderPlaylistPanelDetailRows();
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    if (playlistPanelDetailState.token === token && playlistPanelDetailState.controller === controller) playlistPanelDetailState.controller = null;
  }
}

async function openPlaylistPanelDetail(provider, pid, title) {
  if (!pid) return;
  provider = normalizePlaylistProvider(provider);
  var key = playlistPanelKey(provider, pid);
  var pl = userPlaylists.find(function (item) { return playlistPanelKey(normalizePlaylistProvider(item.provider), item.id) === key; }) || { id: pid, provider: provider, name: title || '歌单详情' };
  if (playlistPanelDetailState.key === key) {
    cancelPlaylistPanelDetailRequest();
    playlistPanelDetailState.key = '';
    playlistPanelDetailState.tracks = [];
    playlistPanelDetailState.playlist = null;
    playlistPanelDetailState.renderLimit = PLAYLIST_DETAIL_INITIAL_RENDER;
    playlistPanelDetailState.error = '';
    playlistPanelDetailState.message = '';
    renderPlaylistPanelDetailState();
    return;
  }
  cancelPlaylistPanelDetailRequest();
  var token = ++playlistPanelDetailState.token;
  playlistPanelDetailState = { key: key, loading: true, loadingMore: false, playlist: pl, tracks: [], token: token, total: Number(pl.trackCount) || 0, nextOffset: 0, hasMore: true, scrollTop: 0, controller: null, warmTimer: 0, renderLimit: PLAYLIST_DETAIL_INITIAL_RENDER, error: '', message: '' };
  renderPlaylistPanelDetailState();
  scrollPlaylistPanelDetailIntoView(key);
  await loadMorePlaylistPanelDetailTracks('initial');
}

function playPlaylistPanelDetail() {
  var st = playlistPanelDetailState;
  if (!st || !st.key) return;
  if (window.mineradioPlaylistFilter && mineradioPlaylistFilter.active(st)) {
    var filtered = mineradioPlaylistFilter.rows(st).map(function (item) { return item.song; });
    if (!filtered.length) return showToast('没有符合筛选条件的歌曲');
    return loadPlaylistIntoQueueById('mineradio:filtered', true, st.playlist && st.playlist.name || '', {
      seedTracks: filtered, total: filtered.length, nextOffset: filtered.length, hasMore: false
    });
  }
  var parts = st.key.split(':');
  var provider = normalizePlaylistProvider(parts[0]);
  var pid = parts.slice(1).join(':');
  return loadPlaylistIntoQueueById(playlistPanelProviderId(provider, pid), true, st.playlist && st.playlist.name || '', {
    seedTracks: st.tracks, total: st.total, nextOffset: st.nextOffset, hasMore: st.hasMore
  });
}

async function togglePlaylistPanelCollection(collected) {
  var state = playlistPanelDetailState;
  if (!state || !state.key || !state.playlist) return;
  var parts = state.key.split(':');
  var provider = normalizePlaylistProvider(parts[0]);
  var id = parts.slice(1).join(':');
  var endpoint = provider === 'netease'
    ? '/api/playlist/subscribe'
    : (provider === 'qishui'
      ? '/api/qishui/playlist/collect'
      : (provider === 'spotify' ? '/api/spotify/playlist/collect' : ''));
  if (!endpoint) {
    showToast(playlistProviderName(provider) + '暂不支持写回歌单收藏');
    return;
  }
  try {
    var result = await apiJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id,
        playlistId: id,
        subscribed: !!collected,
        collected: !!collected,
        spotifyUri: state.playlist.spotifyUri || '',
      })
    });
    if (!result || result.error || result.success === false) throw new Error(result && (result.message || result.error) || 'PLAYLIST_COLLECTION_FAILED');
    showToast(collected ? '歌单已收藏' : '已取消收藏歌单');
    cancelPlaylistPanelDetailRequest();
    playlistPanelDetailState.key = '';
    playlistPanelDetailState.tracks = [];
    playlistPanelDetailState.playlist = null;
    await refreshUserPlaylists(true);
    renderPlaylistPanelDetailState();
  } catch (err) {
    showToast(/SCOPE|PERMISSION/i.test(String(err && err.message || ''))
      ? '请重新授权后再修改歌单收藏'
      : '歌单收藏操作失败');
  }
}

function playPlaylistPanelDetailTrack(index) {
  var tracks = playlistPanelDetailState.tracks || [];
  if (!tracks[index]) return;
  if (window.mineradioPlaylistFilter && mineradioPlaylistFilter.active(playlistPanelDetailState)) {
    var song = tracks[index];
    var filtered = mineradioPlaylistFilter.rows(playlistPanelDetailState).map(function (item) { return item.song; });
    var selected = filtered.indexOf(song);
    if (selected < 0) return;
    return loadPlaylistIntoQueueById('mineradio:filtered', true, playlistPanelDetailState.playlist && playlistPanelDetailState.playlist.name || '', {
      seedTracks: filtered, startIndex: selected, total: filtered.length, nextOffset: filtered.length, hasMore: false
    });
  }
  var parts = playlistPanelDetailState.key.split(':');
  var provider = normalizePlaylistProvider(parts[0]);
  var pid = parts.slice(1).join(':');
  loadPlaylistIntoQueueById(playlistPanelProviderId(provider, pid), true, playlistPanelDetailState.playlist && playlistPanelDetailState.playlist.name || '', {
    seedTracks: tracks,
    startIndex: index,
    total: playlistPanelDetailState.total,
    nextOffset: playlistPanelDetailState.nextOffset,
    hasMore: playlistPanelDetailState.hasMore,
    preserveHomeState: true
  });
}

function openPlaylistPanelDetailArtist(index) {
  var song = playlistPanelDetailState.tracks && playlistPanelDetailState.tracks[index];
  if (song) openArtistDetailForSong(song);
}

function growPlaylistPanelDetailRenderLimit(amount) {
  return loadMorePlaylistPanelDetailTracks('manual');
}

function maybeGrowPlaylistPanelDetailRenderLimit() {
  var panel = document.getElementById('playlist-panel');
  var detail = panel && panel.querySelector('.pl-inline-detail[data-pl-detail]');
  if (!panel || !detail || !playlistPanelDetailState.hasMore || playlistPanelDetailState.loadingMore) return;
  var panelRect = panel.getBoundingClientRect();
  var detailRect = detail.getBoundingClientRect();
  if (detailRect.bottom <= panelRect.bottom + PLAYLIST_DETAIL_ROW_STEP * 8) loadMorePlaylistPanelDetailTracks('scroll');
}

function resetPlaylistPanelRenderLimit() {
  playlistPanelRenderLimit = PLAYLIST_PANEL_BATCH_SIZE;
}

function playlistPanelDetailShellHeight() {
  var st = playlistPanelDetailState || {};
  var rows = Math.max(st.loading && !(st.tracks && st.tracks.length) ? 1 : 0, st.tracks && st.tracks.length || 0);
  var noticeHeight = rows ? 0 : 74;
  var footerHeight = st.error || st.hasMore || st.loadingMore || rows > PLAYLIST_DETAIL_INITIAL_RENDER ? PLAYLIST_DETAIL_OUTER_FOOTER_HEIGHT : 12;
  return PLAYLIST_DETAIL_OUTER_CHROME_HEIGHT + rows * PLAYLIST_DETAIL_ROW_STEP + noticeHeight + footerHeight;
}

function playlistPanelGroupKey(pl) {
  return normalizePlaylistProvider(pl && pl.provider);
}

function playlistPanelBuildVirtualEntries() {
  var detailSig = [
    playlistPanelDetailState.key || '',
    playlistPanelDetailState.loading ? 1 : 0,
    playlistPanelDetailState.loadingMore ? 1 : 0,
    playlistPanelDetailState.tracks && playlistPanelDetailState.tracks.length || 0,
    playlistPanelDetailState.total || 0,
    playlistPanelDetailState.hasMore ? 1 : 0,
    playlistPanelDetailState.error || ''
  ].join('|');
  if (playlistPanelVirtualCache.revision === playlistCatalogRevision &&
      playlistPanelVirtualCache.detailKey === playlistPanelDetailState.key &&
      playlistPanelVirtualCache.detailSig === detailSig) return playlistPanelVirtualCache;
  var labels = { mineradio: 'Mineradio 内置歌单', netease: '网易云歌单', qq: 'QQ 音乐歌单', kugou: '酷狗音乐歌单', qishui: '汽水音乐歌单', spotify: 'Spotify 歌单' };
  var order = ['mineradio', 'netease', 'qq', 'kugou', 'qishui', 'spotify'];
  var groups = { mineradio: [], netease: [], qq: [], kugou: [], qishui: [], spotify: [] };
  userPlaylists.forEach(function (pl, sourceIndex) {
    var key = playlistPanelGroupKey(pl);
    if (!groups[key]) groups[key] = [];
    groups[key].push({ pl: pl, sourceIndex: sourceIndex });
  });
  var entries = [];
  order.forEach(function (key) {
    var items = (groups[key] || []).sort(function (a, b) {
      var priority = playlistCardPriority(a.pl) - playlistCardPriority(b.pl);
      return priority || (a.sourceIndex - b.sourceIndex);
    });
    if (!items.length) return;
    entries.push({ type: 'label', key: key, label: labels[key] || key, height: 31 });
    items.forEach(function (entry) {
      entries.push({ type: 'card', pl: entry.pl, sourceIndex: entry.sourceIndex, height: 69 });
      var cardKey = playlistPanelKey(normalizePlaylistProvider(entry.pl.provider), entry.pl.id);
      if (playlistPanelDetailState.key === cardKey) {
        entries.push({ type: 'detail', pl: entry.pl, provider: normalizePlaylistProvider(entry.pl.provider), height: playlistPanelDetailShellHeight() });
      }
    });
  });
  var offsets = [0];
  entries.forEach(function (entry) { offsets.push(offsets[offsets.length - 1] + entry.height); });
  playlistPanelVirtualCache = {
    revision: playlistCatalogRevision,
    detailKey: playlistPanelDetailState.key,
    detailSig: detailSig,
    entries: entries,
    offsets: offsets,
    totalHeight: offsets[offsets.length - 1] || 0,
    raf: playlistPanelVirtualCache.raf || 0
  };
  return playlistPanelVirtualCache;
}

function playlistPanelOffsetIndex(offsets, value) {
  var lo = 0, hi = Math.max(0, offsets.length - 1);
  while (lo < hi) {
    var mid = Math.floor((lo + hi + 1) / 2);
    if (offsets[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, Math.min(offsets.length - 2, lo));
}

function playlistCatalogFooterHtml() {
  var state = playlistCatalogSyncState || {};
  var providerStates = state.providers || {};
  var totals = Object.keys(providerStates).reduce(function (acc, key) {
    var item = providerStates[key] || {};
    acc.loaded += Number(item.loaded) || 0;
    acc.total += Math.max(Number(item.total) || 0, Number(item.loaded) || 0);
    if (item.hasMore || item.loading) acc.pending = true;
    return acc;
  }, { loaded: 0, total: 0, pending: !!state.loading });
  if (!totals.pending && !state.error) return '';
  var label = state.error
    ? ('部分歌单载入失败 · 已显示 ' + userPlaylists.length + ' 个')
    : ('正在后台载入歌单 · ' + totals.loaded + (totals.total ? '/' + totals.total : ''));
  return '<div class="playlist-catalog-status"><span class="queue-hydration-spinner spinning"></span><span>' + label + '</span></div>';
}

function schedulePlaylistPanelVirtualRender() {
  if (playlistPanelVirtualCache.raf) return;
  playlistPanelVirtualCache.raf = requestAnimationFrame(function () {
    playlistPanelVirtualCache.raf = 0;
    if (queueViewTab !== 'playlists') return;
    renderUserPlaylistsList({ animate: false, preserveScroll: true });
  });
}

function bindPlaylistPanelLazyRender() {
  var panel = document.getElementById('playlist-panel');
  bindMiniQueueLazyRender();
  if (!panel || playlistPanelLazyBound) return;
  playlistPanelLazyBound = true;
  panel.addEventListener('scroll', function () {
    if (queueViewTab === 'queue') {
      scheduleQueuePanelVirtualRender();
      maybeRequestPlaylistQueuePageFromScroller(panel);
    }
    if (queueViewTab === 'playlists') {
      schedulePlaylistPanelVirtualRender();
      maybeGrowPlaylistPanelDetailRenderLimit();
    }
  }, { passive: true });
}

function renderUserPlaylistsList(opts) {
  opts = opts || {};
  var $pl = document.getElementById('pl-list');
  var seq = ++playlistRenderSeq;
  if (!userPlaylists.length) {
    $pl.innerHTML = playlistCatalogSyncState && playlistCatalogSyncState.loading
      ? miniQueueSkeleton() + playlistCatalogFooterHtml()
      : '<div style="text-align:center;padding:24px 0;color:rgba(255,255,255,.32);font-size:11.5px">未找到歌单</div>';
    return;
  }
  var panel = document.getElementById('playlist-panel');
  var keepTop = panel ? panel.scrollTop : 0;
  function playlistCardHtml(pl, sourceIndex) {
    var provider = normalizePlaylistProvider(pl.provider);
    var providerLabel = playlistProviderLabel(provider);
    var thumb = pl.cover ? (typeof coverProxySrc === 'function' ? coverProxySrc(pl.cover) || pl.cover : pl.cover) : '';
    var fallback = typeof shelfCoverFallbackSrc === 'function' ? shelfCoverFallbackSrc(pl) : '';
    var imageError = fallback ? 'this.onerror=null;this.src=' + JSON.stringify(fallback) : 'this.style.opacity=0.2';
    var imgTag = thumb || fallback ? '<img src="' + escHtml(thumb || fallback) + '" alt="" loading="lazy" decoding="async" onerror="' + escHtml(imageError) + '">' : (provider === 'mineradio' ? '<div class="pl-built-in-placeholder">MR</div>' : '<div style="width:44px;height:44px;border-radius:8px;background:rgba(255,255,255,.06);flex-shrink:0"></div>');
    var key = playlistPanelKey(provider, pl.id);
    var isExpanded = playlistPanelDetailState.key === key;
    var expanded = isExpanded ? ' expanded' : '';
    return '<div class="pl-card' + expanded + '" aria-expanded="' + (isExpanded ? 'true' : 'false') + '" data-playlist-provider="' + provider + '" data-playlist-id="' + escHtml(String(pl.id || '')) + '" data-playlist-title="' + escHtml(pl.name || '') + '" data-playlist-index="' + sourceIndex + '">' +
      imgTag +
      '<div style="flex:1;min-width:0"><div class="pl-name">' + escHtml(pl.name) + '<span class="tag-source ' + provider + '" style="margin-left:6px;vertical-align:1px">' + providerLabel + '</span></div><div class="pl-sub">' + pl.trackCount + ' 首 · ' + escHtml(pl.creator || '') + '</div></div>' +
      '</div>';
  }
  var cache = playlistPanelBuildVirtualEntries();
  var listRect = $pl.getBoundingClientRect();
  var panelRect = panel && panel.getBoundingClientRect ? panel.getBoundingClientRect() : { top: 0 };
  var visibleTop = panel ? Math.max(0, panelRect.top - listRect.top) : 0;
  var viewport = Math.max(420, Number(panel && panel.clientHeight) || 620);
  var start = playlistPanelOffsetIndex(cache.offsets, Math.max(0, visibleTop - PLAYLIST_CARD_VIRTUAL_OVERSCAN_PX));
  var end = Math.min(cache.entries.length, playlistPanelOffsetIndex(cache.offsets, visibleTop + viewport + PLAYLIST_CARD_VIRTUAL_OVERSCAN_PX) + 1);
  var topHeight = cache.offsets[start] || 0;
  var bottomHeight = Math.max(0, cache.totalHeight - (cache.offsets[end] || cache.totalHeight));
  var html = '<div class="playlist-virtual-spacer" aria-hidden="true" style="height:' + Math.round(topHeight) + 'px"></div>';
  for (var entryIndex = start; entryIndex < end; entryIndex++) {
    var entry = cache.entries[entryIndex];
    if (entry.type === 'label') html += '<div class="pl-section-label">' + entry.label + '</div>';
    else if (entry.type === 'card') html += playlistCardHtml(entry.pl, entry.sourceIndex);
    else if (entry.type === 'detail') {
      var entryTop = cache.offsets[entryIndex] || 0;
      var detailRowScrollTop = Math.max(0, visibleTop - entryTop - PLAYLIST_DETAIL_OUTER_CHROME_HEIGHT);
      html += playlistPanelDetailHtml(entry.pl, entry.provider, { scrollTop: detailRowScrollTop, viewport: viewport });
    }
  }
  html += '<div class="playlist-virtual-spacer" aria-hidden="true" style="height:' + Math.round(bottomHeight) + 'px"></div>' + playlistCatalogFooterHtml();
  if ($pl.__playlistRenderedHtml !== html || !$pl.firstChild) {
    $pl.innerHTML = html;
    $pl.__playlistRenderedHtml = html;
  }
  if (panel && opts.preserveScroll) panel.scrollTop = keepTop;
  bindPlaylistPanelDetailScroller();
  if (typeof requestNextPlaylistCatalogPage === 'function' && end >= cache.entries.length - 8) requestNextPlaylistCatalogPage('panel-near-end');
  if (opts.animate && seq === playlistRenderSeq) animateVisiblePanelList($pl, '.pl-card', document.getElementById('playlist-panel'));
}

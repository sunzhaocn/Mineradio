'use strict';


async function fetchMusicSearchResults(q, mode, previousPages, onPartial, signal) {
  searchProviderNotice = '';
  var providers = activeSearchProvidersForMode(mode);
  if (!providers.length) {
    searchProviderNotice = searchProviderLoginNotice(mode);
    return { songs: [], providerPages: {}, hasMore: false };
  }
  previousPages = previousPages && typeof previousPages === 'object' ? previousPages : null;
  var providerPages = {};
  Object.keys(previousPages || {}).forEach(function (provider) {
    providerPages[provider] = Object.assign({}, previousPages[provider]);
  });
  var pageLimitByProvider = { netease: 18, qq: 12, kugou: 12, qishui: 12, spotify: 10 };
  var fetchProviders = providers.filter(function (provider) {
    return !previousPages || !previousPages[provider] || previousPages[provider].hasMore;
  });
  var result = await Promise.allSettled(fetchProviders.map(function (provider) {
    var previous = previousPages && previousPages[provider];
    var offset = previous ? Math.max(0, Number(previous.nextOffset) || 0) : 0;
    var limit = pageLimitByProvider[provider] || 12;
    return apiJson(searchProviderUrl(provider, q, limit, offset), { timeoutMs: 10000, signal: signal }).then(function (value) {
      if (onPartial && value && Array.isArray(value.songs) && value.songs.length) {
        onPartial(mergeSongSearchResults(
          provider === 'netease' ? value.songs : [], provider === 'qq' ? value.songs : [],
          provider === 'kugou' ? value.songs : [], provider === 'qishui' ? value.songs : [],
          provider === 'spotify' ? value.songs : [], MUSIC_SEARCH_MAX_RESULTS, q));
      }
      return { provider: provider, offset: offset, requestedLimit: limit, value: value || {} };
    });
  }));
  var songsByProvider = { netease: [], qq: [], kugou: [], qishui: [], spotify: [] };
  fetchProviders.forEach(function (provider, index) {
    var entry = result[index];
    if (!entry || entry.status !== 'fulfilled') {
      console.warn(controlSourceProviderTitle(provider) + ' search failed:', entry && entry.reason);
      providerPages[provider] = Object.assign({}, providerPages[provider] || {}, { hasMore: false, failed: true });
      return;
    }
    var response = entry.value || {};
    var value = response.value || {};
    var songs = Array.isArray(value.songs) ? value.songs : [];
    var offset = response.offset;
    var requestedLimit = response.requestedLimit;
    var nextOffset = Number(value.nextOffset);
    if (!isFinite(nextOffset) || nextOffset <= offset) nextOffset = offset + songs.length;
    var hasMore = value.hasMore === true;
    if (value.hasMore == null) hasMore = songs.length >= requestedLimit;
    if (!songs.length || nextOffset <= offset) hasMore = false;
    providerPages[provider] = {
      offset: offset,
      limit: Number(value.limit) || requestedLimit,
      nextOffset: nextOffset,
      hasMore: hasMore,
      total: Number(value.total) || 0,
      failed: false
    };
    songsByProvider[provider] = songs;
    if (value.message && !songs.length && !searchProviderNotice) searchProviderNotice = value.message;
  });
  var songs = mergeSongSearchResults(
    songsByProvider.netease,
    songsByProvider.qq,
    songsByProvider.kugou,
    songsByProvider.qishui,
    songsByProvider.spotify,
    MUSIC_SEARCH_MAX_RESULTS,
    q
  );
  // Aggregate rank belongs to the recording; its default source follows the
  // platform order shown in the search tabs, rather than response timing/heat.
  var preferredOrder = searchModeProvider(mode) ? [searchModeProvider(mode)] : MUSIC_SEARCH_PROVIDER_ORDER;
  songs = songs.map(function (song) {
    var sources = searchSongSources(song);
    sources.sort(function (a, b) { return preferredOrder.indexOf(songProviderKey(a)) - preferredOrder.indexOf(songProviderKey(b)); });
    return sources.length ? Object.assign({}, sources[0], { _searchScore: song._searchScore, _webSearchSources: sources }) : song;
  });
  return { songs: songs, providerPages: providerPages, hasMore: searchProviderPagesHaveMore(providerPages) };
}

function searchSongResultHtml(s, i) {
    var vipTag = songVipTagHtml(s);
    var sourceTag = songSourceTagHtml(s);
    var sourceClass = songProviderKey(s) + '-source';
    var thumb = songCoverSrc(s, 80);
    var imgTag = thumb
      ? '<img src="' + thumb + '" alt="" loading="lazy" onerror="this.style.opacity=0.2">'
      : '<div style="width:40px;height:40px;border-radius:6px;background:rgba(255,255,255,0.06);flex-shrink:0"></div>';
    return '<div class="search-result ' + sourceClass + '">' +
      '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0" onclick="playSearchResult(' + i + ')">' +
      imgTag +
      '<div class="search-result-info">' +
      '<div class="search-result-title">' + escHtml(s.name) + sourceTag + vipTag + '</div>' +
      '<div class="search-result-meta">' + searchResultMetaHtml(s, i) + '</div>' +
      '</div>' +
      '</div>' +
      '<button class="song-action-btn web-song-quality-button" data-web-quality-index="' + i + '" type="button" title="查看全部音质"><span class="web-quality-badge">音质</span></button>' +
      '<button class="song-action-btn web-song-download-button" data-web-download-index="' + i + '" type="button" title="下载此音源，可选择音质" aria-label="下载此音源，可选择音质"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/></svg></button>' +
      '<button class="song-action-btn' + (isSongLiked(s) ? ' liked' : '') + '" data-like-index="' + i + '" title="' + (isSongLiked(s) ? '取消红心' : '红心喜欢') + '" onclick="event.stopPropagation();toggleLikeSearchResult(' + i + ')">' + heartIconSvg() + '</button>' +
      '<button class="song-action-btn" title="收藏到歌单" onclick="event.stopPropagation();collectSearchResult(' + i + ')">' + playlistPlusIconSvg() + '</button>' +
      '<button class="add-btn" title="下一首播放" onclick="event.stopPropagation();queueSearchResult(' + i + ')">+</button>' +
      '</div>';
}

function searchLoadMoreSentinelHtml() {
  var remaining = Math.max(0, searchMusicRenderState.songs.length - searchMusicRenderState.visibleCount);
  if (!remaining && !searchMusicRenderState.remoteHasMore && !searchMusicRenderState.loadingMore) return '';
  var label = searchMusicRenderState.loadingMore
    ? '正在加载更多歌曲…'
    : (remaining ? ('继续滚动加载 · 当前还有 ' + remaining + ' 首') : '继续滚动加载更多歌曲');
  return '<div class="search-empty search-load-more" data-search-load-more="1" role="status">' + label + '</div>';
}

function refreshSearchLoadMoreSentinel() {
  disconnectSearchLoadMoreObserver();
  var sentinel = $results && $results.querySelector('[data-search-load-more]');
  if (sentinel) sentinel.remove();
  var html = searchLoadMoreSentinelHtml();
  if (html && $results) $results.insertAdjacentHTML('beforeend', html);
  observeSearchLoadMoreSentinel();
}

function observeSearchLoadMoreSentinel() {
  disconnectSearchLoadMoreObserver();
  var sentinel = $results && $results.querySelector('[data-search-load-more]');
  if (!sentinel || !window.IntersectionObserver) return;
  var expectedKey = searchMusicRenderState.key;
  searchLoadMoreObserver = new IntersectionObserver(function (entries) {
    if (entries.some(function (entry) { return entry.isIntersecting; })) appendNextSearchResults(expectedKey);
  }, { root: $results, rootMargin: '0px 0px 96px 0px', threshold: 0.01 });
  searchLoadMoreObserver.observe(sentinel);
}

async function loadNextMusicSearchPage(expectedKey) {
  if (!expectedKey || expectedKey !== searchMusicRenderState.key || expectedKey !== searchLastResultQuery) return false;
  if (searchMusicRenderState.loadingMore || !searchMusicRenderState.remoteHasMore) return false;
  if (searchMusicRenderState.songs.length >= MUSIC_SEARCH_MAX_RESULTS) {
    searchMusicRenderState.remoteHasMore = false;
    refreshSearchLoadMoreSentinel();
    return false;
  }
  searchMusicRenderState.loadingMore = true;
  refreshSearchLoadMoreSentinel();
  var requestSeq = searchRequestSeq;
  var q = searchMusicRenderState.query;
  var mode = searchMusicRenderState.mode;
  try {
    var page = await fetchMusicSearchResults(q, mode, searchMusicRenderState.providerPages);
    if (requestSeq !== searchRequestSeq || expectedKey !== searchMusicRenderState.key || expectedKey !== searchLastResultQuery || searchMode !== mode || $input.value.trim() !== q) return false;
    var before = searchMusicRenderState.songs.length;
    var merged = mergeUniqueSearchSongPools(searchMusicRenderState.songs, page.songs || []);
    searchMusicRenderState.providerPages = page.providerPages || {};
    searchMusicRenderState.songs = merged;
    playlist = merged;
    searchMusicRenderState.remoteHasMore = !!page.hasMore && merged.length < MUSIC_SEARCH_MAX_RESULTS;
    // 某一页可能全是已有歌曲的其它音源；分页仍由平台的 hasMore 决定，不能因此截断后续结果。
    searchMusicRenderState.loadingMore = false;
    if (merged.length > before) return appendNextSearchResults(expectedKey);
    refreshSearchLoadMoreSentinel();
    return false;
  } catch (err) {
    console.warn('[SearchLoadMore]', err);
    if (expectedKey === searchMusicRenderState.key) {
      searchMusicRenderState.loadingMore = false;
      searchMusicRenderState.remoteHasMore = false;
      refreshSearchLoadMoreSentinel();
    }
    return false;
  }
}

function appendNextSearchResults(expectedKey) {
  expectedKey = expectedKey || searchMusicRenderState.key;
  if (!expectedKey || expectedKey !== searchMusicRenderState.key || expectedKey !== searchLastResultQuery) return false;
  if (searchMusicRenderState.appending || searchMusicRenderState.loadingMore) return false;
  if (searchMusicRenderState.visibleCount >= searchMusicRenderState.songs.length) {
    if (searchMusicRenderState.remoteHasMore) {
      loadNextMusicSearchPage(expectedKey);
      return true;
    }
    refreshSearchLoadMoreSentinel();
    return false;
  }
  searchMusicRenderState.appending = true;
  disconnectSearchLoadMoreObserver();
  requestAnimationFrame(function () {
    if (expectedKey !== searchMusicRenderState.key || expectedKey !== searchLastResultQuery) {
      searchMusicRenderState.appending = false;
      return;
    }
    var start = searchMusicRenderState.visibleCount;
    var end = Math.min(searchMusicRenderState.songs.length, start + MUSIC_SEARCH_APPEND_BATCH);
    var html = '';
    for (var i = start; i < end; i++) html += searchSongResultHtml(searchMusicRenderState.songs[i], i);
    searchMusicRenderState.visibleCount = end;
    var sentinel = $results.querySelector('[data-search-load-more]');
    if (sentinel) sentinel.insertAdjacentHTML('beforebegin', html);
    else $results.insertAdjacentHTML('beforeend', html);
    syncLikeStatusForSongs(searchMusicRenderState.songs.slice(start, end));
    searchMusicRenderState.appending = false;
    refreshSearchLoadMoreSentinel();
  });
  return true;
}

function renderSongSearchResults(songs) {
  setSearchHistorySurface(false);
  var plan = pendingSearchProviderPages || {};
  resetSearchMusicRenderState();
  playlist = Array.isArray(songs) ? songs : [];
  searchMusicRenderState.key = plan.key || searchLastResultQuery || searchResultKey($input && $input.value, searchMode);
  searchMusicRenderState.query = plan.query || String($input && $input.value || '').trim();
  searchMusicRenderState.mode = plan.mode || searchMode;
  searchMusicRenderState.providerPages = plan.providerPages || {};
  searchMusicRenderState.remoteHasMore = !!plan.hasMore;
  searchMusicRenderState.songs = playlist;
  searchMusicRenderState.visibleCount = Math.min(playlist.length, plan.visibleCount || MUSIC_SEARCH_INITIAL_VISIBLE);
  var html = '';
  for (var i = 0; i < searchMusicRenderState.visibleCount; i++) html += searchSongResultHtml(playlist[i], i);
  $results.innerHTML = html + searchLoadMoreSentinelHtml();
  $results.classList.add('show');
  syncLikeStatusForSongs(playlist.slice(0, searchMusicRenderState.visibleCount));
  if (window.gsap && !plan.progressive) animateListItems($results, '.search-result', { x: 0, y: 6, stagger: 0.012, duration: 0.18, limit: 18 });
  observeSearchLoadMoreSentinel();
}


async function doSearch(q, opts) {
  opts = opts || {};
  q = String(q || '').trim();
  if (!q) {
    if (!renderSearchHistory() && searchMode === 'podcast') loadPodcastHot();
    return;
  }
  if (searchMode === 'podcast') {
    doPodcastSearch(q);
    return;
  }
  var requestSeq = ++searchRequestSeq;
  if (searchAbortController) searchAbortController.abort();
  searchAbortController = window.AbortController ? new window.AbortController() : null;
  var controller = searchAbortController;
  disconnectSearchLoadMoreObserver();
  setSearchHistorySurface(false);
  try {
    var mode = searchMode;
    var streamedSongs = [];
    function currentRequest() { return requestSeq === searchRequestSeq && searchMode === mode && $input.value.trim() === q; }
    var searchData = await fetchMusicSearchResults(q, mode, null, function (partial) {
      if (!currentRequest()) return;
      streamedSongs = mergeUniqueSearchSongPools(streamedSongs, partial);
      var scroll = $results.scrollTop, visible = searchMusicRenderState.visibleCount;
      searchLastResultQuery = searchResultKey(q, mode);
      pendingSearchProviderPages = { key: searchLastResultQuery, query: q, mode: mode,
        hasMore: false, progressive: true, visibleCount: visible };
      renderSongSearchResults(streamedSongs);
      $results.scrollTop = scroll;
    }, controller && controller.signal);
    var songs = searchData && Array.isArray(searchData.songs) ? searchData.songs : [];
    // Keep already visible rows in place while slower platforms add sources.
    // A tap must continue to address the same song throughout the search.
    if (streamedSongs.length) songs = mergeUniqueSearchSongPools(streamedSongs, songs);
    if (requestSeq !== searchRequestSeq || searchMode !== mode || $input.value.trim() !== q) return;
    if (!songs.length) {
      resetSearchMusicRenderState();
      playlist = [];
      searchLastResultQuery = '';
      $results.innerHTML = '<div class="search-empty">' + escHtml(searchProviderNotice || '没有找到相关歌曲') + '</div>';
      $results.classList.add('show');
      return;
    }
    searchLastResultQuery = searchResultKey(q, mode);
    rememberSearchQuery(q);
    var scroll = $results.scrollTop, visible = searchMusicRenderState.visibleCount;
    pendingSearchProviderPages = {
      key: searchLastResultQuery,
      query: q,
      mode: mode,
      providerPages: searchData.providerPages || {},
      hasMore: !!searchData.hasMore,
      progressive: !!streamedSongs.length,
      visibleCount: visible
    };
    renderSongSearchResults(songs);
    $results.scrollTop = scroll;
    if (opts.autoPlayFirst) playSearchResult(0);
  } catch (err) {
    console.error('Search:', err);
    if (requestSeq === searchRequestSeq) {
      resetSearchMusicRenderState();
      playlist = [];
      searchLastResultQuery = '';
      $results.innerHTML = '<div class="search-empty">搜索暂时失败，请稍后重试</div>';
      $results.classList.add('show');
    }
  } finally {
    if (searchAbortController === controller) searchAbortController = null;
  }
}

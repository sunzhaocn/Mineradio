'use strict';

// ============================================================
var searchTimer = null;

var searchRequestSeq = 0;
var searchAbortController = null;

var searchLastResultQuery = '';

var searchProviderNotice = '';

var SEARCH_HISTORY_STORE_KEY = 'mineradio-search-history';

var SEARCH_HISTORY_STORE_VERSION = 3;

var SEARCH_HISTORY_MODES = ['song', 'netease', 'qq', 'kugou', 'qishui', 'podcast'];

var MUSIC_SEARCH_INITIAL_VISIBLE = 18;

var MUSIC_SEARCH_APPEND_BATCH = 14;

var MUSIC_SEARCH_MAX_RESULTS = 180;

var searchLoadMoreObserver = null;

var pendingSearchProviderPages = null;

var searchMusicRenderState = {
  key: '',
  query: '',
  mode: 'song',
  songs: [],
  visibleCount: 0,
  appending: false,
  loadingMore: false,
  providerPages: {},
  remoteHasMore: false
};

var $input = document.getElementById('search-input');

var $results = document.getElementById('search-results');

var $loading = document.getElementById('loading-overlay');

if (window.MutationObserver && $results) {
  new MutationObserver(syncSearchAreaResultState).observe($results, { childList: true, attributes: true, attributeFilter: ['class'] });
}


$input.addEventListener('input', function () {
  clearTimeout(searchTimer);
  if (searchAbortController) searchAbortController.abort();
  var q = $input.value.trim();
  searchRequestSeq++;
  searchLastResultQuery = '';
  resetSearchMusicRenderState();
  if (!q) {
    playlist = [];
    if (!renderSearchHistory() && searchMode === 'podcast') loadPodcastHot();
    return;
  }
  if (isMusicSearchMode(searchMode)) {
    setSearchHistorySurface(false);
    $results.innerHTML = '<div class="search-empty">正在搜索 “' + escHtml(q) + '”…</div>';
    $results.classList.add('show');
  }
  if (!searchComposing) searchTimer = setTimeout(function () { doSearch(q); }, 350);
});
var searchComposing = false;
$input.addEventListener('compositionstart', function () { searchComposing = true; clearTimeout(searchTimer); });
$input.addEventListener('compositionend', function () {
  searchComposing = false; clearTimeout(searchTimer);
  var q = $input.value.trim();
  if (q) searchTimer = setTimeout(function () { doSearch(q); }, 350);
});

$input.addEventListener('focus', function () {
  var searchArea = document.getElementById('search-area');
  if (searchArea) setPeek(searchArea, true, 'search');
  if (!$input.value.trim()) {
    if (!renderSearchHistory() && searchMode === 'podcast') loadPodcastHot();
  } else if ($results.children.length > 0) {
    $results.classList.add('show');
  }
});

var searchBoxEl = document.getElementById('search-box');

if (searchBoxEl) {
  searchBoxEl.addEventListener('click', function () {
    if ($input) $input.focus();
  });
}

$input.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    if (e.isComposing || searchComposing) return;
    e.preventDefault();
    clearTimeout(searchTimer);
    var q = $input.value.trim();
    if (isMusicSearchMode(searchMode) && q && playlist.length && searchLastResultQuery === searchResultKey(q)) $results.classList.add('show');
    else doSearch(q, { autoPlayFirst: false });
  } else if (e.key === 'Escape') {
    clearTimeout(searchTimer);
    $input.blur();
    clearSearchResults();
    if (!emptyHomeActive) setPeek(document.getElementById('search-area'), false, 'search');
  }
});

$results.addEventListener('click', function (e) {
  var loadMore = e.target && e.target.closest ? e.target.closest('[data-search-load-more]') : null;
  if (loadMore) {
    e.preventDefault();
    e.stopPropagation();
    appendNextSearchResults();
    return;
  }
  var clearBtn = e.target && e.target.closest ? e.target.closest('[data-clear-history]') : null;
  if (clearBtn) {
    e.preventDefault();
    e.stopPropagation();
    clearSearchHistory();
    return;
  }
  var item = e.target && e.target.closest ? e.target.closest('[data-history-query]') : null;
  if (item) {
    e.preventDefault();
    e.stopPropagation();
    runSearchHistory(item.getAttribute('data-history-query') || '');
  }
});

$results.addEventListener('scroll', function () {
  if (!$results.classList.contains('show')) return;
  if ($results.scrollTop + $results.clientHeight >= $results.scrollHeight - 96) appendNextSearchResults();
}, { passive: true });

document.addEventListener('click', function (e) {
  var searchArea = document.getElementById('search-area');
  if (!searchArea.contains(e.target)) {
    $results.classList.remove('show');
    if (!emptyHomeActive) setPeek(searchArea, false, 'search');
  }
});

updateSearchModeTabs();

var controlSourceSwitcherState = { open: false, loading: false, requestId: 0, anchor: null };

document.addEventListener('click', function (e) {
  var el = document.getElementById('control-source-switcher');
  if (!el || !controlSourceSwitcherState.open) return;
  if (el.contains(e.target)) return;
  if (controlSourceSwitcherState.anchor && controlSourceSwitcherState.anchor.contains && controlSourceSwitcherState.anchor.contains(e.target)) return;
  closeControlSourceSwitcher();
});

window.addEventListener('resize', function () {
  if (controlSourceSwitcherState.open) controlSourcePositionSwitcher();
});

var MUSIC_SEARCH_PROVIDER_ORDER = ['netease', 'qq', 'kugou', 'qishui'];

var SEARCH_ORIGINAL_ARTIST_HINTS = [
  { titles: ['日落大道'], artists: ['梁博'] },
  { titles: ['beautyandabeat', 'beauty and a beat'], artists: ['justin bieber', 'nicki minaj'] }
];

// ============================================================
//  音频上下文 & 频谱分析

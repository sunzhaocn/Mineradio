'use strict';


function setSearchHistorySurface(on) {
  if ($results) $results.classList.toggle('search-history-surface', !!on);
}

function syncSearchAreaResultState() {
  var searchArea = document.getElementById('search-area');
  if (!searchArea || !$results) return;
  var hasVisibleResults = $results.classList.contains('show') && $results.children.length > 0;
  var hasIntent = !!($input && String($input.value || '').trim()) || searchMode === 'podcast';
  searchArea.classList.toggle('has-results', hasVisibleResults && hasIntent);
}

function isMusicSearchMode(mode) {
  return mode !== 'podcast';
}

function searchResultKey(q, mode) {
  return (mode || searchMode || 'song') + '|' + String(q || '').trim();
}

function disconnectSearchLoadMoreObserver() {
  if (searchLoadMoreObserver) searchLoadMoreObserver.disconnect();
  searchLoadMoreObserver = null;
}

function resetSearchMusicRenderState() {
  disconnectSearchLoadMoreObserver();
  searchMusicRenderState.key = '';
  searchMusicRenderState.query = '';
  searchMusicRenderState.mode = 'song';
  searchMusicRenderState.songs = [];
  searchMusicRenderState.visibleCount = 0;
  searchMusicRenderState.appending = false;
  searchMusicRenderState.loadingMore = false;
  searchMusicRenderState.providerPages = {};
  searchMusicRenderState.remoteHasMore = false;
  pendingSearchProviderPages = null;
}

function clearSearchResults() {
  if (searchAbortController) searchAbortController.abort();
  searchRequestSeq++;
  searchLastResultQuery = '';
  resetSearchMusicRenderState();
  playlist = [];
  podcastResults = [];
  podcastPrograms = [];
  podcastCurrentRadio = null;
  $results.innerHTML = '';
  $results.classList.remove('show', 'search-history-surface');
}

function emptySearchHistoryState() {
  return { version: SEARCH_HISTORY_STORE_VERSION, items: [] };
}

function normalizeSearchHistoryItems(items) {
  var seen = {};
  return (Array.isArray(items) ? items : []).map(function (value) {
    return String(value || '').trim();
  }).filter(function (value) {
    var key = value.toLowerCase();
    if (!value || seen[key]) return false;
    seen[key] = true;
    return true;
  }).slice(0, 10);
}

function readSearchHistoryState() {
  var state = emptySearchHistoryState();
  try {
    var raw = JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORE_KEY) || '[]');
    if (Array.isArray(raw)) {
      state.items = normalizeSearchHistoryItems(raw);
      return state;
    }
    if (!raw || typeof raw !== 'object') return state;
    if (Array.isArray(raw.items)) {
      state.items = normalizeSearchHistoryItems(raw.items);
      return state;
    }
    var sourceModes = raw.modes && typeof raw.modes === 'object' ? raw.modes : raw;
    var migratedItems = [];
    SEARCH_HISTORY_MODES.forEach(function (mode) {
      migratedItems = migratedItems.concat(Array.isArray(sourceModes[mode]) ? sourceModes[mode] : []);
    });
    state.items = normalizeSearchHistoryItems(migratedItems);
    return state;
  } catch (e) {
    return state;
  }
}

function writeSearchHistoryState(state) {
  var normalized = emptySearchHistoryState();
  normalized.items = normalizeSearchHistoryItems(state && state.items);
  try { localStorage.setItem(SEARCH_HISTORY_STORE_KEY, JSON.stringify(normalized)); } catch (e) { }
}

function readSearchHistory() {
  return readSearchHistoryState().items.slice();
}

function writeSearchHistory(items) {
  writeSearchHistoryState({ items: items });
}

function rememberSearchQuery(q) {
  q = String(q || '').trim();
  if (!q) return;
  var items = readSearchHistory().filter(function (item) { return item.toLowerCase() !== q.toLowerCase(); });
  items.unshift(q);
  writeSearchHistory(items);
}

function renderSearchHistory() {
  resetSearchMusicRenderState();
  var items = readSearchHistory();
  if (!items.length) {
    $results.innerHTML = '';
    $results.classList.remove('show', 'search-history-surface');
    return false;
  }
  $results.innerHTML =
    '<div class="search-history">' +
    '<div class="search-history-head"><span>搜索历史</span><button class="search-history-clear" type="button" data-clear-history="1">清空</button></div>' +
    '<div class="search-history-list">' +
    items.map(function (q) { return '<button class="search-history-chip" type="button" data-history-query="' + escHtml(q) + '">' + escHtml(q) + '</button>'; }).join('') +
    '</div>' +
    '</div>';
  setSearchHistorySurface(true);
  $results.classList.add('show');
  requestAnimationFrame(updateSearchPillGlassDisplacementMap);
  return true;
}

function clearSearchHistory() {
  writeSearchHistory([]);
  if (!renderSearchHistory() && searchMode === 'podcast') loadPodcastHot();
}

function runSearchHistory(q) {
  q = String(q || '').trim();
  if (!q) return;
  $input.value = q;
  setPeek(document.getElementById('search-area'), true, 'search');
  doSearch(q);
  $input.focus();
}

function updateSearchModeTabs() {
  var songBtn = document.getElementById('search-mode-song');
  var neteaseBtn = document.getElementById('search-mode-netease');
  var qqBtn = document.getElementById('search-mode-qq');
  var kugouBtn = document.getElementById('search-mode-kugou');
  var qishuiBtn = document.getElementById('search-mode-qishui');
  var podcastBtn = document.getElementById('search-mode-podcast');
  if (songBtn) {
    songBtn.classList.toggle('active', searchMode === 'song');
    songBtn.setAttribute('aria-selected', searchMode === 'song' ? 'true' : 'false');
  }
  if (neteaseBtn) {
    neteaseBtn.classList.toggle('active', searchMode === 'netease');
    neteaseBtn.setAttribute('aria-selected', searchMode === 'netease' ? 'true' : 'false');
  }
  if (qqBtn) {
    qqBtn.classList.toggle('active', searchMode === 'qq');
    qqBtn.setAttribute('aria-selected', searchMode === 'qq' ? 'true' : 'false');
  }
  if (kugouBtn) {
    kugouBtn.classList.toggle('active', searchMode === 'kugou');
    kugouBtn.setAttribute('aria-selected', searchMode === 'kugou' ? 'true' : 'false');
  }
  if (qishuiBtn) {
    qishuiBtn.classList.toggle('active', searchMode === 'qishui');
    qishuiBtn.setAttribute('aria-selected', searchMode === 'qishui' ? 'true' : 'false');
  }
  if (podcastBtn) {
    podcastBtn.classList.toggle('active', searchMode === 'podcast');
    podcastBtn.setAttribute('aria-selected', searchMode === 'podcast' ? 'true' : 'false');
  }
  if ($input) {
    $input.placeholder = searchMode === 'podcast'
      ? '搜索播客、电台...'
      : (searchMode === 'kugou' ? '搜索酷狗音乐...' : (searchMode === 'qq' ? '搜索 QQ 音乐...' : (searchMode === 'netease' ? '搜索网易云音乐...' : '搜索歌曲、歌手...')));
  }
  if (qishuiBtn && window.MINERADIO_QISHUI_PUBLIC_ONLY) {
    qishuiBtn.title = '官方公开目录；可粘贴官方歌曲链接或歌曲 ID';
    qishuiBtn.textContent = '汽水·公开';
  }
  if ($input && searchMode === 'qishui') $input.placeholder = window.MINERADIO_QISHUI_PUBLIC_ONLY
    ? '筛选公开目录，或粘贴官方歌曲链接 / ID…' : '搜索汽水音乐…';
  requestAnimationFrame(updateSearchPillGlassDisplacementMap);
}

function setSearchMode(mode) {
  mode = (mode === 'podcast' || mode === 'netease' || mode === 'qq' || mode === 'kugou' || mode === 'qishui') ? mode : 'song';
  if (window.checkClientPlatformAssets) window.checkClientPlatformAssets(mode === 'song' ? 'all' : mode);
  if (searchMode === mode) return;
  searchMode = mode;
  updateSearchModeTabs();
  clearSearchResults();
  var searchArea = document.getElementById('search-area');
  if (searchArea) setPeek(searchArea, true, 'search');
  var q = $input ? $input.value.trim() : '';
  if (searchMode === 'podcast') {
    if (q) doSearch(q);
    else if (!renderSearchHistory()) loadPodcastHot();
  } else if (q) {
    doSearch(q);
  } else {
    renderSearchHistory();
  }
}

function podcastMetaText(item) {
  item = item || {};
  var bits = [];
  if (item.djName) bits.push(item.djName);
  if (item.programCount) bits.push(item.programCount + ' episodes');
  if (item.subCount) bits.push(Math.round(item.subCount / 1000) + 'k follows');
  return bits.join('  ·  ');
}

function formatProgramTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = Math.floor(sec % 60);
  return h ? (h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')) : (m + ':' + String(s).padStart(2, '0'));
}

function programMetaText(item) {
  item = item || {};
  var bits = [];
  if (item.radioName || item.artist) bits.push(item.radioName || item.artist);
  if (item.djName && item.djName !== item.artist) bits.push(item.djName);
  if (item.duration) bits.push(formatProgramTime(Math.round(item.duration / 1000)));
  return bits.join('  ·  ');
}

function searchThumbHtml(src) {
  return src
    ? '<img src="' + coverUrlWithSize(src, 80) + '" alt="" loading="lazy" onerror="this.style.opacity=0.2">'
    : '<div style="width:40px;height:40px;border-radius:6px;background:rgba(255,255,255,0.06);flex-shrink:0"></div>';
}

function renderPodcastRadios(items, label) {
  setSearchHistorySurface(false);
  podcastResults = items || [];
  podcastPrograms = [];
  playlist = [];
  if (!podcastResults.length) {
    $results.innerHTML = '<div class="search-empty">No podcast found</div>';
    $results.classList.add('show');
    return;
  }
  $results.innerHTML = podcastResults.map(function (p, i) {
    return '<div class="search-result">' +
      '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0" onclick="openPodcastPrograms(' + i + ')">' +
      searchThumbHtml(p.cover) +
      '<div class="search-result-info">' +
      '<div class="search-result-title">' + escHtml(p.name || '') + '<span class="tag-podcast">Podcast</span></div>' +
      '<div class="search-result-meta">' + escHtml(podcastMetaText(p) || label || 'NetEase Radio') + '</div>' +
      '</div>' +
      '</div>' +
      '<button class="add-btn" title="Open" onclick="event.stopPropagation();openPodcastPrograms(' + i + ')">›</button>' +
      '</div>';
  }).join('');
  $results.classList.add('show');
  if (window.gsap) animateListItems($results, '.search-result', { x: 0, y: 6, stagger: 0.012, duration: 0.18, limit: 18 });
}

async function loadPodcastHot() {
  var requestSeq = ++searchRequestSeq;
  setSearchHistorySurface(false);
  $results.innerHTML = '<div class="search-empty">Loading podcasts...</div>';
  $results.classList.add('show');
  try {
    var data = await apiJson('/api/podcast/hot?limit=18');
    if (requestSeq !== searchRequestSeq || searchMode !== 'podcast') return;
    renderPodcastRadios(data.podcasts || [], 'Hot podcasts');
  } catch (err) {
    console.error('Podcast hot:', err);
    if (requestSeq === searchRequestSeq) $results.innerHTML = '<div class="search-empty">Podcast load failed</div>';
  }
}

async function doPodcastSearch(q) {
  var requestSeq = ++searchRequestSeq;
  try {
    var data = await apiJson('/api/podcast/search?keywords=' + encodeURIComponent(q) + '&limit=18');
    if (requestSeq !== searchRequestSeq || searchMode !== 'podcast' || $input.value.trim() !== q) return;
    var podcasts = data.podcasts || [];
    if (podcasts.length) rememberSearchQuery(q);
    renderPodcastRadios(podcasts, 'Search results');
  } catch (err) {
    console.error('Podcast search:', err);
  }
}

async function openPodcastPrograms(i) {
  var radio = podcastResults[i]; if (!radio) return;
  var requestSeq = ++searchRequestSeq;
  setSearchHistorySurface(false);
  podcastCurrentRadio = radio;
  $results.innerHTML = '<div class="search-empty">Loading episodes...</div>';
  $results.classList.add('show');
  try {
    var data = await apiJson('/api/podcast/programs?id=' + encodeURIComponent(radio.id) + '&limit=' + PLAYLIST_LAZY_BATCH_SIZE);
    if (requestSeq !== searchRequestSeq || searchMode !== 'podcast') return;
    podcastCurrentRadio = Object.assign({}, radio, data.radio || {});
    podcastPrograms = data.programs || [];
    playlist = podcastPrograms;
    renderPodcastPrograms();
  } catch (err) {
    console.error('Podcast programs:', err);
    if (requestSeq === searchRequestSeq) $results.innerHTML = '<div class="search-empty">Episodes load failed</div>';
  }
}

function renderPodcastPrograms() {
  setSearchHistorySurface(false);
  var radio = podcastCurrentRadio || {};
  if (!podcastPrograms.length) {
    $results.innerHTML = '<div class="podcast-result-head"><button class="podcast-back-btn" onclick="event.stopPropagation();renderPodcastRadios(podcastResults)">‹</button><div class="search-result-info"><div class="search-result-title">' + escHtml(radio.name || 'Podcast') + '</div><div class="search-result-meta">No playable episodes</div></div></div>';
    $results.classList.add('show');
    return;
  }
  $results.innerHTML =
    '<div class="podcast-result-head">' +
    '<button class="podcast-back-btn" onclick="event.stopPropagation();renderPodcastRadios(podcastResults)">‹</button>' +
    searchThumbHtml(radio.cover) +
    '<div class="search-result-info"><div class="search-result-title">' + escHtml(radio.name || 'Podcast') + '<span class="tag-podcast">Podcast</span></div><div class="search-result-meta">' + escHtml(radio.djName || (podcastPrograms.length + ' episodes')) + '</div></div>' +
    '</div>' +
    podcastPrograms.map(function (p, i) {
      return '<div class="search-result">' +
        '<div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0" onclick="playPodcastProgram(' + i + ')">' +
        searchThumbHtml(p.cover) +
        '<div class="search-result-info">' +
        '<div class="search-result-title">' + escHtml(p.name || '') + '</div>' +
        '<div class="search-result-meta">' + escHtml(programMetaText(p)) + '</div>' +
        '</div>' +
        '</div>' +
        '<button class="add-btn" title="下一首播放" onclick="event.stopPropagation();queuePodcastProgram(' + i + ')">+</button>' +
        '</div>';
    }).join('');
  $results.classList.add('show');
  if (window.gsap) animateListItems($results, '.search-result', { x: 0, y: 6, stagger: 0.010, duration: 0.18, limit: 18 });
}

function queuePodcastProgram(i) {
  var item = podcastPrograms[i]; if (!item) return;
  queueSongNext(item);
  showToast('已设为下一首: ' + item.name);
}

function playPodcastProgram(i) {
  var item = podcastPrograms[i]; if (!item) return;
  playSearchResult(i);
}


function songProviderKey(song) {
  if (song && (song.provider === 'spotify' || song.source === 'spotify' || song.type === 'spotify' || song.spotifyId || song.spotifyUri)) return 'spotify';
  if (song && (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq' || song.provider === 'qqmusic' || song.source === 'qqmusic' || song.type === 'qqmusic')) return 'qq';
  if (song && (song.provider === 'qishui' || song.source === 'qishui' || song.type === 'qishui')) return 'qishui';
  if (song && (song.provider === 'kugou' || song.source === 'kugou' || song.type === 'kugou' || song.hash || song.audioHash)) return 'kugou';
  return 'netease';
}

function songSourceTagHtml(song, opts) {
  opts = opts || {};
  var rawKey = song && (song.resolvedPlaybackProvider || song.playbackProvider || song.audioProvider || song.providerResolved || '');
  var key = /^(netease|qq|kugou|qishui|spotify)$/.test(String(rawKey || '')) ? String(rawKey) : songProviderKey(song);
  var label = key === 'qq' ? 'QQ' : (key === 'kugou' ? 'KG' : (key === 'qishui' ? 'QS' : (key === 'spotify' ? 'SP' : 'NE')));
  if (opts.switcher) {
    return '<button type="button" class="tag-source ' + key + ' control-source-chip" title="切换音源" aria-haspopup="true" onclick="toggleControlSourceSwitcher(event)">' + label + '</button>';
  }
  return '<span class="tag-source ' + key + '">' + label + '</span>';
}

'use strict';



function renderHomeDashboardDiscovery() {
  var root = document.getElementById('home-discovery-list');
  if (!root) return;
  homeDashboardDiscoveryCache = homeRecommendationSelection('discovery', homeDashboardDiscoverySongs(), 3, renderHomeDashboardDiscovery);
  var fingerprint = homeDashboardDiscoveryCache.map(function (song) {
    return [homeDashboardSongKey(song), song.name || song.title || '', homeDashboardSubtitle(song), homeDashboardSongCover(song, 180)].join('|');
  }).join('||');
  if (!fingerprint) {
    var pendingSelection = homeRecommendationRuntime().selections.get('discovery');
    fingerprint = 'empty:' + (pendingSelection && pendingSelection.pending ? 'pending' : 'done');
  }
  if (fingerprint === homeDashboardDiscoveryFingerprint) return;
  homeDashboardDiscoveryFingerprint = fingerprint;
  root.classList.toggle('is-empty', !homeDashboardDiscoveryCache.length);
  if (!homeDashboardDiscoveryCache.length) {
    var selection = homeRecommendationRuntime().selections.get('discovery');
    var title = selection && selection.pending ? '正在挑选可播放的歌曲' : '暂未找到可播放的歌曲';
    root.innerHTML = '<button class="home-discovery-empty" type="button" onclick="openHomeDashboardLibrary()">' +
      '<strong>' + title + '</strong><span>登录平台或导入本地音乐可补充推荐</span></button>';
    return;
  }
  root.innerHTML = homeDashboardDiscoveryCache.map(function (song, index) {
    var cover = homeDashboardSongCover(song, 180);
    var coverStyle = cover ? ' style="background-image:url(&quot;' + escHtml(cssImageUrl(cover)) + '&quot;)"' : '';
    return '<button class="home-discovery-song" type="button" onclick="playHomeDashboardDiscoverySong(' + index + ')">' +
      '<span class="home-discovery-cover"' + coverStyle + '></span>' +
      '<span class="home-discovery-song-copy"><span class="home-discovery-song-name">' + escHtml(song.name || song.title || '未知歌曲') + '</span>' +
      '<span class="home-discovery-song-artist">' + escHtml(homeDashboardSubtitle(song) + ' · ' + homeRecommendationSourceLabel(song)) + '</span></span></button>';
  }).join('');
}


function playHomeDashboardDiscoverySong(index) {
  var selected = homeDashboardDiscoveryCache[Number(index) || 0];
  if (!selected) {
    showToast('歌曲尚未准备好，请稍后再试');
    return;
  }
  playQueue = homeDashboardDiscoveryCache.map(function (song) { return cloneSong(song); });
  currentIdx = Math.max(0, Math.min(playQueue.length - 1, Number(index) || 0));
  homeForcedOpen = false;
  homeSuppressed = false;
  if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('home-dashboard-discovery', { scrollCurrent: true });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('home-dashboard-discovery', true);
  if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
  Promise.resolve(playQueueAt(currentIdx, homeRecommendationPlaybackOptions(playQueue[currentIdx], {
    manual: true,
    context: { type: 'home-discovery', playlistName: '为你挑选' },
  }))).catch(function (error) { console.warn('[HomeDashboardDiscovery]', error); });
}


function renderHomeInsightDock() {
  if (!document.getElementById('home-insight-dock')) return;
  var metrics = homeDashboardTodayListenMetrics();
  var time = document.getElementById('home-today-time');
  var count = document.getElementById('home-today-count');
  var artist = document.getElementById('home-today-artist');
  var streak = document.getElementById('home-today-streak');
  if (time) time.textContent = homeDashboardListenDurationText(metrics.listenMs);
  if (count) count.textContent = metrics.songCount + ' 首';
  if (artist) artist.textContent = metrics.topArtist || '等待记录';
  if (streak) streak.textContent = metrics.streak ? ('连续聆听 ' + metrics.streak + ' 天') : '开始播放后生成';

  var next = homeDashboardNextQueueInfo();
  var song = next.song;
  var title = document.getElementById('home-next-title');
  var sub = document.getElementById('home-next-sub');
  var cover = document.getElementById('home-next-cover');
  var card = document.getElementById('home-next-card');
  if (title) title.textContent = song ? (song.name || song.title || '未知歌曲') : '队列里还没有歌曲';
  if (sub) sub.textContent = song ? (homeDashboardSubtitle(song) + ' · ' + homeRecommendationSourceLabel(song)) : '正在检查后续歌曲的可用音源';
  var coverUrl = homeDashboardSongCover(song, 220);
  if (cover) homeDashboardSetStableBackgroundImage(cover, coverUrl);
  if (card) card.setAttribute('aria-label', song ? ('播放下一首：' + (song.name || song.title || '未知歌曲')) : '打开音乐库');
  renderHomeDashboardDiscovery();
}


function playHomeNextFromDock() {
  var next = homeDashboardNextQueueInfo();
  if (next.song && next.queued && next.index >= 0) {
    playQueue[next.index] = cloneSong(next.song);
    homeForcedOpen = false;
    homeSuppressed = false;
    if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
    if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
    Promise.resolve(playQueueAt(next.index, homeRecommendationPlaybackOptions(next.song, {
      manual: true,
      context: { type: 'home-next', playlistName: '接下来播放' },
    }))).catch(function (error) { console.warn('[HomeDashboardNext]', error); });
    return;
  }
  if (next.song) {
    playQueue = [cloneSong(next.song)];
    currentIdx = 0;
    if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('home-dashboard-next');
    if (typeof safeShelfRebuild === 'function') safeShelfRebuild('home-dashboard-next', true);
    if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
    Promise.resolve(playQueueAt(0, homeRecommendationPlaybackOptions(next.song, {
      manual: true,
      context: { type: 'home-next', playlistName: '首页推荐' },
    }))).catch(function (error) { console.warn('[HomeDashboardStart]', error); });
    return;
  }
  openHomeDashboardLibrary();
}


function openHomeDashboardLibrary() {
  var loggedIn = typeof hasAnyPlatformLogin === 'function' && hasAnyPlatformLogin()
    || homeDiscoverState && homeDiscoverState.loggedIn;
  if (loggedIn && typeof openHomeLibrary === 'function') {
    openHomeLibrary();
    return;
  }
  homeForcedOpen = false;
  homeSuppressed = false;
  if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
  if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility();
  if (typeof openUploadPanel === 'function') openUploadPanel();
}


function openHomeDashboardCharts() {
  openHomePlatformRecommendations('netease');
}


function homePlatformRecommendationSourceLabel(source) {
  return {
    netease: '网易云',
    qishui: '汽水',
    qq: 'QQ 音乐',
    kugou: '酷狗音乐',
  }[source] || '当前平台';
}


function homePlatformRecommendationFeedConfig(source) {
  return {
    qishui: {
      endpoint: '/api/qishui/feed?limit=12',
      sectionTitle: '推荐 Feed',
      cardLabel: '汽水推荐 Feed',
      readyText: '来自汽水推荐 Feed',
      playlistName: '汽水推荐 Feed',
    },
    kugou: {
      endpoint: '/api/kugou/recommendations?limit=12',
      sectionTitle: '推荐 FM',
      cardLabel: '酷狗推荐 FM',
      readyText: '来自酷狗 FM 推荐',
      playlistName: '酷狗推荐 FM',
    },
  }[source] || null;
}


function homePlatformRecommendationCard(kind, index, item, label) {
  item = item || {};
  var title = item.name || item.title || '未命名内容';
  var sub = '';
  if (kind === 'netease-playlist') sub = (item.trackCount ? item.trackCount + ' 首' : '推荐歌单') + (item.playCount ? ' · ' + compactHomeCount(item.playCount) + ' 播放' : '');
  else sub = homeDashboardSubtitle(item) || label;
  var cover = item.cover || item.picUrl || homeDashboardSongCover(item, 180) || '';
  var coverStyle = cover ? ' style="background-image:url(&quot;' + escHtml(cssImageUrl(cover)) + '&quot;)"' : '';
  return '<button class="home-platform-recommend-card" type="button" data-home-recommend-kind="' + kind + '" data-home-recommend-index="' + index + '">' +
    '<span class="home-platform-recommend-cover"' + coverStyle + '></span>' +
    '<span class="home-platform-recommend-copy"><span class="home-platform-recommend-label">' + escHtml(label) + '</span>' +
    '<strong>' + escHtml(title) + '</strong><small>' + escHtml(sub) + '</small></span>' +
    '<span class="home-platform-recommend-arrow" aria-hidden="true">›</span></button>';
}


function homePlatformRecommendationDailyRange(total, columns, scrollTop, viewportHeight, gridOffsetTop) {
  total = Math.max(0, Number(total) || 0);
  columns = Math.max(1, Number(columns) || 1);
  var totalRows = Math.ceil(total / columns);
  if (!totalRows) return { start: 0, end: 0, topRows: 0, bottomRows: 0 };
  var localScrollTop = Math.max(0, (Number(scrollTop) || 0) - (Number(gridOffsetTop) || 0));
  var firstVisibleRow = Math.floor(localScrollTop / HOME_PLATFORM_DAILY_ROW_HEIGHT);
  var visibleRows = Math.max(1, Math.ceil((Number(viewportHeight) || 500) / HOME_PLATFORM_DAILY_ROW_HEIGHT));
  var maxRows = Math.max(1, Math.floor(HOME_PLATFORM_DAILY_MAX_RENDERED_CARDS / columns));
  var startRow = Math.max(0, firstVisibleRow - HOME_PLATFORM_DAILY_OVERSCAN_ROWS);
  var renderRows = Math.min(maxRows, visibleRows + HOME_PLATFORM_DAILY_OVERSCAN_ROWS * 2);
  var endRow = Math.min(totalRows, startRow + renderRows);
  if (endRow === totalRows) startRow = Math.max(0, endRow - renderRows);
  return {
    start: startRow * columns,
    end: Math.min(total, endRow * columns),
    topRows: startRow,
    bottomRows: Math.max(0, totalRows - endRow),
  };
}


function homePlatformRecommendationGridColumns(grid) {
  if (!grid) return 1;
  try {
    var template = window.getComputedStyle(grid).gridTemplateColumns;
    var columns = String(template || '').trim().split(/\s+/).filter(Boolean).length;
    if (columns > 0) return columns;
  } catch (_error) { }
  return grid.clientWidth > 560 ? 2 : 1;
}


function homePlatformRecommendationSpacer(rows, position) {
  if (!rows) return '';
  var height = Math.max(0, rows * HOME_PLATFORM_DAILY_ROW_HEIGHT - 8);
  return '<span class="home-platform-recommend-spacer" data-home-recommend-spacer="' + position +
    '" aria-hidden="true" style="grid-column:1/-1;height:' + height + 'px"></span>';
}


function renderHomePlatformDailyWindow(force) {
  if (homePlatformRecommendationState.source !== 'netease') return;
  var list = document.getElementById('home-platform-recommend-list');
  var grid = document.getElementById('home-platform-daily-grid');
  if (!list || !grid) return;
  var songs = Array.isArray(homeDiscoverState.songs) ? homeDiscoverState.songs : [];
  var columns = homePlatformRecommendationGridColumns(grid);
  var range = homePlatformRecommendationDailyRange(
    songs.length,
    columns,
    list.scrollTop,
    list.clientHeight,
    grid.offsetTop
  );
  var signature = songs.length + '|' + columns + '|' + range.start + '|' + range.end;
  if (!force && grid.getAttribute('data-render-window') === signature) return;
  var html = [homePlatformRecommendationSpacer(range.topRows, 'top')];
  for (var index = range.start; index < range.end; index += 1) {
    html.push(homePlatformRecommendationCard('netease-song', index, songs[index], '网易云每日推荐'));
  }
  html.push(homePlatformRecommendationSpacer(range.bottomRows, 'bottom'));
  grid.innerHTML = html.join('');
  grid.setAttribute('data-render-window', signature);
  grid.setAttribute('aria-label', '全部每日推荐，共 ' + songs.length + ' 首');
  var count = document.getElementById('home-platform-daily-count');
  if (count) {
    count.textContent = songs.length
      ? ' · ' + (range.start + 1) + '–' + range.end + ' / ' + songs.length
      : '';
  }
}


function scheduleHomePlatformDailyWindowRender() {
  if (homePlatformRecommendationDailyRenderRaf) return;
  var run = function () {
    homePlatformRecommendationDailyRenderRaf = 0;
    renderHomePlatformDailyWindow(false);
  };
  if (typeof requestAnimationFrame === 'function') {
    homePlatformRecommendationDailyRenderRaf = requestAnimationFrame(run);
  } else {
    homePlatformRecommendationDailyRenderRaf = setTimeout(run, 16);
  }
}


function homePlatformRecommendationEmptyHtml(source, message) {
  return '<div class="home-platform-recommend-empty"><strong>' + escHtml(homePlatformRecommendationSourceLabel(source)) + ' 暂无可用推荐</strong>' +
    '<span>' + escHtml(message || '当前版本没有可验证的平台推荐接口，未使用关键词搜索替代。') + '</span></div>';
}


function renderHomePlatformRecommendations() {
  var mask = document.getElementById('home-platform-recommend-mask');
  var list = document.getElementById('home-platform-recommend-list');
  var status = document.getElementById('home-platform-recommend-status');
  if (!mask || !list || !status) return;
  var source = homePlatformRecommendationState.source;
  var tabs = document.querySelectorAll('[data-home-recommend-source]');
  Array.prototype.forEach.call(tabs, function (tab) {
    var selected = tab.getAttribute('data-home-recommend-source') === source;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.classList.toggle('active', selected);
  });
  status.classList.remove('is-error');

  if (source === 'netease') {
    if (homeDiscoverState.loading || homePlatformRecommendationState.neteaseLoading) {
      status.textContent = '正在读取网易云平台推荐…';
      list.innerHTML = '<div class="home-platform-recommend-loading">正在同步推荐内容</div>';
      return;
    }
    var sections = [];
    var playlists = Array.isArray(homeDiscoverState.playlists) ? homeDiscoverState.playlists.slice(0, 6) : [];
    var songs = Array.isArray(homeDiscoverState.songs) ? homeDiscoverState.songs : [];
    if (playlists.length) {
      sections.push('<section><h3>推荐歌单</h3><div class="home-platform-recommend-grid">' + playlists.map(function (item, index) {
        return homePlatformRecommendationCard('netease-playlist', index, item, '网易云推荐歌单');
      }).join('') + '</div></section>');
    }
    if (songs.length) {
      sections.push('<section><h3>每日推荐<span id="home-platform-daily-count"></span></h3>' +
        '<div id="home-platform-daily-grid" class="home-platform-recommend-grid" role="list" aria-label="全部每日推荐"></div></section>');
    }
    if (sections.length) {
      status.textContent = songs.length
        ? '已读取全部 ' + songs.length + ' 首每日推荐；滚动时仅渲染视窗附近歌曲'
        : '来自网易云推荐歌单';
      list.innerHTML = sections.join('');
      if (songs.length) renderHomePlatformDailyWindow(true);
    } else {
      status.textContent = homeDiscoverState.error ? '网易云推荐读取失败' : '网易云暂未返回推荐内容';
      status.classList.toggle('is-error', !!homeDiscoverState.error);
      list.innerHTML = homePlatformRecommendationEmptyHtml('netease', homeDiscoverState.loggedIn
        ? '平台本次没有返回推荐内容，未使用搜索结果补位。'
        : '登录网易云后可读取推荐歌单与每日推荐，未使用关键词搜索替代。');
    }
    return;
  }

  var feedConfig = homePlatformRecommendationFeedConfig(source);
  var feedState = homePlatformRecommendationState.feeds[source];
  if (feedConfig && feedState) {
    var sourceLabel = homePlatformRecommendationSourceLabel(source);
    if (feedState.loading) {
      status.textContent = '正在读取' + sourceLabel + '平台推荐…';
      list.innerHTML = '<div class="home-platform-recommend-loading">正在同步推荐内容</div>';
      return;
    }
    if (feedState.songs.length) {
      var sectionTitle = feedConfig.sectionTitle;
      var cardLabel = feedConfig.cardLabel;
      var readyText = feedConfig.readyText;
      if (source === 'qishui' && feedState.fallback) {
        sectionTitle = '你的音乐';
        cardLabel = '汽水喜欢 / 最近播放';
        readyText = '汽水推荐 Feed 暂不可用，当前显示你的喜欢与最近播放';
      } else if (source === 'spotify' && feedState.mode === 'liked-affinity') {
        sectionTitle = '你的喜欢';
        cardLabel = 'Spotify 喜欢的歌曲';
        readyText = '来自 Spotify Web API 的喜欢歌曲';
      } else if (source === 'spotify' && feedState.mode === 'personal-top') {
        sectionTitle = '你的常听';
        cardLabel = 'Spotify 常听歌曲';
        readyText = '来自 Spotify Web API 的个人常听';
      }
      status.textContent = readyText;
      list.innerHTML = '<section><h3>' + escHtml(sectionTitle) + '</h3><div class="home-platform-recommend-grid">' + feedState.songs.map(function (item, index) {
        return homePlatformRecommendationCard(source + '-song', index, item, cardLabel);
      }).join('') + '</div></section>';
    } else {
      var authRequired = /(?:AUTH|LOGIN)_REQUIRED|NOT_CONFIGURED/i.test(feedState.error);
      var feedFailed = !!feedState.error && !authRequired;
      status.textContent = feedFailed ? sourceLabel + '推荐读取失败' : sourceLabel + '暂未返回推荐内容';
      status.classList.toggle('is-error', feedFailed);
      list.innerHTML = homePlatformRecommendationEmptyHtml(source, feedState.message || (feedFailed
        ? '推荐接口当前不可用，未使用关键词搜索补位。'
        : '连接' + sourceLabel + '后可读取平台推荐，未使用关键词搜索替代。'));
    }
    return;
  }

  status.textContent = homePlatformRecommendationSourceLabel(source) + ' 暂无平台推荐接口';
  list.innerHTML = homePlatformRecommendationEmptyHtml(source);
}

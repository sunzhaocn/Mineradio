'use strict';



async function loadHomePlatformNeteaseRecommendations(force) {
  if (homePlatformRecommendationState.neteaseLoading) return;
  homePlatformRecommendationState.neteaseLoading = true;
  renderHomePlatformRecommendations();
  try {
    if (homeDiscoverState.loading && typeof waitForHomeDiscoverIdle === 'function') await waitForHomeDiscoverIdle(2600);
    if (force || !homeDiscoverState.loaded) await loadHomeDiscover(!!force);
    if (homeDiscoverState.loading && typeof waitForHomeDiscoverIdle === 'function') await waitForHomeDiscoverIdle(2600);
    if (force || !Array.isArray(homeDiscoverState.podcasts) || !homeDiscoverState.podcasts.length) {
      var podcastData = await apiJson('/api/podcast/hot?limit=8&t=' + Date.now(), { timeoutMs: 12000 });
      var hotPodcasts = podcastData && Array.isArray(podcastData.podcasts) ? podcastData.podcasts : [];
      if (hotPodcasts.length) homeDiscoverState.podcasts = hotPodcasts;
    }
  } catch (error) {
    console.warn('[HomePlatformNetease]', error);
  } finally {
    homePlatformRecommendationState.neteaseLoading = false;
    renderHomePlatformRecommendations();
  }
}


async function loadHomePlatformQishuiRecommendations(force) {
  return loadHomePlatformFeedRecommendations('qishui', force);
}


async function loadHomePlatformFeedRecommendations(source, force) {
  var config = homePlatformRecommendationFeedConfig(source);
  var feedState = homePlatformRecommendationState.feeds[source];
  if (!config || !feedState || feedState.loading) return;
  if (feedState.loaded && !force) return;
  feedState.loading = true;
  feedState.error = '';
  feedState.message = '';
  renderHomePlatformRecommendations();
  try {
    var separator = config.endpoint.indexOf('?') >= 0 ? '&' : '?';
    var data = await apiJson(config.endpoint + separator + 't=' + Date.now(), { timeoutMs: 14000 });
    var rawSongs = data && (data.songs || data.tracks || data.items || data.recommendations);
    feedState.songs = (Array.isArray(rawSongs) ? rawSongs : []).map(cloneSong);
    feedState.error = data && data.error ? String(data.error) : '';
    feedState.message = data && data.message ? String(data.message) : '';
    feedState.mode = data && data.mode ? String(data.mode) : '';
    feedState.source = data && data.source ? String(data.source) : '';
    feedState.fallback = !!(data && data.fallback);
    feedState.provenance = data && data.provenance ? String(data.provenance) : '';
    feedState.loaded = true;
  } catch (error) {
    console.warn('[HomePlatformFeed:' + source + ']', error);
    feedState.songs = [];
    feedState.error = String(error && error.message || 'PLATFORM_FEED_FAILED');
    feedState.message = '';
    feedState.loaded = true;
  } finally {
    feedState.loading = false;
    renderHomePlatformRecommendations();
  }
}


async function loadHomePlatformRecommendations(source, force) {
  homePlatformRecommendationState.source = source || 'netease';
  renderHomePlatformRecommendations();
  try {
    if (homePlatformRecommendationState.source === 'netease') {
      await loadHomePlatformNeteaseRecommendations(force);
    } else if (homePlatformRecommendationFeedConfig(homePlatformRecommendationState.source)) {
      await loadHomePlatformFeedRecommendations(homePlatformRecommendationState.source, force);
    }
  } catch (error) {
    console.warn('[HomePlatformRecommendations]', error);
  }
  renderHomePlatformRecommendations();
}


function playHomePlatformFeedSong(source, index) {
  var config = homePlatformRecommendationFeedConfig(source);
  var feedState = homePlatformRecommendationState.feeds[source];
  var songs = feedState && feedState.songs || [];
  if (!config || !songs.length) return;
  playQueue = songs.map(cloneSong);
  currentIdx = Math.max(0, Math.min(playQueue.length - 1, Number(index) || 0));
  homeForcedOpen = false;
  homeSuppressed = false;
  if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel('home-platform-' + source, { scrollCurrent: true });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild('home-platform-' + source, true);
  if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
  Promise.resolve(playQueueAt(currentIdx, {
    manual: true,
    context: { type: 'home-platform-recommendation', playlistName: config.playlistName },
  })).catch(function (error) { console.warn('[HomePlatformFeedPlay:' + source + ']', error); });
}


function closeHomePlatformRecommendations() {
  var mask = document.getElementById('home-platform-recommend-mask');
  if (!mask) return;
  mask.classList.remove('show');
  mask.setAttribute('aria-hidden', 'true');
  homePlatformRecommendationState.open = false;
  var focusTarget = homePlatformRecommendationState.previousFocus;
  homePlatformRecommendationState.previousFocus = null;
  if (focusTarget && typeof focusTarget.focus === 'function') {
    setTimeout(function () { focusTarget.focus(); }, 0);
  }
}


function bindHomePlatformRecommendationControls() {
  if (homePlatformRecommendationControlsBound) return;
  homePlatformRecommendationControlsBound = true;
  var mask = document.getElementById('home-platform-recommend-mask');
  var tabs = document.getElementById('home-platform-recommend-tabs');
  var list = document.getElementById('home-platform-recommend-list');
  var close = document.getElementById('home-platform-recommend-close');
  var done = document.getElementById('home-platform-recommend-done');
  var refresh = document.getElementById('home-platform-recommend-refresh');
  if (tabs) tabs.addEventListener('click', function (event) {
    var tab = event.target.closest('[data-home-recommend-source]');
    if (!tab || !tabs.contains(tab)) return;
    loadHomePlatformRecommendations(tab.getAttribute('data-home-recommend-source'), false);
  });
  if (list) list.addEventListener('click', function (event) {
    var card = event.target.closest('[data-home-recommend-kind]');
    if (!card || !list.contains(card)) return;
    var kind = card.getAttribute('data-home-recommend-kind');
    var index = Number(card.getAttribute('data-home-recommend-index')) || 0;
    closeHomePlatformRecommendations();
    if (kind === 'netease-playlist' && typeof openHomePlaylist === 'function') openHomePlaylist(index);
    else if (kind === 'netease-song' && typeof playHomeSong === 'function') playHomeSong(index);
    else if (/^(qishui|kugou|spotify)-song$/.test(kind)) playHomePlatformFeedSong(kind.replace(/-song$/, ''), index);
  });
  if (list) list.addEventListener('scroll', scheduleHomePlatformDailyWindowRender, { passive: true });
  window.addEventListener('resize', scheduleHomePlatformDailyWindowRender, { passive: true });
  if (close) close.addEventListener('click', closeHomePlatformRecommendations);
  if (done) done.addEventListener('click', closeHomePlatformRecommendations);
  if (refresh) refresh.addEventListener('click', function () {
    loadHomePlatformRecommendations(homePlatformRecommendationState.source, true);
  });
  if (mask) mask.addEventListener('click', function (event) {
    if (event.target === mask) closeHomePlatformRecommendations();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && homePlatformRecommendationState.open) closeHomePlatformRecommendations();
  });
}


function openHomePlatformRecommendations(preferredSource) {
  bindHomePlatformRecommendationControls();
  var mask = document.getElementById('home-platform-recommend-mask');
  if (!mask) return;
  homePlatformRecommendationState.previousFocus = document.activeElement;
  homePlatformRecommendationState.open = true;
  mask.classList.add('show');
  mask.setAttribute('aria-hidden', 'false');
  var defaultSource = loginStatus && loginStatus.loggedIn
    ? 'netease'
    : (qishuiLoginStatus && (qishuiLoginStatus.loggedIn || qishuiLoginStatus.configured)
      ? 'qishui'
      : (kugouLoginStatus && kugouLoginStatus.loggedIn ? 'kugou' : 'netease'));
  var source = /^(netease|qishui|qq|kugou)$/.test(String(preferredSource || '')) ? preferredSource : defaultSource;
  loadHomePlatformRecommendations(source, false);
  setTimeout(function () {
    var activeTab = mask.querySelector('[data-home-recommend-source="' + source + '"]');
    if (activeTab) activeTab.focus();
  }, 0);
}


function openHomeDashboardRadio() {
  openHomePlatformRecommendations();
}


function scheduleHomeDashboardRefresh() {
  if (homeDashboardRefreshTimer) {
    clearTimeout(homeDashboardRefreshTimer);
    homeDashboardRefreshTimer = null;
  }
  if (!emptyHomeActive || document.hidden) return;
  homeDashboardRefreshTimer = setTimeout(function () {
    homeDashboardRefreshTimer = null;
    if (!emptyHomeActive || document.hidden) return;
    homeDashboardUpdateClock();
    renderHomeInsightDock();
    scheduleHomeDashboardRefresh();
  }, 15000);
}


function renderHomeDashboard() {
  renderHomeDashboardHero();
  renderHomeDashboardQuickCards();
  renderHomeInsightDock();
  scheduleHomeDashboardRefresh();
}
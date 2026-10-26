'use strict';



function renderHomeDashboardHero() {
  var hero = document.querySelector('#empty-home .home-hero');
  if (!hero) return;
  var review = homeDashboardSelectedReview();
  var fingerprint = homeDashboardDayNumber() + '|' + homeDashboardReviewOffset + '|' + review.text + '|' + review.source;
  if (!hero.querySelector('.daily-review-card')) {
    hero.innerHTML = '<div class="daily-review-card">' +
      '<div id="daily-review-date" class="daily-review-date"></div>' +
      '<div id="daily-review-time" class="daily-review-time">--:--</div>' +
      '<div class="daily-review-quote"></div>' +
      '<div class="daily-review-source"></div>' +
      '<div class="daily-review-actions">' +
      '<button type="button" onclick="homeDashboardNextReview()">换一条</button>' +
      '<button id="home-dashboard-video-choose" type="button" onclick="openHomeDashboardVideoPicker()">选择 MP4</button>' +
      '<button id="home-dashboard-video-clear" type="button" onclick="clearHomeDashboardVideo()" hidden>移除视频</button>' +
      '</div></div>' +
      '<input id="home-dashboard-video-input" type="file" accept=".mp4,video/mp4" hidden aria-hidden="true">';
    homeDashboardVideoControlsBound = false;
    bindHomeDashboardVideoControls();
  }
  if (fingerprint !== homeDashboardHeroFingerprint) {
    homeDashboardHeroFingerprint = fingerprint;
    var quote = hero.querySelector('.daily-review-quote');
    var source = hero.querySelector('.daily-review-source');
    if (quote) quote.textContent = '“' + review.text + '”';
    if (source) source.textContent = '— ' + (review.source || '每日热评');
  }
  homeDashboardRenderVideoActions();
  homeDashboardUpdateVideoPower();
  homeDashboardUpdateClock();
}


function homeDashboardNextReview() {
  homeDashboardReviewOffset += 1;
  renderHomeDashboardHero();
}


function homeDashboardCurrentSong() {
  try {
    return typeof currentCoverSong === 'function' ? currentCoverSong() : null;
  } catch (_error) {
    return null;
  }
}


function homeDashboardSubtitle(song) {
  if (!song) return '';
  try {
    return song.artist || song.singer || song.album || songSourceLabel(song) || '';
  } catch (_error) {
    return song.artist || song.singer || song.source || '';
  }
}


function homeDashboardSongCover(song, size) {
  if (!song) return '';
  try {
    return songCoverSrc(song, size || 320) || song.cover || song.picUrl || '';
  } catch (_error) {
    return song.cover || song.picUrl || '';
  }
}


function homeDashboardLocalSongs() {
  var pool = [];
  if (Array.isArray(playQueue)) pool = pool.concat(playQueue);
  if (Array.isArray(playlist)) pool = pool.concat(playlist);
  if (Array.isArray(userPlaylists)) {
    userPlaylists.forEach(function (item) {
      if (item && Array.isArray(item.songs)) pool = pool.concat(item.songs);
    });
  }
  var seen = Object.create(null);
  return pool.filter(function (song) {
    if (!song || song.type !== 'local') return false;
    var key = '';
    try { key = queueItemKey(song); } catch (_error) { }
    key = key || song.localPath || song.id || ((song.name || song.title || '') + '|' + (song.artist || ''));
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}


function homeDashboardSetStableBackgroundImage(element, src) {
  if (!element) return;
  src = String(src || '');
  if (element.__homeDashboardRequestedBackground === src) return;
  element.__homeDashboardRequestedBackground = src;
  if (!src) {
    element.__homeDashboardBackground = '';
    element.style.backgroundImage = '';
    return;
  }
  var image = new Image();
  image.decoding = 'async';
  function commit() {
    if (!element.isConnected || element.__homeDashboardRequestedBackground !== src) return;
    element.__homeDashboardBackground = src;
    element.style.backgroundImage = 'url("' + cssImageUrl(src) + '")';
  }
  image.onload = function () {
    if (typeof image.decode === 'function') image.decode().catch(function () { }).then(commit);
    else commit();
  };
  image.onerror = function () { };
  image.src = src;
}


function homeDashboardCardHtml(card) {
  var cover = card.cover || homeDashboardGeneratedCover(card.title, card.label, card.tone);
  var artStyle = cover ? ' style="background-image:url(&quot;' + escHtml(cssImageUrl(cover)) + '&quot;)"' : '';
  return '<button class="home-card ' + escHtml(card.className || '') + '" data-home-tone="' + escHtml(card.tone || 'playlist') + '"' +
    ' type="button" onclick="' + card.action + '">' +
    '<div class="home-card-label">' + escHtml(card.label || '') + '</div>' +
    '<div class="home-card-title">' + escHtml(card.title || '') + '</div>' +
    '<div class="home-card-sub">' + escHtml(card.sub || '') + '</div>' +
    '<div class="home-card-art has-cover"' + artStyle + '></div>' +
    '</button>';
}


function homeDashboardPatchCard(button, card) {
  if (!button || !card) return;
  var className = 'home-card' + (card.className ? ' ' + card.className : '');
  var displayCover = card.cover || homeDashboardGeneratedCover(card.title, card.label, card.tone);
  if (button.className !== className) button.className = className;
  if (button.getAttribute('data-home-tone') !== card.tone) button.setAttribute('data-home-tone', card.tone);
  if (button.getAttribute('onclick') !== card.action) button.setAttribute('onclick', card.action);
  var label = button.querySelector('.home-card-label');
  var title = button.querySelector('.home-card-title');
  var sub = button.querySelector('.home-card-sub');
  var art = button.querySelector('.home-card-art');
  if (label && label.textContent !== card.label) label.textContent = card.label;
  if (title && title.textContent !== card.title) title.textContent = card.title;
  if (sub && sub.textContent !== card.sub) sub.textContent = card.sub;
  if (art) {
    art.className = 'home-card-art' + (displayCover ? ' has-cover' : '');
    homeDashboardSetStableBackgroundImage(art, displayCover);
  }
}


function renderHomeDashboardQuickCards() {
  var grid = document.querySelector('#empty-home .home-grid');
  if (!grid) return;
  var summary = typeof homeListenSummary === 'function' ? homeListenSummary() : {};
  var recent = summary && summary.recent || null;
  var current = homeDashboardCurrentSong();
  var daily = homeDiscoverState && homeDiscoverState.songs && homeDiscoverState.songs[0] || null;
  var continueItem = current || recent;
  var localSongs = homeDashboardLocalSongs();
  var localCount = localSongs.length;
  var accountPlaylistCount = homeDiscoverState && Array.isArray(homeDiscoverState.playlists) ? homeDiscoverState.playlists.length : 0;
  var ownPlaylistCount = Array.isArray(userPlaylists) ? userPlaylists.length : 0;
  var libraryCount = localCount + accountPlaylistCount + ownPlaylistCount;
  var cards = [
    {
      label: 'CONTINUE',
      title: continueItem && (continueItem.name || continueItem.title) || '开始听歌',
      sub: continueItem ? (homeDashboardSubtitle(continueItem) || recent && (recent.artist || recent.source) || '继续当前队列') : '从音乐库或每日推荐开始',
      cover: homeDashboardSongCover(current, 360) || recent && recent.cover || '',
      action: 'resumeHomeDashboardPlayback()',
      tone: 'search',
      className: 'home-card-featured',
    },
    {
      label: 'LIBRARY',
      title: '音乐库',
      sub: libraryCount ? (libraryCount + ' 项内容 · 本地音乐与歌单') : '歌单、本地音乐和已登录平台',
      cover: localSongs[0] ? homeDashboardSongCover(localSongs[0], 260) : '',
      action: 'openHomeDashboardLibrary()',
      tone: 'library',
      className: 'home-card-quick',
    },
    {
      label: 'DAILY MIX',
      title: '每日推荐',
      sub: daily ? ((daily.name || daily.title || '今日歌曲') + (homeDashboardSubtitle(daily) ? ' · ' + homeDashboardSubtitle(daily) : '')) : '使用当前 Mineradio 推荐数据',
      cover: homeDashboardSongCover(daily, 260),
      action: 'playHomeDaily()',
      tone: 'mix',
      className: 'home-card-quick',
    },
    {
      label: 'RECENT',
      title: '最近播放',
      sub: recent ? ((recent.name || '最近一首') + (recent.artist ? ' · ' + recent.artist : '')) : '播放过的歌曲会出现在这里',
      cover: recent && recent.cover || '',
      action: 'openHomeRecentHistory()',
      tone: 'playlist',
      className: 'home-card-quick',
    },
  ];
  var fingerprint = cards.map(function (card) {
    return [card.title, card.sub, card.cover, card.action].join('|');
  }).join('||');
  if (fingerprint === homeDashboardQuickFingerprint && grid.classList.contains('home-quick-grid')) return;
  homeDashboardQuickFingerprint = fingerprint;
  grid.classList.add('home-quick-grid');
  var existingCards = Array.prototype.slice.call(grid.children).filter(function (node) {
    return node && node.classList && node.classList.contains('home-card');
  });
  if (existingCards.length !== cards.length) {
    grid.innerHTML = cards.map(homeDashboardCardHtml).join('');
    existingCards = Array.prototype.slice.call(grid.querySelectorAll('.home-card'));
  }
  cards.forEach(function (card, index) {
    homeDashboardPatchCard(existingCards[index], card);
  });
}


function resumeHomeDashboardPlayback() {
  homeForcedOpen = false;
  homeSuppressed = false;
  if (typeof setHomeControlsLocked === 'function') setHomeControlsLocked(false);
  if (playQueue && playQueue.length && currentIdx >= 0 && playQueue[currentIdx]) {
    if (typeof forcePlaybackControlsInteractive === 'function') forcePlaybackControlsInteractive();
    if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility();
    if (playing || audio && !audio.paused) return;
    if (typeof togglePlay === 'function') {
      Promise.resolve(togglePlay()).catch(function (error) { console.warn('[HomeDashboardResume]', error); });
    }
    return;
  }
  var recent = typeof homeListenSummary === 'function' ? homeListenSummary().recent : null;
  if (recent && typeof playHomeRecent === 'function') {
    Promise.resolve(playHomeRecent(recent)).catch(function (error) { console.warn('[HomeDashboardRecent]', error); });
    return;
  }
  if (typeof playHomeDaily === 'function') playHomeDaily();
}


function homeDashboardDayKey(timestamp) {
  var date = new Date(Number(timestamp) || Date.now());
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}


function homeDashboardTodayListenMetrics() {
  var now = Date.now();
  var today = new Date(now);
  today.setHours(0, 0, 0, 0);
  var todayStart = today.getTime();
  var history = listenStatsState && Array.isArray(listenStatsState.history) ? listenStatsState.history : [];
  var records = history.filter(function (record) {
    return record && Number(record.playedAt) >= todayStart;
  });
  var keys = Object.create(null);
  var artists = Object.create(null);
  var listenMs = 0;
  records.forEach(function (record) {
    var key = String(record.key || record.id || (record.name || '') + '|' + (record.artist || ''));
    if (key) keys[key] = true;
    var activeRecord = listenSession && record.sessionId && record.sessionId === listenSession.sessionId;
    // 最近播放已包含正在听的这首，活动会话的时长在下方只累计一次。
    if (!activeRecord) listenMs += Math.max(0, Number(record.listenMs) || 0);
    String(record.artist || '').split(/\s*\/\s*|\s*,\s*|、|&/).forEach(function (name) {
      name = name.trim();
      if (!name) return;
      artists[name] = (artists[name] || 0) + Math.max(1, Number(record.listenMs) || 1);
    });
  });
  if (listenSession && Number(listenSession.startedAt) >= todayStart) {
    listenMs += Math.max(0, Number(listenSession.listenMs) || 0);
    if (listenSession.key) keys[listenSession.key] = true;
  }
  var topArtist = Object.keys(artists).sort(function (a, b) { return artists[b] - artists[a]; })[0] || '';
  var dayMap = Object.create(null);
  history.forEach(function (record) {
    if (record && record.playedAt) dayMap[homeDashboardDayKey(record.playedAt)] = true;
  });
  if (records.length || listenSession) dayMap[homeDashboardDayKey(now)] = true;
  var streak = 0;
  var cursor = new Date(todayStart);
  if (!dayMap[homeDashboardDayKey(cursor.getTime())]) cursor.setDate(cursor.getDate() - 1);
  while (dayMap[homeDashboardDayKey(cursor.getTime())]) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return {
    listenMs: listenMs,
    songCount: Object.keys(keys).length,
    topArtist: topArtist,
    streak: streak,
  };
}


function homeDashboardListenDurationText(milliseconds) {
  var minutes = Math.floor(Math.max(0, Number(milliseconds) || 0) / 60000);
  if (minutes < 60) return minutes + ' 分钟';
  var hours = Math.floor(minutes / 60);
  var rest = minutes % 60;
  return hours + ' 小时' + (rest ? rest + ' 分' : '');
}


function homeDashboardNextQueueInfo() {
  if (playQueue && playQueue.length) {
    var start = currentIdx >= 0 ? (currentIdx + 1) % playQueue.length : 0;
    var candidates = [], indexes = [];
    for (var offset = 0; offset < playQueue.length; offset++) {
      var index = (start + offset) % playQueue.length;
      if (index !== currentIdx || playQueue.length === 1) { candidates.push(playQueue[index]); indexes.push(index); }
    }
    var songs = homeRecommendationSelection('next', candidates, 1, renderHomeInsightDock);
    var selected = songs[0] || null;
    var candidateIndex = selected ? candidates.findIndex(function (song) {
      var entry = cachedHomePlayableRecommendation(song);
      return entry && entry.song && homeDashboardSongKey(entry.song) === homeDashboardSongKey(selected);
    }) : -1;
    return { song: selected, index: candidateIndex >= 0 ? indexes[candidateIndex] : -1, queued: true };
  }
  var pool = (homeDiscoverState && homeDiscoverState.songs || []).concat(homeDashboardLocalSongs());
  return { song: homeRecommendationSelection('next', pool, 1, renderHomeInsightDock)[0] || null, index: 0, queued: false };
}


function homeDashboardSongKey(song) {
  if (!song) return '';
  try {
    var queueKey = typeof queueItemKey === 'function' ? queueItemKey(song) : '';
    if (queueKey) return (song.provider || song.source || song.type || 'netease') + '|' + String(queueKey);
  } catch (_error) { }
  var provider = song.provider || song.source || song.type || '';
  var id = song.id || song.mid || song.songmid || song.mediaMid || song.localPath || song.url || '';
  if (id) return provider + '|' + id;
  return provider + '|' + (song.name || song.title || '') + '|' + homeDashboardSubtitle(song);
}


function homeDashboardDiscoverySongs() {
  var candidates = [];
  var seen = Object.create(null);
  function addSongs(songs) {
    (Array.isArray(songs) ? songs : []).forEach(function (song) {
      if (!song) return;
      var key = homeDashboardSongKey(song);
      if (!key || seen[key]) return;
      seen[key] = true;
      candidates.push(song);
    });
  }

  addSongs(homeDiscoverState && homeDiscoverState.songs);
  addSongs(playQueue);
  if (Array.isArray(userPlaylists)) {
    userPlaylists.forEach(function (item) { addSongs(item && item.songs); });
  }
  addSongs(playlist);
  addSongs(homeDashboardLocalSongs());

  if (candidates.length <= 3) return candidates.slice();
  var day = homeDashboardDayNumber();
  if (!homeRecommendationSelection.entrySeed) homeRecommendationSelection.entrySeed = Date.now();
  day += Math.floor(homeRecommendationSelection.entrySeed / 1000);
  var step = Math.max(1, Math.floor(candidates.length / 3));
  var picked = [];
  var pickedKeys = Object.create(null);
  for (var index = 0; index < candidates.length && picked.length < 3; index += 1) {
    var candidate = candidates[(day * 17 + index * step + index * 7) % candidates.length];
    var candidateKey = homeDashboardSongKey(candidate);
    if (!candidateKey || pickedKeys[candidateKey]) continue;
    pickedKeys[candidateKey] = true;
    picked.push(candidate);
  }
  // Failed candidates must be replaced from the rest of the pool, rather than
  // turning one unavailable song into an empty recommendation strip.
  candidates.forEach(function (song) {
    if (!pickedKeys[homeDashboardSongKey(song)]) picked.push(song);
  });
  return picked;
}

'use strict';

function songFromListenRecord(record) {
  if (!record) return null;
  var provider = record.sourceKey || record.provider || '';
  if (!provider && record.type === 'qq') provider = 'qq';
  if (!provider) provider = record.mid ? 'qq' : 'netease';
  var song = Object.assign({}, record, {
    provider: provider,
    source: provider,
    type: record.type || (provider === 'qq' ? 'qq' : 'song'),
    id: record.id || record.mid || record.key || '',
    mid: record.mid || '',
    songmid: record.mid || '',
    mediaMid: record.mediaMid || '',
    hash: record.hash || '',
    mixSongId: record.mixSongId || '',
    providerSongId: record.providerSongId || '',
    albumId: record.albumId || '',
    name: record.name || '继续听',
    artist: record.artist || '',
    cover: record.cover || '',
  });
  delete song.sessionId;
  delete song.playedAt;
  delete song.listenMs;
  delete song.statsCounted;
  delete song.completed;
  delete song.context;
  return song;
}

function closeHomeRecentHistory() {
  closeGsapModal(document.getElementById('home-recent-history-modal'));
}

function homeRecentPlayedAtLabel(timestamp) {
  var date = new Date(Number(timestamp) || Date.now());
  var today = new Date();
  var datePart = date.toDateString() === today.toDateString() ? '今天' : (date.getMonth() + 1) + '月' + date.getDate() + '日';
  if (date.getFullYear() !== today.getFullYear()) datePart = date.getFullYear() + '年' + datePart;
  return datePart + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function renderHomeRecentHistoryList() {
  var list = document.getElementById('home-recent-history-list');
  var count = document.getElementById('home-recent-history-count');
  if (!list) return;
  var history = (listenStatsState && listenStatsState.history || []).slice(0, 100);
  if (count) count.textContent = history.length + ' / 100 首';
  list.replaceChildren();
  if (!history.length) {
    var empty = document.createElement('div');
    empty.className = 'home-recent-empty';
    empty.textContent = '还没有播放记录，开始听歌后会自动记录在这里。';
    list.appendChild(empty);
    return;
  }
  history.forEach(function (record, index) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'home-recent-row';
    var cover = record.cover ? '<img class="home-recent-cover" src="' + escHtml(record.cover) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span class="home-recent-cover home-recent-cover-empty">♪</span>';
    row.innerHTML = '<span class="home-recent-rank">' + (index + 1) + '</span>' + cover +
      '<span class="home-recent-main"><span class="home-recent-name">' + escHtml(record.name || '未知歌曲') + '</span>' +
      '<span class="home-recent-meta">' + escHtml((record.artist || '未知歌手') + (record.source ? ' · ' + record.source : '')) + '</span></span>' +
      '<span class="home-recent-time">' + escHtml(homeRecentPlayedAtLabel(record.playedAt)) + '</span>';
    row.title = '播放 ' + (record.name || '未知歌曲') + (record.artist ? ' · ' + record.artist : '');
    row.addEventListener('click', function () {
      closeHomeRecentHistory();
      Promise.resolve(playHomeRecent(record)).catch(function (error) {
        console.warn('[HomeRecent]', error);
        showToast('播放失败，请稍后重试');
      });
    });
    list.appendChild(row);
  });
}

function openHomeRecentHistory() {
  var mask = document.getElementById('home-recent-history-modal');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'home-recent-history-modal';
    mask.className = 'modal-mask';
    mask.innerHTML = '<div class="modal home-recent-modal" role="dialog" aria-modal="true" aria-labelledby="home-recent-history-heading">' +
      '<div class="home-recent-heading"><h2 id="home-recent-history-heading">最近播放</h2><span id="home-recent-history-count"></span></div>' +
      '<p class="home-recent-description">保留最近 100 首，再次播放会移至最前，超出后自动替换最早记录。</p>' +
      '<div id="home-recent-history-list" class="home-recent-list"></div>' +
      '<div class="btn-row"><button class="modal-btn" type="button" data-recent-close>关闭</button></div></div>';
    mask.querySelector('[data-recent-close]').addEventListener('click', closeHomeRecentHistory);
    mask.addEventListener('click', function (event) { if (event.target === mask) closeHomeRecentHistory(); });
    mask.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeHomeRecentHistory(); });
    document.body.appendChild(mask);
  }
  renderHomeRecentHistoryList();
  openGsapModal(mask);
  mask.querySelector('[data-recent-close]').focus({ preventScroll: true });
}

var homeRecentSelectionSerial = 0;

async function resolveRecentLocalSong(song) {
  var fileId=String(song.localFileId || song.localKey || song.id || '').replace(/^local:/,'').toLowerCase();
  var localApi=typeof localMusicLibraryApi==='function' ? localMusicLibraryApi() : window.desktopWindow || window.browserLocalMusic;
  if (!/^[a-f0-9]{24}$/.test(fileId) || !localApi || typeof localApi.listLocalMusicLibrary!=='function') return null;
  var controller=new AbortController();
  var timer;
  var timeout=new Promise(function (resolve) { timer=setTimeout(function () { controller.abort();resolve(null); },5000); });
  try {
    return await Promise.race([timeout,(async function () {
      var library=await localApi.listLocalMusicLibrary();
      if (controller.signal.aborted || !library || library.ok!==true || !Array.isArray(library.tracks)) return null;
      var track=library.tracks.find(function (item) {
        return String(item.localFileId || item.localKey || item.id || '').replace(/^local:/,'').toLowerCase()===fileId;
      });
      // Only the existing authorized library may supply a local media capability.
      // A history row's filesystem path or an expired blob URL is never a source.
      if (!track || !track.localUrl) return null;
      var browserUrl=localApi===window.browserLocalMusic && typeof localApi.ownsLocalMusicUrl==='function' && localApi.ownsLocalMusicUrl(track.localUrl);
      if (!browserUrl && new URL(track.localUrl).protocol!=='mineradio-local:') return null;
      var response=await fetch(track.localUrl,{method:browserUrl ? 'GET' : 'HEAD',cache:'no-store',signal:controller.signal});
      if (!response.ok) return null;
      if (browserUrl && response.body) response.body.cancel().catch(function () {});
      return Object.assign({},song,track,{localMissing:false});
    }())]);
  } finally { clearTimeout(timer); }
}

async function playHomeRecent(record) {
  record = record || homeListenSummary().recent;
  if (!record) {
    showToast('还没有听歌记录');
    return;
  }
  var song = songFromListenRecord(record);
  if (!song || (!song.id && !song.mid)) {
    runHomeSearch(record.name || '');
    return;
  }
  var selection=++homeRecentSelectionSerial;
  var previousToken=typeof trackSwitchToken==='number' ? trackSwitchToken : null;
  function stillCurrent() {
    return selection===homeRecentSelectionSerial && (previousToken===null || previousToken===trackSwitchToken);
  }
  if (song.type==='local' || song.source==='local' || song.provider==='local' || song.localFileId || song.localKey) {
    try { song=await resolveRecentLocalSong(song); }
    catch (_) { song=null; }
    if (!stillCurrent()) return false;
    if (!song) {
      showToast('这首本地音乐已移动、删除或不在本机曲库中，请重新导入后播放');
      return false;
    }
  }
  activeRadioContext = null;
  playQueue = [cloneSong(song)];
  currentIdx = 0;
  safeRenderQueuePanel('home-recent-song');
  safeShelfRebuild('home-recent-song', true);
  forcePlaybackControlsInteractive();
  return await playQueueAt(0,{manual:true});
}

function openHomeInsight() {
  var summary = homeListenSummary();
  if (summary.topArtist && summary.topArtist.name) {
    runHomeSearch(summary.topArtist.name);
    return;
  }
  if (summary.topSong && summary.topSong.name) {
    runHomeSearch(summary.topSong.name);
    return;
  }
  showToast('播放几首歌后会生成听歌画像');
}

function handleHomeTileClick(index) {
  var row = document.getElementById('home-tile-row');
  var item = row && row._homeTiles && row._homeTiles[index];
  if (!item) return;
  if (item.kind === 'recent') playHomeRecent(item.record);
  else if (item.kind === 'profile') openHomeInsight();
  else if (item.kind === 'song') playHomeSong(item.index);
  else if (item.kind === 'login') showLoginModal({ source: 'home-tile' });
  else if (item.kind === 'local') openHomeLocalImport();
  else if (item.kind === 'guide') openHomeProductGuide();
  else if (item.kind === 'playlist') openHomePlaylist(item.index);
  else if (item.kind === 'podcast') openHomePodcast(item.index);
  else if (item.kind === 'podcastSearch') { setSearchMode('podcast'); loadPodcastHot(); }
  else if (item.kind === 'library') openHomeLibrary();
  else runHomeSearch(item.query || item.title || '');
}

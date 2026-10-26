'use strict';



function emptyListenRollupV2() {
  return { version: 2, totalListenMs: 0, sessions: 0, daily: {}, updatedAt: 0 };
}

function loadListenRollupV2() {
  try {
    var raw = localStorage.getItem(HOME_LISTEN_ROLLUP_V2_KEY);
    if (!raw) return emptyListenRollupV2();
    var data = JSON.parse(raw);
    return {
      version: 2,
      totalListenMs: Math.max(0, Number(data.totalListenMs) || 0),
      sessions: Math.max(0, Number(data.sessions) || 0),
      daily: data.daily && typeof data.daily === 'object' ? data.daily : {},
      updatedAt: Number(data.updatedAt) || 0,
    };
  } catch (e) {
    return emptyListenRollupV2();
  }
}

function listenDayKey(timestamp) {
  var date = new Date(timestamp || Date.now());
  var year = date.getFullYear();
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function recordListenRollupV2(record) {
  try {
    var state = loadListenRollupV2();
    var listenMs = Math.max(0, Math.round(Number(record && record.listenMs) || 0));
    var dayKey = listenDayKey(record && record.playedAt);
    var day = state.daily[dayKey] && typeof state.daily[dayKey] === 'object'
      ? state.daily[dayKey]
      : { listenMs: 0, sessions: 0, completed: 0 };
    state.totalListenMs += listenMs;
    state.sessions += 1;
    day.listenMs = Math.max(0, Number(day.listenMs) || 0) + listenMs;
    day.sessions = Math.max(0, Number(day.sessions) || 0) + 1;
    day.completed = Math.max(0, Number(day.completed) || 0) + (record && record.completed ? 1 : 0);
    state.daily[dayKey] = day;
    state.updatedAt = Date.now();
    localStorage.setItem(HOME_LISTEN_ROLLUP_V2_KEY, JSON.stringify(state));
  } catch (e) { }
}

function createListenSessionId() {
  try {
    var cryptoApi = typeof crypto !== 'undefined' ? crypto : null;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
      return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    }
  } catch (e) { }
  listenSessionSerial += 1;
  return 'mr-' + Date.now().toString(36) + '-' + listenSessionSerial.toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function listenSnapshotDurationMs(snapshot) {
  var rawDuration = Math.max(0, Number(snapshot && snapshot.duration) || 0);
  if (!rawDuration) return 0;
  return Math.round(rawDuration > 10000 ? rawDuration : rawDuration * 1000);
}

function listenReportProvider(snapshot) {
  var provider = String(
    (snapshot && (snapshot.provider || snapshot.sourceKey || snapshot.resolvedPlaybackProvider)) || ''
  ).trim().toLowerCase();
  if (provider === 'song' || provider === 'music') provider = 'netease';
  if (/^(netease|qq|kugou|qishui|spotify)$/.test(provider) && typeof normalizePlaybackProvider === 'function') {
    provider = normalizePlaybackProvider(provider);
  }
  return provider;
}

function reportListenSession(record, session, durationMs) {
  if (typeof fetch !== 'function' || !record || !session) return;
  var snapshot = session.song || {};
  var payload = {
    sessionId: session.sessionId || '',
    provider: listenReportProvider(snapshot),
    song: {
      key: snapshot.key || record.key || '',
      id: snapshot.id || '',
      mid: snapshot.mid || '',
      mediaMid: snapshot.mediaMid || '',
      hash: snapshot.hash || '',
      mixSongId: snapshot.mixSongId || '',
      albumId: snapshot.albumId || '',
      providerSongId: snapshot.providerSongId || '',
      spotifyId: snapshot.spotifyId || '',
      uri: snapshot.uri || '',
      type: snapshot.type || 'song',
      sourceKey: snapshot.sourceKey || '',
      name: snapshot.name || record.name || '未知歌曲',
      artist: snapshot.artist || record.artist || '',
      resolvedPlaybackProvider: snapshot.resolvedPlaybackProvider || '',
    },
    listenMs: record.listenMs,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    completed: !!record.completed,
    context: record.context || null,
  };
  var body = '';
  try {
    body = JSON.stringify(payload);
  } catch (e) {
    payload.context = null;
    try {
      body = JSON.stringify(payload);
    } catch (serializeError) {
      return;
    }
  }
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 3500) : null;
  var options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body,
    keepalive: true,
  };
  if (controller) options.signal = controller.signal;
  try {
    Promise.resolve(fetch('/api/listen/report', options)).then(function () {
      if (timeoutId) clearTimeout(timeoutId);
    }, function () {
      if (timeoutId) clearTimeout(timeoutId);
    });
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
  }
}


function listenSessionMatchesSong(session, song) {
  if (!session || !song) return false;
  var snapshot = session.song || session;
  var key = song.key || queueItemKey(song);
  if (key && (session.key === key || snapshot.key === key)) return true;
  try {
    if (typeof window !== 'undefined' && window.webFavoriteTools && typeof window.webFavoriteTools.sameSong === 'function') {
      return window.webFavoriteTools.sameSong(snapshot, song);
    }
  } catch (_error) { }
  function normalized(value) {
    var text = String(value || '').trim().toLowerCase();
    return text.normalize ? text.normalize('NFKC') : text;
  }
  var title = normalized(snapshot.name || snapshot.title);
  var artist = normalized(snapshot.artist);
  if (!title || !artist || /^(未知歌手|unknown|unknown artist|群星)$/.test(artist)) return false;
  return title === normalized(song.name || song.title)
    && artist === normalized(song.artist)
    && normalized(snapshot.version || snapshot.versionName) === normalized(song.version || song.versionName);
}

function normalizeListenHistory(history) {
  var result = [];
  (Array.isArray(history) ? history : []).forEach(function (record) {
    if (!record || typeof record !== 'object' || (!record.key && !record.id && !record.mid && !record.hash && !record.name)) return;
    if (result.some(function (existing) { return listenSessionMatchesSong(existing, record); })) return;
    if (result.length < 100) result.push(record);
  });
  return result;
}

function loadListenStatsState() {
  try {
    var raw = localStorage.getItem(HOME_LISTEN_STATS_KEY);
    if (!raw) return { history: [], songs: {}, artists: {}, updatedAt: 0 };
    var data = JSON.parse(raw);
    var state = {
      history: normalizeListenHistory(data.history),
      songs: data.songs && typeof data.songs === 'object' ? data.songs : {},
      artists: data.artists && typeof data.artists === 'object' ? data.artists : {},
      updatedAt: Number(data.updatedAt) || 0,
    };
    // 旧版最多保留 180 条；加载时直接迁移，避免只有内存中的上限生效。
    if (JSON.stringify(state.history) !== JSON.stringify(data.history || [])) {
      try { localStorage.setItem(HOME_LISTEN_STATS_KEY, JSON.stringify(state)); } catch (_storageError) { }
    }
    return state;
  } catch (e) {
    return { history: [], songs: {}, artists: {}, updatedAt: 0 };
  }
}

function saveListenStatsState() {
  try {
    listenStatsState.history = normalizeListenHistory(listenStatsState.history);
    listenStatsState.updatedAt = Date.now();
    localStorage.setItem(HOME_LISTEN_STATS_KEY, JSON.stringify(listenStatsState));
  } catch (e) { }
}

function listenSongSnapshot(song) {
  song = song || {};
  var snapshot = {
    key: queueItemKey(song),
    id: song.id || '',
    mid: song.mid || song.songmid || '',
    mediaMid: song.mediaMid || song.media_mid || '',
    hash: song.hash || song.fileHash || song.audioHash || '',
    mixSongId: song.mixSongId || song.mix_song_id || '',
    albumId: song.albumId || song.album_id || (song.album && song.album.id) || '',
    providerSongId: song.providerSongId || song.provider_song_id || '',
    spotifyId: song.spotifyId || song.spotify_id || '',
    uri: song.spotifyUri || song.uri || '',
    type: song.type || 'song',
    sourceKey: song.source || song.provider || '',
    name: song.name || song.title || '未知歌曲',
    artist: song.artist || '',
    cover: songCoverSrc(song, 220) || song.cover || '',
    source: songSourceLabel(song),
    provider: song.provider || song.source || song.type || '',
    resolvedPlaybackProvider: song.resolvedPlaybackProvider || song.playbackProvider || song.audioProvider || song.providerResolved || '',
    duration: Number(song.duration) || 0,
  };
  // 保留四个平台及本地文件的播放/详情标识，最近播放才能可靠地再次播放。
  ['album', 'albumMid', 'albummid', 'artistId', 'artistMid', 'artistProvider', 'version', 'versionName',
    'localKey', 'localFileId', 'localPath', 'localMissing', 'programId', 'radioId', 'radioName',
    'spotifyUri', 'spotifyUrl', 'albumUri', 'albumAudioId', 'album_audio_id', 'hqHash', 'sqHash', 'resHash'].forEach(function (key) {
    if (song[key] != null && song[key] !== '') snapshot[key] = song[key];
  });
  ['artists', 'artistRefs', 'singers', 'genres', 'tags'].forEach(function (key) {
    if (Array.isArray(song[key])) snapshot[key] = song[key].slice(0, 20);
  });
  return snapshot;
}

function listenHistoryRecord(session, completed) {
  var record = Object.assign({}, session.song || {});
  record.sessionId = session.sessionId || '';
  record.key = session.key;
  record.playedAt = session.startedAt;
  record.listenMs = Math.max(0, Math.round(Number(session.listenMs) || 0));
  record.completed = !!completed;
  record.statsCounted = false;
  record.context = session.context || null;
  return record;
}

function recordRecentListenSession(session, force, completed, statsCounted) {
  if (!session || !session.recentStarted) return null;
  var now = Date.now();
  if (!force && now - (session.recentSavedAt || 0) < 5000) return null;
  var record = listenHistoryRecord(session, completed);
  record.statsCounted = !!statsCounted;
  listenStatsState.history = [record].concat((listenStatsState.history || []).filter(function (item) {
    return item && !listenSessionMatchesSong(record, item);
  })).slice(0, 100);
  session.recentSavedAt = now;
  saveListenStatsState();
  if (typeof document !== 'undefined' && document.getElementById('home-recent-history-list')) renderHomeRecentHistoryList();
  if (emptyHomeActive && typeof renderHomeDashboardQuickCards === 'function') renderHomeDashboardQuickCards();
  return record;
}

function beginListenSession(song, context) {
  if (!song) return;
  var snap = listenSongSnapshot(song);
  if (!snap.key) return;
  if (listenSession && listenSessionMatchesSong(listenSession, snap)) {
    // 音质切换、换源和恢复播放会重建媒体，沿用同一次聆听。
    listenSession.song = snap;
    listenSession.key = snap.key;
    listenSession.lastWallAt = Date.now();
    listenSession.lastAudioTime = audio && isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (audio && !audio.paused) listenSession.recentStarted = true;
    recordRecentListenSession(listenSession, true);
    return;
  }
  if (listenSession) finalizeListenSession(false);
  listenSession = {
    sessionId: createListenSessionId(),
    key: snap.key,
    song: snap,
    context: context || activeRadioContext || null,
    startedAt: Date.now(),
    lastWallAt: Date.now(),
    lastAudioTime: audio && isFinite(audio.currentTime) ? audio.currentTime : 0,
    listenMs: 0,
    maxProgress: 0,
    recentStarted: !!(audio && !audio.paused),
    recentSavedAt: 0,
  };
  recordRecentListenSession(listenSession, true);
}

function tickListenSessionSnapshot(session, force) {
  if (!session || !audio || !audio.duration || audio.paused) return;
  var now = Date.now();
  var audioTime = isFinite(audio.currentTime) ? audio.currentTime : 0;
  var deltaByAudio = Math.max(0, audioTime - (session.lastAudioTime || 0)) * 1000;
  var deltaByWall = Math.max(0, now - (session.lastWallAt || now));
  var delta = deltaByAudio > 0 ? Math.min(deltaByAudio, deltaByWall || deltaByAudio, 4200) : 0;
  if (force && delta <= 0) delta = Math.min(deltaByWall, 1500);
  if (delta > 0 && delta < 8000) session.listenMs += delta;
  if (deltaByAudio > 0) session.recentStarted = true;
  session.lastWallAt = now;
  session.lastAudioTime = audioTime;
  session.maxProgress = Math.max(session.maxProgress || 0, audio.duration ? audioTime / audio.duration : 0);
}

function updateListenStatsTick(force) {
  if (!audio || !audio.duration || audio.paused) return;
  var song = currentCoverSong();
  if (!song) return;
  if (!listenSession || !listenSessionMatchesSong(listenSession, song)) beginListenSession(song, activeRadioContext);
  if (!listenSession) return;
  tickListenSessionSnapshot(listenSession, force);
  recordRecentListenSession(listenSession, !!force);
}

function finalizeListenSession(completed) {
  if (!listenSession) return;
  var session = listenSession;
  tickListenSessionSnapshot(session, true);
  var actualDurationMs = audio && isFinite(audio.duration) && audio.duration > 0
    ? Math.round(audio.duration * 1000)
    : listenSnapshotDurationMs(session.song);
  listenSession = null;
  var effective = completed || session.listenMs >= 45000 || session.maxProgress >= 0.5 || (!audio || !audio.duration ? session.listenMs >= 30000 : false);
  if (!effective) {
    recordRecentListenSession(session, true, completed, false);
    return;
  }
  var now = Date.now();
  var record = listenHistoryRecord(session, completed);
  recordRecentListenSession(session, true, completed, true);
  var songStat = listenStatsState.songs[record.key] || { key: record.key, name: record.name, artist: record.artist, cover: record.cover, source: record.source, plays: 0, listenMs: 0, completed: 0, lastPlayedAt: 0 };
  songStat.name = record.name;
  songStat.artist = record.artist;
  songStat.cover = record.cover || songStat.cover || '';
  songStat.source = record.source || songStat.source || '';
  songStat.plays += 1;
  songStat.listenMs += record.listenMs;
  songStat.completed += completed ? 1 : 0;
  songStat.lastPlayedAt = now;
  listenStatsState.songs[record.key] = songStat;
  String(record.artist || '').split(/\s*\/\s*|\s*,\s*|、|&/).forEach(function (name) {
    name = name.trim();
    if (!name) return;
    var artistStat = listenStatsState.artists[name] || { name: name, plays: 0, listenMs: 0, lastPlayedAt: 0 };
    artistStat.plays += 1;
    artistStat.listenMs += record.listenMs;
    artistStat.lastPlayedAt = now;
    listenStatsState.artists[name] = artistStat;
  });
  recordListenRollupV2(record);
  saveListenStatsState();
  reportListenSession(record, session, actualDurationMs);
  if (emptyHomeActive) renderHomeDiscover();
}

function mostPlayedSong() {
  var list = Object.keys(listenStatsState.songs || {}).map(function (key) { return listenStatsState.songs[key]; });
  list.sort(function (a, b) { return (b.plays - a.plays) || (b.listenMs - a.listenMs) || (b.lastPlayedAt - a.lastPlayedAt); });
  return list[0] || null;
}

function topListenArtist() {
  var list = Object.keys(listenStatsState.artists || {}).map(function (key) { return listenStatsState.artists[key]; });
  list.sort(function (a, b) { return (b.plays - a.plays) || (b.listenMs - a.listenMs) || (b.lastPlayedAt - a.lastPlayedAt); });
  return list[0] || null;
}

function homeListenSummary() {
  var recent = (listenStatsState.history || [])[0] || null;
  var topSong = mostPlayedSong();
  var topArtist = topListenArtist();
  var totalPlays = Object.keys(listenStatsState.songs || {}).reduce(function (sum, key) { return sum + ((listenStatsState.songs[key] && listenStatsState.songs[key].plays) || 0); }, 0);
  return { recent: recent, topSong: topSong, topArtist: topArtist, totalPlays: totalPlays };
}

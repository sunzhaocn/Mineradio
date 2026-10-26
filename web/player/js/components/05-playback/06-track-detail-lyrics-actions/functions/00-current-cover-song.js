'use strict';

function trackDetailRequestRuntime() {
  if (!trackDetailRequestRuntime.state) trackDetailRequestRuntime.state = {
    requests:new Set(), cache:new Map(), accountGeneration:0, warmTimer:0, warmTask:null
  };
  return trackDetailRequestRuntime.state;
}

function cancelPendingTrackDetailRequests(clearCache) {
  var state=trackDetailRequestRuntime();
  state.requests.forEach(function(request) { request.abort(); });
  if (state.warmTimer) clearTimeout(state.warmTimer);
  state.warmTimer=0;state.warmTask=null;
  if (clearCache) { state.accountGeneration++;state.cache.clear(); }
}

function currentTrackMetadataBusy() {
  var state=trackDetailRequestRuntime();return !!state.warmTask || state.requests.size>0;
}

async function requestTrackDetailJson(url, options) {
  options=options || {};
  var state=trackDetailRequestRuntime(), generation=state.accountGeneration;
  if (!options.background) {
    // An explicit detail owns its request immediately. Automatic warming must
    // never hold an album dialog behind a source that cannot start playing.
    state.requests.forEach(function(request) { if (request.background) request.abort(); });
    if (state.warmTimer) clearTimeout(state.warmTimer);
    state.warmTimer=0;state.warmTask=null;
  }
  var key=generation+'|'+url, cached=state.cache.get(key);
  if (!options.force && cached && Date.now()-cached.at<120000) return cached.data;
  var controller=typeof AbortController==='function' ? new AbortController() : null;
  var request={controller:controller,background:!!options.background}, timeoutMs=Number(options.timeoutMs) || (/\/album\/detail\?/.test(url) ? 30000 : 10000);
  state.requests.add(request);
  var timer, rejectAbort;
  var aborted=new Promise(function(_resolve,reject) { rejectAbort=reject; });
  function abortError() { var error=new Error(request.cancelled ? '加载已取消，请重试' : '加载超时，请重试');error.name='AbortError';return error; }
  request.abort=function() {
    request.cancelled=true;
    if (controller) controller.abort();else rejectAbort(abortError());
  };
  if (controller) controller.signal.addEventListener('abort',function() { rejectAbort(abortError()); },{once:true});
  function armDeadline(ms) {
    if (timer) clearTimeout(timer);
    if (typeof setTimeout==='function') timer=setTimeout(function() {
      request.timedOut=true;
      if (controller) controller.abort();else rejectAbort(abortError());
    },ms);
  }
  // Only background work waits for playback, with a separate bounded budget.
  // Foreground album requests retain their own 30-second network deadline.
  armDeadline(options.background ? 10000 : timeoutMs);
  var task=Promise.resolve().then(async function() {
    while (options.background && typeof playbackResolutionRuntime==='function' && playbackResolutionRuntime().active) {
      if (request.cancelled || request.timedOut || controller && controller.signal.aborted) throw abortError();
      await new Promise(function(resolve) { setTimeout(resolve,40); });
    }
    if (request.cancelled || request.timedOut || controller && controller.signal.aborted) throw abortError();
    armDeadline(timeoutMs);
    var data=await apiJson(url,{timeoutMs:timeoutMs,signal:controller && controller.signal,
      priority:options.background ? 'low' : 'high'});
    if (request.cancelled || request.timedOut || controller && controller.signal.aborted || generation!==state.accountGeneration) throw abortError();
    var validShape=!/\/song\/comments\?/.test(url) || data && Array.isArray(data.comments);
    if (/\/album\/detail\?/.test(url)) validShape=!!(data && Array.isArray(data.songs));
    if (data && !data.error && data.ok!==false && validShape) {
      state.cache.set(key,{at:Date.now(),data:data});
      if (state.cache.size>80) state.cache.delete(state.cache.keys().next().value);
    }
    return data;
  });
  try { return await Promise.race([task,aborted]); }
  finally { if (timer) clearTimeout(timer);state.requests.delete(request); }
}

function scheduleCurrentTrackMetadata(song, token) {
  var state=trackDetailRequestRuntime();
  if (state.warmTimer) clearTimeout(state.warmTimer);
  if (!song || song.type==='local' || song.source==='local' || song.localUrl) return;
  state.warmTimer=setTimeout(async function() {
    state.warmTimer=0;
    if (token!==trackSwitchToken) return;
    var task={token:token}, waitingSince=Date.now();state.warmTask=task;
    try {
      while (token===trackSwitchToken && state.warmTask===task && typeof playbackResolutionRuntime==='function'
          && playbackResolutionRuntime().active) {
        if (Date.now()-waitingSince>=10000) return;
        await new Promise(function(resolve) { setTimeout(resolve,40); });
      }
      if (token!==trackSwitchToken || state.warmTask!==task) return;
      song=playQueue[currentIdx] || song;
      var config=typeof detailCommentsConfig==='function' && detailCommentsConfig(song);
      var urls=[];
      if (config && config.readUrl) urls.push(config.readUrl+'&sort=hot&cursor=');
      var album=albumDetailUrlForSong(song);
      if (album) urls.push(album);
      for (var i=0;i<urls.length && token===trackSwitchToken && state.warmTask===task;i++) {
        try { await requestTrackDetailJson(urls[i],{background:true,timeoutMs:10000}); } catch (_) {}
      }
    } finally { if (state.warmTask===task) state.warmTask=null; }
  },350);
}

function currentCoverSong() {
  if (currentIdx >= 0 && playQueue[currentIdx]) return playQueue[currentIdx];
  return currentLocalSong || null;
}

function songDurationLabel(song) {
  var sec = playbackDurationFromSong(song);
  if (!sec && audio && isFinite(audio.duration) && audio.duration > 0) sec = audio.duration;
  if (!sec) return '未知';
  return formatProgramTime(sec);
}

function songSourceLabel(song) {
  if (!song) return '未知';
  if (song.provider === 'spotify' || song.source === 'spotify' || song.type === 'spotify' || song.spotifyId || song.spotifyUri) return 'Spotify';
  if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') return 'QQ 音乐';
  if (song.provider === 'qishui' || song.source === 'qishui' || song.type === 'qishui') return '汽水音乐';
  if (song.provider === 'kugou' || song.source === 'kugou' || song.type === 'kugou' || song.hash || song.audioHash) return '酷狗音乐';
  if (song.type === 'local') return '本地上传';
  if (song.type === 'podcast' || song.source === 'podcast') return '网易云播客';
  return '网易云音乐';
}

function detailRow(label, value) {
  value = value == null || value === '' ? '未知' : value;
  return '<div class="detail-k">' + escHtml(label) + '</div><div class="detail-v">' + escHtml(String(value)) + '</div>';
}

function currentArtistNames(song) {
  var refs = song && (song.artist_refs || song.artists);
  if (Array.isArray(refs)) {
    var names = refs.map(function (row) { return String(typeof row === 'string' ? row : row && row.name || '').trim(); }).filter(Boolean);
    if (names.length) return names;
  }
  var text = String((song && song.artist) || '').trim();
  return text ? [text] : [];
}

function normalizeArtistNameForMatch(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s·・,，、/\\|&＋+_-]+/g, '')
    .replace(/[()（）\[\]【】"'“”‘’]/g, '');
}

function artistNameMatches(expectedNames, actualName) {
  var actual = normalizeArtistNameForMatch(actualName);
  if (!actual) return false;
  return (expectedNames || []).some(function (name) {
    var expected = normalizeArtistNameForMatch(name);
    return expected && (expected === actual || expected.indexOf(actual) >= 0 || actual.indexOf(expected) >= 0);
  });
}

function currentArtistId(song) {
  if (!song) return '';
  if (song.type === 'local' || ['netease', 'qq', 'kugou', 'qishui'].indexOf(songProviderKey(song)) < 0) return '';
  if (song.artistId) return String(song.artistId);
  if (song.artist_id) return String(song.artist_id);
  var artists = song.artist_refs || song.artists || [];
  for (var i = 0; i < artists.length; i++) {
    if (artists[i] && artists[i].id) return String(artists[i].id);
  }
  return '';
}

function currentQQArtistMid(song) {
  if (!song || songProviderKey(song) !== 'qq') return '';
  if (song.artistMid) return String(song.artistMid);
  if (song.artist_mid) return String(song.artist_mid);
  if (song.singerMid) return String(song.singerMid);
  if (song.artistId && !/^\d+$/.test(String(song.artistId))) return String(song.artistId);
  var artists = song.artist_refs || song.artists || [];
  for (var i = 0; i < artists.length; i++) {
    if (artists[i] && artists[i].mid) return String(artists[i].mid);
    if (artists[i] && artists[i].id && !/^\d+$/.test(String(artists[i].id))) return String(artists[i].id);
  }
  return '';
}

function artistDetailUrlForSong(song) {
  if (!song || song.type === 'local') return '';
  var provider = songProviderKey(song);
  if (['netease', 'qq', 'kugou', 'qishui'].indexOf(provider) < 0) return '';
  var prefix = '/api' + (provider === 'netease' ? '' : '/' + provider) + '/artist/detail?';
  var identifier = provider === 'qq' ? (currentQQArtistMid(song) || currentArtistId(song)) : currentArtistId(song);
  var songId = song.mid || song.hash || song.id || song.providerSongId || song.trackId || '';
  var name = currentArtistNames(song)[0] || '';
  if (identifier) return prefix + (provider === 'qq' && !/^\d+$/.test(identifier) ? 'mid=' : 'id=') + encodeURIComponent(identifier) + '&name=' + encodeURIComponent(name) + '&limit=36';
  return songId ? prefix + 'song_id=' + encodeURIComponent(songId) + '&name=' + encodeURIComponent(name) + '&limit=36' : '';
}

function artistProfileMatchesSong(song, profile) {
  var nativeId = currentArtistId(song), nativeMid = currentQQArtistMid(song);
  if ((nativeId && String(profile.id || '') === nativeId) || (nativeMid && String(profile.mid || '') === nativeMid)) return true;
  var expected = currentArtistNames(song).map(normalizeArtistNameForMatch);
  var names = [profile.name].concat(profile.alias || []).map(normalizeArtistNameForMatch);
  if (!expected.length) return true;
  return expected.some(function (name) { return name && names.indexOf(name) >= 0; });
}

function renderArtistDetailSongs() {
  var context = detailArtistContext || {};
  var html = renderArtistSongList(context.songs || []);
  html += '<div class="detail-sub">已载入 ' + (context.songs || []).length +
    (context.total == null ? '' : ' / ' + escHtml(String(context.total))) + ' 首' +
    (context.scope === 'hot' ? ' · 平台热门目录' : '') + '</div>';
  if (context.error) html += '<div class="detail-empty">' + escHtml(context.error) + '</div>';
  if (context.hasMore || context.error) html += '<button class="detail-action-toggle" type="button" ' +
    (context.loading ? 'disabled' : '') + ' onclick="loadArtistDetailPage(' + trackDetailSeq + (context.restart ? ',true' : '') + ')">' +
    (context.loading ? '正在载入…' : context.restart ? '重新加载歌曲目录' : context.error ? '重试加载' : '加载更多歌曲') + '</button>';
  return html;
}

async function loadArtistDetailPage(seq, restart) {
  var context = detailArtistContext;
  if (seq !== trackDetailSeq || !context || context.loading) return;
  if (restart) {
    context.songs = [];
    context.nextOffset = 0;
    context.total = null;
    context.hasMore = false;
    context.restart = false;
  }
  var target = document.getElementById('artist-hot-songs');
  var offset = context.nextOffset || 0;
  context.loading = true;
  context.error = '';
  if (offset && target) target.innerHTML = renderArtistDetailSongs();
  try {
    var result = await requestTrackDetailJson(context.url + '&offset=' + encodeURIComponent(offset));
    if (seq !== trackDetailSeq || context !== detailArtistContext) return;
    if (!result || result.error || result.ok === false || result.supported === false) throw new Error(result && result.message || '歌手主页加载失败');
    var confirmed = context.artist || result.resolvedArtist;
    var confirmedMatch = result.artist && confirmed &&
      ((confirmed.id && String(confirmed.id) === String(result.artist.id || '')) ||
       (confirmed.mid && String(confirmed.mid) === String(result.artist.mid || '')));
    if (!result.artist || !result.artist.name || (!confirmedMatch && !artistProfileMatchesSong(context.song, result.artist))) {
      throw new Error('歌手资料与当前歌曲不匹配，已停止展示错误主页。');
    }
    if (!Array.isArray(result.songs) || (result.hasMore && !(result.nextOffset > offset))) throw new Error('歌手歌曲分页未前进，请稍后重试');
    var changed = (offset && context.total !== result.total && !context.totalEstimated && !result.totalEstimated) ||
      (!result.totalEstimated && result.total != null && offset + result.songs.length > result.total);
    var keys = new Set(context.songs.map(function (row) { return String(row.mid || row.hash || row.id || ''); }));
    if (result.songs.some(function (row) {
      var key = String(row.mid || row.hash || row.id || '');
      if (!key) return false;
      if (keys.has(key)) return true;
      keys.add(key);
      return false;
    })) changed = true;
    if (changed) {
      context.restart = true;
      throw new Error('歌手歌曲目录已更新，请重新加载。');
    }
    context.songs = context.songs.concat(result.songs.map(cloneSong));
    context.nextOffset = result.nextOffset;
    context.hasMore = !!result.hasMore;
    context.total = result.total;
    context.totalEstimated = !!result.totalEstimated;
    context.scope = result.scope || 'hot';
    var artist = result.artist;
    context.artist = artist;
    // 后续分页使用已确认的歌手标识，旧歌曲只恢复一次。
    var nativeId = artist.mid || artist.id;
    if (nativeId) {
      var provider = songProviderKey(context.song);
      context.url = '/api' + (provider === 'netease' ? '' : '/' + provider) + '/artist/detail?id=' +
        encodeURIComponent(nativeId) + '&name=' + encodeURIComponent(artist.name) + '&limit=36';
    }
    var title = document.getElementById('artist-detail-title');
    if (title) title.textContent = artist.name;
    var metadata = document.getElementById('artist-detail-profile');
    if (metadata) metadata.innerHTML = (artist.song_count == null ? '' : detailRow('平台作品数', artist.song_count)) +
      (artist.alias && artist.alias.length ? detailRow('别名', artist.alias.join(' / ')) : '') +
      (artist.description ? '<div class="detail-k">歌手简介</div><div class="detail-v"><details><summary>展开歌手简介</summary><div>' + escHtml(artist.description) + '</div></details></div>' : '');
    var section = document.getElementById('artist-songs-heading');
    if (section) section.textContent = context.scope === 'hot' ? '热门歌曲' : '歌手歌曲';
    var avatar = document.getElementById('artist-detail-cover');
    if (avatar && artist.avatar) {
      avatar.textContent = '';
      avatar.style.backgroundImage = 'url("' + coverUrlWithSize(artist.avatar, 180).replace(/"/g, '\\"') + '")';
      avatar.style.backgroundSize = 'cover';
      avatar.style.backgroundPosition = 'center';
    }
  } catch (error) {
    if (seq === trackDetailSeq && context === detailArtistContext) context.error = error.message || '歌手主页加载失败，请重试';
  } finally {
    if (seq === trackDetailSeq && context === detailArtistContext) {
      context.loading = false;
      target = document.getElementById('artist-hot-songs');
      if (target) target.innerHTML = renderArtistDetailSongs();
      bindTrackDetailScrollers();
    }
  }
}

function currentAlbumKey(song) {
  if (!song) return '';
  var provider = songProviderKey(song);
  if (provider === 'qq') {
    var qqAlbumMid = song.albumMid || song.albummid || song.album_mid || song.albumId || song.album_id || '';
    return qqAlbumMid ? 'qq:' + qqAlbumMid : '';
  }
  if (provider === 'spotify') {
    var spotifyAlbumId = song.albumId || song.spotifyAlbumId || '';
    return spotifyAlbumId ? 'spotify:' + spotifyAlbumId : '';
  }
  if (provider === 'netease') {
    var albumId = song.albumId || song.album_id || '';
    return albumId ? 'netease:' + albumId : '';
  }
  if (provider === 'kugou') {
    var kugouAlbumId = song.albumId || song.album_id || '';
    return kugouAlbumId ? 'kugou:' + kugouAlbumId : '';
  }
  if (provider === 'qishui') {
    var qishuiAlbumId = song.albumId || song.album_id || '';
    return qishuiAlbumId ? 'qishui:' + qishuiAlbumId : '';
  }
  return '';
}

function albumDetailUrlForSong(song) {
  var provider = songProviderKey(song);
  if (provider === 'qq') {
    var qqAlbumMid = song && (song.albumMid || song.albummid || song.album_mid || '');
    var qqAlbumId = song && (song.albumId || song.album_id || '');
    return qqAlbumMid ? '/api/qq/album/detail?mid=' + encodeURIComponent(qqAlbumMid) + '&limit=20'
      : (qqAlbumId ? '/api/qq/album/detail?id=' + encodeURIComponent(qqAlbumId) + '&limit=20' : albumDetailSongLookupUrl(song,provider));
  }
  if (provider === 'spotify') {
    var spotifyAlbumId = song && (song.albumId || song.spotifyAlbumId || '');
    return spotifyAlbumId ? '/api/spotify/album/detail?id=' + encodeURIComponent(spotifyAlbumId) + '&limit=20' : '';
  }
  if (provider === 'netease') {
    var albumId = song && (song.albumId || song.album_id || '');
    return albumId ? '/api/album/detail?id=' + encodeURIComponent(albumId) + '&limit=20' : albumDetailSongLookupUrl(song,provider);
  }
  if (provider === 'kugou' || provider === 'qishui') {
    var nativeAlbumId = song && (song.albumId || song.album_id || '');
    return nativeAlbumId ? '/api/' + provider + '/album/detail?id=' + encodeURIComponent(nativeAlbumId) + '&limit=20' : albumDetailSongLookupUrl(song,provider);
  }
  return '';
}

function albumDetailSongLookupUrl(song,provider) {
  if (!song || song.type==='local' || song.type==='podcast' || song.source==='local' || song.localUrl) return '';
  var id=provider==='qq' ? song.mid || song.songmid || song.qqId || song.id
    : provider==='kugou' ? song.hash || song.audioHash || song.id
      : provider==='qishui' ? song.providerSongId || song.trackId || song.id : song.id;
  return id ? '/api'+(provider==='netease' ? '' : '/'+provider)+'/album/detail?songId='+encodeURIComponent(id)+'&limit=20' : '';
}

function albumDetailMissingText(song) {
  return '暂无专辑信息';
}

function renderAlbumDetailSongs() {
  var context = detailAlbumContext || {};
  var html = renderAlbumSongList(context.songs || []);
  var loaded = (context.songs || []).length;
  html += '<div class="detail-sub">已载入 ' + loaded + ' / ' + escHtml(String(context.total || loaded)) + ' 首</div>';
  if (context.error) html += '<div class="detail-empty">' + escHtml(context.error) + '</div>';
  if (context.hasMore) html += '<button class="detail-action-toggle" type="button" ' +
    (context.loading ? 'disabled' : '') + ' onclick="loadMoreAlbumDetailSongs(' + trackDetailSeq + ')">' +
    (context.loading ? '正在载入…' : (context.error ? '重试加载更多' : '加载更多曲目')) + '</button>';
  return html;
}

async function loadMoreAlbumDetailSongs(seq) {
  var context = detailAlbumContext;
  if (seq !== trackDetailSeq || !context || !context.hasMore || context.loading) return;
  var target = document.getElementById('album-song-list');
  context.loading = true;
  context.error = '';
  if (target) target.innerHTML = renderAlbumDetailSongs();
  try {
    var result = await requestTrackDetailJson(context.url + '&offset=' + encodeURIComponent(context.nextOffset));
    if (seq !== trackDetailSeq || context !== detailAlbumContext) return;
    if (!result || result.error || result.ok === false) throw new Error(result && result.message || '专辑曲目加载失败');
    if (!Array.isArray(result.songs) || (result.hasMore && !(result.nextOffset > context.nextOffset))) {
      throw new Error('专辑分页未前进，请稍后重试');
    }
    context.songs = context.songs.concat(result.songs.map(cloneSong));
    context.nextOffset = result.nextOffset;
    context.hasMore = !!result.hasMore;
    context.total = result.total;
    if (detailAlbumGaplessEnabled && typeof setAlbumGaplessPlaybackContext === 'function') setAlbumGaplessPlaybackContext(true, context);
  } catch (error) {
    if (seq === trackDetailSeq && context === detailAlbumContext) context.error = error.message || '专辑曲目加载失败，请重试';
  } finally {
    if (seq === trackDetailSeq && context === detailAlbumContext) {
      context.loading = false;
      target = document.getElementById('album-song-list');
      if (target) target.innerHTML = renderAlbumDetailSongs();
      bindTrackDetailScrollers();
    }
  }
}

function albumCollectionConfig(song) {
  var provider = songProviderKey(song);
  var albumId = song && (song.albumId || song.album_id || song.spotifyAlbumId || '');
  if (!albumId) return null;
  if (provider === 'netease') return { provider: provider, id: String(albumId), endpoint: '/api/album/subscribe', field: 'subscribed', label: '网易云' };
  if (provider === 'spotify') return { provider: provider, id: String(albumId), endpoint: '/api/spotify/album/like', field: 'like', label: 'Spotify' };
  if (provider === 'qishui') return { provider: provider, id: String(albumId), endpoint: '/api/qishui/album/collect', field: 'collected', label: '汽水音乐' };
  return null;
}

function albumCollectionKey(song) {
  var config = albumCollectionConfig(song);
  return config ? (config.provider + ':' + config.id) : '';
}

function renderAlbumCollectionButton(song) {
  if (window.MINERADIO_LOCAL_WEB && ['netease', 'qq', 'kugou', 'qishui'].indexOf(songProviderKey(song)) >= 0) return '';
  var config = albumCollectionConfig(song);
  if (!config) return '';
  var key = albumCollectionKey(song);
  var collected = !!detailAlbumCollectionState[key];
  return '<button id="album-collection-toggle" class="detail-action-toggle' + (collected ? ' on' : '') + '" type="button" onclick="toggleAlbumCollection()">' +
    (collected ? '已收藏专辑' : '收藏专辑') +
    '</button>';
}

function syncAlbumCollectionButton(song) {
  song = song || detailCommentSong || currentCoverSong();
  var btn = document.getElementById('album-collection-toggle');
  if (!btn) return;
  var collected = !!detailAlbumCollectionState[albumCollectionKey(song)];
  btn.classList.toggle('on', collected);
  btn.textContent = collected ? '已收藏专辑' : '收藏专辑';
}

function syncAlbumCollectionState(song) {
  var config = albumCollectionConfig(song);
  if (!config || !isSongAccountLoggedIn(config.provider)) return;
  var url = '';
  var responseField = '';
  if (config.provider === 'netease') {
    url = '/api/album/subscribe/check?ids=' + encodeURIComponent(config.id);
    responseField = 'subscribed';
  } else if (config.provider === 'spotify') {
    url = '/api/spotify/album/like/check?ids=' + encodeURIComponent(config.id);
    responseField = 'liked';
  }
  if (!url) return;
  apiJson(url).then(function (result) {
    if (!result || result.error || !result[responseField]) return;
    detailAlbumCollectionState[albumCollectionKey(song)] = !!result[responseField][config.id];
    syncAlbumCollectionButton(song);
  }).catch(function () {});
}

async function toggleAlbumCollection() {
  var song = detailCommentSong || currentCoverSong();
  var config = albumCollectionConfig(song);
  if (!config) { showToast('当前平台暂不支持收藏专辑'); return; }
  if (!ensureLoggedInForAction(config.provider)) return;
  var key = albumCollectionKey(song);
  var next = !detailAlbumCollectionState[key];
  var payload = { id: config.id, albumId: config.id };
  payload[config.field] = next;
  var btn = document.getElementById('album-collection-toggle');
  if (btn) btn.classList.add('busy');
  try {
    var result = await apiJson(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!result || result.error || result.success === false) throw new Error(result && (result.message || result.error) || 'ALBUM_COLLECTION_FAILED');
    detailAlbumCollectionState[key] = next;
    syncAlbumCollectionButton(song);
    showToast(next ? '专辑已收藏到' + config.label : '已取消收藏专辑');
  } catch (err) {
    showToast(/SCOPE|PERMISSION/i.test(String(err && err.message || ''))
      ? '请重新授权后再收藏专辑'
      : '专辑收藏操作失败');
  } finally {
    if (btn) btn.classList.remove('busy');
  }
}

function renderAlbumGaplessButton() {
  return '<button id="album-gapless-toggle" class="detail-action-toggle' + (detailAlbumGaplessEnabled ? ' on' : '') + '" type="button" onclick="toggleAlbumGaplessPlayback()">' +
    (detailAlbumGaplessEnabled ? '无缝衔接 开' : '无缝衔接 关') +
    '</button>';
}

function syncAlbumGaplessButton() {
  var btn = document.getElementById('album-gapless-toggle');
  if (!btn) return;
  btn.classList.toggle('on', detailAlbumGaplessEnabled);
  btn.textContent = detailAlbumGaplessEnabled ? '无缝衔接 开' : '无缝衔接 关';
}

function toggleAlbumGaplessPlayback() {
  detailAlbumGaplessUserTouched = true;
  detailAlbumGaplessEnabled = !detailAlbumGaplessEnabled;
  if (typeof setAlbumGaplessPlaybackContext === 'function') {
    setAlbumGaplessPlaybackContext(detailAlbumGaplessEnabled, detailAlbumContext, { userToggle: true });
  }
  syncAlbumGaplessButton();
  showToast(detailAlbumGaplessEnabled ? '专辑无缝衔接已开启' : '专辑无缝衔接已关闭');
}

function tagAlbumSongsForGapless(songs, context) {
  var albumKey = context && context.albumKey || '';
  return (songs || []).map(function (song, i) {
    var copy = cloneSong(song);
    copy.__albumGaplessKey = albumKey;
    copy.__albumTrackIndex = i;
    return copy;
  });
}

function renderAlbumSongList(songs) {
  detailAlbumSongs = (songs || []).map(cloneSong);
  if (!detailAlbumSongs.length) return '<div class="detail-empty">暂无专辑曲目</div>';
  return '<div class="detail-scroll">' + detailAlbumSongs.map(function (s, i) {
    var cover = songCoverSrc(s, 80);
    var coverHtml = cover ? '<img class="artist-song-cover" src="' + escHtml(cover) + '" alt="" onerror="this.style.opacity=0.18">' : '<div class="artist-song-cover"></div>';
    var actionsHtml = '<div class="artist-song-actions">' +
      '<button class="artist-song-action collect" type="button" title="收藏到歌单" aria-label="收藏到歌单" onclick="event.stopPropagation();collectAlbumDetailSong(' + i + ')">' + artistCollectTrayIconSvg() + '</button>' +
      '<button class="artist-song-action next" type="button" title="下一首播放" aria-label="下一首播放" onclick="event.stopPropagation();queueAlbumDetailSongNext(' + i + ')">' + artistNextPlusIconSvg() + '</button>' +
      '</div>';
    return '<div class="artist-song-item" onclick="playAlbumDetailSong(' + i + ')">' +
      '<div class="artist-song-rank">' + String(i + 1).padStart(2, '0') + '</div>' +
      coverHtml +
      '<div class="artist-song-main"><div class="artist-song-name">' + escHtml(s.name || '') + '</div>' +
      '<div class="artist-song-meta">' + escHtml((s.artist || '未知歌手') + (s.duration ? (' · ' + songDurationLabel(s)) : '')) + '</div></div>' +
      actionsHtml +
      '</div>';
  }).join('') + '</div>';
}

function playAlbumDetailSong(i) {
  var song = detailAlbumSongs[i];
  if (!song) return;
  var taggedSongs = tagAlbumSongsForGapless(detailAlbumSongs, detailAlbumContext);
  playQueue = taggedSongs;
  currentIdx = i;
  if (typeof setAlbumGaplessPlaybackContext === 'function') {
    setAlbumGaplessPlaybackContext(detailAlbumGaplessEnabled, detailAlbumContext);
  }
  safeRenderQueuePanel('album-detail-play');
  safeShelfRebuild('album-detail-play', true);
  closeTrackDetailModal();
  playQueueAt(i, { manual: true, skipShuffleOrder: true }).catch(function (e) { console.warn('[AlbumDetailPlay]', e); });
}

function collectAlbumDetailSong(i) {
  var song = detailAlbumSongs[i];
  if (!song) return;
  collectDetailSong(song);
}

function queueAlbumDetailSongNext(i) {
  var song = detailAlbumSongs[i];
  if (!song) return;
  queueDetailSongNext(song);
}


'use strict';


async function submitDetailComment() {
  if (detailCommentSubmitBusy || !detailCommentSong) return;
  var config = detailCommentsConfig(detailCommentSong);
  if (typeof songCommentContext !== 'undefined' && songCommentContext && songCommentContext.seq === trackDetailSeq) config = songCommentContext.config;
  if (!config || !config.canWrite || !config.writeUrl) {
    showToast('当前平台评论只读');
    return;
  }
  if (!ensureLoggedInForAction(config.provider)) return;
  var input = document.getElementById('detail-comment-input');
  var content = String(input && input.value || '').trim();
  if (!content) { showToast('先输入评论内容'); return; }
  detailCommentSubmitBusy = true;
  var button = document.getElementById('detail-comment-submit');
  if (button) { button.disabled = true; button.textContent = '发送中'; }
  try {
    var result = await apiJson(config.writeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: config.id, content: content })
    });
    if (!result || result.error || result.success === false || result.created === false) {
      throw new Error(result && (result.message || result.error) || 'COMMENT_CREATE_FAILED');
    }
    if (input) input.value = '';
    showToast('评论已发布');
    await loadDetailComments(detailCommentSong, trackDetailSeq);
  } catch (err) {
    showToast('评论发布失败' + (err && err.message ? ': ' + err.message : ''));
  } finally {
    detailCommentSubmitBusy = false;
    if (button) { button.disabled = false; button.textContent = '发送'; }
  }
}

function renderArtistSongList(songs) {
  detailArtistSongs = (songs || []).map(cloneSong);
  if (!detailArtistSongs.length) return '<div class="detail-empty">暂无热门歌曲</div>';
  return '<div class="detail-scroll">' + detailArtistSongs.map(function (s, i) {
    var cover = songCoverSrc(s, 80);
    var coverHtml = cover ? '<img class="artist-song-cover" src="' + escHtml(cover) + '" alt="" onerror="this.style.opacity=0.18">' : '<div class="artist-song-cover"></div>';
    var actionsHtml = '<div class="artist-song-actions">' +
      '<button class="artist-song-action collect" type="button" title="收藏到歌单" aria-label="收藏到歌单" onclick="event.stopPropagation();collectArtistDetailSong(' + i + ')">' + artistCollectTrayIconSvg() + '</button>' +
      '<button class="artist-song-action next" type="button" title="下一首播放" aria-label="下一首播放" onclick="event.stopPropagation();queueArtistDetailSongNext(' + i + ')">' + artistNextPlusIconSvg() + '</button>' +
      '</div>';
    return '<div class="artist-song-item" onclick="playArtistDetailSong(' + i + ')">' +
      '<div class="artist-song-rank">' + String(i + 1).padStart(2, '0') + '</div>' +
      coverHtml +
      '<div class="artist-song-main"><div class="artist-song-name">' + escHtml(s.name || '') + '</div>' +
      '<div class="artist-song-meta">' + escHtml((s.album || '未知专辑') + (s.duration ? (' · ' + songDurationLabel(s)) : '')) + '</div></div>' +
      actionsHtml +
      '</div>';
  }).join('') + '</div>';
}

function playArtistDetailSong(i) {
  var song = detailArtistSongs[i];
  if (!song) return;
  playQueue = detailArtistSongs.map(cloneSong);
  currentIdx = i;
  safeRenderQueuePanel('artist-detail-play');
  safeShelfRebuild('artist-detail-play', true);
  closeTrackDetailModal();
  playQueueAt(i).catch(function (e) { console.warn('[ArtistDetailPlay]', e); });
}

function collectArtistDetailSong(i) {
  var song = detailArtistSongs[i];
  if (!song) return;
  collectDetailSong(song);
}

function queueArtistDetailSongNext(i) {
  var song = detailArtistSongs[i];
  if (!song) return;
  queueDetailSongNext(song);
}

function bindTrackDetailScrollers() {
  var body = document.getElementById('track-detail-body');
  bindSmoothWheelScroll(body);
  if (body) body.querySelectorAll('.detail-scroll').forEach(bindSmoothWheelScroll);
}

function closeTrackDetailModal() {
  if (typeof cancelPendingTrackDetailRequests==='function') cancelPendingTrackDetailRequests(false);
  ++trackDetailSeq;
  if (typeof songDetailOpen !== 'undefined') songDetailOpen = false;
  if (typeof songCommentContext !== 'undefined') songCommentContext = null;
  if (typeof closeCommentImagePreview === 'function') closeCommentImagePreview();
  closeGsapModal(document.getElementById('track-detail-modal'), function () {
    detailCommentSong = null;
    detailCommentSubmitBusy = false;
  });
}

function openTrackDetailModal(type, songOverride) {
  var song = songOverride || currentCoverSong();
  if (!song) { showToast('先播放或选择一首歌'); return; }
  if (immersiveMode) setImmersiveMode(false);
  var heading = document.getElementById('track-detail-heading');
  var body = document.getElementById('track-detail-body');
  if (!heading || !body) return;
  if (typeof cancelPendingTrackDetailRequests==='function') cancelPendingTrackDetailRequests(false);
  var cover = songCoverSrc(song, 180);
  var coverHtml = cover ? '<img class="detail-cover" src="' + cover + '" alt="">' : '<div class="detail-cover"></div>';
  var title = song.name || '当前歌曲';
  var artists = currentArtistNames(song);
  var seq = ++trackDetailSeq;
  detailCommentSong = song;
  if (typeof songDetailOpen !== 'undefined') {
    songDetailOpen = type !== 'album' && type !== 'artist';
    songDetailPlaybackKey = songDetailNativeKey(currentCoverSong());
    songCommentContext = null;
    closeCommentImagePreview();
  }
  if (type === 'album') {
    var albumUrl = albumDetailUrlForSong(song);
    var albumTitle = song.album || (song.type === 'podcast' ? (song.radioName || 'Podcast') : '未知专辑');
    var albumKey = currentAlbumKey(song);
    detailAlbumGaplessUserTouched = false;
    detailAlbumGaplessEnabled = typeof albumGaplessDefaultEnabledForContext === 'function'
      ? albumGaplessDefaultEnabledForContext({ albumKey: albumKey })
      : true;
    detailAlbumSongs = [];
    detailAlbumContext = {
      provider: songProviderKey(song),
      albumKey: albumKey,
      album: { name: albumTitle, cover: cover, artist: song.artist || '', id: song.albumId || song.album_id || '', albumMid: song.albumMid || song.albummid || '' },
      songs: [],
    };
    heading.textContent = '专辑详情';
    body.innerHTML =
      '<div class="detail-hero">' + coverHtml +
      '<div style="min-width:0;flex:1"><div class="detail-title" id="album-detail-title">' + escHtml(albumTitle) + '</div>' +
      '<div class="detail-sub" id="album-detail-sub">' + escHtml(song.artist || '未知歌手') + ' · ' + escHtml(songSourceLabel(song)) + '</div></div>' +
      '</div>' +
      '<div class="detail-grid" id="album-detail-metadata">' +
      detailRow('当前歌曲', title) +
      detailRow('专辑', albumTitle) +
      detailRow('歌手', song.artist || '未知歌手') +
      detailRow('来源', songSourceLabel(song)) +
      '</div>' +
      '<div class="detail-chip-row" id="album-detail-modes">' +
      '<span class="detail-chip">' + escHtml(songSourceLabel(song)) + '</span>' +
      '<span class="detail-chip">按专辑顺序播放</span>' +
      '</div>' +
      '<div class="detail-section"><div class="detail-section-head" id="album-detail-section-head"><div class="detail-section-title">专辑曲目</div><div class="detail-section-actions">' + renderAlbumCollectionButton(song) + renderAlbumGaplessButton() + '</div></div><div id="album-song-list">' +
      (albumUrl ? '<div class="detail-loading" role="status">正在读取' + escHtml(songSourceLabel(song)) + '专辑资料和曲目…</div>' : '<div class="detail-empty">' + escHtml(albumDetailMissingText(song)) + '</div>') +
      '</div></div>';
    syncAlbumCollectionState(song);
    if (albumUrl) {
      requestTrackDetailJson(albumUrl).then(function (r) {
        if (seq !== trackDetailSeq) return;
        var target = document.getElementById('album-song-list');
        if (!r || r.error || r.ok === false || r.supported === false) {
          if (target) target.innerHTML = renderAlbumDetailLoadFailure(song, r && r.message);
          bindTrackDetailScrollers();
          return;
        }
        if (r.albumAvailable === false && r.reason === 'song_has_no_album') {
          detailAlbumGaplessEnabled = false;
          detailAlbumContext = { provider:songProviderKey(song), songs:[], album:null, hasMore:false, total:0 };
          var absentTitle = document.getElementById('album-detail-title');
          if (absentTitle) absentTitle.textContent = title;
          var absentMetadata = document.getElementById('album-detail-metadata');
          if (absentMetadata) absentMetadata.innerHTML = detailRow('当前音频',title) +
            detailRow('发布者 / 歌手',song.artist || '未知') + detailRow('专辑','平台未关联专辑') +
            detailRow('来源',songSourceLabel(song));
          var absentModes = document.getElementById('album-detail-modes');
          if (absentModes) absentModes.innerHTML = '<span class="detail-chip">' + escHtml(songSourceLabel(song)) + '</span>';
          var absentSection = document.getElementById('album-detail-section-head');
          if (absentSection) absentSection.innerHTML = '<div class="detail-section-title">专辑信息</div>';
          if (target) target.innerHTML = '<div class="detail-empty">' + escHtml(r.message || '当前平台未为这首音频关联专辑') + '</div>';
          bindTrackDetailScrollers();
          return;
        }
        var albumInfo = r.album || {};
        if (!song.albumId && (albumInfo.albumId || albumInfo.id)) song.albumId=String(albumInfo.albumId || albumInfo.id);
        if (!song.albumMid && (albumInfo.albumMid || albumInfo.mid)) song.albumMid=String(albumInfo.albumMid || albumInfo.mid);
        if (!song.album && albumInfo.name) song.album=albumInfo.name;
        var songs = (r.songs || []).map(cloneSong);
        detailAlbumContext = {
          provider: r.provider || songProviderKey(song),
          albumKey: albumKey || currentAlbumKey(songs[0]) || currentAlbumKey(song),
          album: albumInfo,
          songs: songs,
          url: albumDetailUrlForSong(song) || albumUrl,
          nextOffset: r.nextOffset,
          hasMore: !!r.hasMore,
          total: r.total,
          loading: false,
        };
        if (!detailAlbumContext.albumKey && albumInfo) {
          detailAlbumContext.albumKey = (r.provider || songProviderKey(song)) + ':' + (albumInfo.albumId || albumInfo.id || albumInfo.albumMid || albumInfo.mid || albumTitle);
        }
        if (!detailAlbumGaplessUserTouched && typeof albumGaplessDefaultEnabledForContext === 'function') {
          detailAlbumGaplessEnabled = albumGaplessDefaultEnabledForContext(detailAlbumContext);
        }
        if (detailAlbumGaplessEnabled && typeof setAlbumGaplessPlaybackContext === 'function') {
          setAlbumGaplessPlaybackContext(true, detailAlbumContext);
        }
        var titleEl = document.getElementById('album-detail-title');
        var subEl = document.getElementById('album-detail-sub');
        if (titleEl && albumInfo.name) titleEl.textContent = albumInfo.name;
        if (subEl) subEl.textContent = (albumInfo.artist || song.artist || '未知歌手') + ' · ' + songSourceLabel(song);
        var metadataEl = document.getElementById('album-detail-metadata');
        if (metadataEl) metadataEl.innerHTML = detailRow('发行时间', albumInfo.publish_time) +
          detailRow('唱片公司', albumInfo.company) + detailRow('曲目数', r.total) +
          (albumInfo.description ? '<div class="detail-k">专辑简介</div><div class="detail-v"><details>' +
            '<summary>展开专辑简介</summary><div>' + escHtml(albumInfo.description) + '</div></details></div>' : '');
        var detailCover = body.querySelector('.detail-cover');
        var albumCover = albumInfo.cover || (songs[0] && songs[0].cover) || cover;
        if (detailCover && albumCover) {
          if (detailCover.tagName === 'IMG') detailCover.src = coverUrlWithSize(albumCover, 180);
          else {
            detailCover.style.backgroundImage = 'url("' + coverUrlWithSize(albumCover, 180).replace(/"/g, '\\"') + '")';
            detailCover.style.backgroundSize = 'cover';
            detailCover.style.backgroundPosition = 'center';
          }
        }
        if (target) target.innerHTML = renderAlbumDetailSongs();
        syncAlbumGaplessButton();
        bindTrackDetailScrollers();
      }).catch(function (error) {
        var target = document.getElementById('album-song-list');
        var message = error && error.name === 'AbortError' ? '专辑读取超时，请重新加载' : '';
        if (seq === trackDetailSeq && target) target.innerHTML = renderAlbumDetailLoadFailure(song,message);
        bindTrackDetailScrollers();
      });
    }
  } else if (type === 'artist') {
    var artistDetailUrl = artistDetailUrlForSong(song);
    var artistName = artists.join(' / ') || song.artist || '未知歌手';
    var artistInitial = artistName && artistName !== '未知歌手' ? artistName.slice(0, 1) : '歌';
    var artistCoverHtml = '<div id="artist-detail-cover" class="detail-cover detail-artist-avatar">' + escHtml(artistInitial) + '</div>';
    var artistEmptyText = '当前歌曲缺少可用的歌手或歌曲标识，请重新搜索后重试。';
    var artistLoadingText = '正在载入' + songSourceLabel(song) + '歌手主页...';
    detailArtistSongs = [];
    detailArtistContext = { song: song, url: artistDetailUrl, songs: [], nextOffset: 0, hasMore: false, loading: false, total: null };
    heading.textContent = '歌手详情';
    body.innerHTML =
      '<div class="detail-hero">' + artistCoverHtml +
      '<div style="min-width:0;flex:1"><div class="detail-title" id="artist-detail-title">' + escHtml(artistName) + '</div>' +
      '<div class="detail-sub">来自当前播放 · ' + escHtml(title) + '</div></div>' +
      '</div>' +
      '<div class="detail-grid">' +
      detailRow('当前歌曲', title) +
      detailRow('关联歌手', artistName) +
      detailRow('所属专辑', song.album || (song.type === 'podcast' ? (song.radioName || 'Podcast') : '未知')) +
      detailRow('来源', songSourceLabel(song)) +
      '</div>' +
      '<div class="detail-grid" id="artist-detail-profile"></div>' +
      '<div class="detail-chip-row">' + (artists.length ? artists.map(function (name) { return '<span class="detail-chip">' + escHtml(name) + '</span>'; }).join('') : '<span class="detail-chip">未知歌手</span>') + '</div>' +
      '<div class="detail-section"><div class="detail-section-head"><div class="detail-section-title" id="artist-songs-heading">热门歌曲</div></div><div id="artist-hot-songs">' + (artistDetailUrl ? '<div class="detail-loading">' + escHtml(artistLoadingText) + '</div>' : '<div class="detail-empty">' + escHtml(artistEmptyText) + '</div>') + '</div></div>';
    if (artistDetailUrl) {
      loadArtistDetailPage(seq);
    }
  } else {
    heading.textContent = '歌曲详情';
    var commentConfig = detailCommentsConfig(song);
    var detailCommentTitle = commentConfig ? commentConfig.title : (songSourceLabel(song) + '评论');
    var detailCanLoadComments = !!(commentConfig && commentConfig.readUrl);
    var detailEmptyText = detailCanLoadComments ? '暂无评论' : '当前平台暂无评论接口';
    body.innerHTML =
      '<div class="detail-hero">' + coverHtml +
      '<div style="min-width:0;flex:1"><div class="detail-title">' + escHtml(title) + '</div>' +
      '<div class="detail-sub">' + escHtml(song.artist || (song.type === 'local' ? '本地文件' : '未知歌手')) + '</div></div>' +
      '</div>' +
      '<div class="detail-grid">' +
      detailRow('歌曲名', title) +
      detailRow('歌手', song.artist || '未知歌手') +
      detailRow('专辑', song.album || (song.type === 'podcast' ? (song.radioName || 'Podcast') : '未知')) +
      detailRow('时长', songDurationLabel(song)) +
      detailRow('来源', songSourceLabel(song)) +
      '<div class="detail-k">歌词源</div><div class="detail-v" id="song-detail-lyric-source">正在读取平台歌词…</div>' +
      '</div>' +
      '<div class="detail-chip-row">' +
      '<span class="detail-chip">' + escHtml(songSourceLabel(song)) + '</span>' +
      (isSongLiked(song) ? '<span class="detail-chip">红心喜欢</span>' : '') +
      (getCustomCoverForSong(song) ? '<span class="detail-chip">自定义封面</span>' : '') +
      (hasCustomLyricForSong(song) ? '<span class="detail-chip">自定义歌词</span>' : '') +
      '</div>' +
      '<div id="song-detail-lyrics"></div>' +
      '<div class="detail-section"><div class="detail-section-head"><div class="detail-section-title">' + escHtml(detailCommentTitle) + '</div><span class="comment-current-source">当前音源</span></div>' +
      '<div id="song-comments" aria-live="polite">' + (detailCanLoadComments ? '<div class="detail-loading">正在载入评论...</div>' : '<div class="detail-empty">' + detailEmptyText + '</div>') + '</div></div>';
    loadDetailComments(song, seq);
    loadSongDetailLyricPanel(song, seq);
  }
  bindTrackDetailScrollers();
  openGsapModal(document.getElementById('track-detail-modal'));
}

function renderAlbumDetailLoadFailure(song, message) {
  return '<div class="detail-empty">'+escHtml(message || '专辑加载失败，请重试')+'</div>'+
    '<button type="button" class="detail-action-toggle" onclick="retryAlbumDetail()">重新加载</button>';
}

function retryAlbumDetail() {
  if (detailCommentSong) openTrackDetailModal('album',detailCommentSong);
}

function openArtistDetailForSong(song) {
  if (!song) { showToast('未找到歌手信息'); return; }
  openTrackDetailModal('artist', song);
}

function setCustomCoverForCurrent(dataUrl, opts) {
  if (!dataUrl) return;
  var song = currentCoverSong();
  var saved = false;
  var hasKey = false;
  if (song) {
    var key = songCustomCoverKey(song);
    song.customCover = dataUrl;
    if (key) {
      hasKey = true;
      customCoverMap[key] = dataUrl;
      saved = saveCustomCoverMap();
      for (var i = 0; i < playQueue.length; i++) {
        if (songCustomCoverKey(playQueue[i]) === key) playQueue[i].customCover = dataUrl;
      }
      if (currentLocalSong && songCustomCoverKey(currentLocalSong) === key) currentLocalSong.customCover = dataUrl;
    }
  }
  applyCoverDataUrl(dataUrl, opts);
  safeRenderQueuePanel('custom-cover-apply', { scrollCurrent: miniQueueOpen });
  safeShelfRebuild('custom-cover-apply');
  updateCustomCoverButton();
  showToast(song ? (!hasKey ? '封面已应用' : (saved ? '封面已保存' : '封面已应用，存储空间不足')) : '已应用临时封面');
}

function updateCustomCoverButton() {
  if (typeof syncOpenTrackDetailSong === 'function') syncOpenTrackDetailSong();
  var btn = document.getElementById('clear-cover-btn');
  var hasCover = !!getCustomCoverForSong(currentCoverSong());
  var area = document.getElementById('search-area');
  if (area) area.classList.toggle('has-cover-action', hasCover);
  if (!btn) return;
  btn.classList.toggle('has-cover', hasCover);
  btn.title = hasCover ? '取消自定义封面' : '当前没有自定义封面';
  btn.setAttribute('aria-label', btn.title);
}

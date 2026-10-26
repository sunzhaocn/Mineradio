'use strict';


function setLyricMotionStyle(style) {
  fx.lyricMotionStyle = normalizeLyricMotionStyle(style);
  updateLyricMotionStyleControls();
  refreshStageLyricDisplayMode();
  saveLyricLayout({ user: true, reason: 'lyricMotionStyle' });
  showToast('歌词动画已切换');
}

function setCustomLyricStatus(text, tone) {
  var el = document.getElementById('custom-lyric-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('good', tone === 'good');
  el.classList.toggle('fail', tone === 'fail');
}

function openCustomLyricModal() {
  var song = currentLyricSong();
  if (!song) {
    showToast('先播放或选择一首歌');
    return;
  }
  if (immersiveMode) setImmersiveMode(false);
  var entry = getCustomLyricEntry(song);
  var title = document.getElementById('custom-lyric-title');
  var sub = document.getElementById('custom-lyric-sub');
  var input = document.getElementById('custom-lyric-input');
  if (title) title.textContent = song.name || '当前歌曲';
  if (sub) sub.textContent = (song.artist || (song.type === 'podcast' ? 'Podcast' : '')) + (entry ? ' · 已保存自定义歌词' : ' · 可粘贴 LRC 或逐行输入');
  if (input) input.value = entry ? (entry.text || '') : '';
  setCustomLyricStatus(entry ? '已读取本地自定义歌词' : '提示：带 [00:12.00] 时间轴会更精准；纯文本会自动铺开', entry ? 'good' : '');
  openGsapModal(document.getElementById('custom-lyric-modal'));
  setTimeout(function () { if (input) input.focus(); }, 120);
}

function closeCustomLyricModal() {
  closeGsapModal(document.getElementById('custom-lyric-modal'));
}

function saveCustomLyricForCurrent() {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  var input = document.getElementById('custom-lyric-input');
  var text = input ? String(input.value || '').trim() : '';
  if (!song || !key) {
    setCustomLyricStatus('请先播放或选择一首歌', 'fail');
    showToast('先播放或选择一首歌');
    return;
  }
  if (!text) {
    setCustomLyricStatus('请输入歌词内容', 'fail');
    return;
  }
  var lines = parseCustomLyricText(text);
  if (!lines.length) {
    setCustomLyricStatus('没有识别到可显示的歌词行', 'fail');
    return;
  }
  customLyricMap[key] = { text: text, updatedAt: Date.now() };
  customLyricPrefs[key] = 'custom';
  var saved = saveCustomLyricMap();
  saveCustomLyricPrefs();
  applyCustomLyricState(song, true);
  setCustomLyricStatus(saved ? ('已保存 ' + lines.length + ' 行，并切换为自定义歌词') : '已应用，但本地存储空间不足', saved ? 'good' : 'fail');
  showToast(saved ? '自定义歌词已保存' : '自定义歌词已应用');
  setTimeout(function () { closeCustomLyricModal(); }, 520);
}

function deleteCustomLyricForCurrent() {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  if (!song || !key) {
    setCustomLyricStatus('请先播放或选择一首歌', 'fail');
    return;
  }
  if (!customLyricMap[key]) {
    setCustomLyricStatus('当前歌曲没有自定义歌词', 'fail');
    return;
  }
  delete customLyricMap[key];
  delete customLyricPrefs[key];
  saveCustomLyricMap();
  saveCustomLyricPrefs();
  applyOriginalLyricsState();
  var input = document.getElementById('custom-lyric-input');
  if (input) input.value = '';
  setCustomLyricStatus('已删除，恢复原歌词', 'good');
  showToast('已恢复原歌词');
}

function songAccountProvider(song) {
  if (!song || song.type === 'local' || song.type === 'podcast' || song.source === 'podcast') return 'local';
  if (typeof songProviderKey === 'function') return songProviderKey(song);
  if (song.provider === 'spotify' || song.source === 'spotify' || song.type === 'spotify' || song.spotifyId || song.spotifyUri) return 'spotify';
  if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') return 'qq';
  if (song.provider === 'qishui' || song.source === 'qishui' || song.type === 'qishui') return 'qishui';
  if (song.provider === 'kugou' || song.source === 'kugou' || song.type === 'kugou' || song.hash || song.audioHash) return 'kugou';
  return 'netease';
}

function songAccountAdapter(songOrProvider) {
  var provider = typeof songOrProvider === 'string' ? songOrProvider : songAccountProvider(songOrProvider);
  return SONG_ACCOUNT_ACTION_ADAPTERS[provider] || null;
}

function songAccountIdentityValues(song, provider) {
  song = song || {};
  provider = provider || songAccountProvider(song);
  var raw = [];
  if (provider === 'kugou') {
    raw = [song.hash, song.audioHash, song.fileHash, song.providerSongId, song.id];
  } else if (provider === 'spotify') {
    raw = [song.spotifyId, song.providerSongId, song.id];
    var uri = String(song.spotifyUri || song.uri || '');
    if (/^spotify:track:/i.test(uri)) raw.push(uri.split(':').pop());
  } else if (provider === 'qishui') {
    raw = [song.providerSongId, song.trackId, song.track_id, song.id];
  } else {
    raw = [song.id];
  }
  var seen = Object.create(null);
  return raw.map(function (value) {
    var normalized = String(value == null ? '' : value).trim();
    return provider === 'kugou' ? normalized.toLowerCase() : normalized;
  }).filter(function (value) {
    if (!value || seen[value]) return false;
    seen[value] = true;
    return true;
  });
}

function songAccountId(song, provider) {
  return songAccountIdentityValues(song, provider)[0] || '';
}

function songAccountStateKey(song) {
  var provider = songAccountProvider(song);
  var id = songAccountId(song, provider);
  return provider && id ? (provider + ':' + id) : '';
}

function playlistAccountProvider(playlist) {
  var provider = String(playlist && (playlist.provider || playlist.source) || '').toLowerCase();
  return /^(mineradio|netease|qq|kugou|qishui|spotify)$/.test(provider) ? provider : 'netease';
}

function songAccountLoginStatus(provider) {
  if (provider === 'spotify') return spotifyLoginStatus || {};
  if (provider === 'qishui') return qishuiLoginStatus || {};
  if (provider === 'kugou') return kugouLoginStatus || {};
  if (provider === 'qq') return qqLoginStatus || {};
  return loginStatus || {};
}

function isSongAccountLoggedIn(provider) {
  var status = songAccountLoginStatus(provider);
  if (provider === 'kugou') return !!(status.loggedIn && status.playbackKeyReady);
  if (provider === 'qishui') return !!(status.loggedIn && (status.webSession || status.cookieReady));
  return !!status.loggedIn;
}

function songAccountUnsupportedMessage(provider, action) {
  var adapter = songAccountAdapter(provider);
  if (adapter && adapter.readOnly) return adapter.label + '当前仅支持读取账号收藏，暂不支持写回';
  if (provider === 'qishui') return '汽水音乐当前会话暂不支持此账号操作';
  if (provider === 'local') return '本地文件暂不支持同步' + (action === 'collect' ? '到歌单' : '红心');
  return (adapter && adapter.label || '当前平台') + '暂不支持此操作';
}

function isCloudSong(song) {
  return !!(song && song.id && songAccountProvider(song) === 'netease');
}

function isSongLiked(song) {
  var key = songAccountStateKey(song);
  return !!(key && likedSongMap[key]);
}

function ensureLoggedInForAction(provider) {
  provider = provider || 'netease';
  if (isSongAccountLoggedIn(provider)) return true;
  var adapter = songAccountAdapter(provider);
  showToast('登录' + (adapter && adapter.label || '对应平台') + '后可同步账号收藏');
  showLoginModal({ provider: provider });
  return false;
}

function updateLikeButtons(song) {
  song = song || currentCoverSong();
  var liked = isSongLiked(song);
  var stateKey = songAccountStateKey(song);
  var busy = !!(stateKey && likeBusyMap[stateKey]);
  var btn = document.getElementById('heart-btn');
  if (btn) {
    btn.classList.toggle('liked', liked);
    btn.classList.toggle('busy', busy);
    btn.title = liked ? '取消红心' : '红心喜欢';
  }
  var collectBtn = document.getElementById('collect-btn');
  if (collectBtn) collectBtn.classList.toggle('busy', collectBusy);
}

function heartIconSvg() {
  return '<svg class="heart-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.45c-.32 0-.62-.12-.86-.34l-1.23-1.12C5.54 16.03 2.25 13.05 2.25 8.9 2.25 5.48 4.88 2.9 8.28 2.9c1.7 0 3.35.72 4.52 1.96C13.97 3.62 15.62 2.9 17.32 2.9c3.4 0 6.03 2.58 6.03 6 0 4.15-3.29 7.13-7.66 11.09l-1.23 1.12c-.24.22-.54.34-.86.34z"/></svg>';
}

function playlistPlusIconSvg() {
  return '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10"/><path d="M4 11h10"/><path d="M4 16h7"/><path d="M18 14v6"/><path d="M15 17h6"/></svg>';
}

function artistCollectTrayIconSvg() {
  return '<svg fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v9"/><path d="M7.5 9.5h9"/><path d="M4.5 12.5v6h15v-6"/></svg>';
}

function artistNextPlusIconSvg() {
  return '<svg fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13"/><path d="M5.5 12h13"/></svg>';
}

function songActionHtml(kind, source, index, song) {
  var liked = isSongLiked(song);
  if (kind === 'like') {
    return '<button class="song-action-btn' + (liked ? ' liked' : '') + '" title="' + (liked ? '取消红心' : '红心喜欢') + '" onclick="event.stopPropagation();toggleLike' + source + '(' + index + ')">' + heartIconSvg() + '</button>';
  }
  return '<button class="song-action-btn" title="收藏到歌单" onclick="event.stopPropagation();collect' + source + '(' + index + ')">' + playlistPlusIconSvg() + '</button>';
}

function syncLikeStatusForSongs(songs) {
  if (!songs || !songs.length) return;
  var groups = Object.create(null);
  songs.forEach(function (song) {
    var provider = songAccountProvider(song);
    var adapter = songAccountAdapter(provider);
    var id = songAccountId(song, provider);
    if (!adapter || !adapter.like || !adapter.likeCheckUrl || !id || !isSongAccountLoggedIn(provider)) return;
    if (!groups[provider]) groups[provider] = { adapter: adapter, ids: [], seen: Object.create(null) };
    if (groups[provider].seen[id]) return;
    groups[provider].seen[id] = true;
    groups[provider].ids.push(id);
  });
  var providers = Object.keys(groups);
  if (!providers.length) return;
  var token = ++likeStatusToken;
  var requests = [];
  providers.forEach(function (provider) {
    var group = groups[provider];
    var batchSize = provider === 'spotify' || provider === 'qishui' ? 40 : (provider === 'kugou' ? 50 : 200);
    for (var offset = 0; offset < group.ids.length; offset += batchSize) {
      (function (batchIds) {
        var url = group.adapter.likeCheckUrl + '?' + group.adapter.likeCheckParam + '=' + encodeURIComponent(batchIds.join(','));
        requests.push(apiJson(url).then(function (r) {
          if (token < likeStatusToken - 3 || !r || !r.liked) return;
          var responseLiked = r.liked || {};
          batchIds.forEach(function (id) {
            var responseId = provider === 'kugou' ? String(id).toLowerCase() : String(id);
            var liked = responseLiked[responseId];
            if (liked == null) liked = responseLiked[id];
            if (liked == null) return;
            if (provider === 'qishui' && r.complete === false && !liked) return;
            likedSongMap[provider + ':' + responseId] = !!liked;
          });
        }).catch(function (err) {
          console.warn(provider + ' like check failed:', err);
        }));
      })(group.ids.slice(offset, offset + batchSize));
    }
  });
  Promise.all(requests).then(function () {
    if (token < likeStatusToken - 3) return;
    safeRenderQueuePanel('like-status-sync', { scrollCurrent: miniQueueOpen });
    if ($results && $results.classList.contains('show')) refreshSearchResultActionStates();
    updateLikeButtons();
  });
}

function syncLikeStatusForSong(song) {
  var adapter = songAccountAdapter(song);
  if (!adapter || !adapter.like) { updateLikeButtons(song); return; }
  syncLikeStatusForSongs([song]);
}

function isLikedPlaylistContext(id, title, meta) {
  var rawId = String(id || '');
  var idParts = rawId.match(/^(netease|qq|kugou|qishui|spotify):(.*)$/);
  var provider = idParts ? idParts[1] : playlistAccountProvider(meta);
  var sid = idParts ? idParts[2] : rawId;
  var text = String(title || (meta && meta.name) || '').trim();
  var hit = userPlaylists.find(function (pl) {
    return playlistAccountProvider(pl) === provider && String(pl.id || '') === sid;
  });
  if (hit) {
    if (Number(hit.specialType || 0) === 5) return true;
    text = text || hit.name || '';
  }
  return /我喜欢|喜欢的音乐|liked/i.test(text);
}

function markSongsLiked(songs, liked) {
  (songs || []).forEach(function (song) {
    var key = songAccountStateKey(song);
    if (key) likedSongMap[key] = !!liked;
  });
}

function refreshSearchResultActionStates() {
  if (!playlist || !$results || !$results.children.length) return;
  Array.prototype.forEach.call($results.querySelectorAll('[data-like-index]'), function (btn) {
    var i = Number(btn.getAttribute('data-like-index'));
    var song = playlist[i];
    var liked = isSongLiked(song);
    btn.classList.toggle('liked', liked);
    btn.title = liked ? '取消红心' : '红心喜欢';
  });
}

async function toggleLikeSong(song) {
  var provider = songAccountProvider(song);
  var adapter = songAccountAdapter(provider);
  if (!adapter || !adapter.like || !adapter.likeUrl) {
    showToast(songAccountUnsupportedMessage(provider, 'like'));
    return;
  }
  if (!ensureLoggedInForAction(provider)) return;
  var id = songAccountId(song, provider);
  var stateKey = songAccountStateKey(song);
  if (!id || !stateKey) {
    showToast('当前歌曲缺少' + adapter.label + '歌曲标识');
    return;
  }
  if (likeBusyMap[stateKey]) return;
  var next = !likedSongMap[stateKey];
  likeBusyMap[stateKey] = true;
  likedSongMap[stateKey] = next;
  updateLikeButtons(song);
  safeRenderQueuePanel('like-toggle-optimistic', { scrollCurrent: miniQueueOpen });
  refreshSearchResultActionStates();
  try {
    var r = await apiJson(adapter.likeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, like: next, song: song })
    });
    if (r && (r.error || r.success === false)) throw new Error(r.error || r.message || 'LIKE_FAILED');
    likedSongMap[stateKey] = r && r.liked != null ? !!r.liked : next;
    showToast(next ? '已加入红心喜欢' : '已取消红心');
  } catch (err) {
    likedSongMap[stateKey] = !next;
    var errorText = String(err && err.message || '');
    if (/SCOPE|PERMISSION/i.test(errorText)) {
      showToast('当前授权缺少收藏写入权限，请重新授权');
    } else if (/LOGIN_REQUIRED|AUTH_REQUIRED/i.test(errorText)) {
      showToast(adapter.label + '登录状态已失效，请重新登录');
    } else {
      showToast(errorText ? ('红心操作失败: ' + errorText) : '红心操作失败');
    }
  } finally {
    delete likeBusyMap[stateKey];
    updateLikeButtons(song);
    safeRenderQueuePanel('like-toggle-final', { scrollCurrent: miniQueueOpen });
    refreshSearchResultActionStates();
  }
}

function toggleLikeCurrent() { toggleLikeSong(currentCoverSong()); }

function toggleLikeSearchResult(i) { if (playlist[i]) toggleLikeSong(playlist[i]); }

function toggleLikeQueueIndex(i) { if (playQueue[i]) toggleLikeSong(playQueue[i]); }

function toggleLikeDetailSong(song) { toggleLikeSong(song); }
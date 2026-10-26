'use strict';


function openCollectModal(song) {
  if (!song) return;
  collectTargetSong = song;
  renderCollectModal();
  openGsapModal(document.getElementById('collect-modal'));
  var provider = songAccountProvider(song);
  var refresh = isSongAccountLoggedIn(provider) && typeof refreshUserPlaylists === 'function'
    ? refreshUserPlaylists(true)
    : (typeof refreshBuiltInPlaylists === 'function' ? refreshBuiltInPlaylists(true) : Promise.resolve());
  Promise.resolve(refresh).then(function () { renderCollectModal(); }).catch(function () { renderCollectModal(); });
}

function openCollectModalForCurrent() { openCollectModal(currentCoverSong()); }

function collectSearchResult(i) { if (playlist[i]) openCollectModal(playlist[i]); }

function collectQueueIndex(i) { if (playQueue[i]) openCollectModal(playQueue[i]); }

function collectDetailSong(song) { openCollectModal(song); }

function closeCollectModal() {
  closeGsapModal(document.getElementById('collect-modal'), function () {
    collectTargetSong = null;
    var input = document.getElementById('collect-new-name');
    if (input) input.value = '';
  });
}

function renderCollectModal() {
  var current = document.getElementById('collect-current');
  var list = document.getElementById('collect-list');
  if (!current || !list) return;
  var song = collectTargetSong || {};
  var cover = songCoverSrc(song, 80);
  current.innerHTML = (cover ? '<img src="' + cover + '" alt="">' : '<div class="cover-placeholder"></div>') +
    '<div style="min-width:0"><div class="collect-title">' + escHtml(song.name || '当前歌曲') + '</div><div class="collect-sub">' + escHtml(song.artist || '') + '</div></div>';
  var provider = songAccountProvider(song);
  var adapter = songAccountAdapter(provider);
  var localRows = (builtInPlaylists || []).filter(function (pl) { return !pl.readonly; }).map(function (pl) {
    var thumb = pl.cover ? coverUrlWithSize(pl.cover, 80) : '';
    return '<div class="collect-item" data-collect-key="builtin:' + escHtml(String(pl.id || '')) + '" onclick="addCollectTargetToBuiltInPlaylist(this.getAttribute(\'data-built-in-pid\'))" data-built-in-pid="' + escHtml(String(pl.id || '')) + '">' +
      (thumb ? '<img src="' + thumb + '" alt="">' : '<div class="cover-placeholder built-in">MR</div>') +
      '<div style="min-width:0"><div class="collect-title">' + escHtml(pl.name || '') + '</div><div class="collect-sub">' + (pl.trackCount || 0) + ' 首 · 可混合全部平台</div></div>' +
      '</div>';
  }).join('');
  var html = '<div class="collect-section-title"><span>Mineradio 内置歌单</span><small>保存在本机，不受平台账号限制</small></div>' +
    (localRows || '<div class="collect-empty compact">还没有内置歌单，在上方输入名称即可创建</div>');
  var canWritePlatform = !!(adapter && adapter.collect && adapter.playlistAddUrl && isSongAccountLoggedIn(provider));
  if (canWritePlatform) {
    var mine = userPlaylists.filter(function (pl) {
      return playlistAccountProvider(pl) === provider && !pl.subscribed && !pl.virtual && !pl.readonly;
    });
    if (mine.length) {
      html += '<div class="collect-section-title secondary"><span>同步到' + escHtml(adapter.label) + '</span><small>写入当前平台账号</small></div>' + mine.map(function (pl) {
        var thumb = pl.cover ? coverUrlWithSize(pl.cover, 80) : '';
        return '<div class="collect-item" data-collect-key="platform:' + escHtml(String(pl.id || '')) + '" data-collect-pid="' + escHtml(String(pl.id || '')) + '" onclick="addCollectTargetToPlaylist(this.getAttribute(\'data-collect-pid\'))">' +
          (thumb ? '<img src="' + thumb + '" alt="">' : '<div class="cover-placeholder"></div>') +
          '<div style="min-width:0"><div class="collect-title">' + escHtml(pl.name || '') + '</div><div class="collect-sub">' + (pl.trackCount || 0) + ' 首</div></div>' +
          '</div>';
      }).join('');
    }
  }
  list.innerHTML = html;
  if (window.gsap) animateListItems(list, '.collect-item', { x: 0, y: 6, stagger: 0.012, duration: 0.18, limit: 18 });
}

function setCollectBusyPid(pid, busy, kind) {
  var list = document.getElementById('collect-list');
  if (!list) return;
  var key = (kind || 'platform') + ':' + String(pid);
  list.querySelectorAll('.collect-item').forEach(function (item) {
    item.classList.toggle('busy', !!busy && item.getAttribute('data-collect-key') === key);
  });
}

async function createPlaylistFromCollect() {
  var input = document.getElementById('collect-new-name');
  var name = input ? input.value.trim() : '';
  if (!name) { showToast('先输入歌单名称'); return; }
  try {
    var created = await createBuiltInPlaylist(name, collectTargetSong);
    if (!created) return;
    if (input) input.value = '';
    closeCollectModal();
  } catch (err) {
    console.warn('[BuiltInPlaylistCreateCollect]', err);
    showToast('创建内置歌单失败');
  }
}

async function addCollectTargetToBuiltInPlaylist(pid) {
  if (collectBusy || !collectTargetSong || !pid) return;
  collectBusy = true;
  setCollectBusyPid(pid, true, 'builtin');
  try {
    var added = await addTrackToBuiltInPlaylist(pid, collectTargetSong);
    if (added) closeCollectModal();
  } catch (err) {
    console.warn('[BuiltInPlaylistCollect]', err);
    showToast('加入内置歌单失败');
  } finally {
    collectBusy = false;
    setCollectBusyPid(pid, false, 'builtin');
  }
}

function collectResultMessage(r) {
  if (!r) return '收藏失败';
  var msg = r.error || r.message || r.msg || '';
  if (/LOGIN_REQUIRED|AUTH_REQUIRED/i.test(String(msg))) return '平台登录状态已失效，请重新登录';
  if (/SCOPE|PERMISSION/i.test(String(msg))) return '当前授权缺少收藏写入权限，请重新授权';
  if (/exist|重复|已存在|already/i.test(String(msg))) return '歌曲已在歌单中';
  return msg ? ('收藏失败: ' + msg) : '收藏失败';
}

function playlistTracksPageUrl(adapter, pid, offset, limit) {
  var url = adapter.playlistTracksUrl + '?id=' + encodeURIComponent(pid);
  if (limit) url += '&limit=' + encodeURIComponent(String(limit));
  if (offset) url += '&offset=' + encodeURIComponent(String(offset));
  return url;
}

function playlistContainsAccountSong(tracks, song, provider) {
  var expected = songAccountIdentityValues(song, provider);
  if (!expected.length) return false;
  var expectedSet = Object.create(null);
  expected.forEach(function (id) { expectedSet[id] = true; });
  return (tracks || []).some(function (track) {
    return songAccountIdentityValues(track, provider).some(function (id) { return !!expectedSet[id]; });
  });
}

async function verifySongInPlaylist(pid, song) {
  var provider = songAccountProvider(song);
  var adapter = songAccountAdapter(provider);
  if (!pid || !adapter || !adapter.playlistTracksUrl || !songAccountId(song, provider)) return false;
  var pageLimit = provider === 'spotify' || provider === 'qishui' ? 50 : 200;
  for (var attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      await new Promise(function (resolve) { setTimeout(resolve, attempt === 1 ? 360 : 820); });
    }
    try {
      var detail = await apiJson(playlistTracksPageUrl(adapter, pid, 0, pageLimit));
      var tracks = (detail && detail.tracks) || [];
      if (playlistContainsAccountSong(tracks, song, provider)) return true;
      var total = Math.max(0, Number(detail && (detail.total || (detail.playlist && detail.playlist.trackCount))) || 0);
      var lastOffset = total > pageLimit ? Math.max(0, total - pageLimit) : 0;
      if (lastOffset) {
        var lastPage = await apiJson(playlistTracksPageUrl(adapter, pid, lastOffset, pageLimit));
        if (playlistContainsAccountSong((lastPage && lastPage.tracks) || [], song, provider)) return true;
      }
    } catch (e) {
      console.warn(provider + ' collect verify failed:', e);
    }
  }
  return false;
}

async function addCollectTargetToPlaylist(pid) {
  if (collectBusy || !collectTargetSong || !pid) return;
  var targetSong = collectTargetSong;
  var provider = songAccountProvider(targetSong);
  var adapter = songAccountAdapter(provider);
  if (!adapter || !adapter.collect || !adapter.playlistAddUrl) {
    showToast(songAccountUnsupportedMessage(provider, 'collect'));
    return;
  }
  if (!ensureLoggedInForAction(provider)) return;
  collectBusy = true;
  setCollectBusyPid(pid, true);
  updateLikeButtons();
  showToast('正在收藏到歌单...');
  try {
    var songId = songAccountId(targetSong, provider);
    if (!songId) throw new Error('当前歌曲缺少' + adapter.label + '歌曲标识');
    var r = await apiJson(adapter.playlistAddUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid: pid, id: songId, song: targetSong })
    });
    if (!r || r.error || r.success === false) throw new Error(collectResultMessage(r));
    showToast('已收藏到歌单');
    closeCollectModal();
    refreshUserPlaylists(true);
    setTimeout(function () {
      verifySongInPlaylist(pid, targetSong).then(function (ok) {
        if (!ok) console.warn(provider + ' collect submitted but verify did not find song yet:', pid, songId);
      });
    }, 900);
  } catch (err) {
    showToast(err && err.message ? err.message : '收藏失败');
  } finally {
    collectBusy = false;
    setCollectBusyPid(pid, false);
    updateLikeButtons();
  }
}

function cloneSong(song) { return hydrateCustomCover(Object.assign({}, song)); }

function avatarSrc(url) {
  if (!url) return '';
  return coverProxySrc(url, true);
}

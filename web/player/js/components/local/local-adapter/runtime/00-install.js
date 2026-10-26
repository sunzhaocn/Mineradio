'use strict';

/* Mineradio 本机网页版适配。保留上游渲染、动效、搜索、队列和歌词实现。
 * 仅替换桌面桥接与账号依赖：音乐由本机 API 提供，收藏写入当前浏览器。
 * 原作 GPL-3.0，来源和修改范围见根目录 LOCAL-ADAPTATION.md。
 */
(function () {
  'use strict';
  window.MINERADIO_LOCAL_WEB = true;
  var assetChecks = new Map();
  window.checkClientPlatformAssets = function (provider) {
    provider = provider === 'qqmusic' ? 'qq' : provider;
    if (['all', 'netease', 'qq', 'kugou', 'qishui'].indexOf(provider) < 0) return Promise.resolve();
    if (assetChecks.has(provider)) return assetChecks.get(provider);
    var task = fetch('/api/client/assets/check', { method:'POST', credentials:'omit',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({provider:provider}) })
      .catch(function () {}).finally(function () { assetChecks.delete(provider); });
    assetChecks.set(provider, task);
    return task;
  };
  var STORE = 'mineradio-web-library-v1';
  var saved;
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (_) { saved = {}; }
  var localLists = Array.isArray(saved.playlists) ? saved.playlists : [];
  var savedLocalTracks = [];
  var favorites = Array.isArray(saved.favorites) ? saved.favorites : [];
  var favoriteImports = saved.favoriteImports && typeof saved.favoriteImports === 'object' && !Array.isArray(saved.favoriteImports) ? saved.favoriteImports : {};
  var favoriteRemovals = Array.isArray(saved.favoriteRemovals) ? saved.favoriteRemovals : [];
  var favoriteListeners = new Set();
  var favoriteTools=window.webFavoriteTools;
  // 沿用原存储键，旧的多平台重复红心合为一首，同时保留每个平台的原歌曲资料。
  var oldFavorites=JSON.stringify(favorites);
  favorites=favoriteTools.deduplicate(favorites);
  window.webLocalLibrary = {
    favorites: function () { return favorites.map(cloneSong); },
    subscribeFavorites: function (handler) {
      favoriteListeners.add(handler); return function () { favoriteListeners.delete(handler); };
    },
    findImportedPlaylist: function (sourceKey) {
      var list = localLists.find(function (item) { return item.importSource === sourceKey; });
      return list ? listRow(list) : null;
    },
    importPlaylist: function (name, tracks, sourceKey, metadata) {
      if (metadata && (metadata.isLiked === true || metadata.kind === 'liked')) return importFavoriteTracks(tracks, sourceKey);
      var existing = localLists.find(function (item) { return item.importSource === sourceKey; });
      if (existing) return { duplicate: true, playlist: listRow(existing) };
      var list = { id: 'local:' + Date.now() + ':' + Math.random().toString(36).slice(2, 7),
        name: String(name || '导入的歌单'), tracks: (tracks || []).map(cloneSong), importSource: sourceKey };
      localLists.push(list);
      if (!persist()) { localLists.pop(); throw new Error('浏览器空间不足，未能保存导入歌单'); }
      publishLists(); return { duplicate: false, playlist: listRow(list) };
    },
    migrateImportedLikes: migrateImportedLikes
  };
  if (oldFavorites!==JSON.stringify(favorites)) persist();
  var catalog = [], catalogPromise = null, catalogUpdatedAt = 0, discoverPromise = null, discoverTask = null;
  var dailyPlayPromise = null, dailyPlayPending = false, dailyPlayTask = null;
  var DAILY_STORE = 'mineradio-web-daily-v1', DAILY_LIMIT = 30, DAILY_CANDIDATE_LIMIT = 120, dailyDay = '';
  var dailyCandidates = [], dailyCheckedContext = '', dailyCheckedUntil = 0;

  function dailyContextKey() {
    return typeof homeRecommendationContextKey === 'function' ? homeRecommendationContextKey() : '';
  }
  function dailyNeedsValidation() {
    return !!dailyCandidates.length && (dailyCheckedContext !== dailyContextKey() || Date.now() >= dailyCheckedUntil);
  }
  function pruneExpiredDailyRecommendations() {
    if (typeof cachedHomePlayableRecommendation !== 'function') return;
    var fresh = homeDiscoverState.songs.filter(function (song) {
      var checked = cachedHomePlayableRecommendation(song);
      return !!(checked && checked.song);
    });
    if (fresh.length === homeDiscoverState.songs.length) return;
    homeDiscoverState.songs = fresh;
    homeDiscoverState.loaded = false;
    dailyCheckedUntil = 0;
    publishLists();
  }
  function invalidateDailyVerification() {
    if (discoverTask && discoverTask.controller) discoverTask.controller.abort();
    discoverTask = null; discoverPromise = null;
    dailyCheckedContext = ''; dailyCheckedUntil = 0;
    homeDiscoverState.songs = []; homeDiscoverState.loaded = false; homeDiscoverState.loading = false;
  }

  function dailyDateKey() {
    var date = new Date(Date.now());
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function dailyPlaylist() {
    return { id:'local:daily', name:'每日精选 · ' + dailyDay, readonly:true,
      tracks:homeDiscoverState.songs || [] };
  }
  function ensureDailyDate() {
    var day = dailyDateKey();
    if (dailyDay === day) return;
    dailyDay = day;
    invalidateDailyVerification();
    dailyCandidates = [];
    homeDiscoverState.songs = []; homeDiscoverState.playlists = []; homeDiscoverState.podcasts = [];
    homeDiscoverState.loaded = false; homeDiscoverState.loading = false;
    homeDiscoverState.error = ''; homeDiscoverState.partial = false;
    try {
      var snapshot = JSON.parse(localStorage.getItem(DAILY_STORE) || 'null');
      if (!snapshot || snapshot.day !== day) return;
      var savedSongs = Array.isArray(snapshot.candidates) ? snapshot.candidates : snapshot.songs;
      if (!Array.isArray(savedSongs)) return;
      var songs = savedSongs.filter(function (song) { return song && typeof song === 'object'; }).slice(0, DAILY_CANDIDATE_LIMIT);
      // Freeze the day's candidate order, then recheck it in this client's
      // current account/quality context before exposing any saved song.
      if (!songs.length) return;
      dailyCandidates = songs.map(cloneSong);
      homeDiscoverState.playlists = Array.isArray(snapshot.playlists) ? snapshot.playlists : [];
      homeDiscoverState.mode = 'charts';
      homeDiscoverState.partial = snapshot.partial === true;
      homeDiscoverState.updatedAt = snapshot.updatedAt || 0;
    } catch (_) {}
  }
  function saveDailyPlaylist() {
    if (!dailyCandidates.length) return;
    try {
      localStorage.setItem(DAILY_STORE, JSON.stringify({ day:dailyDay, candidates:dailyCandidates, songs:homeDiscoverState.songs,
        playlists:homeDiscoverState.playlists, partial:homeDiscoverState.partial,
        updatedAt:homeDiscoverState.updatedAt }));
    } catch (_) { showToast('今日精选已生成，但浏览器空间不足，未能保存今日歌单'); }
  }

  function playbackIntentToken() {
    return typeof trackSwitchToken === 'number' ? trackSwitchToken : null;
  }
  function releaseDailyTask(task) {
    if (dailyPlayTask !== task) return;
    dailyPlayTask = null;
    dailyPlayPending = false;
    dailyPlayPromise = null;
    renderHomeDashboard();
  }
  function cancelDailyTask(task) {
    if (!task || task.cancelled) return;
    task.cancelled = true;
    task.cancel(false);
    releaseDailyTask(task);
  }
  if (window.addEventListener) window.addEventListener('mineradio:playback-intent', function (event) {
    var task = dailyPlayTask;
    // The daily task marks its own queue dispatch before playQueueAt emits the
    // event. Any other selection owns playback immediately, even if an old
    // recommendation or media request has not returned yet.
    if (!task || task.dispatching) return;
    var token = event && event.detail && event.detail.token;
    if (task.phase === 'preparing' || token !== task.playbackToken) cancelDailyTask(task);
  });

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify({ playlists: localLists, favorites: favorites, favoriteImports: favoriteImports, favoriteRemovals: favoriteRemovals })); return true; }
    catch (_) { showToast('浏览器存储已满，无法保存歌单'); return false; }
  }
  function identity(song) { return songProviderKey(song) + ':' + (song.mid || song.hash || song.id || ''); }
  function listRow(list) {
    return { id: list.id, name: list.name, cover: list.tracks[0] && list.tracks[0].cover || '',
      trackCount: list.tracks.length, provider: 'mineradio', source: 'mineradio', builtin: true,
      creator: '本机歌单', shelfPane: 'mine', readonly: list.readonly === true || list.id === 'local:favorites' };
  }
  function importFavoriteTracks(tracks, sourceKey, automatic) {
    var previous = favorites, previousRemovals = favoriteRemovals, oldMarker = favoriteImports[sourceKey];
    var incoming = (tracks || []).map(cloneSong);
    if (automatic) incoming = incoming.filter(function (song) {
      return !favoriteRemovals.some(function (removed) { return favoriteTools.sameSong(removed, song); });
    });
    else favoriteRemovals = favoriteRemovals.filter(function (removed) {
      return !incoming.some(function (song) { return favoriteTools.sameSong(removed, song); });
    });
    var merged = favoriteTools.deduplicate(favorites.concat(incoming));
    var changed = JSON.stringify(merged) !== JSON.stringify(previous);
    var removalsChanged = favoriteRemovals.length !== previousRemovals.length;
    var markerChanged = !oldMarker || oldMarker.version !== 1;
    favorites = merged;
    // Save the one-time source marker and local unlike records together. A
    // later platform's first migration must also respect deliberate unlikes.
    favoriteImports[sourceKey] = { version: 1 };
    if ((changed || markerChanged || removalsChanged) && !persist()) {
      favorites = previous; favoriteRemovals = previousRemovals;
      if (oldMarker) favoriteImports[sourceKey] = oldMarker; else delete favoriteImports[sourceKey];
      throw new Error('浏览器空间不足，未能保存导入的喜欢');
    }
    if (changed) refreshFavoriteViews();
    return { destination: 'favorites', duplicate: !changed, added: merged.length - previous.length,
      total: merged.length, importedCount: (tracks || []).length,
      playlist: listRow({ id: 'local:favorites', name: '我喜欢的音乐', tracks: favorites }) };
  }
  function migrateImportedLikes(rows) {
    var confirmed = new Set((rows || []).filter(function (row) { return row && (row.isLiked === true || row.kind === 'liked'); })
      .map(function (row) { return (row.provider === 'qqmusic' ? 'qq' : row.provider) + ':' + String(row.id); }));
    var groups = new Map(), summary = { migrated: 0, added: 0 };
    localLists.forEach(function (list) {
      var key = list.importSource;
      if (!key || !confirmed.has(key) || favoriteImports[key] && favoriteImports[key].version === 1) return;
      groups.set(key, (groups.get(key) || []).concat(Array.isArray(list.tracks) ? list.tracks : []));
    });
    groups.forEach(function (tracks, key) {
      var result = importFavoriteTracks(tracks, key, true); summary.migrated += 1; summary.added += result.added;
    });
    return summary;
  }
  function publishLists() {
    builtInPlaylists = [listRow({id:'local:favorites', name:'我喜欢的音乐', tracks:favorites})]
      .concat([Object.assign(listRow({id:'local:saved', name:'本机已保存的音乐', tracks:savedLocalTracks}), { readonly:true })])
      .concat(dailyDay === dailyDateKey() && homeDiscoverState.songs.length ? [listRow(dailyPlaylist())] : [], localLists.map(listRow), catalog);
    rebuildUserPlaylistsFromCatalog({ preserveScroll:true, reason:'web-catalog' });
  }
  builtInPlaylistApiAvailable = function () { return true; };
  refreshBuiltInPlaylists = function (force) {
    if (!force && catalogUpdatedAt && Date.now() - catalogUpdatedAt < 60000) return Promise.resolve(true);
    // 本机数据不依赖榜单网络；启动、离线刷新和请求失败时都先显示已保存内容。
    publishLists();
    if (catalogPromise) return catalogPromise;
    var request=Promise.resolve().then(function () {
      return apiJson('/api/local/catalog',{timeoutMs:8000});
    }).then(function (data) {
      if (!data || !Array.isArray(data.playlists)) throw new Error('LOCAL_CATALOG_INVALID');
      catalog=data.playlists;catalogUpdatedAt=Date.now();publishLists();return true;
    }).catch(function () {
      publishLists();showToast('榜单暂时不可用，本机歌单仍可使用');return false;
    }).finally(function () { if (catalogPromise===request) catalogPromise=null; });
    catalogPromise=request;return request;
  };
  builtInPlaylistTracksPage = async function (id, options) {
    options = options || {};
    if (id === 'local:saved') await reloadSavedMusic();
    if (String(id).indexOf('chart:') === 0) {
      return apiJson('/api/local/tracks?id=' + encodeURIComponent(id) + '&offset=' + (options.offset || 0) + '&limit=' + (options.limit || 100));
    }
    if (id === 'local:daily') await loadHomeDiscover(false);
    var list = id === 'local:favorites' ? { tracks:favorites } : id === 'local:saved' ? { tracks:savedLocalTracks } : id === 'local:daily' ? dailyPlaylist() : localLists.find(function (item) { return item.id === id; });
    var tracks = list ? list.tracks : [], offset = Number(options.offset) || 0, limit = Number(options.limit) || 100;
    return { ok:true, tracks:tracks.slice(offset, offset + limit), total:tracks.length,
      hasMore:offset + limit < tracks.length, nextOffset:Math.min(offset + limit, tracks.length) };
  };
  createBuiltInPlaylist = async function (name, track) {
    if (!String(name || '').trim()) return null;
    var list = { id:'local:' + Date.now(), name:String(name).trim(), tracks:track ? [cloneSong(track)] : [] };
    localLists.push(list); persist(); publishLists(); showToast('歌单已保存在浏览器中');
    return listRow(list);
  };
  addTrackToBuiltInPlaylist = async function (id, song) {
    var list = localLists.find(function (item) { return item.id === id; });
    if (!list) { showToast('榜单只供浏览，请创建自己的歌单'); return false; }
    if (list.tracks.some(function (s) { return identity(s) === identity(song); })) return 'duplicate';
    list.tracks.push(cloneSong(song)); persist(); publishLists(); showToast('已加入歌单'); return true;
  };
  function synchronizeLocalPlaylistDetail(list) {
    var detail=typeof playlistPanelDetailState==='object' && playlistPanelDetailState;
    if (!detail || detail.key!=='mineradio:'+list.id) return false;
    detail.token=(Number(detail.token)||0)+1;
    if (detail.controller) detail.controller.abort();
    if (detail.warmTimer) clearTimeout(detail.warmTimer);
    detail.controller=null;detail.warmTimer=0;
    detail.tracks=list.tracks.map(cloneSong);detail.total=list.tracks.length;detail.nextOffset=list.tracks.length;
    detail.hasMore=false;detail.loading=false;detail.loadingMore=false;detail.error='';detail.message='';
    detail.playlist=Object.assign({},detail.playlist,listRow(list));
    return true;
  }
  function requestLocalPlaylistName(currentName, heading) {
    return window.mineradioDialogs.prompt({
      idPrefix:'web-local-playlist-name', title:heading || '重命名歌单',
      description:'为你的音乐收藏起个名字。', value:String(currentName || ''),
      label:'歌单名称', emptyMessage:'请输入歌单名称', confirmText:'保存',
      returnFocusSelector:'[data-pl-detail-rename], #collect-btn'
    });
  }
  removeTrackFromBuiltInPlaylist = async function (id, index) {
    var list = localLists.find(function (item) { return item.id === id; });
    index=Number(index);
    if (!list || !Number.isInteger(index) || index<0 || index>=list.tracks.length) return false;
    var previous=list.tracks;list.tracks=list.tracks.slice();list.tracks.splice(index,1);
    if (!persist()) { list.tracks=previous;return false; }
    var expanded=synchronizeLocalPlaylistDetail(list);
    publishLists();
    if (expanded && typeof renderPlaylistPanelDetailState==='function') renderPlaylistPanelDetailState();
    return true;
  };
  renameBuiltInPlaylist = async function (id, name) {
    var list = localLists.find(function (item) { return item.id === id; });
    if (!list) { showToast('平台榜单不能重命名'); return false; }
    var next = await requestLocalPlaylistName(name || list.name);
    if (!next) return false;
    list=localLists.find(function (item) { return item.id===id; });
    if (!list) return false;
    var previous=list.name;list.name=next;
    if (!persist()) { list.name=previous;return false; }
    var expanded=synchronizeLocalPlaylistDetail(list);
    publishLists();
    if (expanded && typeof renderPlaylistPanelDetailState==='function') renderPlaylistPanelDetailState();
    return true;
  };
  window.promptCreateBuiltInPlaylist=async function () {
    var name=await requestLocalPlaylistName('我的歌单','新建歌单');
    return name ? createBuiltInPlaylist(name) : null;
  };
  deleteBuiltInPlaylist = async function (id) {
    var list=localLists.find(function (item) { return item.id === id; });
    if (!list) { showToast('平台榜单不能删除'); return false; }
    var confirmed=await window.mineradioDialogs.confirm({
      title:'删除歌单', description:'确定删除“'+list.name+'”？\n只移除这个歌单，歌曲文件和平台收藏会保留。',
      confirmText:'删除歌单', destructive:true
    });
    if (!confirmed) return false;
    var previous=localLists;localLists=localLists.filter(function (item) { return item.id !== id; });
    if (!persist()) { localLists=previous;return false; }
    var detail=typeof playlistPanelDetailState==='object' && playlistPanelDetailState;
    if (detail && detail.key==='mineradio:'+id) {
      if (typeof cancelPlaylistPanelDetailRequest==='function') cancelPlaylistPanelDetailRequest();
      detail.key='';detail.tracks=[];detail.playlist=null;
    }
    publishLists();return true;
  };
  isSongLiked = function (song) { return !!song && favorites.some(function (item) { return favoriteTools.sameSong(item,song); }); };
  syncLikeStatusForSongs = function () {};
  function refreshFavoriteViews() {
    var detail=typeof playlistPanelDetailState==='object' && playlistPanelDetailState;
    if (detail && detail.key==='mineradio:local:favorites') {
      // 正在展开的“我喜欢”有独立分页缓存；使旧请求失效，避免取消红心后旧记录回填。
      detail.token+=1;
      if (detail.controller) detail.controller.abort();
      if (detail.warmTimer) clearTimeout(detail.warmTimer);
      detail.controller=null;detail.warmTimer=0;
      detail.tracks=favorites.map(cloneSong);detail.total=favorites.length;detail.nextOffset=favorites.length;
      detail.hasMore=false;detail.loading=false;detail.loadingMore=false;detail.error='';detail.message='';
      detail.playlist=Object.assign({},detail.playlist,listRow({id:'local:favorites',name:'我喜欢的音乐',tracks:favorites}));
    }
    publishLists();updateLikeButtons();refreshSearchResultActionStates();
    safeRenderQueuePanel('web-favorite-change',{scrollCurrent:miniQueueOpen});
    // 3D 歌单的爱心画在 canvas 上，需要让已显示的行重新绘制。
    var content=typeof shelfManager!=='undefined' && shelfManager && shelfManager.getContentList && shelfManager.getContentList();
    if (content && content.refreshTheme) content.refreshTheme();
    favoriteListeners.forEach(function (handler) { handler(); });
  }
  toggleLikeSong = async function (song) {
    if (!song) return;
    var liked = isSongLiked(song), previous = favorites, previousRemovals = favoriteRemovals;
    var removed = favorites.filter(function (item) { return favoriteTools.sameSong(item,song); });
    favorites = favorites.filter(function (item) { return !favoriteTools.sameSong(item,song); });
    if (liked) favoriteRemovals = favoriteTools.deduplicate(favoriteRemovals.concat(removed, [cloneSong(song)]));
    else {
      favorites=favoriteTools.deduplicate([cloneSong(song)].concat(favorites));
      favoriteRemovals = favoriteRemovals.filter(function (item) { return !favoriteTools.sameSong(item,song); });
    }
    if (!persist()) { favorites = previous; favoriteRemovals = previousRemovals; refreshFavoriteViews(); return false; }
    refreshFavoriteViews();showToast(liked ? '已取消喜欢' : '已加入我喜欢的音乐');
  };
  var originalFavoriteTrackInfo=updateControlTrackInfo;
  updateControlTrackInfo=function(song) {
    var result=originalFavoriteTrackInfo.apply(this,arguments);updateLikeButtons(song);return result;
  };

  // 推荐使用各平台榜单精选，不伪造账号登录状态。原作的播放/渲染流程继续复用。
  loadHomeDiscover = function (force) {
    ensureDailyDate();
    pruneExpiredDailyRecommendations();
    var context = dailyContextKey();
    if (discoverPromise && discoverTask && discoverTask.context === context) return discoverPromise;
    if (discoverTask) invalidateDailyVerification();
    // "force" can retry an unavailable day, but must never replace today's
    // saved candidate order. A source can be checked again without redrawing
    // the day's picks or exposing songs that no longer pass playback checks.
    if (homeDiscoverState.loaded && homeDiscoverState.songs.length && !dailyNeedsValidation()) {
      renderHomeDashboard();
      return Promise.resolve(true);
    }
    if (dailyCheckedContext !== context) homeDiscoverState.songs = [];
    homeDiscoverState.loaded = false;
    homeDiscoverState.loading = true;
    homeDiscoverState.error = '';
    var request = { day:dailyDay, context:context, controller:window.AbortController ? new AbortController() : null };
    discoverTask = request;
    function current() {
      return discoverTask === request && request.day === dailyDateKey() && request.context === dailyContextKey()
        && (!request.controller || !request.controller.signal.aborted);
    }
    function publishChecked(songs) {
      if (!current()) return;
      homeDiscoverState.songs = songs.slice(0, DAILY_LIMIT).map(cloneSong);
      publishLists();
      renderHomeDashboard();
    }
    renderHomeDashboard();
    var options = { timeoutMs:12000 };
    if (request.controller) options.signal = request.controller.signal;
    var candidateRequest = dailyCandidates.length ? Promise.resolve({ dailySongs:dailyCandidates,
      playlists:homeDiscoverState.playlists, partial:homeDiscoverState.partial }) : apiJson('/api/discover/home', options);
    discoverPromise = candidateRequest.then(async function (data) {
      if (!current()) return false;
      if (!data || !Array.isArray(data.candidateSongs) && !Array.isArray(data.dailySongs)) throw new Error('DISCOVER_INVALID');
      var incoming = Array.isArray(data.candidateSongs) ? data.candidateSongs : data.dailySongs;
      dailyCandidates = incoming.filter(function (song) { return song && typeof song === 'object'; }).slice(0, DAILY_CANDIDATE_LIMIT).map(cloneSong);
      homeDiscoverState.playlists = Array.isArray(data.playlists) ? data.playlists : [];
      homeDiscoverState.podcasts = [];
      homeDiscoverState.mode = 'charts';
      homeDiscoverState.partial = data.partial === true;
      homeDiscoverState.updatedAt = Date.now();
      // Keep failed candidates retryable, including after a page reload. The
      // serialized snapshot is never treated as proof that a song still plays.
      saveDailyPlaylist();
      var checked = typeof filterHomePlayableRecommendations === 'function'
        ? await filterHomePlayableRecommendations(dailyCandidates, {
          limit:DAILY_LIMIT, signal:request.controller && request.controller.signal,
          isCurrent:current, onProgress:publishChecked
        }) : [];
      if (!current()) return false;
      publishChecked(checked);
      homeDiscoverState.loaded = true;
      dailyCheckedContext = request.context;
      dailyCheckedUntil = Date.now() + (checked.length ? 60000 : 15000);
      saveDailyPlaylist();
      publishLists();
      return !!checked.length;
    }).catch(function () {
      if (discoverTask !== request) return false;
      homeDiscoverState.error = 'DISCOVER_FAILED';
      showToast('精选加载失败，请点击每日精选重试');
      return false;
    }).finally(function () {
      if (discoverTask !== request) return;
      homeDiscoverState.loading = false;
      discoverTask = null;
      discoverPromise = null;
      renderHomeDashboard();
    });
    return discoverPromise;
  };
  playHomeDaily = function () {
    ensureDailyDate();
    pruneExpiredDailyRecommendations();
    if (dailyNeedsValidation()) loadHomeDiscover(false);
    if (dailyPlayTask && dailyPlayTask.day !== dailyDay) cancelDailyTask(dailyPlayTask);
    // Coalesce a burst on the same card. Once queue preparation has finished,
    // a later deliberate retry can replace a slow source request immediately.
    if (dailyPlayTask && (dailyPlayTask.phase === 'preparing' ||
        Date.now() - dailyPlayTask.startedAt < 300)) return dailyPlayPromise;
    if (dailyPlayTask) cancelDailyTask(dailyPlayTask);
    var task = { day:dailyDay, phase:'preparing', cancelled:false, initialToken:playbackIntentToken(), startedAt:Date.now() };
    task.cancelledPromise = new Promise(function (resolve) { task.cancel = resolve; });
    dailyPlayTask = task;
    dailyPlayPending = true;
    renderHomeDashboard();
    dailyPlayPromise = (async function () {
      try {
        // 已有推荐直接进入播放，避免无意义的异步等待影响移动浏览器的用户操作手势。
        if (!homeDiscoverState.songs.length) {
          await Promise.race([loadHomeDiscover(false), task.cancelledPromise]);
        }
        if (task.cancelled || dailyPlayTask !== task || task.day !== dailyDateKey() ||
            task.initialToken !== playbackIntentToken()) return false;
        if (!homeDiscoverState.songs.length) {
          if (!homeDiscoverState.error) showToast('暂未找到可播放的精选，请稍后重试');
          return false;
        }
        playQueue = homeDiscoverState.songs.map(cloneSong); currentIdx = 0;
        currentLocalSong = null;
        pendingPlaybackResumeAt = 0;
        startupRestoreHomePending = false;
        // 先退出首页、展开控制台，再等待音源解析。不要等 audio.currentSrc 才隐藏首页。
        homeForcedOpen = false; homeSuppressed = true; setHomeControlsLocked(false);
        updateEmptyHomeVisibility();
        if (window.webMobileNavigation && webMobileNavigation.active()) webMobileNavigation.go('player');
        safeRenderQueuePanel('web-daily'); safeShelfRebuild('web-daily', true); forcePlaybackControlsInteractive();
        task.phase = 'playing';
        dailyPlayPending = false;
        renderHomeDashboard();
        task.dispatching = true;
        var playback;
        try {
          var playbackOptions = { manual:true, preserveHomeState:true,
            context:{type:'home-discovery', playlistName:dailyPlaylist().name} };
          if (typeof homeRecommendationPlaybackOptions === 'function') {
            playbackOptions = homeRecommendationPlaybackOptions(playQueue[0], playbackOptions);
          }
          playback = playQueueAt(0, playbackOptions);
          task.playbackToken = playbackIntentToken();
        } finally { task.dispatching = false; }
        return await Promise.race([playback, task.cancelledPromise]);
      } catch (_) {
        if (!task.cancelled && dailyPlayTask === task) showToast('精选播放失败，请重试或更换歌曲');
        return false;
      }
    }()).finally(function () {
      releaseDailyTask(task);
    });
    return dailyPlayPromise;
  };
  playHomePrivateRadio = playHomeDaily;
  maybeRunStartupLoginGuide = function () {};
  openHomeLibrary = function () {
    homeForcedOpen=false; homeSuppressed=true; setHomeControlsLocked(false); updateEmptyHomeVisibility();
    openPlaylistPanelTab('playlists', true);
  };
  openHomeDashboardLibrary = openHomeLibrary;
  var originalDetailScroll = scrollPlaylistPanelDetailIntoView;
  scrollPlaylistPanelDetailIntoView = function(key) {
    // 从榜单中心打开靠后的歌单时，先定位虚拟列表，再复用原作的展开动画。
    var panel=document.getElementById('playlist-panel'), list=document.getElementById('pl-list');
    var cache=playlistPanelBuildVirtualEntries();
    var index=cache.entries.findIndex(function(entry) { return entry.type==='card' && playlistPanelKey(normalizePlaylistProvider(entry.pl.provider),entry.pl.id)===key; });
    if(panel && list && index>=0) {
      panel.scrollTop=Math.max(0,panel.scrollTop+list.getBoundingClientRect().top-panel.getBoundingClientRect().top+cache.offsets[index]-126);
      renderUserPlaylistsList();
    }
    originalDetailScroll(key);
  };
  MUSIC_SEARCH_PROVIDER_ORDER = ['netease', 'qq', 'kugou', 'qishui'];
  var originalControlProviders = controlSourceProviders;
  controlSourceProviders = function () { return originalControlProviders().filter(function (p) { return p.key !== 'spotify'; }); };
  var originalPlay = playQueueAt;
  playQueueAt = async function () {
    var result = await originalPlay.apply(this, arguments);
    // 将原作创建的媒体元素挂到文档，方便浏览器的媒体控制与状态检查。
    if (audio && !audio.isConnected) { audio.id='web-audio'; audio.hidden=true; document.body.append(audio); }
    if (audio && audio.currentSrc && result !== false) {
      homeForcedOpen=false; homeSuppressed=true; updateEmptyHomeVisibility();
    }
    return result;
  };

  // 根据实际目录显示平台；刷新后新增的汽水榜单会自动加入筛选，无目录的平台不显示空标签。
  var selectedPlatform = 'all', chartPlatformFingerprint = '';
  var chartPlatformLabels = [['netease','网易云'], ['qqmusic','QQ 音乐'], ['kugou','酷狗'], ['qishui','汽水音乐']];
  function renderChartPlatforms() {
    var available = chartPlatformLabels.filter(function (entry) {
      return catalog.some(function (item) { return item.id.split(':')[1] === entry[0]; });
    });
    if (selectedPlatform !== 'all' && !available.some(function (entry) { return entry[0] === selectedPlatform; })) selectedPlatform = 'all';
    var fingerprint = available.map(function (entry) { return entry[0]; }).join('|');
    if (chartPlatformFingerprint !== fingerprint || !document.getElementById('home-platform-recommend-tabs').children.length) {
      chartPlatformFingerprint = fingerprint;
      var tabs = document.getElementById('home-platform-recommend-tabs'); tabs.replaceChildren();
      [['all','全部']].concat(available).forEach(function (entry) {
        var btn = document.createElement('button'); btn.type='button'; btn.textContent=entry[1]; btn.dataset.webPlatform=entry[0];
        btn.onclick=function () { selectedPlatform=entry[0]; window.checkClientPlatformAssets(selectedPlatform); renderCharts(); }; tabs.append(btn);
      });
    }
    document.getElementById('home-platform-recommend-mask').querySelector('p').textContent = available.length
      ? available.map(function (entry) { return entry[1]; }).join('、') + '的完整音乐榜单'
      : '暂未加载音乐榜单，请刷新重试';
  }
  function renderCharts() {
    renderChartPlatforms();
    var list = document.getElementById('home-platform-recommend-list');
    list.replaceChildren();
    var rows = catalog.filter(function (p) { return selectedPlatform === 'all' || p.id.split(':')[1] === selectedPlatform; });
    document.getElementById('home-platform-recommend-status').textContent = rows.length + ' 个音乐榜单 · 点击查看全部歌曲';
    rows.forEach(function (item) {
      var card = document.createElement('button'); card.className = 'home-platform-recommend-card'; card.type = 'button';
      var cover = document.createElement('span'); cover.className = 'home-platform-recommend-cover';
      var artwork = item.cover && (coverProxySrc(item.cover) || item.cover), fallback = shelfCoverFallbackSrc(item);
      var layers = [artwork, fallback].filter(Boolean).map(function (src) { return 'url("' + cssImageUrl(src) + '")'; });
      if (layers.length) cover.style.backgroundImage = layers.join(',');
      var copy = document.createElement('span'); copy.className = 'home-platform-recommend-copy';
      var label = document.createElement('span'); label.className = 'home-platform-recommend-label'; label.textContent = item.creator;
      var title = document.createElement('strong'); title.textContent = item.name;
      var sub = document.createElement('small'); sub.textContent = item.trackCount + ' 首';
      copy.append(label, title, sub); card.append(cover, copy);
      card.onclick = function () {
        closeHomePlatformRecommendations();
        if (window.webMobileNavigation && webMobileNavigation.active()) {
          return loadPlaylistIntoQueueById('mineradio:' + item.id, true, item.name);
        }
        openHomeLibrary(); openPlaylistPanelDetail('mineradio', item.id, item.name);
      };
      list.append(card);
    });
    document.querySelectorAll('#home-platform-recommend-tabs button').forEach(function (btn) { btn.classList.toggle('active', btn.dataset.webPlatform === selectedPlatform); });
  }
  openHomePlatformRecommendations = async function () {
    window.checkClientPlatformAssets(selectedPlatform);
    if (!catalog.length) await refreshBuiltInPlaylists();
    document.getElementById('home-platform-recommend-title').textContent = '音乐榜单';
    var mask = document.getElementById('home-platform-recommend-mask');
    homePlatformRecommendationState.previousFocus = document.activeElement;
    homePlatformRecommendationState.open = true;
    mask.classList.add('show'); mask.setAttribute('aria-hidden','false');
    renderCharts();
  };
  document.getElementById('home-platform-recommend-refresh').onclick = async function () { await refreshBuiltInPlaylists(true); renderCharts(); };
  document.getElementById('home-platform-recommend-close').onclick = closeHomePlatformRecommendations;
  document.getElementById('home-platform-recommend-done').onclick = closeHomePlatformRecommendations;
  document.getElementById('home-platform-recommend-mask').addEventListener('click', function(event) { if(event.target === this) closeHomePlatformRecommendations(); });
  document.addEventListener('keydown', function(event) { if(event.key === 'Escape') closeHomePlatformRecommendations(); });
  var originalDashboard = renderHomeDashboard;
  renderHomeDashboard = function () {
    pruneExpiredDailyRecommendations();
    if (dailyNeedsValidation() && (!discoverTask || discoverTask.context !== dailyContextKey())
        && (typeof emptyHomeActive !== 'undefined' && emptyHomeActive || homeForcedOpen)) {
      loadHomeDiscover(false);
      return;
    }
    originalDashboard();
    var mix = document.querySelector('.home-quick-grid [data-home-tone="mix"]');
    if (mix) {
      mix.querySelector('.home-card-title').textContent=dailyPlayPending ? '正在准备精选…' : '每日精选';
      mix.querySelector('.home-card-sub').textContent='';
      mix.setAttribute('aria-busy', dailyPlayPending || homeDiscoverState.loading ? 'true' : 'false');
    }
    var discover = document.querySelector('[onclick="openHomeDashboardCharts()"]');
    if (discover) { discover.querySelector('.home-ranking-entry-title').textContent='音乐榜单'; discover.querySelector('.home-ranking-entry-sub').textContent=''; }
    var picks = document.querySelector('.home-radio-entry');
    if (picks) {
      picks.querySelector('.home-ranking-entry-title').textContent='今日精选歌单';
      picks.querySelector('.home-ranking-entry-sub').textContent='';
      picks.onclick=async function () {
        if (window.webMobileNavigation && webMobileNavigation.active()) return playHomeDaily();
        await loadHomeDiscover(false);
        if (!homeDiscoverState.songs.length) { showToast('今日歌单暂未载入，请稍后重试'); return; }
        openHomeLibrary(); openPlaylistPanelDetail('mineradio', 'local:daily', dailyPlaylist().name);
      };
      picks.setAttribute('aria-label','查看今日精选歌单');
    }
  };
  function dailyAccountsChanged() {
    invalidateDailyVerification();
    publishLists();
    // Other account listeners update their caches in this same event turn.
    // Recheck only when the home page is displayed; playback elsewhere keeps
    // its own foreground work and does not start a background daily scan.
    Promise.resolve().then(function () { renderHomeDashboard(); });
  }
  if (window.addEventListener) {
    window.addEventListener('mineradio:accounts-changed', dailyAccountsChanged);
    window.addEventListener('storage', function (event) {
      if (!event || !event.key || event.key === 'mineradio-local-accounts-v1') dailyAccountsChanged();
    });
  }
  document.body.classList.add('web-adapter');
  [['song','聚合'],['netease','网易云'],['qq','QQ 音乐'],['kugou','酷狗'],['qishui','汽水']].forEach(function(entry) {
    var button=document.getElementById('search-mode-'+entry[0]); if(button) button.textContent=entry[1];
  });
  var diy = document.getElementById('diy-mode-btn');
  if (diy) { document.getElementById('top-right').append(diy); diy.style.display='inline-flex'; }
  var user = document.getElementById('user-btn'); if(user) user.title='本机接口模式';
  // 桌面独有的扫码账号、播客和系统窗口控制在网页版不显示。
  document.querySelectorAll('#search-mode-podcast,#tab-podcast,#user-capsule-hide-btn').forEach(function (el) { el.hidden=true; });
  window.checkClientPlatformAssets('all');
  ensureDailyDate(); refreshBuiltInPlaylists(); loadHomeDiscover(false);
  var savedMusicRead = 0;
  async function reloadSavedMusic() {
    if (!window.browserLocalMusic) return;
    var read = ++savedMusicRead;
    var result = await browserLocalMusic.listLocalMusicLibrary();
    if (read !== savedMusicRead) return result;
    savedLocalTracks = result.tracks || [];
    publishLists();
    var detail = typeof playlistPanelDetailState === 'object' && playlistPanelDetailState;
    if (detail && !detail.loading && synchronizeLocalPlaylistDetail({id:'local:saved', name:'本机已保存的音乐', tracks:savedLocalTracks})) renderPlaylistPanelDetailState();
    return result;
  }
  function refreshSavedMusic() { reloadSavedMusic().catch(function () { showToast('本地曲库读取失败，请重试；已保存文件不会被清空'); }); }
  if (window.addEventListener) window.addEventListener('mineradio:local-library-changed', refreshSavedMusic);
  refreshSavedMusic();
}());

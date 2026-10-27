'use strict';

(function installWebLibrary() {
  if (!window.MINERADIO_LOCAL_WEB) return;
  var providers = ['netease', 'qq', 'kugou', 'qishui'];
  var labels = { netease: '网易云', qq: 'QQ 音乐', kugou: '酷狗', qishui: '汽水音乐' };
  var kinds = [['liked', '我喜欢的音乐'], ['created', '我的歌单'], ['collected', '我的收藏']];
  var selected = 'all', manage = false, previousFocus = null;
  var mask = document.getElementById('web-library-mask'), content = document.getElementById('web-library-content');
  var lastFingerprint = '', publishedFingerprint = '';
  var importRequests = new Map(), importProgress = {};
  function isLikedPlaylist(row) { return !!row && (row.isLiked === true || row.kind === 'liked'); }
  function element(tag, className, text) {
    var node = document.createElement(tag); if (className) node.className = className;
    if (text != null) node.textContent = text; return node;
  }
  function button(text, handler, className) {
    var node = element('button', className, text); node.type = 'button'; node.onclick = handler; return node;
  }
  function credentialHeaders(url) {
    return window.localMusicCredentials && window.localMusicCredentials.headers ? window.localMusicCredentials.headers(url) : {};
  }
  // This value stays inside the closure and is never rendered, logged or persisted.
  function accountFingerprint() { return JSON.stringify(credentialHeaders('/api/library/catalog')); }
  async function request(url, body, requestOptions) {
    var fingerprint = accountFingerprint();
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 60000);
    var external = requestOptions && requestOptions.signal;
    function abort() { controller.abort(); }
    if (external) { if (external.aborted) abort(); else external.addEventListener('abort', abort, { once: true }); }
    try {
      var response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
        headers: Object.assign({}, credentialHeaders(url), body === undefined ? {} : { 'Content-Type': 'application/json' }),
        body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store', signal: controller.signal, priority: 'low' });
      var data = await response.json();
      if (fingerprint !== accountFingerprint()) throw new Error('账号已变更，请重新加载音乐库');
      if (window.localMusicCredentials && window.localMusicCredentials.observeAccountStatus) window.localMusicCredentials.observeAccountStatus(data);
      if (!response.ok) { var failure = new Error(data.message || '音乐库接口暂时不可用'); failure.definitive = data.ok === false; throw failure; }
      return data;
    } finally { clearTimeout(timer); if (external) external.removeEventListener('abort', abort); }
  }
  function localFavorites() {
    if (window.webLocalLibrary && window.webLocalLibrary.favorites) return window.webLocalLibrary.favorites();
    try { return JSON.parse(localStorage.getItem('mineradio-web-library-v1') || '{}').favorites || []; }
    catch (_) { return []; }
  }
  var store = window.createWebLibraryStore({ request: request, storage: localStorage, favorites: localFavorites,
    deduplicate: window.webFavoriteTools.deduplicate, onChange: changed,
    onStorageError: function () { showToast('无法保存隐藏设置，请检查浏览器存储'); } });
  window.webMusicLibrary = store;
  store.refresh = function (force) { return refreshUserPlaylists(force !== false); };
  store.catalog = function () { return store.state.playlists.map(function (row) { return Object.assign({}, row); }); };
  store.importPlaylist = importPlaylist;
  var likedSync = window.createWebLocalLikedSync({ request: request, favorites: localFavorites,
    sources: window.webFavoriteTools.sources, sameSong: window.webFavoriteTools.sameSong,
    accountKey: accountFingerprint, onChange: render,
    busy: function () { return typeof playbackResolutionRuntime === 'function' && !!playbackResolutionRuntime().active
      || typeof currentTrackMetadataBusy === 'function' && currentTrackMetadataBusy(); } });
  store.localLikedSync = likedSync;
  function cloudRow(row) {
    var kindLabel = kinds.find(function (kind) { return kind[0] === row.kind; });
    return Object.assign({}, row, { source: row.provider, readonly: true, cloudLibrary: true,
      subscribed: false, shelfPane: row.kind === 'collected' ? 'fav' : 'mine',
      virtual: !!row.isLiked, creator: labels[row.provider] + ' · ' + (kindLabel ? kindLabel[1] : '我的歌单') });
  }
  var originalRebuild = rebuildUserPlaylistsFromCatalog;
  rebuildUserPlaylistsFromCatalog = function (options) {
    builtInPlaylists = (builtInPlaylists || []).filter(function (row) { return row.id !== 'library:likes'; });
    var rows = store.visiblePlaylists().map(cloudRow);
    neteasePlaylists = rows.filter(function (row) { return row.provider === 'netease'; });
    qqPlaylists = rows.filter(function (row) { return row.provider === 'qq'; });
    kugouPlaylists = rows.filter(function (row) { return row.provider === 'kugou'; });
    qishuiPlaylists = rows.filter(function (row) { return row.provider === 'qishui'; });
    spotifyPlaylists = [];
    return originalRebuild(options);
  };
  function publish(force) {
    var fingerprint = JSON.stringify(store.visiblePlaylists());
    if (!force && fingerprint === publishedFingerprint) return;
    publishedFingerprint = fingerprint;
    rebuildUserPlaylistsFromCatalog({ preserveScroll: true, reason: 'web-library' });
  }
  function changed() {
    publish(false); render();
  }
  function clearCloudDetail() {
    if (!playlistPanelDetailState || !playlistPanelDetailState.playlist || !playlistPanelDetailState.playlist.cloudLibrary) return;
    if (typeof cancelPlaylistPanelDetailRequest === 'function') cancelPlaylistPanelDetailRequest();
    playlistPanelDetailState.key = ''; playlistPanelDetailState.tracks = []; playlistPanelDetailState.playlist = null;
  }
  function checkAccount() {
    var fingerprint = accountFingerprint();
    if (fingerprint === lastFingerprint) return false;
    lastFingerprint = fingerprint; if (likedSync) likedSync.accountsChanged(); clearCloudDetail(); return true;
  }
  refreshUserPlaylists = function (force) {
    var accountChanged = checkAccount();
    // Stop former provider loaders from repopulating a hidden platform after a refresh.
    if (playlistCatalogSyncState && playlistCatalogSyncState.timer) clearTimeout(playlistCatalogSyncState.timer);
    playlistCatalogSyncState = { token: Number(playlistCatalogSyncState && playlistCatalogSyncState.token || 0) + 1,
      loading: false, timer: 0, providers: {}, error: '' };
    if (force || accountChanged) clearCloudDetail();
    return Promise.all([refreshBuiltInPlaylists(!!force), store.loadCatalog(!!force || accountChanged)]).then(function () { publish(!!force || accountChanged); return true; });
  };
  var originalFetchPage = fetchPlaylistTracksPage;
  fetchPlaylistTracksPage = function (p, id, params, options) {
    if (providers.indexOf(p === 'qqmusic' ? 'qq' : p) >= 0) return store.tracks(p, id, params);
    return originalFetchPage.apply(this, arguments);
  };
  var originalDetailHtml = playlistPanelDetailHtml;
  playlistPanelDetailHtml = function (row) {
    var html = originalDetailHtml.apply(this, arguments);
    if (!row || !row.cloudLibrary || !html) return html;
    var notice = '单击爱心只修改本机喜欢；长按可收藏到平台歌单或从平台歌单移除。';
    if (playlistPanelDetailState.message) notice += ' ' + playlistPanelDetailState.message;
    var importButton = '<button class="fx-mini-btn ghost pl-detail-top-btn" type="button" data-web-library-import="' + escHtml(store.key(row)) + '">' + (isLikedPlaylist(row) ? '导入本机喜欢' : '导入本机歌单') + '</button>';
    return html.replace('<div class="pl-detail-actions">', '<div class="web-library-detail-note">' + escHtml(notice) + '</div><div class="pl-detail-actions">' + importButton);
  };
  var originalDetailHeight = playlistPanelDetailShellHeight;
  playlistPanelDetailShellHeight = function () {
    return originalDetailHeight.apply(this, arguments) + (playlistPanelDetailState && playlistPanelDetailState.playlist && playlistPanelDetailState.playlist.cloudLibrary ? 42 : 0);
  };
  function importPlaylist(row) {
    if (typeof row === 'string') row = store.state.playlists.find(function (item) { return store.key(item) === row; });
    if (!row || providers.indexOf(row.provider) < 0) return Promise.reject(new Error('请先选择一个平台歌单'));
    var sourceKey = store.key(row), local = window.webLocalLibrary, importAccount = accountFingerprint();
    if (importRequests.has(sourceKey)) return importRequests.get(sourceKey);
    if (!isLikedPlaylist(row) && local && local.findImportedPlaylist(sourceKey)) {
      showToast('这个平台歌单已经导入本机');
      return Promise.resolve({ duplicate: true, playlist: local.findImportedPlaylist(sourceKey) });
    }
    var promise = (async function () {
      try {
        importProgress[sourceKey] = 0; render();
        var tracks = await store.readAllTracks(row, function (loaded) { importProgress[sourceKey] = loaded; render(); });
        if (importAccount !== accountFingerprint()) throw new Error('账号已变更，请重新导入');
        if (!local || !local.importPlaylist) throw new Error('本机歌单暂不可用');
        var result = local.importPlaylist(row.name + ' · ' + labels[row.provider], tracks, sourceKey, row);
        showToast(result.destination === 'favorites'
          ? '已合并到本机喜欢 · 新增 ' + result.added + ' 首，共 ' + result.total + ' 首'
          : result.duplicate ? '这个平台歌单已经导入本机' : '已导入本机歌单 · ' + tracks.length + ' 首');
        return result;
      } catch (error) { showToast(error && error.message || '歌单导入失败，请重试'); throw error; }
      finally { delete importProgress[sourceKey]; importRequests.delete(sourceKey); render(); }
    }());
    importRequests.set(sourceKey, promise); render(); return promise;
  }
  function openPlaylist(row) {
    close();
    homeForcedOpen = false; homeSuppressed = true; setHomeControlsLocked(false); updateEmptyHomeVisibility();
    openPlaylistPanelTab('playlists', true, { refresh: false });
    openPlaylistPanelDetail(row.provider, row.id, row.name);
    if (window.webMobileNavigation && window.webMobileNavigation.active()) window.webMobileNavigation.go('library-detail');
  }
  function close() {
    if (!mask) return; mask.hidden = true;
    if (previousFocus && previousFocus.isConnected && previousFocus.focus) previousFocus.focus();
  }
  function open() {
    if (!mask) return;
    if (window.webMobileNavigation && window.webMobileNavigation.active()
      && window.webMobileNavigation.current() !== 'library') {
      window.webMobileNavigation.go('library');
      return;
    }
    previousFocus = document.activeElement; mask.hidden = false; render();
    if (window.checkClientPlatformAssets) window.checkClientPlatformAssets(selected);
    var dialog = mask.querySelector('.web-library'); if (dialog) dialog.focus();
    refreshUserPlaylists(false);
  }
  window.openWebMusicLibrary = open;
  openHomeDashboardLibrary = open;
  function card(row) {
    var hidden = store.hidden(row), wrapper = element('div', 'web-library-card' + (hidden ? ' is-hidden' : ''));
    wrapper.dataset.libraryKey = store.key(row);
    var cover = element('span', 'web-library-cover', '♫');
    cover.dataset.libraryProvider = row.provider;
    function fallbackCover() {
      cover.replaceChildren();
      cover.classList.add('is-fallback');
      cover.textContent = providers.indexOf(row.provider) >= 0 ? '' : isLikedPlaylist(row) ? '♥' : '♫';
    }
    fallbackCover();
    if (row.cover) {
      var img = element('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.onerror = function () { img.onerror = null; fallbackCover(); };
      cover.classList.remove('is-fallback'); cover.replaceChildren(img); img.src = coverProxySrc(row.cover) || row.cover;
    }
    var copy = element('span', 'web-library-copy'); copy.append(element('strong', '', row.name));
    var subtitle = Number(row.trackCount || 0) + ' 首 · ' + labels[row.provider];
    copy.append(element('small', '', subtitle));
    var action = button('', function () { openPlaylist(cloudRow(row)); }, 'web-library-card-open');
    action.disabled = hidden; action.append(cover, copy); wrapper.append(action);
    {
      var personallyHidden = store.preferences.hiddenPlaylists.indexOf(store.key(row)) >= 0;
      var toggle = button(personallyHidden ? '恢复' : '隐藏', function () { store.setPlaylistHidden(row, !personallyHidden); }, 'web-library-hide');
      var importButton = button(importRequests.has(store.key(row)) ? '导入中 ' + (importProgress[store.key(row)] || 0) : isLikedPlaylist(row) ? '导入本机喜欢' : '导入本机', function () { importPlaylist(row).catch(function () {}); }, 'web-library-import');
      importButton.disabled = importRequests.has(store.key(row)); importButton.setAttribute('aria-label', '导入' + row.name + '到本机');
      toggle.setAttribute('aria-label', (personallyHidden ? '恢复' : '隐藏') + row.name); wrapper.append(importButton, toggle);
    }
    return wrapper;
  }
  function render() {
    if (!mask || mask.hidden || !content) return;
    var state = store.state, tabs = document.getElementById('web-library-tabs'); tabs.replaceChildren();
    [['all', '全部平台']].concat(providers.map(function (p) { return [p, labels[p]]; })).forEach(function (entry) {
      var tab = button(entry[1], function () { selected = entry[0]; if (window.checkClientPlatformAssets) window.checkClientPlatformAssets(selected); render(); });
      tab.classList.toggle('active', selected === entry[0]); tab.setAttribute('aria-pressed', selected === entry[0] ? 'true' : 'false'); tabs.append(tab);
    });
    document.getElementById('web-library-manage').textContent = manage ? '完成隐藏管理' : '隐藏管理';
    document.getElementById('web-library-manage').setAttribute('aria-pressed', String(manage));
    var refresh = document.getElementById('web-library-refresh'); refresh.disabled = state.loading; refresh.textContent = state.loading ? '正在刷新…' : '刷新音乐库';
    var status = document.getElementById('web-library-status');
    status.textContent = state.error || (state.loading ? '正在加载歌单…' : state.partial ? '部分平台加载失败，可刷新重试' : state.playlists.length + ' 个歌单');
    status.dataset.error = state.error || state.partial ? 'true' : 'false';
    content.replaceChildren();
    if (manage) content.append(element('p', 'web-library-manage-hint', '可隐藏整个平台，也可只隐藏某个歌单。被隐藏的内容可随时恢复。'));
    providers.filter(function (p) { return selected === 'all' || selected === p; }).forEach(function (p) {
      var platformHidden = store.preferences.hiddenProviders.indexOf(p) >= 0;
      if (platformHidden && !manage) return;
      var section = element('section', 'web-library-platform'); section.dataset.libraryProvider = p;
      var heading = element('div', 'web-library-platform-head'); heading.append(element('h3', '', labels[p]));
      var actions = element('div', 'web-library-platform-actions');
      var syncButton = button('', function () { likedSync.start(p); }, 'web-library-platform-toggle web-library-sync');
      syncButton.dataset.webLikedSync = p; syncButton.setAttribute('aria-label', '同步本机喜欢到' + labels[p]); syncButton.title = '同步本机喜欢到' + labels[p];
      syncButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1.6L20 8M4 16l2.3 2.6A7 7 0 0 0 17.9 17"/></svg><span>同步喜欢</span>';
      syncButton.disabled = state.loading || likedSync.state.running; actions.append(syncButton);
      actions.append(button(platformHidden ? '恢复平台歌单' : '隐藏平台歌单', function () { store.setProviderHidden(p, !platformHidden); }, 'web-library-platform-toggle'));
      heading.append(actions);
      section.append(heading);
      var sync = likedSync.state;
      if (sync.provider === p && sync.phase !== 'idle') {
        var progress = element('div', 'web-library-sync-progress'); progress.setAttribute('role', 'status'); progress.dataset.phase = sync.phase;
        progress.append(element('strong', '', sync.message), element('span', '', '已存在 ' + sync.already + ' · 成功 ' + sync.success + ' · 失败 ' + sync.failed
          + ' · 无本平台音源 ' + sync.noSource + ' · 已读取 ' + sync.read + (sync.readTotal ? ' / ' + sync.readTotal : '')));
        if (sync.running) { var cancel = button(sync.phase === 'cancelling' ? '正在停止…' : '取消后续同步', function () { likedSync.cancel(); }, 'web-library-platform-toggle');
          cancel.dataset.webLikedCancel = p; cancel.disabled = sync.phase === 'cancelling'; progress.append(cancel); }
        else if (sync.failed || sync.phase === 'error') { var retry = button('重试同步', function () { likedSync.start(p); }, 'web-library-platform-toggle'); retry.dataset.webLikedRetry = p; progress.append(retry); }
        sync.failures.forEach(function (failure) { progress.append(element('small', 'web-library-warning', failure.name + '：' + failure.message)); });
        section.append(progress);
      }
      var account = state.providers[p] || {};
      if (!account.ok && !state.loading) {
        var notice = element('div', 'web-library-provider-notice'); notice.append(element('span', '', account.message || (account.configured ? '暂时无法读取平台歌单，请刷新重试' : '登录后显示此平台的喜欢、收藏和歌单')));
        if (!account.configured || !account.loggedIn) notice.append(button('登录' + labels[p], function () { close(); showLoginModal({ provider: p }); }));
        section.append(notice);
      }
      kinds.forEach(function (kind) {
        var rows = state.playlists.filter(function (row) { return row.provider === p && row.kind === kind[0] && (manage || !store.hidden(row)); });
        if (!rows.length) return;
        section.append(element('h4', '', kind[1]));
        var grid = element('div', 'web-library-grid'); rows.forEach(function (row) { grid.append(card(row)); }); section.append(grid);
      });
      var count = state.playlists.filter(function (row) { return row.provider === p && (manage || !store.hidden(row)); }).length;
      if (!count && account.ok && !state.loading) section.append(element('p', 'web-library-empty', manage ? '这个平台暂无歌单' : '暂无可见歌单 · 可在隐藏管理中恢复'));
      content.append(section);
    });
    if (!manage && store.preferences.hiddenProviders.length) content.append(button('有 ' + store.preferences.hiddenProviders.length + ' 个平台已隐藏 · 管理与恢复', function () { manage = true; render(); }, 'web-library-restore'));
  }
  if (mask) {
    document.getElementById('web-library-close').onclick = close;
    document.getElementById('web-library-manage').onclick = function () { manage = !manage; render(); };
    document.getElementById('web-library-refresh').onclick = function () { refreshUserPlaylists(true); };
    mask.addEventListener('click', function (event) { if (event.target === mask) close(); });
    mask.addEventListener('keydown', function (event) {
      if (window.webMobileNavigation && window.webMobileNavigation.active()) {
        if (event.key === 'Escape') { event.stopPropagation(); window.webMobileNavigation.go('home'); }
        return;
      }
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key !== 'Tab') return;
      var nodes = Array.from(mask.querySelectorAll('button:not([disabled]),[tabindex="0"]')).filter(function (node) { return node.getClientRects().length; });
      if (!nodes.length) return;
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === mask.querySelector('.web-library'))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  var toolbar = document.querySelector('#pl-pane .queue-toolbar');
  if (toolbar) toolbar.insertBefore(button('音乐库', open, 'fx-mini-btn ghost web-library-entry'), toolbar.firstChild);
  var originalDashboard = renderHomeDashboard;
  renderHomeDashboard = function () {
    var result = originalDashboard.apply(this, arguments);
    var entry = document.querySelector('.home-quick-grid [data-home-tone="library"]');
    if (entry) { entry.querySelector('.home-card-title').textContent = '我的音乐库'; entry.querySelector('.home-card-sub').textContent = ''; entry.onclick = open; }
    return result;
  };
  function syncFavoriteViews() {
    publish(true); render();
  }
  if (window.webLocalLibrary && window.webLocalLibrary.subscribeFavorites) window.webLocalLibrary.subscribeFavorites(syncFavoriteViews);
  else {
    var originalToggle = toggleLikeSong;
    toggleLikeSong = async function () { var result = await originalToggle.apply(this, arguments); syncFavoriteViews(); return result; };
  }
  window.addEventListener('mineradio:accounts-changed', function () { refreshUserPlaylists(true); });
  window.addEventListener('storage', function (event) { if (!event.key || event.key === 'mineradio-local-accounts-v1') refreshUserPlaylists(true); });
  window.addEventListener('pagehide', function () { likedSync.cancel(); });
  document.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('[data-web-library-import]');
    if (target) { event.preventDefault(); event.stopPropagation(); importPlaylist(target.getAttribute('data-web-library-import')).catch(function () {}); }
  });
  lastFingerprint = accountFingerprint();
  publish(true);
  store.loadCatalog(false);
}());

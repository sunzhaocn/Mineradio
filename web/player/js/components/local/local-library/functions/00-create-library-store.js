'use strict';

/* Account library state has no credentials and never writes to a music service. */
(function () {
  var PROVIDERS = ['netease', 'qq', 'kugou', 'qishui'];
  var STORE = 'mineradio-web-library-visibility-v1';
  function provider(value) { return value === 'qqmusic' ? 'qq' : String(value || ''); }
  function key(row) { return provider(row.provider) + ':' + String(row.id); }
  function safePreferences(storage) {
    var value;
    try { value = JSON.parse(storage.getItem(STORE) || '{}'); } catch (_) { value = {}; }
    value = value && typeof value === 'object' ? value : {};
    return {
      hiddenProviders: (Array.isArray(value.hiddenProviders) ? value.hiddenProviders : []).filter(function (p) { return PROVIDERS.indexOf(p) >= 0; }),
      hiddenPlaylists: (Array.isArray(value.hiddenPlaylists) ? value.hiddenPlaylists : []).filter(function (id) { return typeof id === 'string'; })
    };
  }
  window.createWebLibraryStore = function (options) {
    var preferences = safePreferences(options.storage), catalogRequest = null, likesRequest = null;
    var epoch = 0, catalogSequence = 0;
    var mergedCache = [], mergedCacheCloud = null, mergedCacheLocal = '';
    var state = { playlists: [], providers: {}, loaded: false, loading: false, error: '', partial: false,
      likesReady: false, likesLoading: false, likesErrors: {}, likesProgress: {}, cloudLikes: [] };
    function emit() { if (options.onChange) options.onChange(state); }
    function save() {
      try { options.storage.setItem(STORE, JSON.stringify(preferences)); }
      catch (_) { if (options.onStorageError) options.onStorageError(); }
      emit();
    }
    function hidden(row) { return preferences.hiddenProviders.indexOf(provider(row.provider)) >= 0 || preferences.hiddenPlaylists.indexOf(key(row)) >= 0; }
    function invalidateLikes() {
      epoch += 1; likesRequest = null; state.cloudLikes = []; state.likesReady = false;
      state.likesLoading = false; state.likesErrors = {}; state.likesProgress = {};
    }
    function mergedLikes() {
      var local = options.favorites ? options.favorites() : [], signature = JSON.stringify(local);
      if (mergedCacheCloud !== state.cloudLikes || mergedCacheLocal !== signature) {
        mergedCache = options.deduplicate(local.concat(state.cloudLikes));
        mergedCacheCloud = state.cloudLikes; mergedCacheLocal = signature;
      }
      return mergedCache;
    }
    async function loadCatalog(force) {
      if (catalogRequest && !force) return catalogRequest;
      if (state.loaded && !force) return state;
      var sequence = ++catalogSequence;
      if (force) { invalidateLikes(); state.playlists = []; state.providers = {}; state.loaded = false; }
      state.loading = true; state.error = ''; emit();
      var request = options.request('/api/library/catalog' + (force ? '?force=1' : '')).then(function (data) {
        if (sequence !== catalogSequence) return state;
        if (!data || data.ok !== true || !Array.isArray(data.playlists)) throw new Error(data && (data.message || data.error) || '音乐库返回异常');
        var seen = new Set();
        state.playlists = data.playlists.filter(function (row) {
          if (!row || !row.id || PROVIDERS.indexOf(provider(row.provider)) < 0 || seen.has(key(row))) return false;
          seen.add(key(row)); return true;
        }).map(function (row) { return Object.assign({}, row, { provider: provider(row.provider), kind: row.isLiked ? 'liked' : row.kind || 'created' }); });
        state.providers = data.providers || {}; state.partial = !!data.partial; state.loaded = true;
        return state;
      }).catch(function (error) {
        if (sequence === catalogSequence) state.error = error && error.message || '音乐库加载失败';
        return state;
      }).finally(function () {
        if (sequence === catalogSequence) { state.loading = false; emit(); }
        if (catalogRequest === request) catalogRequest = null;
      });
      catalogRequest = request; return request;
    }
    async function loadLikes(force) {
      if (force) invalidateLikes();
      if (likesRequest) return likesRequest;
      if (state.likesReady) return mergedLikes();
      var token = epoch;
      state.likesLoading = true; state.likesErrors = {}; state.likesProgress = {}; emit();
      var request = (async function () {
        await loadCatalog(false);
        if (token !== epoch) return mergedLikes();
        if (state.error && !state.loaded) { state.likesErrors.library = state.error; state.likesReady = false; return mergedLikes(); }
        var results = await Promise.all(PROVIDERS.map(async function (p) {
          var status = state.providers[p] || {}, rows = [], offset = 0;
          if (!status.configured) return rows;
          try {
            while (token === epoch) {
              var data = await options.request('/api/library/likes?provider=' + p + '&offset=' + offset + '&limit=100' + (force && offset === 0 ? '&force=1' : ''));
              if (token !== epoch) return [];
              if (!data || data.ok !== true) throw new Error(data && (data.message || data.error) || '喜欢的歌曲加载失败');
              var page = Array.isArray(data.tracks) ? data.tracks : [];
              rows.push.apply(rows, page);
              state.likesProgress[p] = rows.length; emit();
              if (!data.hasMore) break;
              var next = data.nextOffset == null ? offset + page.length : Number(data.nextOffset);
              if (!Number.isFinite(next) || next <= offset) throw new Error('分页没有前进，请刷新重试');
              offset = next;
            }
          } catch (error) {
            if (token === epoch) state.likesErrors[p] = error && error.message || '加载失败';
          }
          return rows;
        }));
        if (token === epoch) { state.cloudLikes = [].concat.apply([], results); state.likesReady = Object.keys(state.likesErrors).length === 0; }
        return mergedLikes();
      }()).finally(function () {
        if (token === epoch) { state.likesLoading = false; emit(); }
        if (likesRequest === request) likesRequest = null;
      });
      likesRequest = request; return request;
    }
    var api = {
      state: state, preferences: preferences, key: key, hidden: hidden, mergedLikes: mergedLikes,
      visiblePlaylists: function () { return state.playlists.filter(function (row) { return !hidden(row); }); },
      setProviderHidden: function (p, value) {
        p = provider(p); if (PROVIDERS.indexOf(p) < 0) return;
        preferences.hiddenProviders = preferences.hiddenProviders.filter(function (item) { return item !== p; });
        if (value) preferences.hiddenProviders.push(p); save();
      },
      setPlaylistHidden: function (row, value) {
        var id = key(row); preferences.hiddenPlaylists = preferences.hiddenPlaylists.filter(function (item) { return item !== id; });
        if (value) preferences.hiddenPlaylists.push(id); save();
      },
      loadCatalog: loadCatalog, loadLikes: loadLikes, invalidateLikes: function () { invalidateLikes(); emit(); },
      tracks: async function (p, id, params) {
        params = params || {};
        var row = state.playlists.find(function (item) { return provider(item.provider) === provider(p) && String(item.id) === String(id); });
        var endpoint = row && row.isLiked ? '/api/library/likes?' : '/api/library/tracks?id=' + encodeURIComponent(id) + '&';
        var data = await options.request(endpoint + 'provider=' + encodeURIComponent(provider(p)) + '&offset=' + (Number(params.offset) || 0) + '&limit=' + (Number(params.limit) || 100));
        if (!data || data.ok !== true) throw new Error(data && (data.message || data.error) || '歌单加载失败');
        return data;
      }
    };
    api.readAllTracks = async function (row, onProgress) {
      var rows = [], offset = 0, token = epoch;
      for (;;) {
        var data = await api.tracks(row.provider, row.id, { offset: offset, limit: 100 });
        if (token !== epoch) throw new Error('账号已变更，请重新导入');
        rows.push.apply(rows, Array.isArray(data.tracks) ? data.tracks : []);
        if (onProgress) onProgress(rows.length, Number(data.total) || 0);
        if (!data.hasMore) return rows;
        var next = data.nextOffset == null ? offset + (data.tracks || []).length : Number(data.nextOffset);
        if (!Number.isFinite(next) || next <= offset) throw new Error('分页没有前进，导入已停止');
        offset = next;
      }
    };
    return api;
  };
}());

/* Explicit, additive local-heart synchronization. No search or cross-source matching. */
(function () {
  window.createWebLocalLikedSync = function (options) {
    var active = null, requestIds = new Map();
    var state = { running: false, provider: '', phase: 'idle', message: '', eligible: 0,
      noSource: 0, already: 0, success: 0, failed: 0, read: 0, readTotal: 0, failures: [] };
    function emit() { if (options.onChange) options.onChange(state); }
    function provider(song) { var p = song && (song.provider || song.source); return p === 'qqmusic' ? 'qq' : p; }
    function nativeId(song, p) {
      var value = p === 'qq' ? song.mid || song.songmid || song.providerSongId || song.id
        : p === 'kugou' ? song.hash || song.fileHash || song.audioHash || song.providerSongId || song.id : song.id || song.providerSongId;
      return value == null ? '' : (p === 'kugou' ? String(value).toLowerCase() : String(value)).trim();
    }
    function stopped(message) { var error = new Error(message); error.name = 'AbortError'; return error; }
    function ensure(owner, acceptCancelled) {
      if (active !== owner || owner.account !== options.accountKey(owner.provider)) throw stopped('账号已变更，后续同步已停止');
      if (!acceptCancelled && owner.cancelled) throw stopped(owner.reason || '已取消后续同步');
    }
    async function idle(owner) {
      ensure(owner);
      while (options.busy && options.busy()) {
        state.message = '等待当前歌曲加载完成…'; emit();
        await new Promise(function (resolve) {
          var timer = setTimeout(done, 80);
          function done() { clearTimeout(timer); owner.controller.signal.removeEventListener('abort', done); resolve(); }
          owner.controller.signal.addEventListener('abort', done, { once: true });
        });
        ensure(owner);
      }
    }
    function collect(p) {
      var result = [], missing = 0;
      (options.favorites() || []).forEach(function (song) {
        var found = (options.sources(song) || []).filter(function (item) { return provider(item) === p && nativeId(item, p); });
        if (!found.length) missing++;
        found.forEach(function (actual) {
          var id = nativeId(actual, p);
          actual = Object.assign({}, actual, { provider: p, source: p, id: String(actual.id || id) });
          if (p === 'qq' && !actual.mid) actual.mid = id;
          if (p === 'kugou' && !actual.hash) actual.hash = id;
          if (!result.some(function (item) { return nativeId(item, p) === id || options.sameSong(item, actual); })) result.push(actual);
        });
      });
      return { songs: result, missing: missing };
    }
    async function read(owner, url) {
      await idle(owner);
      var data = await options.request(url, undefined, { signal: owner.controller.signal });
      ensure(owner); return data;
    }
    async function completeLikes(owner) {
      var rows = [], offset = 0;
      for (var page = 0; page < 1000; page++) {
        state.phase = 'reading'; state.message = '正在完整读取平台喜欢…'; emit();
        var data = await read(owner, '/api/library/likes?provider=' + owner.provider + '&force=1&offset=' + offset + '&limit=100');
        if (!data || data.ok !== true || !Array.isArray(data.tracks) || typeof data.hasMore !== 'boolean' || data.partial
          || data.complete === false && !data.hasMore) throw new Error(data && (data.message || data.error) || '平台喜欢未完整读完，本次没有同步');
        rows.push.apply(rows, data.tracks); state.read = rows.length; state.readTotal = Number(data.total) || 0; emit();
        var next = data.nextOffset == null ? offset + data.tracks.length : Number(data.nextOffset);
        if (!Number.isFinite(next) || next < offset || data.hasMore && next <= offset) throw new Error('平台分页没有前进，本次没有同步');
        if (!data.hasMore) {
          if (Number(data.total) > next) throw new Error('平台喜欢分页未完整读完，本次没有同步');
          return rows;
        }
        offset = next;
      }
      throw new Error('平台分页未结束，本次没有同步');
    }
    function start(p) {
      if (active) return active.promise;
      if (['netease', 'qq', 'kugou', 'qishui'].indexOf(p) < 0) return Promise.reject(new Error('请选择有效平台'));
      var owner = { provider: p, account: options.accountKey(p), controller: new AbortController(), cancelled: false };
      active = owner;
      Object.assign(state, { running: true, provider: p, phase: 'catalog', message: '正在确认平台喜欢歌单…', eligible: 0,
        noSource: 0, already: 0, success: 0, failed: 0, read: 0, readTotal: 0, failures: [] }); emit();
      owner.promise = (async function () {
        try {
          var local = collect(p); state.eligible = local.songs.length; state.noSource = local.missing; emit();
          if (!local.songs.length) { state.phase = 'complete'; state.message = '本机喜欢中没有此平台的原生音源，无需同步'; return state; }
          var catalog = await read(owner, '/api/library/catalog?provider=' + p + '&force=1');
          var account = catalog && catalog.providers && catalog.providers[p];
          if (!catalog || catalog.ok !== true || !Array.isArray(catalog.playlists) || !account || account.configured !== true || account.ok !== true)
            throw new Error(account && account.message || catalog && (catalog.message || catalog.error) || '请先登录平台并刷新音乐库');
          var targets = catalog.playlists.filter(function (row) { return provider(row) === p && (row.isLiked === true || row.kind === 'liked'); });
          if (targets.length !== 1) throw new Error(targets.length ? '平台返回多个喜欢歌单，无法确定同步目标；请先在平台确认' : '平台没有返回明确的喜欢歌单，本次没有同步');
          var target = targets[0];
          if (!target.id || target.editable !== true || target.canAdd !== true) throw new Error('此平台喜欢歌单暂不支持添加，本次没有同步');
          var existing = await completeLikes(owner);
          var pending = local.songs.filter(function (song) {
            var found = existing.some(function (item) { return provider(item) === p && (nativeId(item, p) === nativeId(song, p) || options.sameSong(item, song)); });
            if (found) requestIds.delete(p + '|' + String(target.id) + '|' + nativeId(song, p));
            return !found;
          });
          state.already = local.songs.length - pending.length; emit();
          for (var i = 0; i < pending.length; i++) {
            await idle(owner); state.phase = 'writing'; state.message = '正在同步 ' + (i + 1) + ' / ' + pending.length + '：' + (pending[i].name || pending[i].title || '歌曲'); emit();
            var key = p + '|' + String(target.id) + '|' + nativeId(pending[i], p);
            var operation = requestIds.get(key);
            if (!operation) {
              operation = { id: options.requestId ? options.requestId() : window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID()
                : 'liked-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), song: JSON.parse(JSON.stringify(pending[i])) };
              requestIds.set(key, operation);
            }
            try {
              ensure(owner);
              // Cancellation never aborts a POST whose platform write may already have happened.
              var result = await options.request('/api/library/mutate', { provider: p, id: String(target.id), operation: 'add', song: operation.song, requestId: operation.id });
              ensure(owner, true);
              if (!result || result.ok !== true) { requestIds.delete(key); throw new Error(result && (result.message || result.error) || '平台尚未确认同步'); }
              if (result.provider !== p || String(result.playlistId) !== String(target.id) || result.operation !== 'add' || result.verified === false)
                throw new Error('平台返回的同步目标不一致，结果尚未确认');
              requestIds.delete(key); state.success++;
            } catch (error) {
              ensure(owner, true);
              if (error.definitive) requestIds.delete(key);
              state.failed++; state.failures.push({ name: pending[i].name || pending[i].title || '歌曲', message: error.message || '同步失败' });
            }
            emit(); ensure(owner);
          }
          state.phase = 'complete'; state.message = state.failed ? '同步结束，部分歌曲失败；可重试未确认的歌曲' : '同步完成';
        } catch (error) {
          state.phase = error.name === 'AbortError' || owner.cancelled ? 'cancelled' : 'error';
          state.message = owner.cancelled ? owner.reason || '已取消后续同步；已确认的收藏会保留' : error.message || '同步失败，请重试';
        } finally {
          if (active === owner) { active = null; state.running = false; emit(); }
        }
        return state;
      }());
      return owner.promise;
    }
    return { state: state, start: start, cancel: function (reason) {
      if (!active) return;
      active.cancelled = true; active.reason = reason || '已取消后续同步；已确认的收藏会保留'; active.controller.abort();
      state.phase = 'cancelling'; state.message = '正在停止后续同步，等待当前操作确认…'; emit();
    }, accountsChanged: function () {
      requestIds.clear();
      Object.assign(state, { eligible: 0, noSource: 0, already: 0, success: 0, failed: 0, read: 0, readTotal: 0, failures: [] });
      if (active) { active.cancelled = true; active.reason = '账号已变更，旧账号后续同步已停止'; active.controller.abort(); }
      else { state.provider = ''; state.phase = 'idle'; state.message = ''; }
      emit();
    } };
  };
}());

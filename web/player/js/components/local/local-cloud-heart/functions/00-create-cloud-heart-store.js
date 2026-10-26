'use strict';

(function () {
  window.createWebCloudHeartStore = function (options) {
    var cache = new Map(), pending = new Map(), mutationPending = new Map(), requestIds = new Map(), epoch = 0;
    var songStates = [];
    var providers = ['netease', 'qq', 'kugou', 'qishui'];
    function provider(song) { var p = song && (song.provider || song.source); return p === 'qqmusic' ? 'qq' : p; }
    function sources(song) {
      return [song].concat(song && song._webFavoriteSources || [], song && song._webSearchSources || []).filter(function (row) { return row && typeof row === 'object'; });
    }
    function key(song) {
      return sources(song).map(function (row) { return [provider(row), row.mid || row.songmid || row.hash || row.providerSongId || row.id || '', row.name || row.title || '', row.artist || row.author || ''].join(':'); }).sort().join('|');
    }
    function stateFor(song) {
      var state = songStates.find(function (item) { return options.sameSong(item.song, song); });
      if (!state) { state = { song: Object.assign({}, song), generation: 0, readSequence: 0, entry: null, keys: new Set() }; songStates.push(state); }
      state.keys.add(key(song)); return state;
    }
    function publishEntry(state, entry) {
      state.entry = entry;
      state.keys.forEach(function (id) { cache.set(id, entry); });
    }
    async function resolveCandidates(song) {
      var result = {}, known = sources(song);
      await Promise.all(providers.map(async function (p) {
        if (options.configured && !options.configured(p)) return;
        var candidate = known.find(function (row) { return provider(row) === p && options.sameSong(song, row); });
        if (!candidate && options.match) {
          try { var found = await options.match(song, p); candidate = found && (found.song || (found.name ? found : null)); }
          catch (_) { candidate = null; }
        }
        if (candidate && provider(candidate) === p && options.sameSong(song, candidate)) result[p] = Object.assign({}, candidate);
      }));
      return result;
    }
    async function membership(song, force) {
      var id = key(song), token = epoch, state = stateFor(song), old = cache.get(id) || state.entry;
      if (old) cache.set(id, old);
      if (!force && old && Date.now() - old.updatedAt < 120000) return old;
      if (pending.has(id)) return pending.get(id);
      var generation = state.generation, sequence = ++state.readSequence;
      function superseded() { return generation !== state.generation || sequence !== state.readSequence; }
      function latestEntry() {
        if (!state.entry) throw new Error('平台收藏查询已更新，请重新查询');
        cache.set(id, state.entry); return state.entry;
      }
      var request = (async function () {
        var candidates = await resolveCandidates(song);
        if (token !== epoch) throw new Error('账号已变更，请重新操作');
        if (superseded()) return latestEntry();
        var body = Object.assign({}, song, { _webFavoriteSources: Object.keys(candidates).map(function (p) { return candidates[p]; }), _webSearchSources: [] });
        var data = await options.request('/api/library/membership', { song: body, sources: Object.keys(candidates).map(function (p) { return candidates[p]; }), force: !!force });
        if (token !== epoch) throw new Error('账号已变更，请重新操作');
        // A completed cloud write is newer than every read started before it,
        // including a response whose upstream read finished before the write.
        if (superseded()) return latestEntry();
        if (!data || data.ok !== true) throw new Error(data && (data.message || data.error) || '平台收藏状态查询失败');
        var entry = { updatedAt: Date.now(), data: data, candidates: candidates, song: Object.assign({}, song) };
        publishEntry(state, entry); if (options.onChange) options.onChange(); return entry;
      }()).finally(function () { if (pending.get(id) === request) pending.delete(id); });
      pending.set(id, request); return request;
    }
    async function mutate(song, row, operation) {
      if (operation !== 'add' && operation !== 'remove') throw new Error('不支持此操作');
      var p = provider(row), mutationKey = key(song) + ':' + p + ':' + row.id + ':' + operation;
      if (mutationPending.has(mutationKey)) return mutationPending.get(mutationKey);
      var token = epoch;
      var request = (async function () {
        var entry = await membership(song, false);
        if (token !== epoch) throw new Error('账号已变更，请重新操作');
        if (operation === 'remove' && !(entry.data.playlists || []).some(function (item) { return provider(item) === p && String(item.id) === String(row.id); })) return { ok: true, noop: true };
        var actual = row.matchedSong || row.song || entry.candidates[p];
        if (!actual || provider(actual) !== p || !options.sameSong(song, actual)) throw new Error('未找到歌名、完整歌手与版本都匹配的' + (options.labels[p] || p) + '音源');
        if (!requestIds.has(mutationKey)) requestIds.set(mutationKey, options.requestId ? options.requestId() :
          window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'library-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
        if (token !== epoch) throw new Error('账号已变更，请重新操作');
        var data = await options.request('/api/library/mutate', { provider: p, id: row.id, operation: operation, song: actual, requestId: requestIds.get(mutationKey) });
        if (token !== epoch) throw new Error('账号已变更，请重新查询平台状态');
        if (!data || data.ok !== true) { requestIds.delete(mutationKey); throw new Error(data && (data.message || data.error) || '平台歌单同步失败'); }
        requestIds.delete(mutationKey);
        var state = stateFor(song);
        state.generation += 1; state.readSequence += 1;
        state.keys.forEach(function (id) { pending.delete(id); });
        // Preserve other confirmed playlists from any newer completed read.
        entry = state.entry || entry;
        var detail = entry.data.providers && entry.data.providers[p];
        if (!detail) { if (!entry.data.providers) entry.data.providers = {}; detail = entry.data.providers[p] = { ok: true, playlists: [] }; }
        detail.playlists = (detail.playlists || []).filter(function (item) { return String(item.id) !== String(row.id); });
        entry.data.playlists = (entry.data.playlists || []).filter(function (item) { return !(provider(item) === p && String(item.id) === String(row.id)); });
        if (operation === 'add') {
          var confirmed = Object.assign({}, row, { provider: p, matchedSong: actual });
          detail.playlists.push(confirmed); entry.data.playlists.push(confirmed); detail.ok = true;
        }
        entry.updatedAt = Date.now(); publishEntry(state, entry);
        if (options.onChange) options.onChange(); return data;
      }()).finally(function () { if (mutationPending.get(mutationKey) === request) mutationPending.delete(mutationKey); });
      mutationPending.set(mutationKey, request); return request;
    }
    return { key: key, membership: membership, mutate: mutate, resolveCandidates: resolveCandidates,
      peek: function (song) { return cache.get(key(song)); },
      confirmedProviders: function (song) {
        var entry = cache.get(key(song)); if (!entry) return [];
        return providers.filter(function (p) { var result = entry.data.providers && entry.data.providers[p]; return result && result.ok === true && (result.playlists || []).length > 0; });
      },
      clear: function () { epoch += 1; cache.clear(); pending.clear(); mutationPending.clear(); requestIds.clear(); songStates = []; if (options.onChange) options.onChange(); }
    };
  };
  window.createWebHeartPressController = function (options) {
    var press = null, suppressed = null;
    function cancel() {
      var previous = press; press = null;
      if (previous) options.clearTimeout(previous.timer);
    }
    function isSuppressed(el) { return !!(suppressed && suppressed.el === el && options.now() < suppressed.until); }
    return {
      down: function (el, song, x, y) {
        cancel(); press = { el: el, song: song, x: x, y: y };
        press.timer = options.setTimeout(function () {
          if (!press) return;
          suppressed = { el: press.el, until: options.now() + 1600 };
          options.onLongPress(press.el, press.song);
        }, 550);
      },
      move: function (x, y) { if (press && Math.hypot(x - press.x, y - press.y) > 9) cancel(); },
      cancel: cancel, isSuppressed: isSuppressed,
      consumeClick: function (el) { if (!isSuppressed(el)) return false; suppressed = null; return true; }
    };
  };
}());

'use strict';

// Recommendation checks own their requests and temporary media. They never
// replace the current audio, queue, playback token or next-track preload.
function homeRecommendationRuntime() {
  if (!homeRecommendationRuntime.state) {
    var state = { epoch: 0, cache: new Map(), selections: new Map(), busy: 0, waiters: [] };
    homeRecommendationRuntime.state = state;
    function invalidate() {
      var discovery = state.selections.get('discovery');
      state.epoch++;
      state.cache.clear();
      state.selections.forEach(function (selection) { selection.controller.abort(); });
      state.selections.clear();
      if (discovery && !discovery.pending) state.selections.set('discovery', discovery);
      if (typeof renderHomeDashboard === 'function') setTimeout(renderHomeDashboard, 0);
    }
    if (window.addEventListener) {
      window.addEventListener('offline', function () {
        state.selections.forEach(function (selection) { selection.controller.abort(); selection.pending=false; selection.expiresAt=0; });
      });
      window.addEventListener('mineradio:app-enter', function () {
        var selection = state.selections.get('discovery');
        if (selection) selection.controller.abort();
        state.selections.delete('discovery');
        homeRecommendationSelection.entrySeed = Date.now();
        if (typeof renderHomeDashboardDiscovery === 'function') renderHomeDashboardDiscovery();
      });
      window.addEventListener('mineradio:accounts-changed', invalidate);
      window.addEventListener('storage', function (event) {
        if (!event || !event.key || event.key === 'mineradio-local-accounts-v1') invalidate();
      });
    }
  }
  return homeRecommendationRuntime.state;
}

function homeRecommendationContextKey() {
  return JSON.stringify([homeRecommendationRuntime().epoch, ['netease', 'qq', 'kugou', 'qishui'].map(function (provider) {
    var status = window.localMusicCredentials && typeof window.localMusicCredentials.status === 'function'
      ? window.localMusicCredentials.status(provider) || {}
      : typeof platformStatus === 'function' ? platformStatus(provider) || {} : {};
    return [provider, typeof getProviderPlaybackQuality === 'function' ? getProviderPlaybackQuality(provider) : '',
      !!status.loggedIn, status.userId || status.uid || '', status.vipLevel || '', !!status.isVip, !!status.isSvip];
  })]);
}

function homeRecommendationCacheKey(song) {
  return normalizePlaybackProvider(songProviderKey(song)) + '|' + homeDashboardSongKey(song) + '|' + (song && song.localUrl || '');
}

function homeRecommendationSourceLabel(song) {
  if (song && (song.type === 'local' || song.source === 'local' || song.provider === 'local' || song.localUrl || song.localFileId || song.localKey)) return '本地音乐';
  return typeof playbackProviderLabel === 'function' ? playbackProviderLabel(song) : songProviderKey(song);
}

function cachedHomePlayableRecommendation(song) {
  var state = homeRecommendationRuntime(), scope = homeRecommendationContextKey();
  var entry = state.cache.get(homeRecommendationCacheKey(song));
  return entry && entry.scope === scope && entry.expiresAt > Date.now() ? entry : null;
}

function homeRecommendationPlaybackOptions(song, options) {
  var entry = cachedHomePlayableRecommendation(song);
  if (!entry || !entry.song || !entry.data || !entry.data.url || entry.local) return options || {};
  return Object.assign({}, options, { preResolvedPlaybackData: entry.data });
}

function homeRecommendationRequest(check, operation, timeoutMs) {
  if (!check.active()) return Promise.resolve(null);
  var remaining = Math.min(timeoutMs, check.deadlineAt - Date.now());
  if (remaining <= 0) return Promise.resolve(null);
  var controller = new AbortController(), owner = check.controller.signal;
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(cancel, remaining);
    function finish(value) {
      if (settled) return;
      settled = true; clearTimeout(timer); owner.removeEventListener('abort', cancel);
      resolve(check.active() ? value : null);
    }
    function cancel() { controller.abort(); finish(null); }
    owner.addEventListener('abort', cancel, { once: true });
    if (owner.aborted) { cancel(); return; }
    Promise.resolve().then(function () { return operation(controller.signal); }).then(finish, function () { finish(null); });
  });
}

function homeRecommendationSlot(check) {
  var state = homeRecommendationRuntime();
  return new Promise(function (resolve) {
    var signal = check.controller.signal;
    function start() {
      signal.removeEventListener('abort', cancelled);
      if (!check.active()) { resolve(null); return; }
      state.busy++;
      var released = false;
      resolve(function () {
        if (released) return; released = true; state.busy--;
        while (state.busy < 2 && state.waiters.length) state.waiters.shift()();
      });
    }
    function cancelled() {
      var index = state.waiters.indexOf(start);
      if (index >= 0) state.waiters.splice(index, 1);
      resolve(null);
    }
    if (state.busy < 2) start();
    else { state.waiters.push(start); signal.addEventListener('abort', cancelled, { once: true }); }
  });
}

async function probeHomeRecommendationMedia(check, song, data, local) {
  if (!data || !data.url || data.playable === false || !check.active()) return false;
  var url = local ? data.url : '/api/audio?url=' + encodeURIComponent(data.url);
  if (!local && window.localMusicCredentials) url = window.localMusicCredentials.url(url, songProviderKey(song));
  var media = new Audio();
  media.preload = 'auto'; media.autoplay = false; media.muted = true; media.volume = 0;
  media.crossOrigin = 'anonymous';
  try {
    return !!await homeRecommendationRequest(check, function (signal) {
      return new Promise(function (resolve) {
        var done = false;
        function finish(value) {
          if (done) return; done = true;
          ['loadeddata', 'canplay', 'canplaythrough'].forEach(function (name) { media.removeEventListener(name, ready); });
          media.removeEventListener('error', failed); signal.removeEventListener('abort', failed);
          resolve(value);
        }
        function ready() { if (!media.error && media.readyState >= 2) finish(true); }
        function failed() { finish(false); }
        ['loadeddata', 'canplay', 'canplaythrough'].forEach(function (name) { media.addEventListener(name, ready); });
        media.addEventListener('error', failed);
        signal.addEventListener('abort', failed, { once: true });
        if (signal.aborted) { failed(); return; }
        media.src = url; media.load(); ready();
      });
    }, 6500);
  } finally {
    media.pause(); media.removeAttribute('src'); media.load();
  }
}

async function resolveHomePlayableRecommendation(original, options) {
  options = options || {};
  if (!original || options.signal && options.signal.aborted || options.isCurrent && !options.isCurrent()) return null;
  var cached = cachedHomePlayableRecommendation(original);
  if (cached) return cached.song ? cloneSong(cached.song) : null;
  var scope = homeRecommendationContextKey(), controller = new AbortController();
  var check = { controller: controller, deadlineAt: Infinity };
  check.active = function () { return !controller.signal.aborted && Date.now() < check.deadlineAt
    && !(typeof navigator !== 'undefined' && navigator.onLine === false)
    && scope === homeRecommendationContextKey() && (!options.isCurrent || options.isCurrent()); };
  var abort = function () { controller.abort(); };
  if (options.signal) options.signal.addEventListener('abort', abort, { once: true });
  var release = null;
  var result = null, data = null, local = original.type === 'local' || original.source === 'local'
    || original.provider === 'local' || !!(original.localUrl || original.localFileId || original.localKey);
  try {
    release = await homeRecommendationSlot(check);
    if (!release || !check.active()) return null;
    cached = cachedHomePlayableRecommendation(original);
    if (cached) return cached.song ? cloneSong(cached.song) : null;
    check.deadlineAt = Date.now() + 35000;
    if (local) {
      var localSong = cloneSong(original);
      if (localSong.localUrl && await probeHomeRecommendationMedia(check, localSong, { url: localSong.localUrl }, true)) result = localSong;
      else if (typeof resolveRecentLocalSong === 'function') {
        localSong = await homeRecommendationRequest(check, function () { return resolveRecentLocalSong(original); }, 5500);
        if (localSong && await probeHomeRecommendationMedia(check, localSong, { url: localSong.localUrl }, true)) result = localSong;
      }
    } else {
      var providers = [songProviderKey(original)].concat(typeof alternatePlaybackProviders === 'function' ? alternatePlaybackProviders(original) : []);
      var visited = Object.create(null);
      for (var i = 0; i < providers.length && check.active(); i++) {
        var provider = normalizePlaybackProvider(providers[i]);
        if (visited[provider]) continue;
        visited[provider] = true;
        var candidate = i === 0 ? cloneSong(original) : await homeRecommendationRequest(check, function (signal) {
          return searchAlternatePlatformSong(original, provider, null, { signal: signal, background: true });
        }, 4500);
        if (!candidate || !check.active()) continue;
        data = await homeRecommendationRequest(check, function (signal) {
          return resolveAlbumGaplessPlaybackData(candidate, { signal: signal, background: true, isCurrent: check.active });
        }, 6500);
        var urls = [], qualities = [];
        for (var qualityAttempt = 0; qualityAttempt < 8 && data && data.url && check.active(); qualityAttempt++) {
          if (urls.indexOf(data.url) >= 0) break;
          if (await probeHomeRecommendationMedia(check, candidate, data, false)) { result = candidate; break; }
          urls.push(data.url);
          var quality = data.nativeQuality || data.quality || data.level;
          if (quality && qualities.indexOf(quality) < 0) qualities.push(quality);
          if (typeof window.resolvePlaybackDataWithQualityFallback !== 'function') break;
          data = await homeRecommendationRequest(check, function (signal) {
            return window.resolvePlaybackDataWithQualityFallback(candidate, { data: data, signal: signal,
              excludedUrls: urls.slice(), excludedQualities: qualities.slice(), isCurrent: check.active });
          }, 4500);
        }
        if (result) break;
      }
    }
    if (!check.active()) return null;
    if (result) {
      result = typeof mergeSearchSongSources === 'function' ? mergeSearchSongSources(result, original) : cloneSong(result);
    }
    var entry = { song: result, data: result && !local ? data : null, local: local,
      scope: scope, expiresAt: Date.now() + (result ? 60000 : 15000) };
    var cache = homeRecommendationRuntime().cache;
    if (cache.size > 512) cache.clear();
    cache.set(homeRecommendationCacheKey(original), entry);
    if (result) cache.set(homeRecommendationCacheKey(result), entry);
    return result ? cloneSong(result) : null;
  } catch (_) { return null; }
  finally {
    if (options.signal) options.signal.removeEventListener('abort', abort);
    if (release) release();
  }
}

async function filterHomePlayableRecommendations(songs, options) {
  options = options || {};
  var pool = Array.isArray(songs) ? songs : [], results = [], completed = [], cursor = 0, passed = 0, frontier = 0;
  var limit = options.limit == null ? pool.length : Math.max(0, options.limit);
  function active() { return (!options.signal || !options.signal.aborted) && (!options.isCurrent || options.isCurrent()); }
  function ready() { return results.slice(0, frontier).filter(function (song) {
    return song && cachedHomePlayableRecommendation(song);
  }).slice(0, limit); }
  async function worker() {
    while (active() && cursor < pool.length && passed < limit) {
      var index = cursor++;
      var song = await resolveHomePlayableRecommendation(pool[index], options);
      if (!active()) return;
      completed[index] = true;
      if (song) results[index] = song;
      passed = results.filter(function (item) { return item && cachedHomePlayableRecommendation(item); }).length;
      while (completed[frontier]) frontier++;
      if (options.onProgress) options.onProgress(ready());
    }
  }
  await Promise.all([worker(), worker()]);
  return active() ? ready() : [];
}

function homeRecommendationSelection(name, candidates, limit, onChange) {
  var state = homeRecommendationRuntime(), scope = homeRecommendationContextKey();
  var key = JSON.stringify(candidates.map(homeRecommendationCacheKey)), selection = state.selections.get(name);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return selection ? selection.songs.slice() : [];
  // Discovery is a snapshot for this app entry. Signed URLs can expire without
  // replacing the visible songs; normal playback resolves a fresh URL on click.
  if (name === 'discovery' && selection) return selection.songs.slice();
  if (name === 'discovery' && !candidates.length) return [];
  if (!selection || selection.key !== key || selection.scope !== scope || !selection.pending && (selection.expiresAt <= Date.now()
    || selection.songs.some(function (song) { return !cachedHomePlayableRecommendation(song); }))) {
    if (selection) selection.controller.abort();
    selection = { key: key, scope: scope, controller: new AbortController(), songs: [], pending: true, expiresAt: 0 };
    state.selections.set(name, selection);
    var owner = selection;
    filterHomePlayableRecommendations(candidates, { limit: limit, signal: owner.controller.signal,
      isCurrent: function () { return state.selections.get(name) === owner && owner.scope === homeRecommendationContextKey(); },
      onProgress: function (songs) { owner.songs = songs; if (onChange) onChange(); }
    }).then(function (songs) {
      if (state.selections.get(name) !== owner || owner.controller.signal.aborted) return;
      owner.songs = songs; owner.pending = false;
      owner.expiresAt = songs.length ? Math.min.apply(null, songs.map(function (song) {
        var entry = cachedHomePlayableRecommendation(song); return entry ? entry.expiresAt : Date.now();
      })) : Date.now() + 15000;
      if (onChange) onChange();
    }).catch(function () {
      if (state.selections.get(name) !== owner) return;
      owner.pending = false; owner.expiresAt = Date.now() + 15000;
    });
  }
  return selection.songs.filter(function (song) { var entry = cachedHomePlayableRecommendation(song); return entry && entry.song; });
}

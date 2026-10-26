'use strict';

// A radio session owns a replenished queue. Taste stays in this browser; only
// ordinary artist searches and public discovery requests leave the client.
(function () {
  var ready = false, active = false, starting = false, epoch = 0;
  var queue = null, pool = [], excluded = new Set(), heard = new Set(), batch = 0;
  var pendingFill = null, pendingStart = null, pendingNext = null, metadata = null, metadataAt = 0;
  var previousMode = 'loop', feedback = {}, status = '', lastError = '';
  var controllers = new Set(), originalPlay, originalNext, originalPrev, originalCycle;
  var sourceCache = new Map(), sourceGeneration = 0, sourceTimer = 0, sourceWorker = null;
  var STORE = 'mineradio-personal-radio-v1';
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    feedback = saved.feedback && typeof saved.feedback === 'object' ? saved.feedback : {};
    heard = new Set(Array.isArray(saved.recent) ? saved.recent.slice(-300) : []);
  } catch (_) {}
  function engine() { return window.webPersonalRadioEngine; }
  function textKey(song) {
    return 'track:' + [song && (song.name || song.title), song && song.artist].map(function (value) {
      return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
    }).join('|');
  }
  function keys(song) { return [engine().key(song), engine().canonical ? engine().canonical(song) : textKey(song)].filter(Boolean); }
  function store() {
    try {
      var entries = Object.keys(feedback).sort(function (a, b) { return (feedback[b].updatedAt || 0) - (feedback[a].updatedAt || 0); }).slice(0, 200);
      var bounded = {}; entries.forEach(function (key) { bounded[key] = feedback[key]; }); feedback = bounded;
      localStorage.setItem(STORE, JSON.stringify({ recent: Array.from(heard).slice(-300), feedback: feedback }));
    } catch (_) {}
  }
  function favorites() { return window.webLocalLibrary ? window.webLocalLibrary.favorites() : []; }
  function profile() {
    var stats = typeof listenStatsState !== 'undefined' ? listenStatsState : {};
    return engine().profile({ favorites: favorites(), history: stats.history || [], artists: stats.artists || {}, feedback: feedback, metadata: metadata || {} });
  }
  function current() { return queue && queue === playQueue && currentIdx >= 0 ? queue[currentIdx] : null; }
  function isSession() { return active && queue && playQueue === queue; }
  function remaining() { return queue ? queue.length - (queue === playQueue ? currentIdx : -1) - 1 : 0; }
  function ui() {
    var enabled = active || starting;
    if (document.body.classList.contains('web-personal-radio') !== enabled) document.body.classList.toggle('web-personal-radio', enabled);
    var toggle = document.getElementById('personal-radio-toggle');
    if (toggle) {
      var label = enabled ? '退出随心听' : '随心听';
      toggle.setAttribute('aria-label', label); toggle.setAttribute('aria-pressed', String(enabled)); toggle.title = label;
      var caption = toggle.querySelector('.web-player-more-label'); if (caption) caption.textContent = label;
      toggle.classList.toggle('active', enabled);
    }
    var nav = window.webMobileNavigation;
    if (nav && nav.active() && nav.current() === 'player') {
      var heading = document.getElementById('web-mobile-page-title');
      if (heading) heading.textContent = enabled ? '随心听' : '正在播放';
    }
  }
  function invalidate() {
    epoch++;
    controllers.forEach(function (controller) { controller.abort(); }); controllers.clear();
    cancelTailNext(); cancelSourceWarm(); sourceCache.clear();
    pendingFill = pendingStart = null;
  }
  function stop(silent) {
    if (!active && !starting) return;
    invalidate(); active = starting = false; status = lastError = '';
    if (typeof activeRadioContext !== 'undefined' && activeRadioContext && activeRadioContext.type === 'personal-radio') activeRadioContext = null;
    playMode = previousMode;
    if (typeof syncActiveAudioRepeatMode === 'function') syncActiveAudioRepeatMode(audio);
    if (typeof updatePlayModeButton === 'function') updatePlayModeButton(false);
    ui();
    if (!silent) showToast('已退出随心听');
  }
  async function request(url, version, timeout) {
    var controller = new AbortController(); controllers.add(controller);
    var timer = setTimeout(function () { controller.abort(); }, timeout || 18000);
    try {
      var response = await apiJson(url, { signal: controller.signal, timeoutMs: timeout || 18000, priority: 'low' });
      return version === epoch ? response : null;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function candidates(version, taste) {
    var seedList = engine().seeds(taste) || [];
    var number = batch++, tasks = [], providers = ['netease', 'qq', 'kugou', 'qishui'];
    if (!metadata || Date.now() - metadataAt > (metadata.songs_indexed ? 300000 : 60000)) tasks.push(request('/api/radio/metadata', version, 7000).then(function (data) {
      if (data && data.song_charts) { metadata = data; metadataAt = Date.now(); }
      return [];
    }));
    seedList.slice(0, Math.min(3, seedList.length)).forEach(function (_, slot) {
      var seed = seedList[(number * 3 + slot) % seedList.length];
      var provider = providers[(number + slot) % providers.length];
      var prefix = provider === 'netease' ? '/api' : '/api/' + provider;
      var offset = Math.floor(number / 2) % 5 * 30;
      tasks.push(request(prefix + '/search?keywords=' + encodeURIComponent(String(seed).slice(0, 100)) + '&limit=30&offset=' + offset, version)
        .then(function (data) { return data && Array.isArray(data.songs) ? data.songs : []; }));
    });
    // The exploration pool introduces other artists; it is reranked locally,
    // never presented as an authenticated platform recommendation feed.
    if (!seedList.length || pool.length < 24 || number % 2 === 0) {
      tasks.push(request('/api/discover/home', version, 25000).then(function (data) {
        return data && Array.isArray(data.dailySongs) ? data.dailySongs : [];
      }));
    }
    var results = await Promise.allSettled(tasks);
    if (version !== epoch) return;
    var merged = [];
    results.forEach(function (result) { if (result.status === 'fulfilled') merged = merged.concat(result.value || []); });
    var unique = new Map();
    pool.concat(merged).forEach(function (song) {
      if (song && typeof song === 'object' && engine().key(song)) unique.set(engine().key(song), song);
    });
    pool = Array.from(unique.values()).slice(-360);
  }
  function choose(taste, limit) {
    var skip = new Set(Array.from(excluded).concat(Array.from(heard)));
    (queue || []).forEach(function (song) { keys(song).forEach(function (key) { skip.add(key); }); });
    return engine().rank(pool.filter(function (song) {
      return !keys(song).some(function (key) { return skip.has(key); });
    }), taste, { excludeKeys: skip, recentKeys: heard, limit: limit, seed: batch }).map(function (song) {
      var next = Object.assign({}, song);
      next.personalRadioReason = next.personalRadioReason || '根据你的收听偏好推荐';
      next.radioContext = { type: 'personal-radio', playlistName: '随心听', reason: next.personalRadioReason };
      return next;
    });
  }
  function refill(force) {
    if (!active && !starting) return Promise.resolve(0);
    if (!force && remaining() >= 5) return Promise.resolve(remaining());
    if (pendingFill) return pendingFill;
    var version = epoch;
    var promise = (async function () {
      var taste = profile(), selected = choose(taste, 12);
      if (selected.length < 8) { await candidates(version, taste); if (version !== epoch) return 0; selected = choose(profile(), 12); }
      if (version !== epoch || (!active && !starting) || active && playQueue !== queue) return 0;
      selected.forEach(function (song) { queue.push(song); });
      // The session queue is an append-only history and upcoming reservoir.
      // A changed taste can rank new candidates, never replace a queued song.
      lastError = selected.length || remaining() ? '' : '暂时没有新的推荐，点下一首重试';
      if (queue === playQueue) safeRenderQueuePanel('personal-radio-refill', { scrollCurrent: false });
      scheduleSourceWarm(); ui(); return remaining();
    }()).catch(function () {
      if (version === epoch) { lastError = '推荐暂时加载失败，点下一首重试'; ui(); }
      return 0;
    }).finally(function () { if (version === epoch) pendingFill = null; });
    pendingFill = promise; return promise;
  }
  function remember(song) {
    keys(song).forEach(function (key) { heard.delete(key); heard.add(key); });
    while (heard.size > 400) heard.delete(heard.values().next().value);
    store();
  }
  function skipFeedback() {
    var song = current();
    if (!song || !audio || audio.error || audio.currentTime < 1 || audio.currentTime > 30) return;
    var key = engine().key(song), previous = feedback[key] || {};
    feedback[key] = { name: song.name, artist: song.artist, skips: (Number(previous.skips) || 0) + 1, updatedAt: Date.now() };
    store();
  }
  function cancelTailNext() {
    var owner = pendingNext; pendingNext = null;
    if (owner && owner.cancel) owner.cancel();
  }
  function cancelSourceWarm() {
    if (sourceTimer) clearTimeout(sourceTimer);
    sourceTimer = 0;
    var owner = sourceWorker; sourceWorker = null;
    if (owner) owner.controller.abort();
  }
  function sourceScope() {
    var preferences = typeof nextTrackPreloadPreferenceSignature === 'function' ? nextTrackPreloadPreferenceSignature()
      : ['netease', 'qq', 'kugou', 'qishui', 'spotify'].map(function (provider) {
        return typeof getProviderPlaybackQuality === 'function' ? getProviderPlaybackQuality(provider) : '';
      }).join('|');
    return sourceGeneration + '|' + preferences;
  }
  function sourceExpiry(data) {
    var deadline = Date.now() + 120000;
    function cap(value) {
      var number = Number(value);
      if (!isFinite(number) && typeof value === 'string') number = Date.parse(value);
      if (!isFinite(number)) return;
      if (number > 1000000000 && number < 100000000000) number *= 1000;
      if (number > 100000000000) deadline = Math.min(deadline, number - 5000);
    }
    ['expiresAt', 'expires_at', 'expireTime', 'expire_time', 'expiration'].forEach(function (key) { cap(data[key]); });
    ['expiresIn', 'expires_in', 'ttl'].forEach(function (key) {
      if (data[key] != null && isFinite(Number(data[key])) && Number(data[key]) >= 0) deadline = Math.min(deadline, Date.now() + Number(data[key]) * 1000 - 5000);
    });
    try {
      var url = new URL(data.url, location.href);
      ['expires', 'expire', 'expiration', 'exp'].forEach(function (key) { cap(url.searchParams.get(key)); });
    } catch (_) {}
    return deadline;
  }
  function cachedPlaybackData(song, options) {
    options = options || {};
    if (!isSession() || !song || options.qualitySwitch || options.sourceSwitch || options.resumeRecovery
      || options.qualityOverride || options.fallbackDepth || options.sourceFallbackRecovery) return null;
    var key = engine().key(song), entry = sourceCache.get(key);
    if (!entry || entry.scope !== sourceScope() || entry.expires <= Date.now()
      || !queue.some(function (item) { return engine().key(item) === key; })) {
      sourceCache.delete(key); return null;
    }
    return entry.data;
  }
  function sourcePrepared(song) {
    var entry = sourceCache.get(engine().key(song));
    return !!(entry && entry.scope === sourceScope() && entry.expires > Date.now());
  }
  function savePlaybackData(song, data, scope) {
    if (!isSession() || !data || !data.url || scope !== sourceScope()) return false;
    var expires = sourceExpiry(data);
    if (expires <= Date.now()) return false;
    sourceCache.set(engine().key(song), { scope: scope, expires: expires, data: data });
    while (sourceCache.size > 12) sourceCache.delete(sourceCache.keys().next().value);
    return true;
  }
  function sourceForegroundBusy() {
    if (typeof playbackResolutionRuntime === 'function' && playbackResolutionRuntime().active) return true;
    if (typeof currentTrackMetadataBusy === 'function' && currentTrackMetadataBusy()) return true;
    // The sole media preload has priority over the additional URL-only worker.
    var entry = typeof nextTrackPreloadRuntime === 'function' ? nextTrackPreloadRuntime().entry : null;
    return !!(entry && (entry.status === 'resolving' || entry.status === 'retrying'));
  }
  function scheduleSourceWarm(delay) {
    if (sourceTimer || sourceWorker || !isSession() || typeof resolveAlbumGaplessPlaybackData !== 'function') return;
    sourceTimer = setTimeout(function () {
      sourceTimer = 0;
      if (!isSession()) return;
      if (sourceForegroundBusy()) { scheduleSourceWarm(350); return; }
      var song = null;
      var nextMedia = typeof nextTrackPreloadRuntime === 'function' ? nextTrackPreloadRuntime().entry : null;
      for (var i = currentIdx + 1; i <= currentIdx + 3 && i < queue.length; i++) {
        var candidate = queue[i];
        if (nextMedia && nextMedia.index === i && nextMedia.status === 'prepared') continue;
        if (!candidate.localUrl && candidate.type !== 'local' && candidate.source !== 'local' && !sourcePrepared(candidate)) {
          song = candidate; break;
        }
      }
      if (!song) return;
      var owner = { controller: new AbortController(), version: epoch, token: trackSwitchToken,
        queueRef: queue, scope: sourceScope() };
      sourceWorker = owner;
      var timeout = setTimeout(function () {
        if (valid()) sourceCache.set(engine().key(song), { scope: owner.scope, expires: Date.now() + 15000, data: null });
        owner.controller.abort();
      }, 6000);
      var aborted = new Promise(function (resolve) { owner.controller.signal.addEventListener('abort', function () { resolve(null); }, { once: true }); });
      function valid() { return sourceWorker === owner && !owner.controller.signal.aborted && isSession()
        && epoch === owner.version && trackSwitchToken === owner.token && queue === owner.queueRef && sourceScope() === owner.scope; }
      Promise.race([Promise.resolve().then(function () {
        return valid() ? resolveAlbumGaplessPlaybackData(song, { signal: owner.controller.signal, isCurrent: valid, background: true }) : null;
      }), aborted]).then(function (data) {
        if (valid()) {
          // Failed sources get a short backoff without displacing queued songs.
          if (!savePlaybackData(song, data, owner.scope)) sourceCache.set(engine().key(song), { scope: owner.scope, expires: Date.now() + 15000, data: null });
        }
      }).catch(function () {
        if (valid()) sourceCache.set(engine().key(song), { scope: owner.scope, expires: Date.now() + 15000, data: null });
      }).finally(function () {
        clearTimeout(timeout);
        if (sourceWorker !== owner) return;
        sourceWorker = null; scheduleSourceWarm(800);
      });
    }, delay == null ? 800 : delay);
  }
  function start() {
    if (!ready || !engine()) return Promise.resolve(false);
    if (active) { openPlayer(); return Promise.resolve(true); }
    if (pendingStart) return pendingStart;
    invalidate(); var version = epoch;
    var existingQueue = typeof playQueue !== 'undefined' ? playQueue : null;
    var keepPlaying = !!(existingQueue && currentIdx >= 0 && existingQueue[currentIdx]);
    starting = true; active = false; queue = []; pool = []; batch = 0; excluded = new Set();
    (typeof playQueue !== 'undefined' ? playQueue : []).concat(favorites()).forEach(function (song) {
      keys(song).forEach(function (key) { excluded.add(key); });
    });
    previousMode = playMode; status = '正在根据你的喜好寻找新歌…'; lastError = '';
    openPlayer(); ui();
    var promise = (async function () {
      await refill(true);
      if (version !== epoch || !starting) return false;
      if (!queue.length) {
        starting = false; status = ''; ui(); showToast(lastError || '推荐暂不可用，请稍后再试'); return false;
      }
      starting = false; active = true; status = '';
      if (typeof cancelPlaylistQueueHydration === 'function') cancelPlaylistQueueHydration('personal-radio-start');
      if (keepPlaying && playQueue === existingQueue && currentIdx >= 0 && existingQueue[currentIdx]) {
        var recommendations = queue;
        // Preserve the array identity used by the next-track preloader and all
        // history through the current track. No play(), pause() or seek here.
        var preload = typeof nextTrackPreloadRuntime === 'function' ? nextTrackPreloadRuntime().entry : null;
        var nextSong = preload && preload.queueRef === existingQueue ? existingQueue[preload.index] : existingQueue[currentIdx + 1];
        existingQueue.splice(currentIdx + 1);
        if (nextSong) existingQueue.push(nextSong);
        recommendations.forEach(function (song) { existingQueue.push(song); });
        queue = existingQueue;
        playMode = 'loop';
        if (typeof syncActiveAudioRepeatMode === 'function') syncActiveAudioRepeatMode(audio);
        if (preload && nextSong && preload.queueRef === existingQueue) {
          preload.index = currentIdx + 1;
          preload.playMode = playMode;
          if (typeof nextTrackPreloadQueueSignature === 'function') preload.queueSignature = nextTrackPreloadQueueSignature();
        }
        updatePlayModeButton(false);
        safeRenderQueuePanel('personal-radio-tail');
        scheduleSourceWarm(); ui();
        showToast('已开启随心听，从下下首开始推荐');
        return true;
      }
      playQueue = queue; currentIdx = 0; currentLocalSong = null; pendingPlaybackResumeAt = 0;
      startupRestoreHomePending = false; homeForcedOpen = false; homeSuppressed = true;
      playMode = 'loop';
      if (typeof syncActiveAudioRepeatMode === 'function') syncActiveAudioRepeatMode(audio);
      updatePlayModeButton(false); setHomeControlsLocked(false); updateEmptyHomeVisibility();
      safeRenderQueuePanel('personal-radio-start'); safeShelfRebuild('personal-radio-start', true);
      forcePlaybackControlsInteractive(); ui();
      var firstPlay = playQueueAt(0, { manual: true, preserveHomeState: true, context: queue[0].radioContext });
      var firstToken = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : null;
      var result = await firstPlay;
      if (version === epoch && result === false && currentIdx === 0
        && (typeof trackSwitchToken === 'undefined' || trackSwitchToken === firstToken)) {
        lastError = '这首歌暂时无法播放，可点下一首继续推荐'; ui();
      }
      return result !== false;
    }()).catch(function () {
      if (version === epoch) { starting = false; status = ''; lastError = '推荐加载失败，请点击随心听重试'; ui(); showToast(lastError); }
      return false;
    }).finally(function () { if (version === epoch) pendingStart = null; });
    pendingStart = promise; return promise;
  }
  function openPlayer() {
    var nav = window.webMobileNavigation;
    if (nav && nav.active()) nav.go('player');
    else if (typeof openHomePlayerConsole === 'function') openHomePlayerConsole();
    if (window.webMobilePlayerControls) window.webMobilePlayerControls.closeMore();
  }
  function next(userInitiated) {
    if (starting) return pendingStart || Promise.resolve(false);
    if (!isSession()) { if (starting || active) stop(true); return originalNext.apply(this, arguments); }
    if (pendingNext) { pendingNext.target++; pendingNext.manual = pendingNext.manual || !!userInitiated; return pendingNext.promise; }
    if (userInitiated) skipFeedback();
    if (remaining() > 0) return playRadioAt(currentIdx + 1, !!userInitiated);
    var owner = { version: epoch, fromIndex: currentIdx, token: typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : null,
      target: currentIdx + 1, manual: !!userInitiated };
    var cancelled = new Promise(function (resolve) { owner.cancel = function () { resolve(false); }; });
    pendingNext = owner;
    var task = (async function () {
      status = '正在寻找下一首…'; ui(); await refill(true);
      if (pendingNext !== owner || owner.version !== epoch || !isSession()) return false;
      if (currentIdx !== owner.fromIndex || (typeof trackSwitchToken !== 'undefined' && trackSwitchToken !== owner.token)) return false;
      status = '';
      if (remaining() < 1) { ui(); showToast(lastError || '暂时没有新的推荐，请重试'); return false; }
      pendingNext = null;
      return playRadioAt(Math.min(owner.target, queue.length - 1), owner.manual);
    }());
    owner.promise = Promise.race([task, cancelled]).finally(function () {
      if (pendingNext === owner) { pendingNext = null; status = ''; ui(); }
    });
    return owner.promise;
  }
  function playRadioAt(index, manual) {
    var version = epoch;
    var playback = playQueueAt(index, { manual: manual, preserveHomeState: true,
      context: queue[index].radioContext, suppressPlayFailureNotice: !manual });
    var token = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : null;
    return Promise.resolve(playback).catch(function () {
      if (version === epoch && isSession() && currentIdx === index
        && (typeof trackSwitchToken === 'undefined' || trackSwitchToken === token)) {
        status = ''; lastError = '下一首暂时无法播放，请重试'; ui(); showToast(lastError);
      }
      return false;
    });
  }
  function initialize() {
    if (ready || !window.MINERADIO_LOCAL_WEB) return;
    ready = true; originalPlay = playQueueAt; originalNext = nextTrack; originalPrev = prevTrack; originalCycle = cyclePlayMode;
    if (typeof resolveAlbumGaplessPlaybackData === 'function') {
      var originalResolve = resolveAlbumGaplessPlaybackData;
      resolveAlbumGaplessPlaybackData = async function (song, options) {
        if (!isSession()) return originalResolve.apply(this, arguments);
        var hit = cachedPlaybackData(song, options);
        if (hit) return hit;
        var version = epoch, scope = sourceScope();
        var data = await originalResolve.apply(this, arguments);
        if (version === epoch && !(options && options.signal && options.signal.aborted)
          && !(options && options.isCurrent && !options.isCurrent())) savePlaybackData(song, data, scope);
        return data;
      };
    }
    playQueueAt = function (index, options) {
      if ((active || starting) && playQueue !== queue) stop(true);
      cancelTailNext(); cancelSourceWarm();
      if (isSession()) { lastError = ''; status = ''; }
      var version = epoch, playback = originalPlay.apply(this, arguments);
      var invocationToken = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : null;
      if (isSession()) refill(false);
      return Promise.resolve(playback).then(function (result) {
        if (version === epoch && isSession()
          && (typeof trackSwitchToken === 'undefined' || trackSwitchToken === invocationToken)) {
          var song = current(); if (song && result !== false) { remember(song); lastError = ''; refill(false); }
          else if (result === false) lastError = '这首歌暂时无法播放，可点下一首继续推荐';
          scheduleSourceWarm(); ui();
        }
        return result;
      });
    };
    nextTrack = next;
    prevTrack = function () {
      if (!isSession()) return originalPrev.apply(this, arguments);
      cancelTailNext(); status = '';
      if (currentIdx <= 0) { showToast('这是本次随心听的第一首'); return; }
      return playRadioAt(currentIdx - 1, true);
    };
    cyclePlayMode = function () { if (active || starting) stop(true); return originalCycle.apply(this, arguments); };
    if (typeof clearQueue === 'function') {
      var originalClear = clearQueue;
      clearQueue = function () { stop(true); return originalClear.apply(this, arguments); };
    }
    // A radio tail waits for new recommendations, including when AutoMix asks
    // for a preloaded successor. Never warm or crossfade back to its first song.
    if (typeof nextTrackPreloadIndex === 'function') {
      var originalPreloadIndex = nextTrackPreloadIndex;
      nextTrackPreloadIndex = function () {
        if (isSession() && remaining() < 1) return -1;
        return originalPreloadIndex.apply(this, arguments);
      };
    }
    playHomePrivateRadio = start;
    if (window.webLocalLibrary && window.webLocalLibrary.subscribeFavorites) window.webLocalLibrary.subscribeFavorites(function () { refill(false); });
    new MutationObserver(ui).observe(document.getElementById('control-title'), { childList: true, subtree: true });
    ui();
  }
  window.webPersonalRadio = {
    start: start, stop: stop, toggle: function () { if (active || starting) stop(); else return start(); },
    active: function () { return active || starting; },
    ownsQueue: function (reference) { return isSession() && queue === reference; },
    cachedPlaybackData: cachedPlaybackData,
    state: function () { return { active: active, starting: starting, pending: !!pendingFill, remaining: remaining(),
      preparedSources: Array.from(sourceCache.values()).filter(function (entry) { return entry.data && entry.scope === sourceScope() && entry.expires > Date.now(); }).length,
      reason: status || lastError || current() && current().personalRadioReason || '' }; }
  };
  window.addEventListener('mineradio:ready', initialize);
  window.addEventListener('web-mobile-player-layout', ui);
  window.addEventListener('pagehide', function () { stop(true); });
  window.addEventListener('mineradio:playback-intent', cancelSourceWarm);
  function accountsChanged() { sourceGeneration++; sourceCache.clear(); cancelSourceWarm(); scheduleSourceWarm(); }
  window.addEventListener('mineradio:accounts-changed', accountsChanged);
  window.addEventListener('storage', function (event) { if (!event || !event.key || event.key === 'mineradio-local-accounts-v1') accountsChanged(); });
  if (window.MINERADIO_MODULE_STATUS && window.MINERADIO_MODULE_STATUS.ready) initialize();
})();


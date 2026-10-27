'use strict';
(function () {
  var selected = false, layer, video, timer = 0, key = '', controller, boundAudio;
  var playPending = false, buffering = false, lastSeek = -Infinity, retryAt = 0;
  var fallback = 0;
  var homeVisible = false, resumePending = false;
  var endedKey = '', sourceKey = '', objectUrl = '', releaseTimer = 0, visualTimer = 0;
  var endMode = 'fallback', warmKey = '', warmController, resumeButton, playSerial = 0;
  var lastVideoTime = 0, lastMotionAt = 0, loadToken = 0, cacheStatus, progressAt = 0, awaitingFrame = false;
  function bufferingStatus(text) {
    if (!cacheStatus) {
      cacheStatus = document.createElement('div'); cacheStatus.id = 'mv-cache-status';
      cacheStatus.setAttribute('role','status'); document.body.append(cacheStatus);
    }
    cacheStatus.textContent = text || ''; cacheStatus.hidden = !text;
  }
  try { if (localStorage.getItem('mineradio-mv-end-mode') === 'loop') endMode = 'loop'; } catch (_) {}
  var audioEvents = ['playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended', 'ratechange'];
  try { fallback = validFallback(localStorage.getItem('mineradio-mv-fallback')); } catch (_) {}

  function validFallback(value) {
    var number = Number(value);
    return Number.isInteger(number) && number >= 0 && number < 13 ? number : 0;
  }
  function bufferedVideo() { return !!window.mineradioMediaCache; }
  function phone() { return window.mineradioSimplePlayer && mineradioSimplePlayer.active(); }
  function current() { return typeof currentCoverSong === 'function' ? currentCoverSong() : null; }
  function showControls() {
    if (selected && !homeVisible && !document.body.classList.contains('immersive-mode') && typeof revealBottomControls === 'function') {
      revealBottomControls();
    }
  }
  function active(on) {
    var wasActive = !!(layer && layer.classList.contains('active'));
    on = !!on && !homeVisible;
    if (layer) layer.classList.toggle('active', on);
    clearTimeout(visualTimer);
    // Keep rendering the fallback during the fade; restore it before fade-out.
    if (on) visualTimer = setTimeout(function () { document.body.classList.add('song-mv-active'); }, 380);
    else document.body.classList.remove('song-mv-active');
    if (wasActive && !on && bufferedVideo()) {
      // MV suspends the 3D lyric loop. Drop its old mesh/cursor before showing
      // lyrics again; the current audio clock is the sole timing authority.
      if (typeof clearStageLyrics === 'function') clearStageLyrics();
      if (typeof tickLyricsParticles === 'function') tickLyricsParticles();
      if (typeof markStageLyricsPlaybackResume === 'function') markStageLyricsPlaybackResume('mv-return');
      if (typeof syncBeatMapPlaybackCursor === 'function') syncBeatMapPlaybackCursor(window.audio ? audio.currentTime : 0, true);
    }
    if (on && window.MineradioSonicWorkshop) MineradioSonicWorkshop.clear();
    if (typeof wakeMainLoopFromBackground === 'function') wakeMainLoopFromBackground();
  }
  function stop() {
    awaitingFrame = false;
    playSerial++; loadToken++; lastMotionAt = 0;
    if (resumeButton) resumeButton.hidden = true;
    bufferingStatus('');
    if (controller) controller.abort();
    controller = null; key = ''; retryAt = 0; playPending = false; buffering = false;
    sourceKey = ''; endedKey = '';
    if (video) video.pause();
    active(false);
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function () {
      if (video && !sourceKey) { video.removeAttribute('src'); video.load(); }
      if (objectUrl && !sourceKey) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
    }, 400);
  }
  function syncClock(event) {
    if (!video || !video.getAttribute('src') || !boundAudio || !selected || sourceKey !== key || endedKey === key) return;
    if (homeVisible || document.hidden) { video.pause(); return; }
    var audio = boundAudio;
    var force = event && ['loadedmetadata', 'seeked', 'seeking'].indexOf(event.type) >= 0;
    if (typeof trackSwitchToken !== 'undefined' && loadToken !== trackSwitchToken) return;
    var duration = isFinite(video.duration) ? video.duration : Infinity;
    if (endMode === 'fallback' && isFinite(duration) && duration > 0 && audio.currentTime >= duration) {
      endedKey = key; video.pause(); active(false); return;
    }
    var wanted = endMode === 'loop' && isFinite(duration) && duration > 0
      ? Math.max(0, audio.currentTime || 0) % duration : Math.max(0, Math.min(audio.currentTime || 0, duration));
    var drift = wanted - video.currentTime;
    var now = performance.now(), rate = audio.playbackRate || 1;
    // A seek flushes the decoder. Use speed for small drift; do not chase an
    // unbuffered stream every timer tick while its decoder is waiting.
    if (video.readyState >= 1 && !video.seeking && isFinite(wanted)
      && ((force && Math.abs(drift) > .12)
        || (!buffering && video.readyState >= 3 && Math.abs(drift) > (bufferedVideo() ? 3 : 2) && now - lastSeek > (bufferedVideo() ? 8000 : 4000)))) {
      lastSeek = now; resumePending = false;
      video.currentTime = wanted;
    } else if (!buffering && video.readyState >= 3 && Math.abs(drift) > (bufferedVideo() ? .5 : .12)) {
      var correction = bufferedVideo() ? .02 : .05;
      rate *= 1 + Math.max(-correction, Math.min(correction, drift * .08));
    }
    if (Math.abs(video.playbackRate - rate) > .001) video.playbackRate = rate;
    if (document.hidden || audio.paused || audio.ended || audio.seeking || audio.readyState < 2 || wanted >= duration) {
      video.pause(); return;
    }
    if (video.paused && !playPending) {
      startVideo();
    }
    if (Math.abs(video.currentTime - lastVideoTime) > .05) {
      lastVideoTime = video.currentTime; lastMotionAt = now;
      if (awaitingFrame && video.readyState >= 3 && !video.seeking && !video.paused) revealPlayingFrame();
      if (resumeButton) resumeButton.hidden = true;
    } else if (lastMotionAt && now - lastMotionAt > 5000 && resumeButton) resumeButton.hidden = false;
  }
  function revealPlayingFrame() {
    var serial = playSerial, expected = sourceKey;
    function reveal() {
      if (serial !== playSerial || expected !== sourceKey || !selected || homeVisible || document.hidden
        || video.paused || video.seeking || video.readyState < 2) return;
      awaitingFrame = false; bufferingStatus(''); active(true);
    }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(reveal);
    else reveal();
  }
  function startVideo() {
    if (!video || playPending) return;
    var serial = ++playSerial; playPending = true;
    lastMotionAt = performance.now();
    video.muted = true;
    Promise.resolve(video.play()).then(function () {
      if (serial === playSerial && resumeButton) resumeButton.hidden = true;
    }).catch(function () {
      if (serial === playSerial && selected && resumeButton) resumeButton.hidden = false;
    }).finally(function () { if (serial === playSerial) playPending = false; });
  }
  function bindAudio() {
    if (window.audio === boundAudio) return;
    if (boundAudio) audioEvents.forEach(function (name) { boundAudio.removeEventListener(name, syncClock); });
    boundAudio = window.audio;
    if (boundAudio) audioEvents.forEach(function (name) { boundAudio.addEventListener(name, syncClock); });
  }
  function createVideo() {
    if (layer) return;
    layer = document.createElement('div'); layer.id = 'song-mv-layer'; layer.setAttribute('aria-hidden', 'true');
    video = document.createElement('video'); video.muted = true; video.defaultMuted = true; video.playsInline = true;
    video.setAttribute('muted','');
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline',''); video.preload = 'auto';
    video.addEventListener('loadedmetadata', syncClock);
    video.addEventListener('loadeddata', function () { awaitingFrame = true; syncClock(); });
    video.addEventListener('waiting', function () { buffering = true; });
    video.addEventListener('playing', function () { buffering = false; awaitingFrame = true; revealPlayingFrame(); });
    video.addEventListener('canplay', function () { buffering = false; syncClock(); });
    video.addEventListener('error', function () { active(false); retryAt = performance.now() + 30000; });
    video.addEventListener('ended', function () {
      if (sourceKey !== key) return;
      if (endMode === 'loop') { video.currentTime = 0; syncClock(); }
      else { endedKey = key; active(false); }
    });
    layer.append(video);
    resumeButton = document.createElement('button'); resumeButton.id = 'mv-resume-btn';
    resumeButton.type = 'button'; resumeButton.hidden = true; resumeButton.textContent = '点此继续播放 MV';
    resumeButton.onclick = function (event) {
      event.stopPropagation(); playPending = false;
      if (boundAudio && video.readyState >= 1) video.currentTime = boundAudio.currentTime;
      startVideo();
    };
    layer.append(resumeButton);
    // The transformed desktop shell is a stacking context. A body-level video
    // would cover the entire shell, regardless of its controls' z-index.
    (document.getElementById('desktop-window-shell') || document.body).prepend(layer);
  }
  async function update() {
    if (!selected || phone()) { if (key) stop(); return; }
    if (homeVisible) return;
    bindAudio();
    prefetchNext();
    var song = current();
    var provider = song && typeof songProviderKey === 'function' ? normalizePlaybackProvider(songProviderKey(song)) : '';
    var id = song && (song.mid || song.hash || song.providerSongId || song.id), next = provider + ':' + id + ':' + (typeof trackSwitchToken === 'undefined' ? 0 : trackSwitchToken);
    if (!song || !id || ['netease', 'qq', 'kugou', 'qishui'].indexOf(provider) < 0) { if (key) stop(); return; }
    if (document.hidden) return;
    if (next === key && (!retryAt || performance.now() < retryAt)) {
      if (endedKey === key) return;
      if (video && sourceKey === key && video.readyState >= 3 && !video.paused && !video.seeking && !video.error && !layer.classList.contains('active')) {
        awaitingFrame = true; revealPlayingFrame();
      }
      syncClock(resumePending ? { type: 'seeked' } : null);
      if (video && video.readyState >= 1) resumePending = false;
      return;
    }
    stop(); key = next;
    var owner = controller = new AbortController();
    var params = new URLSearchParams({ provider: provider, id: String(id), title: song.name || song.title || '', artist: song.artist || song.author || '' });
    if (bufferedVideo()) params.set('resolution','480');
    try {
      var expectedToken = typeof trackSwitchToken === 'undefined' ? 0 : trackSwitchToken;
      var cached = window.mineradioMediaCache ? await mineradioMediaCache.read(song) : null;
      var data = cached && cached.mv ? { available: true } : await apiJson('/api/mv?' + params, { signal: owner.signal, timeoutMs: 65000 });
      if (owner !== controller || owner.signal.aborted || !selected) return;
      if (!data.available) return;
      createVideo();
      var url = '/api/video?' + params;
      if (bufferedVideo() && !(cached && cached.mv instanceof Blob) && window.mineradioMediaCache) {
        bufferingStatus('正在准备 MV 缓存…');
        // Finish the bounded cache job even if the queue advances meanwhile.
        // Its result is displayed only by the matching current track below.
        var complete = await mineradioMediaCache.video(song, url, undefined, function (loaded,total) {
          if (owner !== controller || owner.signal.aborted || performance.now()-progressAt < 250) return;
          progressAt = performance.now();
          bufferingStatus('MV 缓存 ' + (total ? Math.min(100,Math.floor(loaded/total*100)) + '%' : (loaded/1048576).toFixed(1) + ' MB'));
        });
        if (owner !== controller || owner.signal.aborted || !selected || expectedToken !== trackSwitchToken) return;
        bufferingStatus('');
        if (!complete) {
          retryAt = performance.now() + 30000;
          if (typeof showToast === 'function') showToast('MV 尚未缓存完成，保留音乐播放，请稍后重试');
          return;
        }
        cached = {mv:complete};
      }
      // Let the previous frame finish fading into the default preset first.
      await new Promise(function (resolve) { setTimeout(resolve, 420); });
      if (owner !== controller || owner.signal.aborted || !selected) return;
      clearTimeout(releaseTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = cached && cached.mv instanceof Blob ? URL.createObjectURL(cached.mv) : '';
      sourceKey = key;
      loadToken = expectedToken; lastVideoTime = -1; lastMotionAt = performance.now();
      resumePending = true;
      video.src = objectUrl || (window.localMusicCredentials ? localMusicCredentials.url(url, provider) : url);
      video.load();
      // On iPad the current stream owns the available bandwidth. A second
      // full-file fetch and next-MV preload can starve the visible decoder.
      if (!objectUrl && !bufferedVideo() && window.mineradioMediaCache) mineradioMediaCache.video(song, url, owner.signal);
      prefetchNext();
      lastSeek = -Infinity; syncClock({type:'loadedmetadata'});
    } catch (_) {
      if (owner === controller) bufferingStatus('');
      if (owner === controller && !owner.signal.aborted) retryAt = performance.now() + 30000;
    }
  }
  function select(value) {
    value = !!value;
    if (selected === value) return;
    selected = value;
    if (selected) createVideo();
    homeVisible = document.body.classList.contains('empty-home-active');
    document.body.classList.toggle('song-mv-selected', selected);
    try { localStorage.setItem('mineradio-mv-preset', selected ? '1' : '0'); } catch (_) {}
    clearInterval(timer); timer = 0;
    if (!selected) { stop(); if (warmController) warmController.abort(); warmKey = ''; return; }
    showControls(); update();
    if (!document.hidden) timer = setInterval(update, 500);
  }
  function setFallback(value) {
    fallback = validFallback(value);
    try { localStorage.setItem('mineradio-mv-fallback', String(fallback)); } catch (_) {}
    if (selected && typeof setPreset === 'function') {
      setPreset(13, { silent: true, skipTransition: true, preserveCamera: true });
      if (video && layer.classList.contains('active') && window.MineradioSonicWorkshop) MineradioSonicWorkshop.clear();
    }
  }
  function setEndMode(value) {
    endMode = value === 'loop' ? 'loop' : 'fallback'; endedKey = '';
    try { localStorage.setItem('mineradio-mv-end-mode', endMode); } catch (_) {}
    var input = document.getElementById('mv-end-mode');
    if (input) input.value = endMode;
    syncClock();
  }
  function renderSettings(grid) {
    if (!grid) return;
    var row = document.createElement('label'); row.className = 'mv-fallback-settings'; row.id = 'mv-fallback-settings';
    var title = document.createElement('span'); title.textContent = '无 MV 时显示';
    var input = document.createElement('select'); input.id = 'mv-fallback-preset'; input.setAttribute('aria-label', '无 MV 时显示的视觉预设');
    presetDisplayOrder.forEach(function (id) {
      if (id >= 13 || !presetMeta[id]) return;
      var option = document.createElement('option'); option.value = id; option.textContent = presetMeta[id].name; input.append(option);
    });
    input.value = String(fallback); input.addEventListener('change', function () { setFallback(input.value); });
    row.append(title, input);
    var endLabel = document.createElement('span'); endLabel.textContent = '播放完毕';
    var mode = document.createElement('select'); mode.id = 'mv-end-mode'; mode.setAttribute('aria-label', 'MV 播放完毕后的行为');
    [['fallback', '回到默认视觉预设'], ['loop', '循环 MV']].forEach(function (entry) {
      var option = document.createElement('option'); option.value = entry[0]; option.textContent = entry[1]; mode.append(option);
    });
    mode.value = endMode; mode.onchange = function () {
      setEndMode(mode.value);
    };
    row.append(endLabel, mode);
    var card = grid.querySelector('[data-preset="13"]');
    if (card) card.after(row); else grid.append(row);
    refreshSettings();
  }
  function refreshSettings() {
    var row = document.getElementById('mv-fallback-settings');
    if (row) row.hidden = !selected;
    var input = document.getElementById('mv-fallback-preset');
    if (input) input.value = String(fallback);
  }
  function setHomeVisible(value) {
    value = !!value;
    if (homeVisible === value) return;
    homeVisible = value;
    if (homeVisible) {
      if (video) video.pause();
      active(false);
    } else if (selected) {
      resumePending = true;
      update();
    }
  }
  async function prefetchNext() {
    // On iPad, start the next MV only after this MV and the next audio have
    // finished buffering. Keep audio ahead of optional video traffic.
    var prepared = typeof nextTrackPreloadRuntime === 'function' ? nextTrackPreloadRuntime().entry : null;
    if (bufferedVideo() && (!objectUrl || !prepared || prepared.status !== 'prepared')) return;
    if (!selected || !window.mineradioMediaCache || !Array.isArray(window.playQueue)) return;
    var index = typeof nextTrackPreloadIndex === 'function' ? nextTrackPreloadIndex() : currentIdx + 1;
    var song = bufferedVideo() && prepared ? prepared.song : playQueue[index]; if (!song || index === currentIdx) return;
    var nextKey = mineradioMediaCache.identity(song); if (!nextKey || warmKey === nextKey) return;
    if (warmController) warmController.abort();
    warmKey = nextKey; var owner = warmController = new AbortController();
    try {
      var cached = await mineradioMediaCache.read(song); if (cached && cached.mv) return;
      var provider = normalizePlaybackProvider(songProviderKey(song));
      if (['netease','qq','kugou','qishui'].indexOf(provider) < 0) return;
      var params = new URLSearchParams({ provider: provider, id: String(song.mid || song.hash || song.providerSongId || song.id), title: song.name || '', artist: song.artist || '' });
      if (bufferedVideo()) params.set('resolution','480');
      var info = await apiJson('/api/mv?' + params, { signal: owner.signal, timeoutMs: 45000, priority: 'low' });
      if (selected && owner === warmController && !owner.signal.aborted && info.available) await mineradioMediaCache.video(song, '/api/video?' + params, owner.signal);
    } catch (_) {}
  }
  window.mineradioMV = {
    select: select, selected: function () { return selected; }, active: function () { return !!(layer && layer.classList.contains('active')); },
    fallback: function () { return fallback; }, setFallback: setFallback, renderSettings: renderSettings, refreshSettings: refreshSettings,
    setHomeVisible: setHomeVisible, setEndMode: setEndMode,
    status: function () { return {selected:selected, ready:video ? video.readyState : 0, paused:video ? video.paused : true,
      time:video ? video.currentTime : 0, cached:!!objectUrl, buffering:buffering, needsTap:!!(resumeButton && !resumeButton.hidden)}; }
  };
  document.addEventListener('visibilitychange', function () {
    clearInterval(timer); timer = 0; syncClock();
    if (selected && !document.hidden) { update(); timer = setInterval(update, 500); }
  });
  function revealFromEdge(event) {
    if (!selected || !document.body.classList.contains('immersive-mode')) return;
    var point = event.touches ? event.touches[0] : event;
    if (point && point.clientY >= innerHeight - 120 && typeof holdBottomControlsVisible === 'function') holdBottomControlsVisible(1000);
  }
  window.addEventListener('pointermove', revealFromEdge, { passive: true });
  window.addEventListener('touchstart', revealFromEdge, { passive: true });
  window.addEventListener('mineradio:ready', function () {
    try { if (localStorage.getItem('mineradio-mv-preset') === '1' && !phone()) setPreset(13, { silent: true, noSave: true }); } catch (_) {}
  });
  window.addEventListener('pagehide', function () { clearInterval(timer); stop(); if (warmController) warmController.abort(); });
})();

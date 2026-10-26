'use strict';

// Source/media readiness owns the lyric stage. Lyric network results can finish
// early and warm their textures, but never replace this state before playback is ready.
function playbackLyricsLoadingRuntime() {
  if (!playbackLyricsLoadingRuntime.state) playbackLyricsLoadingRuntime.state = {
    loading:false, token:null, terminalToken:null, startedAt:0, mesh:null, group:null, styleKey:''
  };
  return playbackLyricsLoadingRuntime.state;
}

function playbackLyricsAreLoading() {
  var state = playbackLyricsLoadingRuntime();
  return state.loading && Number(state.token) === Number(trackSwitchToken);
}

function playbackLyricsRecoveryPending() {
  var recovery = typeof activeSourceFallbackRecovery !== 'undefined' && activeSourceFallbackRecovery;
  return !!(recovery && !recovery.terminal && !recovery.completed && !recovery.cancelled &&
    (typeof sourceFallbackRecoveryIdentityActive !== 'function' || sourceFallbackRecoveryIdentityActive(recovery)));
}

function playbackLoadingLyricNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function playbackLoadingLyricRevealProgress() {
  if (!playbackLyricsAreLoading()) return 0;
  var t = Math.max(0, Math.min(1, (playbackLoadingLyricNow() - playbackLyricsLoadingRuntime().startedAt - 1000) / 600));
  return t * t * (3 - 2 * t);
}

function releasePlaybackLoadingLyricMesh() {
  var state = playbackLyricsLoadingRuntime();
  if (state.mesh && typeof disposeLyricMesh === 'function') disposeLyricMesh(state.mesh);
  if (state.group && state.group.parent) state.group.parent.remove(state.group);
  state.mesh = null; state.group = null; state.styleKey = '';
}

function updatePlaybackLoadingLyricMesh(invocation) {
  var state = playbackLyricsLoadingRuntime();
  var visible = playbackLyricsAreLoading() && playbackLyricStageIsVisible() && playbackLoadingLyricRevealProgress() > 0 &&
    !document.body.classList.contains('web-mobile-active');
  if (state.group) state.group.visible = visible;
  if (!visible || !stageLyrics.group || !stageLyrics.group.parent) return;
  var styleKey = [lyricFontCss(128), stageLyricPrewarmStyleKey({ omitLivePalette:true })].join('|');
  if (state.mesh && state.styleKey !== styleKey) releasePlaybackLoadingLyricMesh();
  if (!state.mesh) {
    state.mesh = buildLyricMesh('音乐加载中…');
    state.mesh.userData.playbackLoading = true;
    state.mesh.userData.enterDirection = 0;
    state.mesh.position.set(0, 0.20, 1.48);
    primeLyricMeshOpacity(state.mesh, 0);
    state.group = new THREE.Group();
    state.group.add(state.mesh);
    stageLyrics.group.parent.add(state.group);
    state.styleKey = styleKey;
  }
  // A sibling shares the exact lyric transform while the prepared real lyrics
  // remain hidden. Both use the same font masks, shaders, palette and motion.
  state.group.position.copy(stageLyrics.group.position);
  state.group.quaternion.copy(stageLyrics.group.quaternion);
  state.group.scale.copy(stageLyrics.group.scale);
  state.group.renderOrder = stageLyrics.group.renderOrder;
  state.group.visible = true;
  invocation.tickMesh(state.mesh, true);
}

function playbackLyricStageIsVisible() {
  var body = document.body;
  if (!body || body.classList.contains('splash-active') ||
      (typeof fx !== 'undefined' && fx && fx.particleLyrics === false)) return false;
  if (body.classList.contains('web-mobile-active')) {
    return body.dataset && body.dataset.mobilePage === 'player';
  }
  return !body.classList.contains('empty-home-active');
}

function syncPlaybackLoadingLyricPosition() {
  var notice = document.getElementById('playback-loading-lyrics');
  if (!notice) return;
  notice.hidden = !playbackLyricsAreLoading() || !playbackLyricStageIsVisible();
  var state = playbackLyricsLoadingRuntime();
  if (state.group && notice.hidden) state.group.visible = false;
  if (notice.hidden) return;
  var width = Number(window.innerWidth) || 1280, height = Number(window.innerHeight) || 800;
  var x = width * 0.5, y = height * 0.5;
  var mobile = document.body && document.body.classList.contains('web-mobile-active');
  // Desktop pixels come from the lyric renderer; this element retains the live
  // status announcement and supplies the mobile stage's matching fallback.
  notice.style.opacity = mobile ? String(playbackLoadingLyricRevealProgress()) : '0';
  var mobileStage = mobile && document.getElementById('web-player-stage');
  if (mobileStage && mobileStage.getBoundingClientRect) {
    var bounds = mobileStage.getBoundingClientRect();
    x = bounds.left + bounds.width * 0.5; y = bounds.top + bounds.height * 0.5;
  } else if (typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.group &&
      typeof stageLyrics.group.getWorldPosition === 'function' &&
      typeof camera !== 'undefined' && camera && typeof THREE !== 'undefined') {
    var position = new THREE.Vector3();
    if (state.mesh && !mobile) state.mesh.getWorldPosition(position);
    else if (stageLyrics.current) stageLyrics.current.getWorldPosition(position);
    else {
      var mouth = stageLyrics.group.userData && stageLyrics.group.userData.skullMouthLocked;
      position.set(0, mouth ? -0.070 : 0.20, mouth ? 0.018 : 1.48);
      stageLyrics.group.localToWorld(position);
    }
    position.project(camera);
    // Follow the actual lyric anchor, including user offsets. Never substitute
    // a window-centred overlay when the lyric stage moves out of view.
    if (!isFinite(position.x) || !isFinite(position.y) || position.z < -1 || position.z > 1 ||
        Math.abs(position.x) > 1 || Math.abs(position.y) > 1) { notice.hidden = true; return; }
    x = (position.x + 1) * width * 0.5;
    y = (1 - position.y) * height * 0.5;
  }
  notice.style.left = x.toFixed(1) + 'px'; notice.style.top = y.toFixed(1) + 'px';
}

function setPlaybackLoadingNotice(visible, token, reason) {
  if (token != null && Number(token) !== Number(trackSwitchToken)) return;
  var state = playbackLyricsLoadingRuntime();
  var wasLoading = state.loading && Number(state.token) === Number(trackSwitchToken);
  var pending = typeof playbackResolutionRuntime === 'function' && playbackResolutionRuntime().active;
  var pendingCurrent = pending && !pending.wasCancelled && Number(pending.token) === Number(trackSwitchToken);
  var currentMedia = typeof audio !== 'undefined' && audio && Number(audio.__mineradioTrackSwitchToken) === Number(trackSwitchToken)
    && (typeof playbackMediaMatchesCurrentQueueItem !== 'function' || playbackMediaMatchesCurrentQueueItem(audio));
  var mediaReady = currentMedia && audio.readyState >= 3 && !audio.error;
  if (visible || reason === 'preparing') state.terminalToken = null;
  if (reason === 'cancelled' || reason === 'terminal') state.terminalToken = trackSwitchToken;
  var terminal = reason === 'cancelled' || reason === 'terminal' || reason === 'ready' || state.terminalToken === trackSwitchToken;
  // Pausing an unresolved source pauses playback intent. Its fetched lyric data
  // remains gated until the media is actually playable, preventing a lyric flash.
  visible = !!visible || (!terminal && !mediaReady && (pendingCurrent || playbackLyricsRecoveryPending() ||
    (state.loading && currentMedia && audio.src && !audio.error && !audio.__mineradioLastPlayError)));
  if (visible && !wasLoading) {
    releasePlaybackLoadingLyricMesh();
    state.startedAt = playbackLoadingLyricNow();
  }
  state.loading = visible; state.token = trackSwitchToken;
  if (!visible) releasePlaybackLoadingLyricMesh();
  var notice = document.getElementById('playback-loading-lyrics');
  if (notice && notice.hidden !== !visible) notice.hidden = !visible;
  if (document.body && document.body.classList) document.body.classList.toggle('playback-lyrics-loading', visible);
  if (typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.group) stageLyrics.group.visible = !visible;
  syncPlaybackLoadingLyricPosition();
  var controls = document.getElementById('bottom-bar');
  if (controls) controls.setAttribute('aria-busy', String(visible));
}

function settlePlaybackLoadingNotice(token) {
  if (Number(token) !== Number(trackSwitchToken)) return;
  var currentMedia = audio && Number(audio.__mineradioTrackSwitchToken) === Number(token)
    && (typeof playbackMediaMatchesCurrentQueueItem !== 'function' || playbackMediaMatchesCurrentQueueItem(audio));
  var waiting = currentMedia && audio.src
    && !audio.paused && !audio.ended && !audio.error && !audio.__mineradioLastPlayError && audio.readyState < 3;
  setPlaybackLoadingNotice(!!waiting, token, currentMedia && !audio.error && audio.readyState >= 3 ? 'ready' : '');
}

function syncPlaybackLoadingFromMediaEvent(media, reason) {
  if (!media || media !== audio || Number(media.__mineradioTrackSwitchToken) !== Number(trackSwitchToken)) return;
  if (typeof playbackMediaMatchesCurrentQueueItem === 'function' && !playbackMediaMatchesCurrentQueueItem(media)) return;
  var pending = typeof playbackResolutionRuntime === 'function' && playbackResolutionRuntime().active;
  // load() on the reused Audio element emits these for the discarded source,
  // after the new source/token may already have been assigned.
  if ((reason === 'abort' || reason === 'emptied') && pending && pending.token === trackSwitchToken
      && !pending.wasCancelled) return;
  if (reason === 'playing') {
    setPlaybackLoadingNotice(false, trackSwitchToken, 'ready');
  } else if (reason === 'error') {
    var song = typeof playQueue !== 'undefined' && playQueue[currentIdx];
    var canRecover = pending && !pending.wasCancelled && pending.token === trackSwitchToken || playbackLyricsRecoveryPending() ||
      (media.__mineradioPlaybackStarted && typeof canRefreshCurrentPlaybackUrlForResume === 'function' && canRefreshCurrentPlaybackUrlForResume(song));
    setPlaybackLoadingNotice(!!canRecover, trackSwitchToken, canRecover ? '' : 'terminal');
  } else if (reason === 'ended' || reason === 'abort' || reason === 'emptied') {
    setPlaybackLoadingNotice(false, trackSwitchToken, 'terminal');
  } else if (reason === 'pause') {
    setPlaybackLoadingNotice(false, trackSwitchToken);
  } else if ((reason === 'waiting' || reason === 'stalled' || reason === 'play') && !media.paused && !media.ended && media.readyState < 3) {
    setPlaybackLoadingNotice(true, trackSwitchToken);
  } else if ((reason === 'canplay' || reason === 'timeupdate' || reason === 'seeked') && media.readyState >= 3) {
    setPlaybackLoadingNotice(false, trackSwitchToken, 'ready');
  }
}


function tweenLoading(to, durationMs, onComplete) {
  if (loadingTween) cancelAnimationFrame(loadingTween.raf);
  durationMs = Math.max(1, durationMs || 1);
  if (isHiddenForBackgroundOptimization() || isDeepBackgroundMode()) {
    uniforms.uLoading.value = to;
    loadingTween = null;
    if (onComplete) onComplete();
    return;
  }
  var start = performance.now();
  var from = uniforms.uLoading.value;
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    var eased = visualEase(t);
    uniforms.uLoading.value = from + (to - from) * eased;
    if (t < 1) loadingTween = { raf: requestAnimationFrame(step) };
    else {
      uniforms.uLoading.value = to;
      loadingTween = null;
      if (onComplete) onComplete();
    }
  }
  loadingTween = { raf: requestAnimationFrame(step) };
}

function showLoading(opts) {
  opts = opts || {};
  if (opts.trackSwitch || opts.seamlessCover) {
    forceLoadingSettled('seamless-track-switch');
    return;
  }
  loadingShownAt = performance.now();
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  var current = uniforms.uLoading.value || 0;
  tweenLoading(Math.max(current, 0.56), current > 0.04 ? 86 : 118);
}

function hideLoading() {
  if (loadingHideTimer) clearTimeout(loadingHideTimer);
  if (isHiddenForBackgroundOptimization() || isDeepBackgroundMode()) {
    forceLoadingSettled('background-hide');
    return;
  }
  var elapsed = loadingShownAt ? performance.now() - loadingShownAt : 999;
  var wait = Math.max(0, 72 - elapsed);
  loadingHideTimer = setTimeout(function () {
    loadingHideTimer = null;
    var current = uniforms.uLoading.value || 0;
    if (current <= 0.015 || isHiddenForBackgroundOptimization() || isDeepBackgroundMode()) {
      if (loadingTween) {
        cancelAnimationFrame(loadingTween.raf);
        loadingTween = null;
      }
      uniforms.uLoading.value = 0;
      return;
    }
    tweenLoading(0, current > 0.38 ? 126 : 96);
  }, wait);
}

function forceLoadingSettled(reason) {
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  if (loadingTween) {
    cancelAnimationFrame(loadingTween.raf);
    loadingTween = null;
  }
  uniforms.uLoading.value = 0;
  loadingShownAt = 0;
  if (reason && window.__mineradioDebugLoading) console.log('[LoadingSettled]', reason);
}

function recoverVisualsAfterBackground(reason) {
  applyRendererPowerMode();
  if (typeof ensureAudiblePlaybackGain === 'function') ensureAudiblePlaybackGain(reason || 'background-restore');
  if (typeof scheduleMainRendererViewportRefresh === 'function') scheduleMainRendererViewportRefresh(reason || 'restore');
  if (audio && audio.src && !audio.paused && ((uniforms.uLoading.value || 0) > 0.015 || loadingTween || loadingHideTimer)) {
    forceLoadingSettled(reason || 'restore');
  }
  if (typeof markRenderInteraction === 'function') markRenderInteraction('restore', 1100);
}


function neutralCoverEdgeCanvas(size) {
  size = Math.max(4, Math.min(512, Math.round(Number(size) || 64)));
  if (neutralCoverEdgeCanvasCache && neutralCoverEdgeCanvasCache.width === size) return neutralCoverEdgeCanvasCache;
  var cv = document.createElement('canvas');
  cv.width = cv.height = size;
  var cx = cv.getContext('2d');
  cx.fillStyle = 'rgba(128,0,0,255)';
  cx.fillRect(0, 0, size, size);
  neutralCoverEdgeCanvasCache = cv;
  return cv;
}


function applyNeutralCoverEdgeTexture(size) {
  if (!coverEdgeTex) return;
  coverEdgeTex.image = neutralCoverEdgeCanvas(size);
  coverEdgeTex.needsUpdate = true;
}


function setCoverDepthState(depthTo, aiTo, durationMs) {
  depthTo = Math.max(0, Math.min(1, Number(depthTo) || 0));
  aiTo = Math.max(0, Math.min(1, Number(aiTo) || 0));
  if (coverDepthTween) {
    cancelAnimationFrame(coverDepthTween.raf);
    coverDepthTween = null;
  }
  durationMs = Math.max(1, durationMs || 1);
  var depthFrom = uniforms.uHasDepth.value || 0;
  var aiFrom = uniforms.uAiBoost.value || 0;
  if (durationMs <= 1 || (Math.abs(depthFrom - depthTo) < 0.001 && Math.abs(aiFrom - aiTo) < 0.001)) {
    uniforms.uHasDepth.value = depthTo;
    uniforms.uAiBoost.value = aiTo;
    return;
  }
  var start = performance.now();
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    var eased = visualEase(t);
    uniforms.uHasDepth.value = depthFrom + (depthTo - depthFrom) * eased;
    uniforms.uAiBoost.value = aiFrom + (aiTo - aiFrom) * eased;
    if (t < 1) coverDepthTween = { raf: requestAnimationFrame(step) };
    else {
      uniforms.uHasDepth.value = depthTo;
      uniforms.uAiBoost.value = aiTo;
      coverDepthTween = null;
    }
  }
  coverDepthTween = { raf: requestAnimationFrame(step) };
}


function coverApplyStillCurrent(opts) {
  opts = opts || {};
  return !opts.trackToken || opts.trackToken === trackSwitchToken;
}


function setControlCoverSrc(src) {
  var cover = document.getElementById('control-cover');
  if (!cover) return;
  if (!src) {
    cover.style.backgroundImage = '';
    cover.classList.add('cover-empty');
    return;
  }
  cover.style.backgroundImage = 'url("' + String(src).replace(/"/g, '\\"') + '")';
  cover.classList.remove('cover-empty');
}


function updateControlTrackInfo(song) {
  if (window.mineradioMediaCache && song) mineradioMediaCache.remember(song);
  if (typeof syncOpenTrackDetailSong === 'function') syncOpenTrackDetailSong();
  song = song || {};
  var title = document.getElementById('control-title');
  var artist = document.getElementById('control-artist');
  if (title) {
    var titleText = document.getElementById('control-title-text');
    var titleBadges = document.getElementById('control-title-badges');
    if (!titleText) {
      title.innerHTML = '<span id="control-title-text" class="control-title-text"></span><span id="control-title-badges" class="control-title-badges"></span>';
      titleText = document.getElementById('control-title-text');
      titleBadges = document.getElementById('control-title-badges');
    }
    if (titleText) titleText.textContent = song.name || '';
    else title.textContent = song.name || '';
    if (titleBadges) {
      var sourceTag = typeof songSourceTagHtml === 'function' ? songSourceTagHtml(song, { switcher: true }) : '';
      var vipTag = typeof songVipTagHtml === 'function' ? songVipTagHtml(song) : '';
      titleBadges.innerHTML = (song && song.name) ? (sourceTag + vipTag) : '';
    }
  }
  if (artist) artist.textContent = song.artist || '';
  updatePlaybackQualityUi();
  if (typeof updateLyricTimingOffsetUi === 'function') updateLyricTimingOffsetUi(song);
}


function applyCoverCanvas(cv, thumbSrc, opts) {
  opts = opts || {};
  if (!cv || !coverApplyStillCurrent(opts)) return;
  var token = ++coverProcessToken;
  if (opts.coverSource && opts.coverSourceKind) {
    currentCoverSource = { kind: opts.coverSourceKind, src: opts.coverSource };
  }
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) {
    // The compact player needs its actual artwork, not particle textures,
    // depth maps, colour transitions, or deferred AI processing.
    coverPickerCanvas = cv;
    coverTex.image = cv;
    coverTex.needsUpdate = true;
    if (thumbSrc) {
      document.getElementById('thumb-cover').src = thumbSrc;
      setControlCoverSrc(thumbSrc);
    }
    return;
  }
  var cacheSeed = (opts.coverKey || thumbSrc || '') + '|tex=' + (cv.width || 0) + 'x' + (cv.height || 0);
  var cachedDepth = getCoverDepthCache(cacheSeed);
  // 切歌颜色渐变: 把当前 coverTex 当作 prevCoverTex
  if (!opts.noCoverTransition && uniforms.uHasCover.value > 0.5 && coverTex.image) {
    var prevW = coverTex.image.width || 256;
    var prevH = coverTex.image.height || 256;
    var prevScale = Math.min(1, 256 / Math.max(prevW, prevH, 1));
    var prevCv = document.createElement('canvas');
    prevCv.width = Math.max(1, Math.round(prevW * prevScale));
    prevCv.height = Math.max(1, Math.round(prevH * prevScale));
    try {
      prevCv.getContext('2d').drawImage(coverTex.image, 0, 0, prevCv.width, prevCv.height);
      prevCoverTex.image = prevCv;
      prevCoverTex.needsUpdate = true;
    } catch (e) { }
  }
  coverTex.image = cv; coverTex.needsUpdate = true;
  coverPickerCanvas = cv;
  uniforms.uHasCover.value = 1;
  if (cachedDepth && cachedDepth.canvas) {
    coverEdgeTex.image = cachedDepth.canvas;
    coverEdgeTex.needsUpdate = true;
    setCoverDepthState(1, cachedDepth.ai ? 1.0 : 0.55, opts.deferHeavy ? 180 : 120);
  } else {
    applyNeutralCoverEdgeTexture(Math.min(cv.width || 64, 128));
    setCoverDepthState(0, 0, opts.deferHeavy ? 96 : 1);
  }

  if (thumbSrc) {
    document.getElementById('thumb-cover').src = thumbSrc;
    setControlCoverSrc(thumbSrc);
  }
  if (shelfManager) shelfManager.onCoverChange(thumbSrc);

  // 切歌只做干净的新旧封面 crossfade，不再插入加载雾团。
  var colorMixMs = opts.colorMixDuration || (opts.seamlessTrackSwitch ? (fx.preset === 0 ? 320 : 460) : (fx.preset === 0 ? 520 : 960));
  if (opts.noCoverTransition) {
    if (colorMixTween) {
      cancelAnimationFrame(colorMixTween.raf);
      colorMixTween = null;
    }
    uniforms.uColorMixT.value = 1;
  } else {
    startColorMixTween(opts.fromResolutionChange ? (fx.preset === 0 ? 300 : 520) : colorMixMs);
  }

  function refreshCoverDependentColors() {
    if (token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    if (floatGroup) refreshFloatColorsFromCover(cv);
    if (backCoverGroup) refreshBackCoverColorsFromCanvas(cv);
    updateLyricPaletteFromCover(cv);
  }

  async function runHeavyCoverWork() {
    if (token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    if (opts.deferHeavy && typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) {
      scheduleVisualApply(runHeavyCoverWork, 420, heavyTimeout || 1800);
      return;
    }
    var edgeCv = await buildEdgeAndDepthAsync(cv);
    if (token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    setCoverDepthCache(cacheSeed, edgeCv, false);
    coverEdgeTex.image = edgeCv; coverEdgeTex.needsUpdate = true;
    setCoverDepthState(1, 0.55, opts.deferHeavy ? 260 : 180);
    refreshCoverDependentColors();

    queueAIDepthForCover(cv, edgeCv, token, opts, cacheSeed, false);
  }
  if (cachedDepth && cachedDepth.canvas) {
    scheduleVisualApply(refreshCoverDependentColors, opts.deferHeavy ? 260 : 90, opts.deferHeavy ? 1200 : 700);
    if (!cachedDepth.ai) queueAIDepthForCover(cv, cachedDepth.canvas, token, opts, cacheSeed, false);
    return;
  }
  var heavyDelay = opts.deferHeavy ? (opts.delay || 620) : (opts.delay || 120);
  var heavyTimeout = opts.deferHeavy ? (opts.timeout || 1800) : (opts.timeout || 900);
  scheduleVisualApply(runHeavyCoverWork, heavyDelay, heavyTimeout);
}

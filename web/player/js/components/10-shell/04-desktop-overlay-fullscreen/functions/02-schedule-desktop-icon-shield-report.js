'use strict';



function scheduleDesktopIconShieldReport(forceEmpty) {
  desktopIconShieldReporter.forceEmptyPending = forceEmpty === true;
  if (desktopIconShieldReporter.timer) return;
  desktopIconShieldReporter.timer = setTimeout(function () {
    var pendingForceEmpty = desktopIconShieldReporter.forceEmptyPending;
    desktopIconShieldReporter.forceEmptyPending = false;
    flushDesktopIconShieldReport(pendingForceEmpty);
  }, 100);
}


function desktopIconShieldMutationRelevant(mutation) {
  if (!mutation) return false;
  var target = mutation.target && mutation.target.nodeType === 1 ? mutation.target : null;
  if (target === document.documentElement || target === document.body) return true;
  try {
    if (target && (target.matches(DESKTOP_ICON_SHIELD_SELECTOR) || target.closest(DESKTOP_ICON_SHIELD_SELECTOR))) return true;
  } catch (_) { }
  if (mutation.type !== 'childList') return false;
  var nodes = [];
  if (mutation.addedNodes) nodes = nodes.concat(Array.prototype.slice.call(mutation.addedNodes));
  if (mutation.removedNodes) nodes = nodes.concat(Array.prototype.slice.call(mutation.removedNodes));
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (!node || node.nodeType !== 1) continue;
    try {
      if (node.matches(DESKTOP_ICON_SHIELD_SELECTOR) || node.querySelector(DESKTOP_ICON_SHIELD_SELECTOR)) return true;
    } catch (_) { }
  }
  return false;
}


function refreshDesktopIconShieldResizeTargets() {
  var observer = desktopIconShieldReporter.resizeObserver;
  if (!observer) return;
  var next = [];
  for (var i = 0; i < DESKTOP_ICON_SHIELD_TARGETS.length; i++) {
    var elements;
    try {
      elements = document.querySelectorAll(DESKTOP_ICON_SHIELD_TARGETS[i].selector);
    } catch (_) {
      elements = [];
    }
    for (var j = 0; j < elements.length; j++) {
      if (next.indexOf(elements[j]) < 0) next.push(elements[j]);
    }
  }
  var previous = desktopIconShieldReporter.observedElements;
  for (var p = 0; p < previous.length; p++) {
    if (next.indexOf(previous[p]) < 0 && observer.unobserve) {
      try { observer.unobserve(previous[p]); } catch (_) { }
    }
  }
  for (var n = 0; n < next.length; n++) {
    if (previous.indexOf(next[n]) < 0) {
      try { observer.observe(next[n]); } catch (_) { }
    }
  }
  desktopIconShieldReporter.observedElements = next;
}


function initDesktopIconShieldReporter(api) {
  if (!api || typeof api.updateDesktopIconShields !== 'function') return;
  if (typeof window.ResizeObserver === 'function') {
    desktopIconShieldReporter.resizeObserver = new ResizeObserver(function () {
      scheduleDesktopIconShieldReport(false);
    });
    refreshDesktopIconShieldResizeTargets();
  }
  if (typeof window.MutationObserver === 'function') {
    desktopIconShieldReporter.mutationObserver = new MutationObserver(function (mutations) {
      var relevant = false;
      var refreshTargets = false;
      for (var i = 0; i < mutations.length; i++) {
        if (!desktopIconShieldMutationRelevant(mutations[i])) continue;
        relevant = true;
        if (mutations[i].type === 'childList') refreshTargets = true;
      }
      if (!relevant) return;
      if (refreshTargets) refreshDesktopIconShieldResizeTargets();
      scheduleDesktopIconShieldReport(false);
    });
    desktopIconShieldReporter.mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden']
    });
  }
  window.addEventListener('resize', function () { scheduleDesktopIconShieldReport(false); }, { passive: true });
  document.addEventListener('transitionend', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('animationend', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('click', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('contextmenu', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('input', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('change', function () { scheduleDesktopIconShieldReport(false); }, true);
  document.addEventListener('visibilitychange', function () {
    scheduleDesktopIconShieldReport(document.visibilityState === 'hidden');
  });
  // Three.js shelf cards move without DOM mutations. A low-rate timer follows
  // only an actually interactive shelf; it is not a mouse loop or an rAF and
  // dedupe prevents IPC when the projected hit envelope has not changed.
  desktopIconShieldReporter.shelfTimer = setInterval(function () {
    if (!desktopIconShieldModeState().active || !desktopIconShieldShelfNeedsGeometryTracking()) return;
    scheduleDesktopIconShieldReport(false);
  }, 250);
  window.addEventListener('pagehide', function () {
    if (desktopIconShieldReporter.shelfTimer) clearInterval(desktopIconShieldReporter.shelfTimer);
    desktopIconShieldReporter.shelfTimer = 0;
    flushDesktopIconShieldReport(true);
  }, { once: true });
  scheduleDesktopIconShieldReport(false);
}

function currentDesktopSongMeta() {
  var song = playQueue && currentIdx >= 0 ? playQueue[currentIdx] : null;
  song = song || currentLyricSong && currentLyricSong() || {};
  return {
    title: song.name || song.title || 'Mineradio',
    artist: song.artist || song.ar || song.author || '',
    cover: (typeof songCoverSrc === 'function' && song) ? (songCoverSrc(song, 360) || song.cover || '') : (song.cover || '')
  };
}

function normalizeDesktopLyricText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function currentDesktopLyricSnapshot() {
  if (typeof playbackLyricsAreLoading === 'function' && playbackLyricsAreLoading()) {
    return { text:'音乐加载中…', progress:0, progressSpan:4.8 };
  }
  var rawT = audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
  var t = typeof getAdjustedLyricPlaybackTime === 'function' ? getAdjustedLyricPlaybackTime(rawT) : rawT;
  var lines = Array.isArray(lyricsLines) ? lyricsLines : [];
  if (playing && audio && lines.length) {
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].t <= t + 0.05) idx = i;
      else break;
    }
    if (idx >= 0) {
      var curLine = lines[idx] || { t: t, text: '' };
      var nextLine = lines[idx + 1];
      var nextT = nextLine && nextLine.t > curLine.t ? nextLine.t : Math.min((audio && audio.duration) || t + 4, curLine.t + (curLine.duration || 4.8));
      var span = Math.max(0.75, nextT - curLine.t);
      return {
        text: normalizeDesktopLyricText(curLine.text || currentLyricFallbackText()),
        progress: getLyricLineProgress(curLine, nextLine, t),
        progressSpan: span
      };
    }
    var introText = normalizeDesktopLyricText(currentLyricFallbackText());
    if (introText) {
      var firstLine = lines[0];
      var introEnd = firstLine && firstLine.t > 0 ? firstLine.t : Math.min((audio && audio.duration) || 4.8, 4.8);
      return {
        text: introText,
        progress: getLyricLineProgress({ t: 0, text: introText, duration: Math.max(0.8, introEnd), charCount: Math.max(1, introText.length), fallback: true }, null, t),
        progressSpan: Math.max(0.8, introEnd)
      };
    }
  }
  if (stageLyrics && stageLyrics.currentText) {
    return {
      text: normalizeDesktopLyricText(stageLyrics.currentText),
      progress: stageLyrics.current && stageLyrics.current.userData ? clampRange(Number(stageLyrics.current.userData.lastLyricProgress) || 0, 0, 1) : 0,
      progressSpan: 4.8
    };
  }
  return { text: normalizeDesktopLyricText(currentDesktopSongMeta().title || 'Mineradio'), progress: 0, progressSpan: 4.8 };
}

function desktopOverlayColorValue(value, fallback) {
  var raw = String(value || '').trim();
  fallback = String(fallback || '#d6f8ff').trim();
  if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw)) return normalizeHexColor(raw, fallback);
  if (/^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) return raw;
  return normalizeHexColor(raw, fallback);
}

function desktopOverlayColors() {
  var pal = stageLyrics && stageLyrics.palette || {};
  return {
    primary: desktopOverlayColorValue(pal.primary || fx.lyricColor || '#d6f8ff', '#d6f8ff'),
    secondary: desktopOverlayColorValue(pal.secondary || fx.visualTintColor || '#9cffdf', '#9cffdf'),
    highlight: desktopOverlayColorValue(pal.highlight || fx.lyricHighlightColor || '#fff0b8', '#fff0b8'),
    glow: desktopOverlayColorValue(pal.glowColor || pal.secondary || pal.primary || fx.lyricGlowColor || '#9cffdf', '#9cffdf')
  };
}

function desktopLyricsMotionPayload() {
  return {
    lyricGlow: !!fx.lyricGlow,
    lyricGlowBeat: !!fx.lyricGlowBeat,
    lyricGlowStrength: fx.lyricGlow ? clampRange(Number(fx.lyricGlowStrength) || 0, 0, 0.85) : 0,
    highBloom: stageLyrics && isFinite(stageLyrics.highBloom) ? clampRange(stageLyrics.highBloom, 0, 1.45) : 0,
    beatGlow: stageLyrics && isFinite(stageLyrics.beatGlow) ? clampRange(stageLyrics.beatGlow, 0, 1.7) : 0,
    beatPulse: isFinite(beatPulse) ? clampRange(beatPulse, 0, 1.4) : 0,
    bass: isFinite(bass) ? clampRange(bass, 0, 1.2) : 0
  };
}

function desktopLyricsPlaybackPayload() {
  var time = audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
  var duration = audio && isFinite(audio.duration) ? Number(audio.duration) : 0;
  var rate = audio && isFinite(audio.playbackRate) && audio.playbackRate > 0 ? Number(audio.playbackRate) : 1;
  return {
    time: Math.max(0, time),
    duration: Math.max(0, duration),
    rate: clampRange(rate, 0.25, 4)
  };
}

function desktopLyricsActiveBeatMap() {
  var useDj = !!(djMode && djMode.active && currentDjBeatMap);
  return {
    source: useDj ? 'dj' : 'mr',
    map: useDj ? currentDjBeatMap : currentBeatMap
  };
}

function desktopLyricsBeatMapPayload(force) {
  var selected = desktopLyricsActiveBeatMap();
  var map = selected && selected.map;
  var source = selected && selected.source || 'mr';
  var cameraCount = map ? ((map.cameraBeats && map.cameraBeats.length) || (map.beats && map.beats.length) || (map.kicks && map.kicks.length) || 0) : 0;
  var pulseCount = map ? ((map.pulseBeats && map.pulseBeats.length) || (map.kicks && map.kicks.length) || 0) : 0;
  var duration = map && isFinite(map.duration) ? Number(map.duration) : 0;
  var partialUntil = map && isFinite(map.partialUntilSec) ? Number(map.partialUntilSec) : 0;
  var key = map
    ? [source, map.analyzedAt || 0, cameraCount, pulseCount, Math.round(duration * 10), Math.round(partialUntil * 10), map.tempoSource || 'local'].join('|')
    : 'none';
  var shouldSendMap = !!force || key !== desktopOverlayPushState.lastLyricsBeatKey;
  desktopOverlayPushState.lastLyricsBeatKey = key;
  var payload = { beatMapKey: key };
  if (shouldSendMap) payload.beatMap = map ? packLocalBeatMap(map) : null;
  return payload;
}

function notifyDesktopLyricsBeatMapReady() {
  try {
    if (fx && fx.desktopLyrics) pushDesktopLyricsState(true);
  } catch (e) { }
}

function desktopLyricsPushInterval() {
  var fps = normalizeDesktopLyricsFps(fx && fx.desktopLyricsFps);
  if (!fps) return 8;
  return Math.max(8, Math.min(42, 1000 / fps));
}

function desktopLyricsCurrentCustomFontId() {
  var font = customLyricFontRecordForKey(fx && fx.lyricFont);
  return font ? font.id : '';
}

function desktopLyricsCustomFontPayload(includeDataUrl) {
  var font = customLyricFontRecordForKey(fx && fx.lyricFont);
  if (!font) return null;
  var payload = {
    id: font.id,
    family: font.family,
    name: font.name
  };
  if (includeDataUrl !== false) payload.dataUrl = font.dataUrl;
  return payload;
}

function desktopLyricsPayload(forceBeatMap, includeCustomFontData) {
  var meta = currentDesktopSongMeta();
  var lyric = currentDesktopLyricSnapshot();
  var beatPayload = desktopLyricsBeatMapPayload(!!forceBeatMap);
  var payload = {
    enabled: !!fx.desktopLyrics && !isDevelopmentLockedFx('desktopLyrics'),
    text: lyric.text,
    progress: lyric.progress,
    progressSpan: lyric.progressSpan,
    title: meta.title,
    artist: meta.artist,
    playing: !!playing,
    size: clampRange(Number(fx.desktopLyricsSize) || fxDefaults.desktopLyricsSize, 0.72, 1.55),
    opacity: clampRange(fx.desktopLyricsOpacity == null ? fxDefaults.desktopLyricsOpacity : Number(fx.desktopLyricsOpacity), 0.28, 1),
    y: clampRange(fx.desktopLyricsY == null ? fxDefaults.desktopLyricsY : Number(fx.desktopLyricsY), 0.08, 0.92),
    clickThrough: isDevelopmentLockedFx('desktopLyricsClickThrough') ? true : fx.desktopLyricsClickThrough !== false,
    lyricGlowParticles: !!fx.lyricGlowParticles,
    cinema: fx.desktopLyricsCinema !== false,
    highlightFollow: fx.desktopLyricsHighlight === true,
    frameRate: normalizeDesktopLyricsFps(fx.desktopLyricsFps),
    fontFamily: lyricFontStackForKey(fx.lyricFont),
    customFont: desktopLyricsCustomFontPayload(includeCustomFontData),
    fontWeight: lyricFontWeightValue(),
    letterSpacing: clampRange(Number(fx.lyricLetterSpacing) || 0, -0.04, 0.18),
    lineHeight: lyricLineHeightFactor(),
    lyricScale: clampRange(Number(fx.lyricScale) || 1, 0.35, 1.65),
    feather: lyricsHasNativeKaraoke ? 0.030 : 0.055,
    motion: desktopLyricsMotionPayload(),
    playback: desktopLyricsPlaybackPayload(),
    beatMapKey: beatPayload.beatMapKey,
    colors: desktopOverlayColors()
  };
  if (Object.prototype.hasOwnProperty.call(beatPayload, 'beatMap')) payload.beatMap = beatPayload.beatMap;
  return payload;
}

function wallpaperPayload() {
  var meta = currentDesktopSongMeta();
  return {
    enabled: !!fx.wallpaperMode && !isDevelopmentLockedFx('wallpaperMode'),
    title: meta.title,
    artist: meta.artist,
    cover: meta.cover,
    playing: !!playing,
    preset: fx.preset,
    opacity: clampRange(fx.wallpaperOpacity == null ? fxDefaults.wallpaperOpacity : Number(fx.wallpaperOpacity), 0.35, 1),
    frameRate: normalizeWallpaperFps(fx.wallpaperFps),
    colors: desktopOverlayColors()
  };
}

function desktopWallpaperStatusPayload(payload) {
  if (payload && payload.status && typeof payload.status === 'object') return payload.status;
  return payload && typeof payload === 'object' ? payload : {};
}

function updateDesktopWallpaperRuntimeControls(status) {
  status = status || desktopWallpaperRuntimeState || {};
  var supported = status.supported !== false;
  var attaching = status.attaching === true;
  var toggle = document.getElementById('t-wallpaperMode');
  if (toggle) {
    toggle.classList.toggle('runtime-pending', attaching);
    toggle.classList.toggle('runtime-unavailable', !supported);
    toggle.classList.toggle('runtime-interactive', status.interactive === true);
    toggle.setAttribute('aria-busy', attaching ? 'true' : 'false');
    if (!supported) toggle.setAttribute('aria-disabled', 'true');
    else toggle.removeAttribute('aria-disabled');
    toggle.title = !supported
      ? '当前系统不支持完整桌面模式'
      : (attaching ? '正在切换完整桌面模式' : '把完整 Mineradio 放到 Windows 桌面；仅通过此设置开关退出');
  }
  var opacity = document.getElementById('fx-wallpaperopacity');
  if (opacity) opacity.disabled = !supported;
  document.querySelectorAll('#wallpaper-fps-seg [data-wallpaper-fps]').forEach(function (btn) {
    btn.disabled = !supported;
  });
}


function applyDesktopWallpaperSafeArea(status, enabled) {
  var root = document.documentElement;
  if (!root || !root.style) return;
  var insets = status && status.safeInsets && typeof status.safeInsets === 'object'
    ? status.safeInsets
    : null;
  if (!insets && status && status.bounds && status.workArea) {
    var bounds = status.bounds;
    var workArea = status.workArea;
    insets = {
      top: Math.max(0, Number(workArea.y) - Number(bounds.y)),
      right: Math.max(0, Number(bounds.x) + Number(bounds.width) - Number(workArea.x) - Number(workArea.width)),
      bottom: Math.max(0, Number(bounds.y) + Number(bounds.height) - Number(workArea.y) - Number(workArea.height)),
      left: Math.max(0, Number(workArea.x) - Number(bounds.x))
    };
  }
  var names = ['top', 'right', 'bottom', 'left'];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var value = enabled === true && insets ? Math.max(0, Number(insets[name]) || 0) : 0;
    root.style.setProperty('--desktop-safe-' + name, value + 'px');
  }
}

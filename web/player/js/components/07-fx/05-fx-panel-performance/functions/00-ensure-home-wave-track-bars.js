'use strict';


function ensureHomeWaveTrackBars() {
  var el = document.getElementById('home-wave-track');
  if (!el) return;
  var count = 24;
  if (homeWaveTrackState.bars === count && el.children.length === count) return;
  homeWaveTrackState.bars = count;
  homeWaveTrackState.smooth = new Array(count).fill(0);
  el.innerHTML = new Array(count + 1).join('<span></span>');
}

function updateHomeAudioVisual(dt) {
  if (!emptyHomeActive) return;
  var wave = document.getElementById('home-wave-track');
  if (!wave) return;
  var nowMs = performance.now();
  if (homeWaveTrackState.lastAt && nowMs - homeWaveTrackState.lastAt < 80) return;
  homeWaveTrackState.lastAt = nowMs;
  ensureHomeWaveTrackBars();
  var bars = wave.children;
  var nowT = uniforms && uniforms.uTime ? uniforms.uTime.value : performance.now() / 1000;
  for (var i = 0; i < bars.length; i++) {
    var ratio = bars.length > 1 ? i / (bars.length - 1) : 0;
    var bin = 0;
    if (frequencyData && frequencyData.length) {
      bin = (frequencyData[Math.min(frequencyData.length - 1, Math.floor(Math.pow(ratio, 1.2) * (frequencyData.length - 1)))] || 0) / 255;
    } else {
      bin = 0.16 + Math.sin(nowT * 1.4 + i * 0.34) * 0.06;
    }
    var target = clampRange(Math.max(bin, smoothBass * 0.35 + smoothMid * 0.18 + beatPulse * 0.24), 0.03, 1);
    var prev = homeWaveTrackState.smooth[i] || 0;
    prev += (target - prev) * (target > prev ? 0.34 : 0.12);
    homeWaveTrackState.smooth[i] = prev;
    bars[i].style.height = Math.max(4, prev * 18) + 'px';
    bars[i].style.opacity = String(clampRange(0.36 + prev * 0.68, 0.32, 1));
  }
}

function setRange(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  if (id === 'fx-lyricglow') value = Math.min(0.85, Math.max(0, value));
  if (id === 'fx-lyricbgadapt') value = Math.min(1, Math.max(0, value));
  if (id === 'fx-coverres') value = normalizeCoverResolution(value);
  if (id === 'fx-glassaberration') value = normalizeControlGlassChromaticOffset(value);
  if (id === 'fx-lyriccustomlines') value = lyricCustomLineCountValue();
  if (id === 'fx-memory-interval' || id === 'fx-memory-threshold' || id === 'fx-bgcropx' || id === 'fx-bgcropy' || /^fx-sonic(?!we)/.test(id) || id === 'fx-sonicwegain') value = Math.round(Number(value) || 0);
  el.value = value;
  var out = el.parentElement.querySelector('output');
  if (out) out.textContent = id === 'fx-coverres'
    ? coverParticleCountLabel(value)
    : (id === 'fx-lyricweight' || id === 'fx-lyriccustomlines' || id === 'fx-glassaberration' || id === 'fx-playlistblur' || id === 'fx-bgcropx' || id === 'fx-bgcropy' || id === 'fx-lyrictiltx' || id === 'fx-lyrictilty' || id === 'fx-shelfangle' || id === 'fx-shelfdetailanglex' || id === 'fx-shelfdetailangley' || id === 'fx-memory-interval' || id === 'fx-memory-threshold' || /^fx-sonic(?!we)/.test(id) || id === 'fx-sonicwegain' ? String(Math.round(Number(value) || 0)) : Number(value).toFixed(id === 'fx-lyricspacing' ? 3 : 2));
}

function updateDevelopmentFxControls() {
  [
    ['desktopLyrics', 't-desktopLyrics', '全屏幕置顶歌词'],
    ['desktopLyricsClickThrough', 't-desktopLyricsClickThrough', '锁定后防误触；鼠标移到桌面歌词上按中键可锁定/解锁'],
    ['desktopLyricsCinema', 't-desktopLyricsCinema', '桌面歌词绑定鼓点电影震动，基础漂浮始终保留'],
    ['desktopLyricsHighlight', 't-desktopLyricsHighlight', '桌面歌词按播放进度高亮'],
    ['wallpaperMode', 't-wallpaperMode', '把完整 Mineradio 放到 Windows 桌面；仅通过设置开关退出；重启默认关闭']
  ].forEach(function (item) {
    var runtimeUnavailable = item[0] === 'wallpaperMode'
      && typeof desktopWallpaperRuntimeState !== 'undefined'
      && desktopWallpaperRuntimeState.supported === false;
    var locked = isDevelopmentLockedFx(item[0]) || runtimeUnavailable;
    var el = document.getElementById(item[1]);
    if (!el) return;
    el.classList.toggle('dev-locked', locked);
    if (locked) {
      el.classList.remove('on');
      el.setAttribute('aria-disabled', 'true');
      el.title = runtimeUnavailable ? '当前系统不支持桌面壁纸模式' : '开发中，暂不可用';
    } else {
      el.removeAttribute('aria-disabled');
      el.title = item[2];
    }
  });
  [
    ['desktopLyrics', 'fx-desktoplyricssize'],
    ['desktopLyrics', 'fx-desktoplyricsopacity'],
    ['desktopLyrics', 'fx-desktoplyricsy'],
    ['wallpaperMode', 'fx-wallpaperopacity']
  ].forEach(function (item) {
    var runtimeUnavailable = item[0] === 'wallpaperMode'
      && typeof desktopWallpaperRuntimeState !== 'undefined'
      && desktopWallpaperRuntimeState.supported === false;
    var locked = isDevelopmentLockedFx(item[0]) || runtimeUnavailable;
    var input = document.getElementById(item[1]);
    if (!input) return;
    input.disabled = locked;
    var row = input.closest && input.closest('.fx-slider');
    if (row) row.classList.toggle('dev-locked', locked);
  });
  var wallpaperFpsLocked = isDevelopmentLockedFx('wallpaperMode')
    || (typeof desktopWallpaperRuntimeState !== 'undefined' && desktopWallpaperRuntimeState.supported === false);
  document.querySelectorAll('#wallpaper-fps-seg [data-wallpaper-fps]').forEach(function (btn) {
    btn.disabled = wallpaperFpsLocked;
  });
}

function updateDesktopLyricsFpsControls() {
  var fps = normalizeDesktopLyricsFps(fx.desktopLyricsFps);
  document.querySelectorAll('#desktop-lyrics-fps-seg [data-desktop-lyrics-fps]').forEach(function (btn) {
    btn.classList.toggle('active', normalizeDesktopLyricsFps(btn.getAttribute('data-desktop-lyrics-fps')) === fps);
  });
}

function updateWallpaperFpsControls() {
  fx.wallpaperFps = normalizeWallpaperFps(fx.wallpaperFps);
  document.querySelectorAll('#wallpaper-fps-seg [data-wallpaper-fps]').forEach(function (btn) {
    var active = normalizeWallpaperFps(btn.getAttribute('data-wallpaper-fps')) === fx.wallpaperFps;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function updateLyricTextureClarityControls() {
  fx.lyricTextureClarity = normalizeLyricTextureClarity(fx.lyricTextureClarity);
  document.querySelectorAll('#lyric-texture-quality-seg [data-lyric-texture-clarity]').forEach(function (btn) {
    var active = normalizeLyricTextureClarity(btn.getAttribute('data-lyric-texture-clarity')) === fx.lyricTextureClarity;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function lyricTextureClarityLabel(value) {
  var tier = normalizeLyricTextureClarity(value);
  return tier === 4 ? '4× 极致' : (tier === 3 ? '3× 超清' : (tier === 2 ? '2× 高清' : '1× 标清'));
}

function setLyricTextureClarity(value, silent) {
  var next = normalizeLyricTextureClarity(value);
  var changed = next !== normalizeLyricTextureClarity(fx.lyricTextureClarity);
  fx.lyricTextureClarity = next;
  updateLyricTextureClarityControls();
  if (!changed) return;
  if (typeof invalidateLyricQualityTextures === 'function') invalidateLyricQualityTextures('texture-clarity-change', { release: next <= 1 });
  saveLyricLayout({ user: true, reason: 'lyricTextureClarity' });
  if (!silent) showToast('歌词清晰度: ' + lyricTextureClarityLabel(next));
}

function updatePerformanceControls() {
  fx.performanceBackground = normalizePerformanceBackgroundMode(fx.performanceBackground, fx.liveBackgroundKeep === true);
  fx.liveBackgroundKeep = fx.performanceBackground === 'keep';
  fx.performanceQuality = normalizePerformanceQuality(fx.performanceQuality);
  fx.foregroundFpsMode = normalizeForegroundFpsMode(fx.foregroundFpsMode);
  document.querySelectorAll('#performance-background-seg [data-performance-background]').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-performance-background') === fx.performanceBackground);
  });
  document.querySelectorAll('#performance-quality-seg [data-performance-quality]').forEach(function (btn) {
    var active = btn.getAttribute('data-performance-quality') === fx.performanceQuality;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  document.querySelectorAll('#foreground-fps-seg [data-foreground-fps]').forEach(function (btn) {
    var active = normalizeForegroundFpsMode(btn.getAttribute('data-foreground-fps')) === fx.foregroundFpsMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  var liveBackgroundKeepToggle = document.getElementById('t-liveBackgroundKeep');
  if (liveBackgroundKeepToggle) liveBackgroundKeepToggle.classList.toggle('on', fx.liveBackgroundKeep === true);
}

function fxPanelControlBlockById(id) {
  var el = document.getElementById(id);
  if (!el) return null;
  if (el.classList && (el.classList.contains('fx-section-label') || el.classList.contains('fx-slider') || el.classList.contains('fx-toggle-grid') || el.classList.contains('sonic-audio-monitor') || el.classList.contains('lyric-color-row') || el.classList.contains('fx-seg'))) return el;
  return el.closest ? el.closest('.fx-slider,.fx-toggle-grid,.sonic-audio-monitor,.lyric-color-row,.fx-seg,.fx-section-label') : null;
}

function setFxPanelControlsHidden(ids, hidden) {
  ids.forEach(function (id) {
    var node = fxPanelControlBlockById(id);
    if (node) node.classList.toggle('fx-sonic-hidden', !!hidden);
  });
}

function updateSonicSeriesControlVisibility() {
  var preset = Number(fx && fx.preset) || 0;
  var original = preset === 7;
  var workshop = preset === 8;
  setFxPanelControlsHidden(SONIC_ORIGINAL_FX_CONTROL_IDS, !original);
  setFxPanelControlsHidden(SONIC_WORKSHOP_FX_CONTROL_IDS, !workshop);
  setFxPanelControlsHidden(['fx-lyricbgadapt-row', 'fx-lyricbgadapt'], false);
}

function setPerformanceBackgroundMode(mode, silent) {
  var next = normalizePerformanceBackgroundMode(mode, false);
  fx.performanceBackground = next;
  fx.liveBackgroundKeep = next === 'keep';
  updatePerformanceControls();
  saveLyricLayout({ user: true, reason: 'performanceBackground' });
  updateRenderPowerClasses();
  applyRendererPowerMode();
  if (next === 'keep') recoverVisualsAfterBackground('performance-background-keep');
  else if (next === 'release' && isDeepBackgroundMode()) trimRuntimeCaches('performance-release', true);
  if (!silent) {
    showToast(next === 'keep' ? '后台策略: 保持运行' : (next === 'release' ? '后台策略: 停止并释放' : '后台策略: 自动优化'));
  }
}

function setPerformanceQualityMode(mode, silent) {
  var next = normalizePerformanceQuality(mode);
  fx.performanceQuality = next;
  updatePerformanceControls();
  applyRendererPowerMode();
  saveLyricLayout({ user: true, reason: 'performanceQuality' });
  if (!silent) {
    var label = next === 'eco' ? '低' : (next === 'balanced' ? '中' : (next === 'ultra' ? '超高' : '高'));
    showToast('画质档位: ' + label);
  }
}

function setForegroundFpsMode(mode, silent) {
  var next = normalizeForegroundFpsMode(mode);
  fx.foregroundFpsMode = next;
  updatePerformanceControls();
  saveLyricLayout({ user: true, reason: 'foregroundFpsMode' });
  if (typeof wakeMainLoopFromBackground === 'function') wakeMainLoopFromBackground();
  if (typeof syncWallpaperEngineCaptureFrameRate === 'function') {
    Promise.resolve(syncWallpaperEngineCaptureFrameRate()).catch(function () { });
  }
  if (!silent) showToast(next === 'vsync' ? '前台帧率: 跟随屏幕垂直同步' : ('前台帧率上限: ' + next + ' FPS'));
}

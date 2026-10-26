'use strict';

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h, s: s, l: l };
}

function hslToRgb(h, s, l) {
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  var r, g, b;
  if (s === 0) r = g = b = l;
  else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function rgbCss(c, a) {
  if (a == null) return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}

function clampRange(v, min, max) { return Math.max(min, Math.min(max, v)); }

function normalizeCoverResolution(v) {
  return clampRange(Number(v) || 1, 0.75, 1.55);
}

function normalizePerformanceBackgroundMode(v, liveKeepFallback) {
  var value = String(v || '');
  if (value === 'keep' || liveKeepFallback === true) return 'keep';
  if (value === 'release') return 'release';
  return 'auto';
}

function normalizePerformanceQuality(v) {
  var value = String(v || '');
  return /^(eco|balanced|high|ultra)$/.test(value) ? value : fxDefaults.performanceQuality;
}

function normalizeLyricTextureClarity(v) {
  var value = Number(v);
  if (!isFinite(value)) value = Number(fxDefaults.lyricTextureClarity) || 1;
  // Compatibility with the short-lived 1 / 1.25 / 1.5 experiment.  New
  // archives store the user-facing raster multiplier directly as 1..4.
  if (Math.abs(value - 1.25) < 0.001) return 2;
  if (Math.abs(value - 1.5) < 0.001) return 4;
  return clampRange(Math.round(value), 1, 4);
}

function layoutNumber(value, fallback, min, max) {
  var n = Number(value);
  if (!isFinite(n)) n = Number(fallback);
  if (!isFinite(n)) n = min;
  return clampRange(n, min, max);
}

function layoutInteger(value, fallback, min, max) {
  return Math.round(layoutNumber(value, fallback, min, max));
}

function coverParticleGridForResolution(v) {
  var grid = Math.round(118 * normalizeCoverResolution(v));
  grid = Math.max(88, Math.min(183, grid));
  return grid % 2 ? grid : grid + 1;
}

function coverParticleCountLabel(v) {
  var grid = coverParticleGridForResolution(v);
  return grid + 'x' + grid;
}

function coverTextureSizeForResolution(v) {
  v = normalizeCoverResolution(v);
  if (v >= 1.32) return 512;
  if (v >= 1.10) return 384;
  return 256;
}

function plainCurrentFxAutosavePayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function currentFxAutosaveTimestamp(raw) {
  raw = plainCurrentFxAutosavePayload(raw);
  if (!raw) return 0;
  var n = Number(raw.autosavedAt || raw.savedAt || 0);
  return isFinite(n) ? n : 0;
}

function parseCurrentFxAutosaveText(rawText) {
  if (!rawText) return null;
  try {
    return plainCurrentFxAutosavePayload(JSON.parse(rawText));
  } catch (e) {
    return null;
  }
}

function repairCurrentFxAutosaveLocalMirror(payload) {
  payload = plainCurrentFxAutosavePayload(payload);
  if (!payload) return;
  try {
    localStorage.setItem(CURRENT_FX_AUTOSAVE_STORE_KEY, JSON.stringify(payload));
    try { localStorage.removeItem(LYRIC_LAYOUT_STORE_KEY); } catch (cleanupError) { }
  } catch (e) { }
}

function readDesktopCurrentFxAutosaveRaw() {
  try {
    var bridge = window.desktopWindow;
    if (!bridge || typeof bridge.readCurrentFxAutosaveSync !== 'function') return null;
    var result = bridge.readCurrentFxAutosaveSync();
    return plainCurrentFxAutosavePayload(result && result.payload);
  } catch (e) {
    console.warn('[FxAutosave] desktop read failed:', e);
    return null;
  }
}

function chooseCurrentFxAutosaveRaw(localRaw, diskRaw) {
  if (localRaw && diskRaw) {
    var localHasUserVisual = currentFxAutosaveHasUserVisualState(localRaw);
    var diskHasUserVisual = currentFxAutosaveHasUserVisualState(diskRaw);
    if (diskHasUserVisual && !localHasUserVisual) {
      repairCurrentFxAutosaveLocalMirror(diskRaw);
      return diskRaw;
    }
    if (localHasUserVisual && !diskHasUserVisual) return localRaw;
    if (currentFxAutosaveTimestamp(diskRaw) >= currentFxAutosaveTimestamp(localRaw)) {
      repairCurrentFxAutosaveLocalMirror(diskRaw);
      return diskRaw;
    }
    return localRaw;
  }
  if (diskRaw) {
    repairCurrentFxAutosaveLocalMirror(diskRaw);
    return diskRaw;
  }
  return localRaw;
}

function readCurrentFxAutosaveStorageRaw() {
  var localRaw = null;
  try {
    var rawText = localStorage.getItem(CURRENT_FX_AUTOSAVE_STORE_KEY);
    if (!rawText) rawText = localStorage.getItem(LYRIC_LAYOUT_STORE_KEY);
    localRaw = parseCurrentFxAutosaveText(rawText);
  } catch (e) { }
  var diskRaw = readDesktopCurrentFxAutosaveRaw();
  return chooseCurrentFxAutosaveRaw(localRaw, diskRaw);
}

function readCurrentFxAutosaveRaw() {
  var storedRaw = readCurrentFxAutosaveStorageRaw();
  if (storedRaw) return storedRaw;
  return packagedDefaultLyricLayoutRaw();
}

function normalizeSavedLyricDisplayMode(mode) {
  mode = String(mode || 'single');
  return /^(single|dual|triple|cinema|custom)$/.test(mode) ? mode : 'single';
}

function normalizeSavedLyricTranslationMode(mode) {
  mode = String(mode || 'off');
  return /^(off|current|dual|multi)$/.test(mode) ? mode : 'off';
}

function normalizeSavedLyricMotionStyle(style) {
  style = String(style || 'float');
  return /^(glass|smooth|float|quick|shine|glitch)$/.test(style) ? style : 'float';
}

function readSavedLyricLayoutCriticalFallback(raw, err) {
  raw = plainCurrentFxAutosavePayload(raw);
  if (err) {
    try {
      console.warn('[FxAutosave] startup layout read fallback:', err);
    } catch (logError) { }
  }
  if (!raw) return {};
  return {
    lyricColorMode: raw.lyricColorMode === 'custom' ? 'custom' : 'auto',
    lyricColor: normalizeHexColor(raw.lyricColor || fxDefaults.lyricColor || '#a9b8c8', fxDefaults.lyricColor || '#a9b8c8'),
    lyricHighlightMode: raw.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
    lyricHighlightColor: normalizeHexColor(raw.lyricHighlightColor || fxDefaults.lyricHighlightColor || '#fac900', fxDefaults.lyricHighlightColor || '#fac900'),
    lyricGlowLinked: raw.lyricGlowLinked !== false,
    lyricGlowColor: normalizeHexColor(raw.lyricGlowColor || fxDefaults.lyricGlowColor || '#008aff', fxDefaults.lyricGlowColor || '#008aff'),
    lyricDisplayMode: normalizeSavedLyricDisplayMode(raw.lyricDisplayMode || fxDefaults.lyricDisplayMode),
    lyricTranslationMode: normalizeSavedLyricTranslationMode(raw.lyricTranslationMode || fxDefaults.lyricTranslationMode),
    lyricMotionStyle: normalizeSavedLyricMotionStyle(raw.lyricMotionStyle || fxDefaults.lyricMotionStyle),
    lyricVerticalFloat: raw.lyricVerticalFloat !== false,
    lyricCustomLineCount: layoutInteger(raw.lyricCustomLineCount, fxDefaults.lyricCustomLineCount, 1, 10),
    controlGlassChromaticOffset: layoutNumber(raw.controlGlassChromaticOffset, fxDefaults.controlGlassChromaticOffset, 30, 140)
  };
}
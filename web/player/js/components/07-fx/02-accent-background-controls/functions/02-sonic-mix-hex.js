'use strict';


function sonicMixHex(a, b, t) {
  var ca = sonicHexRgb(a, '#000000');
  var cb = sonicHexRgb(b, '#ffffff');
  t = clampRange(Number(t) || 0, 0, 1);
  return '#' + [ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t].map(function (v) {
    return Math.round(clampRange(v, 0, 255)).toString(16).padStart(2, '0');
  }).join('');
}

function sonicPaletteHex(value, fallback, minLum) {
  if (typeof lyricPaletteColorToHex === 'function') return lyricPaletteColorToHex(value, fallback, minLum);
  return normalizeHexColor(value || fallback, fallback);
}

function sonicRawPaletteHex(value, fallback) {
  fallback = normalizeHexColor(fallback || '#ffffff', '#ffffff');
  value = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3,6}$/.test(value)) return normalizeHexColor(value, fallback);
  var m = value.match(/^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)/i);
  if (m) {
    return '#' + [m[1], m[2], m[3]].map(function (part) {
      var n = Math.round(clampRange(parseFloat(part) || 0, 0, 255));
      return n.toString(16).padStart(2, '0');
    }).join('');
  }
  return fallback;
}

function sonicGroundCoverPreviewColors() {
  var pal = stageLyrics && (stageLyrics.coverPalette || stageLyrics.palette) || {};
  var primary = sonicPaletteHex(pal.primary || pal.secondary || pal.highlight, '#33e6ff', 0.42);
  var secondary = sonicPaletteHex(pal.secondary || pal.primary || pal.highlight, '#7fd8ff', 0.40);
  var highlight = sonicPaletteHex(pal.highlight || pal.primary || pal.secondary, '#ffd070', 0.48);
  return {
    sonicGroundBaseColor: sonicMixHex('#05070c', primary, 0.12),
    sonicGroundCoolColor: primary,
    sonicGroundWarmColor: highlight,
    sonicGroundAccentColor: secondary
  };
}

function updateSonicGroundColorControls() {
  var customMode = fx.sonicGroundColorMode === 'custom';
  var coverPreview = customMode ? null : sonicGroundCoverPreviewColors();
  SONIC_GROUND_COLOR_CONTROLS.forEach(function (item) {
    var fallback = fxDefaults[item.key] || '#33e6ff';
    var color = customMode ? normalizeHexColor(fx[item.key] || fallback, fallback) : normalizeHexColor(coverPreview[item.key] || fallback, fallback);
    var picker = document.getElementById(item.picker);
    var value = document.getElementById(item.value);
    if (picker) picker.value = color;
    if (value && !customMode) value.textContent = '封面 ' + color.toUpperCase();
    if (value) value.textContent = customMode ? color.toUpperCase() : '封面取色';
  });
  if (!customMode) {
    SONIC_GROUND_COLOR_CONTROLS.forEach(function (item) {
      var fallback = fxDefaults[item.key] || '#33e6ff';
      var color = normalizeHexColor((coverPreview && coverPreview[item.key]) || fallback, fallback);
      var value = document.getElementById(item.value);
      if (value) value.textContent = '封面 ' + color.toUpperCase();
    });
  }
}

function setSonicGroundColor(key, color, silent) {
  var item = sonicGroundColorControl(key);
  if (!item) return;
  var fallback = fxDefaults[item.key] || '#33e6ff';
  fx.sonicGroundColorMode = 'custom';
  fx[item.key] = normalizeHexColor(color || fallback, fallback);
  updateSonicGroundColorControls();
  syncFxUniforms();
  saveLyricLayout({ user: true, reason: item.key });
  if (!silent) showToast(item.label + ': ' + fx[item.key].toUpperCase());
}

function resetSonicGroundColor(key) {
  var item = sonicGroundColorControl(key);
  if (!item) return;
  fx.sonicGroundColorMode = 'cover';
  SONIC_GROUND_COLOR_CONTROLS.forEach(function (control) {
    fx[control.key] = normalizeHexColor(fxDefaults[control.key] || '#33e6ff', '#33e6ff');
  });
  updateSonicGroundColorControls();
  syncFxUniforms();
  saveLyricLayout({ user: true, reason: 'sonicGroundColorAuto' });
  showToast('音域回响颜色: 封面取色');
}

function setSonicGroundColorFromPicker(pickerId, color, silent) {
  var item = sonicGroundColorControl(pickerId);
  if (item) setSonicGroundColor(item.key, color, silent);
}

function normalizeSonicWorkshopTheme(theme) {
  theme = String(theme || '');
  theme = SONIC_WORKSHOP_THEME_ALIASES[theme] || theme;
  return SONIC_WORKSHOP_THEMES[theme] ? theme : (fxDefaults.sonicWorkshopTheme || 'coral-mirage');
}

function sonicWorkshopRegionControl(id) {
  if (id && typeof id === 'object' && id.id) return id;
  for (var i = 0; i < SONIC_WORKSHOP_COLOR_CONTROLS.length; i++) {
    var item = SONIC_WORKSHOP_COLOR_CONTROLS[i];
    if (item.id === id || item.role === id || item.picker === id || item.colorKey === id || item.modeKey === id) return item;
  }
  return null;
}

function sonicWorkshopCurrentSong() {
  if (Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length) return playQueue[currentIdx];
  if (Array.isArray(playlist) && currentIdx >= 0 && currentIdx < playlist.length) return playlist[currentIdx];
  return null;
}

function sonicWorkshopCurrentCoverKey() {
  try {
    var domSrc = sonicWorkshopCurrentCoverDomSource();
    if (domSrc) return String(domSrc);
    var song = sonicWorkshopCurrentSong();
    if (!song) return '';
    if (typeof songCoverSrc === 'function') return String(songCoverSrc(song, 400) || song.cover || song.id || '');
    return String(song.customCover || song.cover || song.id || song.name || '');
  } catch (e) {
    return '';
  }
}

function sonicWorkshopCurrentCoverDomSource() {
  try {
    if (typeof currentCoverSource !== 'undefined' && currentCoverSource && currentCoverSource.src) return String(currentCoverSource.src || '');
  } catch (e) { }
  try {
    var thumb = document.getElementById('thumb-cover');
    var thumbSrc = thumb && (thumb.currentSrc || thumb.src || thumb.getAttribute('src'));
    if (thumbSrc) return String(thumbSrc);
  } catch (e) { }
  try {
    var bg = document.getElementById('album-bg');
    var style = bg && window.getComputedStyle ? window.getComputedStyle(bg).backgroundImage : '';
    var m = style && style.match(/url\(["']?(.+?)["']?\)/i);
    if (m && m[1]) return m[1];
  } catch (e) { }
  return '';
}

function sonicWorkshopCurrentCoverSampleSrc() {
  var domSrc = sonicWorkshopCurrentCoverDomSource();
  if (domSrc) {
    if (/^data:image\//i.test(domSrc) || /^blob:/i.test(domSrc) || /^\/api\/cover\?/i.test(domSrc) || /^https?:\/\/[^/]+\/api\/cover\?/i.test(domSrc)) return domSrc;
    if (typeof coverProxySrc === 'function') return coverProxySrc(domSrc, false) || domSrc;
    return domSrc;
  }
  var song = sonicWorkshopCurrentSong();
  if (!song) return '';
  var src = '';
  try {
    src = typeof songCoverSrc === 'function' ? songCoverSrc(song, 256) : (song.customCover || song.cover || '');
  } catch (e) {
    src = song.customCover || song.cover || '';
  }
  if (!src) return '';
  if (/^data:image\//i.test(src) || /^blob:/i.test(src) || /^\/api\/cover\?/i.test(src)) return src;
  if (typeof coverProxySrc === 'function') return coverProxySrc(src, false) || src;
  return src;
}

function sonicWorkshopCssFromSample(sample, fallback) {
  if (!sample) return fallback || '#cb6c89';
  if (typeof lyricCoverSampleCss === 'function') return lyricCoverSampleCss(sample, fallback || '#cb6c89');
  return '#' + ['r', 'g', 'b'].map(function (key) {
    return Math.round(clampRange(Number(sample[key]) || 0, 0, 255)).toString(16).padStart(2, '0');
  }).join('');
}

function buildSonicWorkshopUiPaletteFromCanvas(canvas, key) {
  if (!canvas || !canvas.width || !canvas.height) return null;
  try {
    var ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    var img = ctx.getImageData(0, 0, w, h).data;
    var buckets = {};
    var count = 0;
    var sumR = 0, sumG = 0, sumB = 0;
    var fallbackList = [];
    var step = Math.max(2, Math.floor(Math.max(w, h) / 96));
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        var di = (y * w + x) * 4;
        var a = img[di + 3] / 255;
        if (a < 0.5) continue;
        var r = img[di], g = img[di + 1], b = img[di + 2];
        count++;
        sumR += r; sumG += g; sumB += b;
        if (typeof lyricCoverAddAreaBucket === 'function') lyricCoverAddAreaBucket(buckets, r, g, b);
        else fallbackList.push({ r: r, g: g, b: b, score: 1 });
      }
    }
    if (!count) return null;
    var areaPalette = typeof lyricCoverAreaPaletteFromBuckets === 'function'
      ? lyricCoverAreaPaletteFromBuckets(buckets)
      : null;
    if (!areaPalette) {
      fallbackList.sort(function (a, b) { return b.score - a.score; });
      areaPalette = {
        primary: fallbackList[0],
        base: fallbackList[0],
        warm: fallbackList[0],
        cool: fallbackList[0],
        light: fallbackList[0],
        accent: fallbackList[0],
        colors: []
      };
    }
    var avg = {
      r: Math.round(sumR / count),
      g: Math.round(sumG / count),
      b: Math.round(sumB / count),
      score: count
    };
    var palette = {
      rawAreaPrimary: sonicWorkshopCssFromSample(areaPalette.primary, '#cb6c89'),
      rawAreaBase: sonicWorkshopCssFromSample(areaPalette.base, '#16060f'),
      rawAreaWarm: sonicWorkshopCssFromSample(areaPalette.warm, '#cb6c89'),
      rawAreaCool: sonicWorkshopCssFromSample(areaPalette.cool, '#99c4ff'),
      rawAreaLight: sonicWorkshopCssFromSample(areaPalette.light, '#f8d8ff'),
      rawAreaAccent: sonicWorkshopCssFromSample(areaPalette.accent, '#99c4ff'),
      rawAverage: sonicWorkshopCssFromSample(avg, '#cb6c89'),
      sonicWorkshopColors: Array.isArray(areaPalette.colors) ? areaPalette.colors.slice(0, 10) : [],
      coverColors: [],
      coverSourceKey: key || '',
      sonicWorkshopCoverKey: key || ''
    };
    [
      palette.rawAreaPrimary,
      palette.rawAreaBase,
      palette.rawAreaWarm,
      palette.rawAreaCool,
      palette.rawAreaLight,
      palette.rawAreaAccent,
      palette.rawAverage
    ].forEach(function (color) {
      if (typeof lyricCoverPushUniqueColor === 'function') lyricCoverPushUniqueColor(palette.coverColors, color);
      else if (palette.coverColors.indexOf(color) < 0) palette.coverColors.push(color);
    });
    return palette;
  } catch (e) {
    return null;
  }
}

function sonicWorkshopPaletteLooksCurrent(pal, key) {
  if (!pal) return false;
  var hasArea = !!(pal.rawAreaPrimary || pal.rawPrimary || pal.sonicWorkshopColors && pal.sonicWorkshopColors.length);
  if (!hasArea) return false;
  var palKey = String(pal.sonicWorkshopCoverKey || pal.coverSourceKey || '');
  if (key && !palKey) return false;
  if (!key || !palKey) return true;
  return palKey === key;
}

function sonicWorkshopUiPaletteForKey(key) {
  var pal = sonicWorkshopCoverUiSample.palette;
  return sonicWorkshopPaletteLooksCurrent(pal, key || sonicWorkshopCurrentCoverKey()) ? pal : null;
}

function applySonicWorkshopCoverCanvasForUi(canvas, key) {
  if (!canvas) return false;
  if (sonicWorkshopCoverUiSample.refreshing) return false;
  sonicWorkshopCoverUiSample.refreshing = true;
  try {
    var uiPalette = buildSonicWorkshopUiPaletteFromCanvas(canvas, key);
    if (uiPalette) {
      sonicWorkshopCoverUiSample.palette = uiPalette;
      if (typeof stageLyrics !== 'undefined' && stageLyrics) {
        stageLyrics.coverPalette = Object.assign({}, stageLyrics.coverPalette || {}, uiPalette);
      }
    }
    if (typeof updateLyricPaletteFromCover === 'function') updateLyricPaletteFromCover(canvas);
    if (stageLyrics && stageLyrics.coverPalette) {
      if (uiPalette) stageLyrics.coverPalette = Object.assign({}, stageLyrics.coverPalette, uiPalette);
      stageLyrics.coverPalette.sonicWorkshopCoverKey = key || stageLyrics.coverPalette.sonicWorkshopCoverKey || '';
      stageLyrics.coverPalette.coverSourceKey = key || stageLyrics.coverPalette.coverSourceKey || '';
    }
    sonicWorkshopCoverUiSample.key = key || sonicWorkshopCoverUiSample.key || '';
    return !!uiPalette || !!(stageLyrics && stageLyrics.coverPalette);
  } catch (e) {
    console.warn('sonic workshop cover UI palette failed:', e);
    return false;
  } finally {
    sonicWorkshopCoverUiSample.refreshing = false;
  }
}

function ensureSonicWorkshopCoverPaletteForUi() {
  if (sonicWorkshopCoverUiSample.refreshing) return;
  var pal = stageLyrics && (stageLyrics.coverPalette || stageLyrics.palette) || {};
  var key = sonicWorkshopCurrentCoverKey();
  if (sonicWorkshopUiPaletteForKey(key)) return;
  if (sonicWorkshopPaletteLooksCurrent(pal, key)) return;
  if (typeof coverPickerCanvas !== 'undefined' && coverPickerCanvas) {
    if (applySonicWorkshopCoverCanvasForUi(coverPickerCanvas, key)) return;
  }
  var src = sonicWorkshopCurrentCoverSampleSrc();
  if (!src || sonicWorkshopCoverUiSample.loading && sonicWorkshopCoverUiSample.key === key) return;
  var token = ++sonicWorkshopCoverUiSample.token;
  sonicWorkshopCoverUiSample.loading = true;
  sonicWorkshopCoverUiSample.key = key;
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = function () {
    if (token !== sonicWorkshopCoverUiSample.token) return;
    sonicWorkshopCoverUiSample.loading = false;
    var size = 96;
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var cx = cv.getContext('2d');
    var iw = img.naturalWidth || img.width || size;
    var ih = img.naturalHeight || img.height || size;
    var crop = Math.min(iw, ih);
    try {
      cx.drawImage(img, (iw - crop) / 2, (ih - crop) / 2, crop, crop, 0, 0, size, size);
      applySonicWorkshopCoverCanvasForUi(cv, key);
      updateSonicWorkshopColorControls();
      if (window.MineradioSonicWorkshop && typeof MineradioSonicWorkshop.pushProperties === 'function') MineradioSonicWorkshop.pushProperties(true);
    } catch (e) {
      console.warn('sonic workshop cover UI sample failed:', e);
    }
  };
  img.onerror = function () {
    if (token !== sonicWorkshopCoverUiSample.token) return;
    sonicWorkshopCoverUiSample.loading = false;
  };
  img.src = src;
}

function sonicWorkshopPaletteForUi() {
  return sonicWorkshopUiPaletteForKey(sonicWorkshopCurrentCoverKey()) || stageLyrics && (stageLyrics.coverPalette || stageLyrics.palette) || {};
}

function sonicWorkshopCoverHex(role) {
  var pal = sonicWorkshopPaletteForUi();
  role = String(role || 'primary');
  var fallback = role === 'base' ? '#16060f' : (role === 'cool' || role === 'peak' ? '#99c4ff' : (role === 'ripple' ? '#f8d8ff' : '#cb6c89'));
  var value = pal.rawAreaPrimary || pal.rawPrimary || pal.primary || pal.highlight || pal.secondary;
  if (role === 'base') value = pal.rawAreaBase || pal.rawDark || pal.rawAverage || pal.secondary || pal.rawAreaPrimary || pal.rawPrimary || pal.primary;
  else if (role === 'warm') value = pal.rawAreaWarm || pal.rawAreaPrimary || pal.rawWarm || pal.rawPrimary || pal.secondary || pal.primary || pal.highlight;
  else if (role === 'cool') value = pal.rawAreaCool || pal.rawAreaLight || pal.rawCool || pal.rawLight || pal.highlight || pal.rawAreaPrimary || pal.rawPrimary || pal.primary;
  else if (role === 'ripple') value = pal.rawAreaLight || pal.rawAreaAccent || pal.rawLight || pal.rawAccent || pal.rawAreaCool || pal.rawCool || pal.highlight || pal.primary;
  else if (role === 'peak') value = pal.rawAreaAccent || pal.rawAreaCool || pal.rawAreaLight || pal.rawCool || pal.rawAccent || pal.rawLight || pal.highlight || pal.primary;
  return sonicRawPaletteHex(value, fallback);
}

function sonicWorkshopThemeForColor(hex) {
  var rgb = sonicHexRgb(hex, '#cb6c89');
  var hsl = typeof rgbToHsl === 'function' ? rgbToHsl(rgb.r, rgb.g, rgb.b) : { h: 0, s: 0.5, l: 0.5 };
  if (hsl.s < 0.08) return 'minimal-monochrome';
  if (hsl.h < 0.035 || hsl.h >= 0.94) return 'crimson-sunset';
  if (hsl.h < 0.10) return 'coral-mirage';
  if (hsl.h < 0.14) return 'ember-fire';
  if (hsl.h < 0.18) return 'golden-hour';
  if (hsl.h < 0.42) return 'cyber-forest';
  if (hsl.h < 0.66) return 'arctic-aurora';
  if (hsl.h < 0.74) return 'ocean-deep';
  return 'neon-tokyo';
}

function currentSonicWorkshopTheme() {
  if (fx.sonicWorkshopColorMode === 'custom') return normalizeSonicWorkshopTheme(fx.sonicWorkshopTheme);
  return sonicWorkshopThemeForColor(sonicWorkshopCoverHex('primary'));
}
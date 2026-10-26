/** Sonic Workshop integration preset. The viewport bridge adjusts framing and keeps the authored fog relative to the scene. */
'use strict';

function installSonicWorkshopPreset(global) {
  const _moduleState = {global: global};
  _moduleState.nowMs = installSonicWorkshopPresetNowMs.bind(undefined, _moduleState);
  _moduleState.clamp = installSonicWorkshopPresetClamp.bind(undefined, _moduleState);
  _moduleState.clamp01 = installSonicWorkshopPresetClamp01.bind(undefined, _moduleState);
  _moduleState.isActive = installSonicWorkshopPresetIsActive.bind(undefined, _moduleState);
  _moduleState.currentSong = installSonicWorkshopPresetCurrentSong.bind(undefined, _moduleState);
  _moduleState.normalizeHex = installSonicWorkshopPresetNormalizeHex.bind(undefined, _moduleState);
  _moduleState.cssColorToHex = installSonicWorkshopPresetCssColorToHex.bind(undefined, _moduleState);
  _moduleState.hexRgb = installSonicWorkshopPresetHexRgb.bind(undefined, _moduleState);
  _moduleState.rgbToHslLocal = installSonicWorkshopPresetRgbToHslLocal.bind(undefined, _moduleState);
  _moduleState.hslToRgbLocal = installSonicWorkshopPresetHslToRgbLocal.bind(undefined, _moduleState);
  _moduleState.rgbToHexLocal = installSonicWorkshopPresetRgbToHexLocal.bind(undefined, _moduleState);
  _moduleState.mixHex = installSonicWorkshopPresetMixHex.bind(undefined, _moduleState);
  _moduleState.hexToSchemeColor = installSonicWorkshopPresetHexToSchemeColor.bind(undefined, _moduleState);
  _moduleState.workshopCoverHex = installSonicWorkshopPresetWorkshopCoverHex.bind(undefined, _moduleState);
  _moduleState.colorDistance = installSonicWorkshopPresetColorDistance.bind(undefined, _moduleState);
  _moduleState.workshopPaletteHexesFromCover = installSonicWorkshopPresetWorkshopPaletteHexesFromCover.bind(undefined, _moduleState);
  _moduleState.workshopHexInfo = installSonicWorkshopPresetWorkshopHexInfo.bind(undefined, _moduleState);
  _moduleState.workshopHueBandScore = installSonicWorkshopPresetWorkshopHueBandScore.bind(undefined, _moduleState);
  _moduleState.workshopPickPaletteHex = installSonicWorkshopPresetWorkshopPickPaletteHex.bind(undefined, _moduleState);
  _moduleState.workshopThemeForColor = installSonicWorkshopPresetWorkshopThemeForColor.bind(undefined, _moduleState);
  _moduleState.normalizeWorkshopTheme = installSonicWorkshopPresetNormalizeWorkshopTheme.bind(undefined, _moduleState);
  _moduleState.workshopThemeColor = installSonicWorkshopPresetWorkshopThemeColor.bind(undefined, _moduleState);
  _moduleState.workshopCustomThemeForColor = installSonicWorkshopPresetWorkshopCustomThemeForColor.bind(undefined, _moduleState);
  _moduleState.workshopCustomThemeForPalette = installSonicWorkshopPresetWorkshopCustomThemeForPalette.bind(undefined, _moduleState);
  _moduleState.workshopCustomThemeForRegions = installSonicWorkshopPresetWorkshopCustomThemeForRegions.bind(undefined, _moduleState);
  _moduleState.workshopRegionHex = installSonicWorkshopPresetWorkshopRegionHex.bind(undefined, _moduleState);
  _moduleState.workshopRegionsFromFx = installSonicWorkshopPresetWorkshopRegionsFromFx.bind(undefined, _moduleState);
  _moduleState.workshopThemeSignature = installSonicWorkshopPresetWorkshopThemeSignature.bind(undefined, _moduleState);
  _moduleState.cloneWorkshopTheme = installSonicWorkshopPresetCloneWorkshopTheme.bind(undefined, _moduleState);
  _moduleState.mixWorkshopTheme = installSonicWorkshopPresetMixWorkshopTheme.bind(undefined, _moduleState);
  _moduleState.workshopEase = installSonicWorkshopPresetWorkshopEase.bind(undefined, _moduleState);
  _moduleState.scheduleWorkshopThemeTransition = installSonicWorkshopPresetScheduleWorkshopThemeTransition.bind(undefined, _moduleState);
  _moduleState.applyWorkshopThemeTransition = installSonicWorkshopPresetApplyWorkshopThemeTransition.bind(undefined, _moduleState);
  _moduleState.buildMediaState = installSonicWorkshopPresetBuildMediaState.bind(undefined, _moduleState);
  _moduleState.postMessage = installSonicWorkshopPresetPostMessage.bind(undefined, _moduleState);
  _moduleState.ensureLayer = installSonicWorkshopPresetEnsureLayer.bind(undefined, _moduleState);
  _moduleState.removeLayer = installSonicWorkshopPresetRemoveLayer.bind(undefined, _moduleState);
  _moduleState.bodyClass = installSonicWorkshopPresetBodyClass.bind(undefined, _moduleState);
  _moduleState.deriveProperties = installSonicWorkshopPresetDeriveProperties.bind(undefined, _moduleState);
  _moduleState.pushProperties = installSonicWorkshopPresetPushProperties.bind(undefined, _moduleState);
  _moduleState.pushMedia = installSonicWorkshopPresetPushMedia.bind(undefined, _moduleState);
  _moduleState.rawAudioArray = installSonicWorkshopPresetRawAudioArray.bind(undefined, _moduleState);
  _moduleState.frameValue = installSonicWorkshopPresetFrameValue.bind(undefined, _moduleState);
  _moduleState.rawBinValue = installSonicWorkshopPresetRawBinValue.bind(undefined, _moduleState);
  _moduleState.workshopAudioFrameStats = installSonicWorkshopPresetWorkshopAudioFrameStats.bind(undefined, _moduleState);
  _moduleState.shapeWorkshopAudioValue = installSonicWorkshopPresetShapeWorkshopAudioValue.bind(undefined, _moduleState);
  _moduleState.buildAudioSamples = installSonicWorkshopPresetBuildAudioSamples.bind(undefined, _moduleState);
  _moduleState.pushAudio = installSonicWorkshopPresetPushAudio.bind(undefined, _moduleState);
  _moduleState.update = installSonicWorkshopPresetUpdate.bind(undefined, _moduleState);
  _moduleState.clear = installSonicWorkshopPresetClear.bind(undefined, _moduleState);
  _moduleState.onPresetChange = installSonicWorkshopPresetOnPresetChange.bind(undefined, _moduleState);
  return installSonicWorkshopPresetInitialize(_moduleState);
}

function installSonicWorkshopPresetNowMs(_moduleState) {
    return _moduleState.global.performance && performance.now ? performance.now() : Date.now();
  }

function installSonicWorkshopPresetClamp(_moduleState, value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
  }

function installSonicWorkshopPresetClamp01(_moduleState, value) {
    return _moduleState.clamp(value, 0, 1);
  }

function installSonicWorkshopPresetIsActive(_moduleState, fx) {
    return !!(fx && Number(fx.preset) === _moduleState.INDEX);
  }

function installSonicWorkshopPresetCurrentSong(_moduleState) {
    if (Array.isArray(_moduleState.global.playQueue) && _moduleState.global.currentIdx >= 0 && _moduleState.global.currentIdx < _moduleState.global.playQueue.length) return _moduleState.global.playQueue[_moduleState.global.currentIdx];
    if (Array.isArray(_moduleState.global.playlist) && _moduleState.global.currentIdx >= 0 && _moduleState.global.currentIdx < _moduleState.global.playlist.length) return _moduleState.global.playlist[_moduleState.global.currentIdx];
    return null;
  }

function installSonicWorkshopPresetNormalizeHex(_moduleState, value, fallback) {
    value = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
      return '#' + value.slice(1).split('').map(function (c) { return c + c; }).join('');
    }
    return fallback || '#ffffff';
  }

function installSonicWorkshopPresetCssColorToHex(_moduleState, value, fallback) {
    value = String(value || '').trim();
    if (/^#[0-9a-fA-F]{3,6}$/.test(value)) return _moduleState.normalizeHex(value, fallback);
    var m = value.match(/^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)/i);
    if (m) {
      var r = Math.max(0, Math.min(255, Math.round(parseFloat(m[1]) || 0)));
      var g = Math.max(0, Math.min(255, Math.round(parseFloat(m[2]) || 0)));
      var b = Math.max(0, Math.min(255, Math.round(parseFloat(m[3]) || 0)));
      return '#' + [r, g, b].map(function (n) { return n.toString(16).padStart(2, '0'); }).join('');
    }
    return fallback || '#ffffff';
  }

function installSonicWorkshopPresetHexRgb(_moduleState, hex, fallback) {
    hex = _moduleState.normalizeHex(hex || fallback || '#ffffff', fallback || '#ffffff').slice(1);
    var n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

function installSonicWorkshopPresetRgbToHslLocal(_moduleState, r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h, s: s, l: l };
  }

function installSonicWorkshopPresetHslToRgbLocal(_moduleState, h, s, l) {
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var r, g, b;
    h = ((Number(h) || 0) % 1 + 1) % 1;
    s = _moduleState.clamp01(Number(s) || 0);
    l = _moduleState.clamp01(Number(l) || 0);
    if (s === 0) {
      r = g = b = l;
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

function installSonicWorkshopPresetRgbToHexLocal(_moduleState, r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return Math.round(_moduleState.clamp(v, 0, 255)).toString(16).padStart(2, '0');
    }).join('');
  }

function installSonicWorkshopPresetMixHex(_moduleState, a, b, t) {
    var ca = _moduleState.hexRgb(a, '#000000');
    var cb = _moduleState.hexRgb(b, '#ffffff');
    t = _moduleState.clamp01(t);
    return _moduleState.rgbToHexLocal(
      ca.r + (cb.r - ca.r) * t,
      ca.g + (cb.g - ca.g) * t,
      ca.b + (cb.b - ca.b) * t
    );
  }

function installSonicWorkshopPresetHexToSchemeColor(_moduleState, hex) {
    var rgb = _moduleState.hexRgb(hex, '#cb6c89');
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255].map(function (v) {
      return String(_moduleState.clamp(v, 0, 1));
    }).join(' ');
  }

function installSonicWorkshopPresetWorkshopCoverHex(_moduleState, role) {
    var pal = _moduleState.global.stageLyrics && (_moduleState.global.stageLyrics.coverPalette || _moduleState.global.stageLyrics.palette) || {};
    role = String(role || 'primary');
    var fallback = role === 'base' ? '#16060f' : (role === 'cool' || role === 'peak' ? '#99c4ff' : (role === 'ripple' ? '#f8d8ff' : '#cb6c89'));
    var value = pal.rawAreaPrimary || pal.rawPrimary || pal.primary || pal.highlight || pal.secondary;
    if (role === 'base') value = pal.rawAreaBase || pal.rawDark || pal.rawAverage || pal.secondary || pal.rawAreaPrimary || pal.rawPrimary || pal.primary;
    else if (role === 'warm') value = pal.rawAreaWarm || pal.rawAreaPrimary || pal.rawWarm || pal.rawPrimary || pal.secondary || pal.primary || pal.highlight;
    else if (role === 'cool') value = pal.rawAreaCool || pal.rawAreaLight || pal.rawCool || pal.rawLight || pal.highlight || pal.rawAreaPrimary || pal.rawPrimary || pal.primary;
    else if (role === 'ripple') value = pal.rawAreaLight || pal.rawAreaAccent || pal.rawLight || pal.rawAccent || pal.rawAreaCool || pal.rawCool || pal.highlight || pal.primary;
    else if (role === 'peak') value = pal.rawAreaAccent || pal.rawAreaCool || pal.rawAreaLight || pal.rawCool || pal.rawAccent || pal.rawLight || pal.highlight || pal.primary;
    return _moduleState.cssColorToHex(value, fallback);
  }

function installSonicWorkshopPresetColorDistance(_moduleState, a, b) {
    var ca = _moduleState.hexRgb(a, '#000000');
    var cb = _moduleState.hexRgb(b, '#000000');
    var dr = (ca.r - cb.r) / 255;
    var dg = (ca.g - cb.g) / 255;
    var db = (ca.b - cb.b) / 255;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

function installSonicWorkshopPresetWorkshopPaletteHexesFromCover(_moduleState) {
    var pal = _moduleState.global.stageLyrics && (_moduleState.global.stageLyrics.coverPalette || _moduleState.global.stageLyrics.palette) || {};
    var values = [];
    if (Array.isArray(pal.sonicWorkshopColors)) values = values.concat(pal.sonicWorkshopColors);
    if (Array.isArray(pal.coverColors)) values = values.concat(pal.coverColors);
    [
      pal.rawAreaPrimary,
      pal.rawAreaBase,
      pal.rawAreaWarm,
      pal.rawAreaCool,
      pal.rawAreaLight,
      pal.rawAreaAccent,
      pal.rawPrimary,
      pal.rawWarm,
      pal.rawCool,
      pal.rawLight,
      pal.rawDark,
      pal.rawAccent,
      pal.rawAverage,
      pal.primary,
      pal.secondary,
      pal.highlight,
      pal.glowColor
    ].forEach(function (value) { if (value) values.push(value); });
    var out = [];
    values.forEach(function (value) {
      var hex = _moduleState.cssColorToHex(value, '');
      if (!hex) return;
      var key = hex.toLowerCase();
      for (var i = 0; i < out.length; i++) {
        if (out[i].toLowerCase() === key || _moduleState.colorDistance(out[i], hex) < 0.035) return;
      }
      out.push(hex);
    });
    if (!out.length) out.push('#cb6c89');
    return out.slice(0, 8);
  }

function installSonicWorkshopPresetWorkshopHexInfo(_moduleState, hex) {
    var rgb = _moduleState.hexRgb(hex, '#cb6c89');
    var hsl = _moduleState.rgbToHslLocal(rgb.r, rgb.g, rgb.b);
    var lum = (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) / 255;
    return { hex: _moduleState.normalizeHex(hex, '#cb6c89'), rgb: rgb, hsl: hsl, lum: lum, chroma: hsl.s };
  }

function installSonicWorkshopPresetWorkshopHueBandScore(_moduleState, h, center, width) {
    var d = Math.abs((((h - center) % 1) + 1) % 1);
    d = Math.min(d, 1 - d);
    return Math.max(0, 1 - d / width);
  }

function installSonicWorkshopPresetWorkshopPickPaletteHex(_moduleState, hexes, kind, fallback, avoidHex) {
    var best = null;
    var bestScore = -Infinity;
    (hexes && hexes.length ? hexes : [fallback || '#cb6c89']).forEach(function (hex) {
      var info = _moduleState.workshopHexInfo(hex);
      var h = info.hsl.h;
      var score = 0;
      if (kind === 'dark') score = (1 - info.lum) * 1.20 + info.chroma * 0.34;
      else if (kind === 'light') score = info.lum * 1.18 + info.chroma * 0.34;
      else if (kind === 'warm') score = Math.max(_moduleState.workshopHueBandScore(h, 0.06, 0.22), _moduleState.workshopHueBandScore(h, 0.98, 0.16)) * 1.05 + info.chroma * 0.62 + info.lum * 0.10;
      else if (kind === 'cool') score = _moduleState.workshopHueBandScore(h, 0.56, 0.30) * 1.08 + info.chroma * 0.58 + info.lum * 0.10;
      else if (kind === 'accent') score = info.chroma * 0.95 + Math.min(0.42, Math.abs(info.lum - 0.50)) * 0.20 + (avoidHex ? _moduleState.colorDistance(info.hex, avoidHex) * 0.36 : 0);
      else score = info.chroma * 0.88 + (0.50 - Math.abs(info.lum - 0.56)) * 0.34;
      if (score > bestScore) {
        best = info.hex;
        bestScore = score;
      }
    });
    return best || fallback || '#cb6c89';
  }

function installSonicWorkshopPresetWorkshopThemeForColor(_moduleState, hex) {
    var rgb = _moduleState.hexRgb(hex, '#cb6c89');
    var hsl = _moduleState.rgbToHslLocal(rgb.r, rgb.g, rgb.b);
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

function installSonicWorkshopPresetNormalizeWorkshopTheme(_moduleState, theme) {
    theme = String(theme || '');
    theme = _moduleState.WORKSHOP_THEME_ALIASES[theme] || theme;
    return /^(nocturnal|coral-mirage|ocean-deep|arctic-aurora|cyber-forest|minimal-monochrome|neon-tokyo|golden-hour|ember-fire|crimson-sunset)$/.test(theme) ? theme : 'coral-mirage';
  }

function installSonicWorkshopPresetWorkshopThemeColor(_moduleState, theme) {
    return _moduleState.WORKSHOP_THEME_COLORS[_moduleState.normalizeWorkshopTheme(theme)] || '#cb6c89';
  }

function installSonicWorkshopPresetWorkshopCustomThemeForColor(_moduleState, hex) {
    hex = _moduleState.normalizeHex(hex, '#cb6c89');
    var rgb = _moduleState.hexRgb(hex, '#cb6c89');
    var hsl = _moduleState.rgbToHslLocal(rgb.r, rgb.g, rgb.b);
    var peakRgb = _moduleState.hslToRgbLocal(hsl.h + 0.54, _moduleState.clamp(0.62 + hsl.s * 0.28, 0.62, 0.92), _moduleState.clamp(0.54 + hsl.l * 0.14, 0.50, 0.72));
    var peak = _moduleState.rgbToHexLocal(peakRgb.r, peakRgb.g, peakRgb.b);
    var glow = _moduleState.clamp(0.62 + hsl.s * 0.20 + hsl.l * 0.10, 0.62, 0.98);
    return {
      name: 'Mineradio Custom',
      id: 'mineradio-custom',
      __primaryColor: hex,
      uBaseColor1: _moduleState.mixHex('#000000', hex, 0.075),
      uBaseColor2: _moduleState.mixHex('#000000', hex, 0.18),
      uCoolCore: hex,
      uCoolEdge: _moduleState.mixHex('#000000', hex, 0.46),
      uWarmCore: hex,
      uWarmEdge: _moduleState.mixHex('#000000', hex, 0.58),
      uRippleColor: hex,
      uPeakColor: peak,
      uGlowIntensity: Number(glow.toFixed(3))
    };
  }

function installSonicWorkshopPresetWorkshopCustomThemeForPalette(_moduleState, hexes, fallbackHex) {
    hexes = Array.isArray(hexes) ? hexes.slice() : [];
    fallbackHex = _moduleState.normalizeHex(fallbackHex || hexes[0] || '#cb6c89', '#cb6c89');
    if (hexes.length <= 1) return _moduleState.workshopCustomThemeForColor(fallbackHex);
    var primary = _moduleState.workshopPickPaletteHex(hexes, 'primary', fallbackHex);
    var dark = _moduleState.workshopPickPaletteHex(hexes, 'dark', primary);
    var warm = _moduleState.workshopPickPaletteHex(hexes, 'warm', primary, primary);
    var cool = _moduleState.workshopPickPaletteHex(hexes, 'cool', primary, warm);
    var light = _moduleState.workshopPickPaletteHex(hexes, 'light', primary);
    var accent = _moduleState.workshopPickPaletteHex(hexes, 'accent', light, primary);
    return _moduleState.workshopCustomThemeForRegions({
      primary: primary,
      base: dark,
      warm: warm,
      cool: cool,
      ripple: light,
      peak: _moduleState.colorDistance(cool, warm) > 0.14 ? cool : accent
    });
  }

function installSonicWorkshopPresetWorkshopCustomThemeForRegions(_moduleState, regions) {
    regions = regions || {};
    var primary = _moduleState.normalizeHex(regions.primary || '#cb6c89', '#cb6c89');
    var base = _moduleState.normalizeHex(regions.base || _moduleState.mixHex('#000000', primary, 0.16), '#16060f');
    var warm = _moduleState.normalizeHex(regions.warm || primary, primary);
    var cool = _moduleState.normalizeHex(regions.cool || '#99c4ff', '#99c4ff');
    var ripple = _moduleState.normalizeHex(regions.ripple || regions.peak || cool, '#f8d8ff');
    var peak = _moduleState.normalizeHex(regions.peak || cool, '#99c4ff');
    var info = _moduleState.workshopHexInfo(primary);
    var coolInfo = _moduleState.workshopHexInfo(cool);
    var peakInfo = _moduleState.workshopHexInfo(peak);
    var glow = _moduleState.clamp(0.62 + info.chroma * 0.10 + Math.max(coolInfo.chroma, peakInfo.chroma) * 0.08 + Math.max(0, info.lum - 0.38) * 0.06, 0.62, 0.96);
    return {
      name: 'Mineradio Region Palette',
      id: 'mineradio-custom',
      __primaryColor: primary,
      uBaseColor1: _moduleState.mixHex('#000000', base, 0.20),
      uBaseColor2: _moduleState.mixHex(base, primary, 0.22),
      uCoolCore: cool,
      uCoolEdge: _moduleState.mixHex('#000000', cool, 0.48),
      uWarmCore: warm,
      uWarmEdge: _moduleState.mixHex('#000000', warm, 0.56),
      uRippleColor: ripple,
      uPeakColor: peak,
      uGlowIntensity: Number(glow.toFixed(3))
    };
  }

function installSonicWorkshopPresetWorkshopRegionHex(_moduleState, fx, role, colorKey, modeKey, fallback) {
    fallback = _moduleState.normalizeHex(fallback || '#cb6c89', '#cb6c89');
    if (fx && fx[modeKey] === 'custom') return _moduleState.cssColorToHex(fx[colorKey] || fallback, fallback);
    return _moduleState.workshopCoverHex(role) || fallback;
  }

function installSonicWorkshopPresetWorkshopRegionsFromFx(_moduleState, fx) {
    fx = fx || {};
    var customTheme = _moduleState.normalizeWorkshopTheme(fx.sonicWorkshopTheme);
    var themeHex = _moduleState.workshopThemeColor(customTheme);
    var primary = fx.sonicWorkshopColorMode === 'custom'
      ? _moduleState.cssColorToHex(fx.sonicWorkshopCustomColor || themeHex, themeHex)
      : _moduleState.workshopCoverHex('primary');
    primary = _moduleState.normalizeHex(primary, '#cb6c89');
    return {
      primary: primary,
      base: _moduleState.workshopRegionHex(fx, 'base', 'sonicWorkshopBaseColor', 'sonicWorkshopBaseColorMode', _moduleState.mixHex('#000000', primary, 0.12)),
      warm: _moduleState.workshopRegionHex(fx, 'warm', 'sonicWorkshopWarmColor', 'sonicWorkshopWarmColorMode', primary),
      cool: _moduleState.workshopRegionHex(fx, 'cool', 'sonicWorkshopCoolColor', 'sonicWorkshopCoolColorMode', '#99c4ff'),
      ripple: _moduleState.workshopRegionHex(fx, 'ripple', 'sonicWorkshopRippleColor', 'sonicWorkshopRippleColorMode', '#f8d8ff'),
      peak: _moduleState.workshopRegionHex(fx, 'peak', 'sonicWorkshopPeakColor', 'sonicWorkshopPeakColorMode', '#99c4ff')
    };
  }

function installSonicWorkshopPresetWorkshopThemeSignature(_moduleState, theme) {
    theme = theme || {};
    return JSON.stringify(_moduleState.WORKSHOP_THEME_COLOR_KEYS.map(function (key) {
      return _moduleState.normalizeHex(theme[key] || '#000000', '#000000');
    }).concat([Number(theme.uGlowIntensity) || 1, _moduleState.normalizeHex(theme.__primaryColor || '#cb6c89', '#cb6c89')]));
  }

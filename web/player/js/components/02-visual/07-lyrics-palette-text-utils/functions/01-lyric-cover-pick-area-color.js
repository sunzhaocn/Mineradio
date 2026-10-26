'use strict';


function lyricCoverPickAreaColor(list, test, fallback, avoid, minDistance) {
  list = Array.isArray(list) ? list : [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (test && !test(item)) continue;
    if (avoid && lyricCoverAreaDistance(item, avoid) < (minDistance || 0.06)) continue;
    return item;
  }
  return fallback || list[0] || null;
}

function lyricCoverAreaPaletteFromBuckets(buckets) {
  var list = lyricCoverAreaBucketList(buckets);
  if (!list.length) return null;
  var primary = lyricCoverPickAreaColor(list, function (item) {
    return item.lum > 0.035 && item.lum < 0.965;
  }, list[0]);
  var base = lyricCoverPickAreaColor(list, function (item) {
    return item.lum < Math.min(0.46, (primary && primary.lum || 0.5) + 0.10);
  }, primary);
  var warm = lyricCoverPickAreaColor(list, function (item) {
    return item.chroma > 0.055 && item.hsl.s > 0.08 && (item.hsl.h < 0.18 || item.hsl.h > 0.90);
  }, primary);
  var cool = lyricCoverPickAreaColor(list, function (item) {
    return item.chroma > 0.055 && item.hsl.s > 0.08 && item.hsl.h > 0.42 && item.hsl.h < 0.78;
  }, primary, warm, 0.055);
  var light = lyricCoverPickAreaColor(list, function (item) {
    return item.lum > 0.52;
  }, primary);
  var accent = lyricCoverPickAreaColor(list, function (item) {
    return item.chroma > 0.075 && item.hsl.s > 0.10 && item.lum > 0.10 && item.lum < 0.92;
  }, light || primary, primary, 0.075);
  return {
    primary: primary,
    base: base,
    warm: warm,
    cool: cool,
    light: light,
    accent: accent,
    colors: list.slice(0, 10).map(function (item) { return lyricCoverSampleCss(item, ''); }).filter(Boolean)
  };
}

function lyricCurrentCoverPaletteKey() {
  try {
    var song = null;
    if (Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length) song = playQueue[currentIdx];
    else if (Array.isArray(playlist) && currentIdx >= 0 && currentIdx < playlist.length) song = playlist[currentIdx];
    if (!song) return '';
    if (typeof songCoverSrc === 'function') return String(songCoverSrc(song, 400) || song.cover || song.id || '');
    return String(song.cover || song.customCover || song.id || song.name || '');
  } catch (e) {
    return '';
  }
}

function updateLyricPaletteFromCover(coverCanvas) {
  if (!coverCanvas) return;
  try {
    var ctx = coverCanvas.getContext('2d');
    var img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
    var w = coverCanvas.width, h = coverCanvas.height;
    var sumR = 0, sumG = 0, sumB = 0, count = 0;
    var sumChroma = 0, maxChroma = 0, colorfulCount = 0, usableColorfulCount = 0;
    var best = { score: -1, r: 143, g: 233, b: 255 };
    var warm = { score: -1, r: 203, g: 108, b: 137 };
    var cool = { score: -1, r: 102, g: 217, b: 255 };
    var light = { score: -1, r: 238, g: 247, b: 255 };
    var dark = { score: -1, r: 18, g: 22, b: 30 };
    var accent = { score: -1, r: 255, g: 154, b: 190 };
    var areaBuckets = {};
    for (var y = 0; y < h; y += 8) {
      for (var x = 0; x < w; x += 8) {
        var di = (y * w + x) * 4;
        var r = img[di], g = img[di + 1], b = img[di + 2], a = img[di + 3] / 255;
        if (a < 0.5) continue;
        var lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        var maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
        var chroma = (maxC - minC) / 255;
        var edgePenalty = Math.abs(lum - 0.5);
        var score = chroma * 1.6 + (0.5 - edgePenalty) * 0.45;
        var hsl = rgbToHsl(r, g, b);
        var warmHue = hsl.h < 0.18 || hsl.h > 0.90 ? 1 : Math.max(0, 1 - Math.min(Math.abs(hsl.h - 0.08), Math.abs(hsl.h - 0.98)) / 0.26);
        var coolHue = hsl.h > 0.42 && hsl.h < 0.78 ? 1 : Math.max(0, 1 - Math.abs(hsl.h - 0.58) / 0.30);
        var satScore = chroma * (0.72 + a * 0.28);
        sumR += r; sumG += g; sumB += b; count++;
        sumChroma += chroma;
        if (chroma > maxChroma) maxChroma = chroma;
        if (chroma > 0.055 && hsl.s > 0.075) colorfulCount++;
        if (chroma > 0.080 && hsl.s > 0.10 && lum > 0.08 && lum < 0.92) usableColorfulCount++;
        lyricCoverAddAreaBucket(areaBuckets, r, g, b);
        if (lum > 0.08 && lum < 0.92 && score > best.score) best = lyricCoverSample(r, g, b, score, lum, chroma, hsl);
        if (lum > 0.10 && lum < 0.92 && chroma > 0.045 && score + warmHue * 0.88 + satScore * 0.45 > warm.score) warm = lyricCoverSample(r, g, b, score + warmHue * 0.88 + satScore * 0.45, lum, chroma, hsl);
        if (lum > 0.10 && lum < 0.92 && chroma > 0.045 && score + coolHue * 0.88 + satScore * 0.45 > cool.score) cool = lyricCoverSample(r, g, b, score + coolHue * 0.88 + satScore * 0.45, lum, chroma, hsl);
        if (lum > 0.46 && score + lum * 0.82 + satScore * 0.28 > light.score) light = lyricCoverSample(r, g, b, score + lum * 0.82 + satScore * 0.28, lum, chroma, hsl);
        if (lum < 0.48 && score + (1 - lum) * 0.68 + satScore * 0.24 > dark.score) dark = lyricCoverSample(r, g, b, score + (1 - lum) * 0.68 + satScore * 0.24, lum, chroma, hsl);
        if (lum > 0.12 && lum < 0.88 && chroma > 0.060 && score + satScore * 0.88 > accent.score) accent = lyricCoverSample(r, g, b, score + satScore * 0.88, lum, chroma, hsl);
      }
    }
    if (!count) return;
    var avgR = Math.round(sumR / count);
    var avgG = Math.round(sumG / count);
    var avgB = Math.round(sumB / count);
    var avgL = (sumR / count * 0.299 + sumG / count * 0.587 + sumB / count * 0.114) / 255;
    var avgChroma = sumChroma / count;
    var colorfulRatio = colorfulCount / count;
    var usableColorfulRatio = usableColorfulCount / count;
    var avgSample = lyricCoverSample(avgR, avgG, avgB, count, avgL, avgChroma, rgbToHsl(avgR, avgG, avgB));
    if (best.score < 0) best = avgSample;
    var monoCover = lyricCoverLooksMonochrome({
      avgChroma: avgChroma,
      maxChroma: maxChroma,
      colorfulRatio: colorfulRatio,
      usableColorfulRatio: usableColorfulRatio
    });
    if (monoCover) {
      warm = avgSample;
      cool = avgSample;
      accent = avgSample;
    }
    var hsl = best.hsl || rgbToHsl(best.r, best.g, best.b);
    var palette = lyricTextPaletteFromHsl(hsl, avgL, Math.max(0, best.chroma || 0), {
      avgChroma: avgChroma,
      maxChroma: maxChroma,
      colorfulRatio: colorfulRatio,
      usableColorfulRatio: usableColorfulRatio,
      monochrome: monoCover
    });
    var areaPalette = lyricCoverAreaPaletteFromBuckets(areaBuckets);
    palette.rawPrimary = lyricCoverSampleCss(best, palette.primary);
    palette.rawWarm = lyricCoverSampleCss(warm, palette.secondary);
    palette.rawCool = lyricCoverSampleCss(cool, palette.primary);
    palette.rawLight = lyricCoverSampleCss(light, palette.highlight);
    palette.rawDark = lyricCoverSampleCss(dark, palette.secondary);
    palette.rawAccent = lyricCoverSampleCss(accent, palette.highlight);
    palette.rawAverage = rgbCss(avgSample);
    palette.coverIsMonochrome = monoCover;
    palette.coverAverageChroma = avgChroma;
    palette.coverMaxChroma = maxChroma;
    palette.coverColorfulRatio = colorfulRatio;
    if (areaPalette) {
      palette.rawAreaPrimary = lyricCoverSampleCss(areaPalette.primary, palette.rawPrimary);
      palette.rawAreaBase = lyricCoverSampleCss(areaPalette.base, palette.rawDark || palette.rawAverage);
      palette.rawAreaWarm = lyricCoverSampleCss(areaPalette.warm, palette.rawWarm || palette.rawPrimary);
      palette.rawAreaCool = lyricCoverSampleCss(areaPalette.cool, palette.rawCool || palette.rawPrimary);
      palette.rawAreaLight = lyricCoverSampleCss(areaPalette.light, palette.rawLight || palette.rawPrimary);
      palette.rawAreaAccent = lyricCoverSampleCss(areaPalette.accent, palette.rawAccent || palette.rawLight);
      palette.sonicWorkshopColors = areaPalette.colors || [];
    }
    palette.coverSourceKey = lyricCurrentCoverPaletteKey();
    palette.sonicWorkshopCoverKey = palette.coverSourceKey;
    palette.coverColors = [];
    [
      palette.rawAreaPrimary,
      palette.rawAreaBase,
      palette.rawAreaWarm,
      palette.rawAreaCool,
      palette.rawAreaLight,
      palette.rawAreaAccent,
      palette.rawPrimary,
      palette.rawWarm,
      palette.rawCool,
      palette.rawLight,
      palette.rawDark,
      palette.rawAccent,
      palette.rawAverage,
      palette.primary,
      palette.secondary,
      palette.highlight
    ].forEach(function (color) { lyricCoverPushUniqueColor(palette.coverColors, color); });
    stageLyrics.coverPalette = palette;
    if (fx.lyricColorMode !== 'custom') setStageLyricPalette(stageLyrics.coverPalette);
    if (typeof updateSonicGroundColorControls === 'function') updateSonicGroundColorControls();
    if (typeof updateSonicWorkshopColorControls === 'function') updateSonicWorkshopColorControls();
    if (window.MineradioSonicWorkshop && typeof MineradioSonicWorkshop.pushProperties === 'function') MineradioSonicWorkshop.pushProperties(true);
  } catch (e) { }
}


function wrapLyricText(ctx, text, maxWidth, maxLines, fontSize) {
  text = String(text || '').trim();
  var useWords = /\s/.test(text) && /[A-Za-z0-9]/.test(text);
  var units = useWords ? text.split(/(\s+)/).filter(Boolean) : text.split('');
  var lines = [], line = '';
  for (var i = 0; i < units.length; i++) {
    var test = line + units[i];
    if (lyricMeasureText(ctx, test, fontSize) > maxWidth && line) {
      lines.push(line.trim());
      line = units[i].trimStart ? units[i].trimStart() : units[i].replace(/^\s+/, '');
      if (lines.length >= maxLines) {
        var rest = units.slice(i).join('').trim();
        if (rest) lines[lines.length - 1] = lines[lines.length - 1].replace(/[.。,…，、\s]*$/, '') + '...';
        return lines;
      }
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line.trim());
  return lines.length ? lines : [''];
}


function cssColorToThreeColor(css, fallback) {
  var c = new THREE.Color(fallback || '#d6f8ff');
  var value = String(css || fallback || '#d6f8ff').trim();
  try {
    if (/^#[0-9a-f]{3}$/i.test(value) || /^#[0-9a-f]{6}$/i.test(value)) {
      c.set(normalizeHexColor(value));
      return c;
    }
    var m = value.match(/^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)/i);
    if (m) {
      c.setRGB(
        Math.max(0, Math.min(255, parseFloat(m[1]))) / 255,
        Math.max(0, Math.min(255, parseFloat(m[2]))) / 255,
        Math.max(0, Math.min(255, parseFloat(m[3]))) / 255
      );
      return c;
    }
    c.setStyle(value);
  } catch (e) {
    try { c.set(normalizeHexColor(fallback || '#d6f8ff')); } catch (e2) { }
  }
  return c;
}

function lyricThreeColor(css, fallback, minLum) {
  var c = cssColorToThreeColor(css, fallback || '#d6f8ff');
  var lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  var floor = minLum == null ? 0.34 : minLum;
  if (lum < floor) {
    var lift = floor - lum;
    c.r = Math.min(1, c.r + lift);
    c.g = Math.min(1, c.g + lift);
    c.b = Math.min(1, c.b + lift);
  }
  return c;
}
'use strict';

function applyLyricVerticalEdgeFade(ctx, W, H, strength, activeLine, lineCount) {
  strength = clampRange(Number(strength) || 0, 0, 1);
  if (!strength || lineCount < 2) return;
  var topBand = clampRange(0.08 + strength * 0.16, 0.06, 0.26);
  var bottomBand = clampRange(0.08 + strength * 0.18, 0.06, 0.28);
  var midBoost = activeLine > 0 && activeLine < lineCount - 1 ? 0.018 * strength : 0;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  var fade = ctx.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(255,255,255,0)');
  fade.addColorStop(topBand * 0.45, 'rgba(255,255,255,' + (0.34 + strength * 0.20).toFixed(3) + ')');
  fade.addColorStop(topBand + midBoost, 'rgba(255,255,255,1)');
  fade.addColorStop(1 - bottomBand - midBoost, 'rgba(255,255,255,1)');
  fade.addColorStop(1 - bottomBand * 0.45, 'rgba(255,255,255,' + (0.34 + strength * 0.20).toFixed(3) + ')');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}


function configureLyricTextureSampling(texture) {
  if (!texture) return texture;
  var image = texture.image || {};
  var width = Math.max(1, Math.round(Number(image.width) || 1));
  var height = Math.max(1, Math.round(Number(image.height) || 1));
  var isPowerOfTwo = function (value) { return value > 0 && (value & (value - 1)) === 0; };
  var webgl2 = !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);
  var mipmapsAllowed = webgl2 || (isPowerOfTwo(width) && isPowerOfTwo(height));
  var maxAnisotropy = renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy
    ? Math.max(1, Number(renderer.capabilities.getMaxAnisotropy()) || 1) : 1;
  var profile = typeof runtimeHardwareProfile !== 'undefined' ? runtimeHardwareProfile : null;
  var anisotropyBudget = profile && profile.lowSpec ? 4 : (profile && profile.balancedSpec ? 8 : 16);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = mipmapsAllowed && THREE.LinearMipmapLinearFilter != null
    ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.generateMipmaps = mipmapsAllowed;
  texture.anisotropy = Math.min(anisotropyBudget, maxAnisotropy);
  texture.needsUpdate = true;
  texture.userData = texture.userData || {};
  texture.userData.__mineradioLyricMipmapped = mipmapsAllowed;
  return texture;
}


function beginLyricMaskLayoutBuild(input, layoutOverride) {
  layoutOverride = layoutOverride || {};
  var payload = normalizeStageLyricPayload(input);
  if (!payload) payload = { entries: [{ text: '', role: 'current', alpha: 1, scale: 1 }], activeLine: 0, text: '', combinedText: '' };
  var baseCanvasW = 2048;
  var rendererMaxTexture = renderer && renderer.capabilities && renderer.capabilities.maxTextureSize ? renderer.capabilities.maxTextureSize : 4096;
  var maxCanvasW = Math.max(baseCanvasW, Math.min(6144, rendererMaxTexture || 4096));
  var entries = payload && payload.entries && payload.entries.length ? payload.entries : [{ text: '', role: 'current', alpha: 1, scale: 1 }];
  var desiredLines = Math.max(1, entries.length);
  var H = desiredLines > 9 ? 1344 : (desiredLines > 8 ? 1216 : (desiredLines > 7 ? 1088 : (desiredLines > 6 ? 960 : (desiredLines > 5 ? 832 : (desiredLines > 4 ? 704 : (desiredLines > 3 ? 608 : (desiredLines > 2 ? 512 : 384)))))));
  var measureCanvas = document.createElement('canvas');
  var ctx = measureCanvas.getContext('2d');
  var maxLines = Math.max(STAGE_LYRIC_MAX_LINES, entries.length);
  var lockedFontSize = Number(layoutOverride.fontSize);
  var lines = entries.map(function (entry) { return entry.text; });
  var activeLine = Math.max(0, Math.min(lines.length - 1, payload.activeLine || 0));
  var fitMeasureIndexes = [];
  for (var fi = 0; fi < entries.length; fi++) {
    var fitAlpha = entries[fi] && entries[fi].alpha == null ? 1 : Number(entries[fi] && entries[fi].alpha);
    if (payload.activeLayer) {
      if (fi === activeLine) fitMeasureIndexes.push(fi);
    } else if (!isFinite(fitAlpha) || fitAlpha > 0.001) {
      fitMeasureIndexes.push(fi);
    }
  }
  if (!fitMeasureIndexes.length) fitMeasureIndexes.push(activeLine);
  return {
    payload: payload,
    layoutOverride: layoutOverride,
    baseCanvasW: baseCanvasW,
    maxCanvasW: maxCanvasW,
    entries: entries,
    lines: lines,
    activeLine: activeLine,
    canvasHeight: H,
    ctx: ctx,
    maxLines: maxLines,
    lockedFontSize: lockedFontSize,
    fitMeasureIndexes: fitMeasureIndexes,
    layoutMeasureBaseSize: 128,
    layoutBaseWidthCache: {},
    measureCursor: 0,
    completedPhases: 0,
    totalPhases: fitMeasureIndexes.length + 1,
    lastPhase: '',
    result: null,
    done: false
  };
}


function lyricMaskLayoutCacheKey(text, weight) {
  return lyricEntryWeight({ weight: weight }) + '|' + String(text || '');
}


function measureLyricMaskLayoutBaseEntry(state, index) {
  var entry = state.entries[index] || {};
  var text = state.lines[index] || '';
  var weight = lyricEntryWeight(entry);
  var cacheKey = lyricMaskLayoutCacheKey(text, weight);
  var baseWidth = state.layoutBaseWidthCache[cacheKey];
  if (!isFinite(baseWidth)) {
    baseWidth = lyricMeasureTextAtSize(state.ctx, text, state.layoutMeasureBaseSize, weight);
    state.layoutBaseWidthCache[cacheKey] = baseWidth;
  }
  return baseWidth;
}


function scaledLyricMaskLayoutWidth(state, index, size) {
  var entry = state.entries[index] || {};
  var cacheKey = lyricMaskLayoutCacheKey(state.lines[index] || '', lyricEntryWeight(entry));
  var baseWidth = state.layoutBaseWidthCache[cacheKey];
  if (!isFinite(baseWidth)) baseWidth = measureLyricMaskLayoutBaseEntry(state, index);
  return baseWidth * (Math.max(0.01, Number(size) || state.layoutMeasureBaseSize) * (entry.scale || 1) / state.layoutMeasureBaseSize);
}


function finishLyricMaskLayoutBuild(state) {
  if (!state || !state.done) return null;
  return state.result;
}


function finalizeLyricMaskLayoutBuild(state) {
  var layoutOverride = state.layoutOverride;
  var payload = state.payload;
  var entries = state.entries;
  var lines = state.lines;
  var activeLine = state.activeLine;
  var fitMeasureIndexes = state.fitMeasureIndexes;
  var baseCanvasW = state.baseCanvasW;
  var maxCanvasW = state.maxCanvasW;
  var H = state.canvasHeight;
  var ctx = state.ctx;
  var maxWidth = baseCanvasW - 88;
  var fontSize = isFinite(state.lockedFontSize) && state.lockedFontSize > 0 ? clampRange(state.lockedFontSize, 42, 160) : 128;
  var widest = 1;
  function measureWidestAtSize(size) {
    var measured = 1;
    for (var li = 0; li < fitMeasureIndexes.length; li++) {
      measured = Math.max(measured, scaledLyricMaskLayoutWidth(state, fitMeasureIndexes[li], size));
    }
    return measured;
  }
  function lyricMaskLayoutFits(size, measuredWidth) {
    var testLineHeight = size * (lines.length > 1 ? 0.98 : 1.0) * lyricLineHeightFactor();
    var testBlockH = size + (lines.length - 1) * testLineHeight;
    return measuredWidth <= maxWidth && testBlockH <= H - 76;
  }
  if (!isFinite(state.lockedFontSize) || state.lockedFontSize <= 0) {
    var minFont = state.maxLines > 2 ? 46 : 42;
    var fitBaseSize = 128;
    var minimumStepFont = fitBaseSize;
    while (minimumStepFont > minFont) minimumStepFont -= 4;
    var baseWidest = measureWidestAtSize(fitBaseSize);
    var baseLineHeight = fitBaseSize * (lines.length > 1 ? 0.98 : 1.0) * lyricLineHeightFactor();
    var baseBlockH = fitBaseSize + (lines.length - 1) * baseLineHeight;
    var fitRatio = Math.min(1, maxWidth / Math.max(1, baseWidest), (H - 76) / Math.max(1, baseBlockH));
    var estimatedFont = Math.floor((fitBaseSize * Math.max(0.01, fitRatio)) / 4) * 4;
    fontSize = Math.max(minimumStepFont, Math.min(fitBaseSize, estimatedFont || minimumStepFont));
    widest = measureWidestAtSize(fontSize);
    while (fontSize + 4 <= fitBaseSize) {
      var nextFontSize = fontSize + 4;
      var nextWidest = measureWidestAtSize(nextFontSize);
      if (!lyricMaskLayoutFits(nextFontSize, nextWidest)) break;
      fontSize = nextFontSize;
      widest = nextWidest;
    }
    while (fontSize > minimumStepFont && !lyricMaskLayoutFits(fontSize, widest)) {
      fontSize -= 4;
      widest = measureWidestAtSize(fontSize);
    }
  }
  ctx.font = lyricFontCss(fontSize);
  widest = 1;
  var widestMeasureIndex = fitMeasureIndexes[0];
  for (var mi = 0; mi < fitMeasureIndexes.length; mi++) {
    var measureIndex = fitMeasureIndexes[mi];
    var measuredLineWidth = scaledLyricMaskLayoutWidth(state, measureIndex, fontSize);
    if (measuredLineWidth > widest) {
      widest = measuredLineWidth;
      widestMeasureIndex = measureIndex;
    }
  }
  var widestEntry = entries[widestMeasureIndex] || {};
  widest = Math.max(1, lyricMeasureTextAtSize(ctx, lines[widestMeasureIndex] || '', fontSize * (widestEntry.scale || 1), lyricEntryWeight(widestEntry)));
  var canvasWidthPad = Math.max(220, fontSize * 2.2);
  var neededCanvasW = Math.ceil(Math.min(maxCanvasW, Math.max(baseCanvasW, widest + canvasWidthPad)));
  var W = neededCanvasW;
  var drawMaxWidth = W - 48;
  ctx.font = lyricFontCss(fontSize);
  var width = Math.min(drawMaxWidth, widest);
  var fitScaleX = widest > drawMaxWidth ? Math.max(0.01, drawMaxWidth / widest) : 1;
  if (fitScaleX < 1) width = Math.min(drawMaxWidth, widest * fitScaleX);
  var lockedLineHeight = Number(layoutOverride.lineHeight);
  var lineHeight = isFinite(lockedLineHeight) && lockedLineHeight > 0
    ? lockedLineHeight
    : fontSize * (lines.length > 1 ? 0.98 : 1.0) * lyricLineHeightFactor() * (lines.length > 1 ? lyricContextSpreadValue() : 1);
  var activeEntry = entries[activeLine] || {};
  var activeTextWidth = activeLine === widestMeasureIndex
    ? widest
    : Math.max(1, lyricMeasureTextAtSize(ctx, lines[activeLine] || '', fontSize * (activeEntry.scale || 1), lyricEntryWeight(activeEntry)));
  var activeWidth = Math.min(drawMaxWidth, activeTextWidth * fitScaleX);
  var blockH = fontSize + (lines.length - 1) * lineHeight;
  var activeBaseline = H / 2 + fontSize * 0.36;
  var y0 = activeBaseline - activeLine * lineHeight;
  var blockTop = y0 - fontSize * 0.84;
  var blockBottom = y0 + (lines.length - 1) * lineHeight + fontSize * 0.24;
  var padY = 22;
  if (blockTop < padY) y0 += padY - blockTop;
  if (blockBottom > H - padY) y0 -= blockBottom - (H - padY);
  state.result = {
    payload: payload,
    entries: entries,
    lines: lines,
    activeLine: activeLine,
    canvasWidth: W,
    canvasHeight: H,
    fontSize: fontSize,
    lineHeight: lineHeight,
    fitScaleX: fitScaleX,
    textWidth: width,
    activeTextWidth: activeWidth,
    textHeight: blockH,
    lineY0: y0,
    textMin: (W / 2 - activeWidth / 2) / W,
    textMax: (W / 2 + activeWidth / 2) / W
  };
  state.done = true;
  state.lastPhase = 'finalize';
  state.completedPhases += 1;
  return state.result;
}


function stepLyricMaskLayoutBuild(state, maxEntries) {
  if (!state || state.done) return true;
  var limit = Math.max(1, Number(maxEntries) || 1);
  var measured = 0;
  while (state.measureCursor < state.fitMeasureIndexes.length && measured < limit) {
    measureLyricMaskLayoutBaseEntry(state, state.fitMeasureIndexes[state.measureCursor]);
    state.measureCursor += 1;
    state.completedPhases += 1;
    state.lastPhase = 'entry';
    measured += 1;
  }
  if (measured > 0) return false;
  finalizeLyricMaskLayoutBuild(state);
  return true;
}


function measureLyricMaskLayout(input, layoutOverride) {
  var state = beginLyricMaskLayoutBuild(input, layoutOverride);
  while (!stepLyricMaskLayoutBuild(state, 1024)) { /* synchronous compatibility path */ }
  return finishLyricMaskLayoutBuild(state);
}


function lyricMaskLayoutMetricsFromLayout(layout) {
  var payload = layout.payload;
  return {
    texture: null,
    width: layout.canvasWidth,
    height: layout.canvasHeight,
    textWidth: layout.textWidth,
    activeTextWidth: layout.activeTextWidth,
    textHeight: layout.textHeight,
    fontSize: layout.fontSize,
    lineHeight: layout.lineHeight,
    lineY0: layout.lineY0,
    lineCount: layout.lines.length,
    lines: layout.lines,
    entries: layout.entries,
    activeLine: layout.activeLine,
    contextLayer: payload.contextLayer,
    activeLayer: payload.activeLayer,
    fitScaleX: layout.fitScaleX,
    textMin: layout.textMin,
    textMax: layout.textMax
  };
}


function beginLyricMaskLayoutMetricsBuild(input, layoutOverride) {
  return beginLyricMaskLayoutBuild(input, layoutOverride);
}


function stepLyricMaskLayoutMetricsBuild(state, maxEntries) {
  return stepLyricMaskLayoutBuild(state, maxEntries);
}


function finishLyricMaskLayoutMetricsBuild(state) {
  var layout = finishLyricMaskLayoutBuild(state);
  return layout ? lyricMaskLayoutMetricsFromLayout(layout) : null;
}


function makeLyricMaskLayoutMetrics(input, layoutOverride) {
  var state = beginLyricMaskLayoutMetricsBuild(input, layoutOverride);
  while (!stepLyricMaskLayoutMetricsBuild(state, 1024)) { /* synchronous compatibility path */ }
  return finishLyricMaskLayoutMetricsBuild(state);
}


function lyricStableHash(text) {
  text = String(text == null ? '' : text);
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}


function lyricSeededRandom(seed) {
  var state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return function () {
    state += 0x6d2b79f5;
    var value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}


function lyricMaskStoneSeed(lines, entries, fontSize) {
  var signature = (lines || []).join('\u241e') + '|' + Math.round(Number(fontSize) || 0) + '|';
  for (var i = 0; i < (entries || []).length; i++) {
    var entry = entries[i] || {};
    signature += (entry.translationLine ? 't' : 'p') + ':' + lyricEntryWeight(entry) + ':' + Math.round((Number(entry.scale) || 1) * 1000) + '|';
  }
  return lyricStableHash(signature);
}
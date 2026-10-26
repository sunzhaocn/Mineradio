'use strict';



function makeLyricMask(input, layoutOverride) {
  var layout = measureLyricMaskLayout(input, layoutOverride);
  var payload = layout.payload;
  var entries = layout.entries;
  var lines = layout.lines;
  var activeLine = layout.activeLine;
  var W = layout.canvasWidth;
  var H = layout.canvasHeight;
  var fontSize = layout.fontSize;
  var lineHeight = layout.lineHeight;
  var fitScaleX = layout.fitScaleX;
  var width = layout.textWidth;
  var activeWidth = layout.activeTextWidth;
  var blockH = layout.textHeight;
  var y0 = layout.lineY0;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  var x = W / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  for (var di = 0; di < lines.length; di++) {
    var entry = entries[di] || {};
    var lineFontSize = fontSize * (entry.scale || 1);
    ctx.globalAlpha = entry.alpha == null ? 1 : entry.alpha;
    var lineY = y0 + di * lineHeight + lyricEntryLineOffset(entry) * lineHeight;
    ctx.font = lyricFontCss(lineFontSize, lyricEntryWeight(entry));
    if (fitScaleX < 1) {
      ctx.save();
      ctx.translate(x, 0);
      ctx.scale(fitScaleX, 1);
      lyricFillText(ctx, lines[di], 0, lineY, lineFontSize);
      ctx.restore();
    } else {
      lyricFillText(ctx, lines[di], x, lineY, lineFontSize);
    }
  }
  ctx.globalAlpha = 1;
  ctx.font = lyricFontCss(fontSize);
  var stoneSeed = lyricMaskStoneSeed(lines, entries, fontSize);
  applyStonePrintTexture(ctx, W, H, fontSize, lyricSeededRandom(stoneSeed));
  applyLyricVerticalEdgeFade(ctx, W, H, lyricEdgeFadeValue() * (payload.contextLayer ? 1.15 : 0.74), activeLine, lines.length);
  var tex = new THREE.CanvasTexture(canvas);
  tex.userData = tex.userData || {};
  tex.userData.__mineradioLyricOwned = true;
  configureLyricTextureSampling(tex);
  return { texture: tex, width: W, height: H, textWidth: width, activeTextWidth: activeWidth, textHeight: blockH, fontSize: fontSize, lineHeight: lineHeight, lineY0: y0, lineCount: lines.length, lines: lines, entries: entries, activeLine: activeLine, contextLayer: payload.contextLayer, activeLayer: payload.activeLayer, fitScaleX: fitScaleX, textMin: layout.textMin, textMax: layout.textMax, stoneSeed: stoneSeed };
}


function lyricTextureClarityScale() {
  if (typeof normalizeLyricTextureClarity === 'function') return normalizeLyricTextureClarity(fx && fx.lyricTextureClarity);
  var value = Number(fx && fx.lyricTextureClarity);
  if (!isFinite(value)) return 1;
  if (Math.abs(value - 1.25) < 0.001) return 2;
  if (Math.abs(value - 1.5) < 0.001) return 4;
  return clampRange(Math.round(value), 1, 4);
}


function lyricRowTextureWidthBudget() {
  var canvasWidth = renderer && renderer.domElement ? Number(renderer.domElement.width) : 0;
  if (!isFinite(canvasWidth) || canvasWidth <= 0) {
    var dpr = typeof window !== 'undefined' ? Math.max(1, Number(window.devicePixelRatio) || 1) : 1;
    canvasWidth = (typeof window !== 'undefined' ? Math.max(1, Number(window.innerWidth) || 1280) : 1280) * dpr;
  }
  var budget = Math.ceil(clampRange(canvasWidth, 1024, 3072) / 64) * 64;
  var profile = typeof runtimeHardwareProfile !== 'undefined' ? runtimeHardwareProfile : null;
  if (profile && profile.lowSpec) budget = Math.min(budget, 1024);
  else if (profile && profile.balancedSpec) budget = Math.min(budget, 1536);
  var rendererMaxTexture = renderer && renderer.capabilities ? Number(renderer.capabilities.maxTextureSize) : 0;
  if (isFinite(rendererMaxTexture) && rendererMaxTexture > 0) budget = Math.min(budget, rendererMaxTexture);
  return Math.max(768, Math.round(budget));
}


function lyricQualityPoolBudgetBytes(tier) {
  tier = clampRange(Math.round(Number(tier) || 1), 1, 4);
  if (tier <= 1) return 0;
  var profile = typeof runtimeHardwareProfile !== 'undefined' ? runtimeHardwareProfile : null;
  var mib = tier === 2 ? 64 : (tier === 3 ? 128 : 192);
  if (profile && profile.lowSpec) mib = tier === 2 ? 32 : (tier === 3 ? 64 : 96);
  else if (profile && profile.balancedSpec) mib = tier === 2 ? 48 : (tier === 3 ? 96 : 144);
  return mib * 1024 * 1024;
}


function lyricQualityMaxResidentRows() {
  var profile = typeof runtimeHardwareProfile !== 'undefined' ? runtimeHardwareProfile : null;
  return profile && profile.lowSpec ? 4 : (profile && profile.balancedSpec ? 6 : 8);
}


function lyricQualityTargetMetrics(mask, tier) {
  if (!mask) return null;
  tier = clampRange(Math.round(Number(tier) || 1), 1, 4);
  if (tier <= 1) return null;
  var logicalW = Math.max(1, Number(mask.logicalWidth) || Number(mask.width) || 1);
  var logicalH = Math.max(1, Number(mask.logicalHeight) || Number(mask.height) || 1);
  var baseW = Math.max(1, Number(mask.width) || logicalW);
  var baseScale = baseW / logicalW;
  var scale = baseScale * tier;
  var rendererMax = renderer && renderer.capabilities ? Number(renderer.capabilities.maxTextureSize) : 0;
  var maxDimension = Math.min(6144, isFinite(rendererMax) && rendererMax > 0 ? rendererMax : 4096);
  scale = Math.min(scale, maxDimension / logicalW, maxDimension / logicalH);
  var width = Math.max(1, Math.floor(logicalW * scale));
  var height = Math.max(1, Math.floor(logicalH * scale));
  var poolBudget = lyricQualityPoolBudgetBytes(tier);
  var itemBudget = Math.min(64 * 1024 * 1024, poolBudget * 0.55);
  var bytes = Math.ceil(width * height * 8.8);
  if (itemBudget > 0 && bytes > itemBudget) {
    scale *= Math.sqrt(itemBudget / bytes);
    width = Math.max(1, Math.floor(logicalW * scale));
    height = Math.max(1, Math.floor(logicalH * scale));
    bytes = Math.ceil(width * height * 8.8);
  }
  if (width <= baseW + 8 || height <= Math.max(1, Number(mask.height) || logicalH) + 4) return null;
  return { tier: tier, scale: scale, width: width, height: height, bytes: bytes, logicalWidth: logicalW, logicalHeight: logicalH };
}


function makeLyricQualityTexture(mask, tier) {
  var target = lyricQualityTargetMetrics(mask, tier);
  if (!target) return null;
  var lines = Array.isArray(mask.lines) && mask.lines.length ? mask.lines : [''];
  var entries = Array.isArray(mask.entries) ? mask.entries : [];
  var logicalW = target.logicalWidth;
  var logicalH = target.logicalHeight;
  var fontSize = Math.max(1, Number(mask.logicalFontSize) || (Number(mask.fontSize) || 128) / Math.max(0.01, Number(mask.rasterScale) || 1));
  var lineHeight = Math.max(1, Number(mask.logicalLineHeight) || (Number(mask.lineHeight) || fontSize) / Math.max(0.01, Number(mask.rasterScale) || 1));
  var lineY0 = isFinite(Number(mask.logicalLineY0)) ? Number(mask.logicalLineY0) : (Number(mask.lineY0) || logicalH / 2 + fontSize * 0.36) / Math.max(0.01, Number(mask.rasterScale) || 1);
  var fitScaleX = Number(mask.fitScaleX) || 1;
  var activeLine = Math.max(0, Math.min(lines.length - 1, Number(mask.activeLine) || 0));
  var canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(target.scale, 0, 0, target.scale, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  for (var i = 0; i < lines.length; i++) {
    var entry = entries[i] || {};
    var lineFontSize = fontSize * (entry.scale || 1);
    var lineY = lineY0 + i * lineHeight + lyricEntryLineOffset(entry) * lineHeight;
    ctx.globalAlpha = entry.alpha == null ? 1 : entry.alpha;
    ctx.font = lyricFontCss(lineFontSize, lyricEntryWeight(entry));
    if (fitScaleX < 1) {
      ctx.save();
      ctx.translate(logicalW / 2, 0);
      ctx.scale(fitScaleX, 1);
      lyricFillText(ctx, lines[i], 0, lineY, lineFontSize);
      ctx.restore();
    } else {
      lyricFillText(ctx, lines[i], logicalW / 2, lineY, lineFontSize);
    }
  }
  ctx.globalAlpha = 1;
  var stoneSeed = Number(mask.stoneSeed) || lyricMaskStoneSeed(lines, entries, fontSize);
  applyStonePrintTexture(ctx, logicalW, logicalH, fontSize, lyricSeededRandom(stoneSeed));
  applyLyricVerticalEdgeFade(ctx, logicalW, logicalH, lyricEdgeFadeValue() * (mask.contextLayer ? 1.15 : 0.74), activeLine, lines.length);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  var texture = new THREE.CanvasTexture(canvas);
  texture.userData = texture.userData || {};
  texture.userData.__mineradioLyricOwned = true;
  texture.userData.__mineradioLyricQuality = true;
  texture.userData.__mineradioLyricQualityBytes = target.bytes;
  configureLyricTextureSampling(texture);
  return { texture: texture, tier: target.tier, width: target.width, height: target.height, bytes: target.bytes, key: target.tier + 'x|' + target.width + 'x' + target.height + '|' + stoneSeed };
}


function lyricGlowTextureWidthBudget() {
  var canvasWidth = renderer && renderer.domElement ? Number(renderer.domElement.width) : 0;
  if (!isFinite(canvasWidth) || canvasWidth <= 0) {
    var dpr = typeof window !== 'undefined' ? Math.max(1, Number(window.devicePixelRatio) || 1) : 1;
    canvasWidth = (typeof window !== 'undefined' ? Math.max(1, Number(window.innerWidth) || 1280) : 1280) * dpr;
  }
  var profile = typeof runtimeHardwareProfile !== 'undefined' ? runtimeHardwareProfile : null;
  var qualityScale = profile && profile.lowSpec ? 1.00 : (profile && profile.balancedSpec ? 1.12 : 1.25);
  var minimum = profile && profile.lowSpec ? 1536 : (profile && profile.balancedSpec ? 1792 : 2048);
  var maximum = profile && profile.lowSpec ? 2048 : (profile && profile.balancedSpec ? 2560 : 3072);
  var budget = Math.ceil(clampRange(canvasWidth * qualityScale, minimum, maximum) / 64) * 64;
  var rendererMaxTexture = renderer && renderer.capabilities ? Number(renderer.capabilities.maxTextureSize) : 0;
  if (isFinite(rendererMaxTexture) && rendererMaxTexture > 0) budget = Math.min(budget, rendererMaxTexture);
  return Math.max(1024, Math.round(budget));
}


function lyricGlowRasterMetrics(mask) {
  mask = mask || {};
  var sourceScale = clampRange(Number(mask.rasterScale) || 1, 0.01, 1);
  var logicalFontSize = Math.max(1, Number(mask.logicalFontSize) || (Number(mask.fontSize) || 128) / sourceScale);
  var logicalTextWidth = Math.max(1, Number(mask.logicalActiveTextWidth) || Number(mask.logicalTextWidth) || (Number(mask.activeTextWidth) || Number(mask.textWidth) || 1) / sourceScale);
  var logicalLineHeight = Math.max(1, Number(mask.logicalLineHeight) || (Number(mask.lineHeight) || logicalFontSize * lyricLineHeightFactor()) / sourceScale);
  var logicalPadX = Math.max(160, logicalFontSize * 1.45);
  var logicalGlowWidth = logicalTextWidth + logicalPadX * 2;
  var widthBudget = lyricGlowTextureWidthBudget();
  var profile = typeof runtimeHardwareProfile !== 'undefined' ? runtimeHardwareProfile : null;
  // The main text can safely use the low-memory row budget, but a glow made
  // from a 20-40 px glyph raster exposes every glyph as a scalloped light
  // blob when it is expanded back to the logical long-line plane.  Keep the
  // visible glow near screen resolution without restoring every row to 6K.
  var minimumRasterFont = profile && profile.lowSpec ? 64 : (profile && profile.balancedSpec ? 72 : 80);
  var budgetScale = widthBudget / Math.max(1, logicalGlowWidth);
  var fontScale = minimumRasterFont / logicalFontSize;
  var scale = clampRange(Math.max(sourceScale, budgetScale, fontScale), 0.01, 1);
  return {
    scale: scale,
    fontSize: logicalFontSize * scale,
    textWidth: logicalTextWidth * scale,
    lineHeight: logicalLineHeight * scale,
    widthBudget: widthBudget,
    sourceScale: sourceScale
  };
}


function compactLyricLineMaskTexture(mask) {
  if (!mask || !mask.texture || !mask.texture.image) return mask;
  var sourceCanvas = mask.texture.image;
  var sourceWidth = Math.max(1, Number(sourceCanvas.width) || Number(mask.width) || 1);
  var sourceHeight = Math.max(1, Number(sourceCanvas.height) || Number(mask.height) || 1);
  // Raster compaction is only a GPU-memory optimization.  Preserve the
  // pre-compaction layout metrics so later resident rows never inherit an
  // already-downscaled font, and so wider anti-crop canvases do not make the
  // same 128 px lyric glyphs appear physically smaller in world space.
  if (!isFinite(Number(mask.logicalWidth)) || Number(mask.logicalWidth) <= 0) mask.logicalWidth = sourceWidth;
  if (!isFinite(Number(mask.logicalHeight)) || Number(mask.logicalHeight) <= 0) mask.logicalHeight = sourceHeight;
  if (!isFinite(Number(mask.logicalFontSize)) || Number(mask.logicalFontSize) <= 0) mask.logicalFontSize = Number(mask.fontSize) || 128;
  if (!isFinite(Number(mask.logicalLineHeight)) || Number(mask.logicalLineHeight) <= 0) mask.logicalLineHeight = Number(mask.lineHeight) || Number(mask.logicalFontSize) * 1.08;
  if (!isFinite(Number(mask.logicalLineY0))) mask.logicalLineY0 = Number(mask.lineY0) || 0;
  if (!isFinite(Number(mask.logicalTextWidth)) || Number(mask.logicalTextWidth) <= 0) mask.logicalTextWidth = Number(mask.textWidth) || sourceWidth;
  if (!isFinite(Number(mask.logicalActiveTextWidth)) || Number(mask.logicalActiveTextWidth) <= 0) mask.logicalActiveTextWidth = Number(mask.activeTextWidth) || Number(mask.logicalTextWidth);
  if (!isFinite(Number(mask.logicalTextHeight)) || Number(mask.logicalTextHeight) <= 0) mask.logicalTextHeight = Number(mask.textHeight) || Number(mask.logicalFontSize);
  var widthBudget = lyricRowTextureWidthBudget();
  if (sourceWidth <= widthBudget + 8) return mask;
  var scale = widthBudget / sourceWidth;
  var compactCanvas = document.createElement('canvas');
  compactCanvas.width = Math.max(1, Math.round(sourceWidth * scale));
  compactCanvas.height = Math.max(1, Math.round(sourceHeight * scale));
  var compactCtx = compactCanvas.getContext('2d');
  compactCtx.imageSmoothingEnabled = true;
  compactCtx.imageSmoothingQuality = 'high';
  compactCtx.drawImage(sourceCanvas, 0, 0, compactCanvas.width, compactCanvas.height);
  var compactTexture = new THREE.CanvasTexture(compactCanvas);
  compactTexture.userData = compactTexture.userData || {};
  compactTexture.userData.__mineradioLyricOwned = true;
  configureLyricTextureSampling(compactTexture);
  var originalTexture = mask.texture;
  originalTexture.userData = originalTexture.userData || {};
  originalTexture.userData.__mineradioDisposed = true;
  originalTexture.dispose();
  sourceCanvas.width = 1;
  sourceCanvas.height = 1;
  mask.texture = compactTexture;
  mask.width = compactCanvas.width;
  mask.height = compactCanvas.height;
  mask.textWidth *= scale;
  mask.activeTextWidth *= scale;
  mask.textHeight *= scale;
  mask.fontSize *= scale;
  mask.lineHeight *= scale;
  mask.lineY0 *= scale;
  mask.rasterScale = (Number(mask.rasterScale) || 1) * scale;
  return mask;
}


function beginLyricReadabilityTextureBuild(mask) {
  var canvas = document.createElement('canvas');
  var W = mask && mask.width || 2048;
  var H = mask && mask.height || 384;
  var fontSize = mask && mask.fontSize || 128;
  var lines = mask && Array.isArray(mask.lines) && mask.lines.length ? mask.lines : [''];
  var entries = mask && Array.isArray(mask.entries) ? mask.entries : [];
  var lineHeight = mask && mask.lineHeight || fontSize * lyricLineHeightFactor();
  var fitScaleX = mask && mask.fitScaleX || 1;
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.font = lyricFontCss(fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.miterLimit = 2;
  var activeLine = Math.max(0, Math.min(lines.length - 1, Number(mask && mask.activeLine) || 0));
  var hasLineY0 = mask && isFinite(Number(mask.lineY0));
  var y0 = hasLineY0 ? Number(mask.lineY0) : (H / 2 + fontSize * 0.36 - activeLine * lineHeight);
  return {
    mask: mask,
    canvas: canvas,
    ctx: ctx,
    W: W,
    H: H,
    fontSize: fontSize,
    lines: lines,
    entries: entries,
    lineHeight: lineHeight,
    fitScaleX: fitScaleX,
    activeLine: activeLine,
    y0: y0,
    pixelScale: clampRange(Number(mask && mask.rasterScale) || 1, 0.20, 1),
    phase: 0,
    lastPhase: '',
    texture: null,
    done: false
  };
}


function drawLyricReadabilityStrokeLines(state, dx, dy) {
  var ctx = state.ctx;
  for (var i = 0; i < state.lines.length; i++) {
    var entry = state.entries[i] || {};
    var lineFontSize = state.fontSize * (entry.scale || 1);
    var y = state.y0 + i * state.lineHeight + lyricEntryLineOffset(entry) * state.lineHeight + (dy || 0);
    var prevAlpha = ctx.globalAlpha;
    var prevLineWidth = ctx.lineWidth;
    var alpha = entry.alpha == null ? 1 : clampRange(Number(entry.alpha), entry.translationLine ? 0.10 : 0.22, 1);
    ctx.font = lyricFontCss(lineFontSize, lyricEntryWeight(entry));
    ctx.globalAlpha = prevAlpha * alpha * (entry.translationLine ? 0.62 : 1);
    if (entry.translationLine) ctx.lineWidth = Math.max(1.8 * state.pixelScale, prevLineWidth * 0.52);
    if (state.fitScaleX < 1) {
      ctx.save();
      ctx.translate(state.W / 2 + (dx || 0), 0);
      ctx.scale(state.fitScaleX, 1);
      lyricStrokeText(ctx, state.lines[i], 0, y, lineFontSize);
      ctx.restore();
    } else {
      lyricStrokeText(ctx, state.lines[i], state.W / 2 + (dx || 0), y, lineFontSize);
    }
    ctx.lineWidth = prevLineWidth;
    ctx.globalAlpha = prevAlpha;
  }
}
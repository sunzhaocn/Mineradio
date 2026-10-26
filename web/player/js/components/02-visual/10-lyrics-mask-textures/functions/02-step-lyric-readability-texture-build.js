'use strict';



function stepLyricReadabilityTextureBuild(state) {
  if (!state || state.done) return true;
  var ctx = state.ctx;
  var fontSize = state.fontSize;
  var pixelScale = state.pixelScale;
  // Black/white readability layer: text-shaped only, no rectangular backing.
  if (state.phase === 0) {
    ctx.save();
    ctx.filter = 'blur(' + Math.max(1, 14 * pixelScale).toFixed(2) + 'px)';
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = Math.max(18 * pixelScale, fontSize * 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    drawLyricReadabilityStrokeLines(state, 0, fontSize * 0.018);
    ctx.restore();
    state.phase = 1;
    state.lastPhase = 'shadow-wide';
    return false;
  }
  if (state.phase === 1) {
    ctx.save();
    ctx.filter = 'blur(' + Math.max(0.8, 5 * pixelScale).toFixed(2) + 'px)';
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = Math.max(9 * pixelScale, fontSize * 0.075);
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    drawLyricReadabilityStrokeLines(state, 0, fontSize * 0.012);
    ctx.restore();
    state.phase = 2;
    state.lastPhase = 'shadow-mid';
    return false;
  }
  if (state.phase === 2) {
    ctx.save();
    ctx.filter = 'blur(' + Math.max(0.7, 4 * pixelScale).toFixed(2) + 'px)';
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = Math.max(9 * pixelScale, fontSize * 0.070);
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    drawLyricReadabilityStrokeLines(state, 0, 0);
    ctx.restore();
    state.phase = 3;
    state.lastPhase = 'outline-wide';
    return false;
  }
  ctx.save();
  ctx.filter = 'blur(' + Math.max(0.45, 1.2 * pixelScale).toFixed(2) + 'px)';
  ctx.globalAlpha = 0.26;
  ctx.lineWidth = Math.max(3.2 * pixelScale, fontSize * 0.030);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  drawLyricReadabilityStrokeLines(state, 0, 0);
  ctx.restore();
  applyLyricVerticalEdgeFade(ctx, state.W, state.H, lyricEdgeFadeValue() * (state.mask && state.mask.contextLayer ? 1.08 : 0.62), state.activeLine, state.lines.length);
  var tex = new THREE.CanvasTexture(state.canvas);
  tex.userData = tex.userData || {};
  tex.userData.__mineradioLyricOwned = true;
  configureLyricTextureSampling(tex);
  state.texture = tex;
  state.phase = LYRIC_READABILITY_BUILD_PHASES;
  state.lastPhase = 'outline-fine';
  state.done = true;
  return true;
}


function finishLyricReadabilityTextureBuild(state) {
  if (!state) return null;
  while (!stepLyricReadabilityTextureBuild(state)) { /* synchronous compatibility path */ }
  return state.texture;
}


function makeLyricReadabilityTexture(mask) {
  return finishLyricReadabilityTextureBuild(beginLyricReadabilityTextureBuild(mask));
}


function beginLyricGlowTextureBuild(text, fontSize, textWidth, lines, lineHeight, fitScaleX, entries, activeLine, sourceMask, rasterScale) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  var drawLines = Array.isArray(lines) && lines.length ? lines : [text];
  entries = Array.isArray(entries) ? entries : [];
  var useMaskFrame = !!(sourceMask && isFinite(Number(sourceMask.width)) && isFinite(Number(sourceMask.height)));
  var canvas = document.createElement('canvas');
  var measureCanvas = document.createElement('canvas');
  var measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = lyricFontCss(fontSize);
  fitScaleX = fitScaleX || 1;
  var measuredWidth = Math.max(1, textWidth || lyricMeasureTextAtSize(measureCtx, text, fontSize) * fitScaleX);
  for (var li = 0; li < drawLines.length; li++) {
    var lineFontSize = fontSize * ((entries[li] && entries[li].scale) || 1);
    measuredWidth = Math.max(measuredWidth, lyricMeasureTextAtSize(measureCtx, drawLines[li], lineFontSize, lyricEntryWeight(entries[li])) * fitScaleX);
  }
  var pixelScale = clampRange(Number(sourceMask && sourceMask.rasterScale) || Number(rasterScale) || 1, 0.20, 1);
  var padX = Math.max(160 * pixelScale, fontSize * 1.45);
  var padY = Math.max(86 * pixelScale, fontSize * 0.78);
  var lh = lineHeight || fontSize * 1.04;
  var blockH = fontSize + (drawLines.length - 1) * lh;
  activeLine = Math.max(0, Math.min(drawLines.length - 1, Number(activeLine) || 0));
  var W = useMaskFrame ? Math.round(sourceMask.width) : Math.ceil(measuredWidth + padX * 2);
  var H = useMaskFrame ? Math.round(sourceMask.height) : Math.ceil(blockH + padY * 2);
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = lyricFontCss(fontSize);
  var y0 = useMaskFrame && isFinite(Number(sourceMask.lineY0)) ? Number(sourceMask.lineY0) : (H / 2 + fontSize * 0.36 - activeLine * lh);
  return {
    text: text,
    fontSize: fontSize,
    drawLines: drawLines,
    entries: entries,
    useMaskFrame: useMaskFrame,
    sourceMask: sourceMask,
    canvas: canvas,
    ctx: ctx,
    W: W,
    H: H,
    measuredWidth: measuredWidth,
    lineHeight: lh,
    fitScaleX: fitScaleX,
    activeLine: activeLine,
    y0: y0,
    pixelScale: pixelScale,
    phase: 0,
    lastPhase: '',
    texture: null,
    done: false
  };
}


function drawLyricGlowText(state, dx, dy) {
  var ctx = state.ctx;
  for (var i = 0; i < state.drawLines.length; i++) {
    var entry = state.entries[i] || {};
    var lineFontSize = state.fontSize * (entry.scale || 1);
    var alpha = entry.alpha == null ? 1 : clampRange(Number(entry.alpha), entry.translationLine ? 0.08 : 0.22, 1);
    var y = state.y0 + i * state.lineHeight + lyricEntryLineOffset(entry) * state.lineHeight + (dy || 0);
    var prevAlpha = ctx.globalAlpha;
    var prevLineWidth = ctx.lineWidth;
    var glowFactor = entry.translationLine ? 0.34 : 1;
    ctx.font = lyricFontCss(lineFontSize, lyricEntryWeight(entry));
    ctx.globalAlpha = prevAlpha * alpha * glowFactor;
    if (entry.translationLine) ctx.lineWidth = Math.max(1.8 * state.pixelScale, prevLineWidth * 0.48);
    if (state.fitScaleX < 1) {
      ctx.save();
      ctx.translate(state.W / 2 + (dx || 0), 0);
      ctx.scale(state.fitScaleX, 1);
      if (ctx.lineWidth > 0) lyricStrokeText(ctx, state.drawLines[i], 0, y, lineFontSize);
      lyricFillText(ctx, state.drawLines[i], 0, y, lineFontSize);
      ctx.restore();
    } else {
      if (ctx.lineWidth > 0) lyricStrokeText(ctx, state.drawLines[i], state.W / 2 + (dx || 0), y, lineFontSize);
      lyricFillText(ctx, state.drawLines[i], state.W / 2 + (dx || 0), y, lineFontSize);
    }
    ctx.lineWidth = prevLineWidth;
    ctx.globalAlpha = prevAlpha;
  }
}


function drawLyricGlowBlurPass(state, filter, alpha, lineWidth) {
  var ctx = state.ctx;
  ctx.save();
  ctx.filter = filter;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fff';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = '#fff';
  drawLyricGlowText(state, 0, 0);
  ctx.restore();
}


function drawLyricGlowRadialPass(state, start, end) {
  var ctx = state.ctx;
  var pixelScale = state.pixelScale;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'blur(' + Math.max(0.8, 8 * pixelScale).toFixed(2) + 'px)';
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = '#fff';
  for (var ri = start; ri < end; ri++) {
    var ang = ri / 8 * Math.PI * 2;
    drawLyricGlowText(state, Math.cos(ang) * 7 * pixelScale, Math.sin(ang) * 4 * pixelScale);
  }
  ctx.restore();
}


function finishLyricGlowTexturePixels(state) {
  var ctx = state.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  var xMask = ctx.createLinearGradient(0, 0, state.W, 0);
  xMask.addColorStop(0.00, 'rgba(255,255,255,0)');
  xMask.addColorStop(0.10, 'rgba(255,255,255,1)');
  xMask.addColorStop(0.90, 'rgba(255,255,255,1)');
  xMask.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = xMask;
  ctx.fillRect(0, 0, state.W, state.H);
  var yMask = ctx.createLinearGradient(0, 0, 0, state.H);
  yMask.addColorStop(0.00, 'rgba(255,255,255,0)');
  yMask.addColorStop(0.16, 'rgba(255,255,255,1)');
  yMask.addColorStop(0.84, 'rgba(255,255,255,1)');
  yMask.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = yMask;
  ctx.fillRect(0, 0, state.W, state.H);
  ctx.restore();
  var tex = new THREE.CanvasTexture(state.canvas);
  tex.userData = tex.userData || {};
  tex.userData.__mineradioLyricOwned = true;
  configureLyricTextureSampling(tex);
  Object.assign(tex.userData, {
    width: state.W,
    height: state.H,
    textWidth: state.useMaskFrame ? (state.sourceMask.activeTextWidth || state.sourceMask.textWidth || state.measuredWidth) : state.measuredWidth,
    matchMask: state.useMaskFrame,
    lineY0: state.y0,
    rasterScale: state.pixelScale,
    fontSize: state.fontSize
  });
  state.texture = tex;
  state.done = true;
}


function stepLyricGlowTextureBuild(state) {
  if (!state || state.done) return true;
  var fontSize = state.fontSize;
  var pixelScale = state.pixelScale;
  if (state.phase === 0) {
    drawLyricGlowBlurPass(state, 'blur(' + Math.max(1, 14 * pixelScale).toFixed(2) + 'px)', 0.46, Math.max(10 * pixelScale, fontSize * 0.10));
    state.lastPhase = 'blur-14';
  } else if (state.phase === 1) {
    drawLyricGlowBlurPass(state, 'blur(' + Math.max(1.5, 34 * pixelScale).toFixed(2) + 'px)', 0.34, Math.max(18 * pixelScale, fontSize * 0.18));
    state.lastPhase = 'blur-34';
  } else if (state.phase === 2) {
    drawLyricGlowBlurPass(state, 'blur(' + Math.max(2, 78 * pixelScale).toFixed(2) + 'px)', 0.22, Math.max(28 * pixelScale, fontSize * 0.26));
    state.lastPhase = 'blur-78';
  } else if (state.phase === 3) {
    drawLyricGlowBlurPass(state, 'blur(' + Math.max(3, 116 * pixelScale).toFixed(2) + 'px)', 0.13, Math.max(42 * pixelScale, fontSize * 0.40));
    state.lastPhase = 'blur-116';
  } else {
    var radialIndex = Math.max(0, Math.min(7, state.phase - 4));
    drawLyricGlowRadialPass(state, radialIndex, radialIndex + 1);
    state.lastPhase = 'radial-' + (radialIndex + 1);
    if (state.phase === LYRIC_GLOW_BUILD_PHASES - 1) finishLyricGlowTexturePixels(state);
  }
  state.phase += 1;
  if (state.phase >= LYRIC_GLOW_BUILD_PHASES) state.done = true;
  return state.done;
}


function finishLyricGlowTextureBuild(state) {
  if (!state) return null;
  while (!stepLyricGlowTextureBuild(state)) { /* synchronous compatibility path */ }
  return state.texture;
}


function makeLyricGlowTexture(text, fontSize, textWidth, lines, lineHeight, fitScaleX, entries, activeLine, sourceMask, rasterScale) {
  return finishLyricGlowTextureBuild(beginLyricGlowTextureBuild(text, fontSize, textWidth, lines, lineHeight, fitScaleX, entries, activeLine, sourceMask, rasterScale));
}
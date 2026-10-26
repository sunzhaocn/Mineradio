'use strict';

function lyricLineCenterWorldY(mask, entry, lineIndex, worldH) {
  mask = mask || {};
  entry = entry || {};
  var h = Math.max(1, Number(mask.height) || 384);
  var fontSize = Number(mask.fontSize) || 128;
  var lineHeight = Number(mask.lineHeight) || fontSize;
  var lineFontSize = fontSize * (entry.scale || 1);
  var y0 = isFinite(Number(mask.lineY0)) ? Number(mask.lineY0) : (h / 2 + fontSize * 0.36);
  var baseline = y0 + lineIndex * lineHeight + lyricEntryLineOffset(entry) * lineHeight;
  var centerY = baseline - lineFontSize * 0.36;
  return (0.5 - clampRange(centerY / h, 0, 1)) * worldH;
}


function lyricRowVirtualIndex(entry, fallbackIndex) {
  entry = entry || {};
  if (entry.translationLine && entry.parentIndex != null && isFinite(Number(entry.parentIndex))) return lyricTranslationVirtualIndex(entry.parentIndex);
  if (entry.lineIndex != null && isFinite(Number(entry.lineIndex))) return lyricPrimaryVirtualIndex(entry.lineIndex);
  if (entry.virtualIndex != null && isFinite(Number(entry.virtualIndex))) return Number(entry.virtualIndex);
  return Number(fallbackIndex) || 0;
}


function lyricLayerVirtualIndex(entry, fallbackIndex, activeLine, usesTrack) {
  entry = entry || {};
  if (!usesTrack) {
    var localActive = activeLine != null && isFinite(Number(activeLine)) ? Number(activeLine) : 0;
    if (entry.translationLine && entry.parentRole === 'current') return localActive + lyricTranslationVisualGapValue();
    return Number(fallbackIndex) || 0;
  }
  return lyricRowVirtualIndex(entry, fallbackIndex);
}


function lyricTrackLineStepWorld(mask, worldH) {
  mask = mask || {};
  var h = Math.max(1, Number(mask.height) || 384);
  var lineHeight = Number(mask.lineHeight) || Number(mask.fontSize) || 128;
  var step = worldH * (lineHeight / h);
  step *= clampRange(1 + (lyricContextSpreadValue() - 1) * 0.32, 0.86, 1.45);
  if (lyricTranslationLayoutActive()) step *= 1.06;
  return clampRange(step, 0.22, 0.94);
}


function lyricTranslationLineStepWorld(mask, worldH) {
  mask = mask || {};
  var h = Math.max(1, Number(mask.height) || 384);
  var lineHeight = Number(mask.lineHeight) || Number(mask.fontSize) || 128;
  var step = worldH * (lineHeight / h);
  if (lyricTranslationLayoutActive()) step *= 1.04;
  return clampRange(step, 0.20, 0.78);
}


function lyricTranslationAnchoredY(entry, fallbackIndex, activeLine, lineStepWorld, translationLineStepWorld, scrollOffset, rowDrift, currentTranslation, usesTrack) {
  entry = entry || {};
  if (!usesTrack) {
    var rowVirtualLocal = entry.virtualIndex != null && isFinite(Number(entry.virtualIndex))
      ? Number(entry.virtualIndex)
      : lyricLayerVirtualIndex(entry, fallbackIndex, activeLine, false);
    var localOffset = scrollOffset == null || !isFinite(Number(scrollOffset)) ? activeLine : Number(scrollOffset);
    var localDelta = rowVirtualLocal - localOffset;
    var localSign = localDelta >= 0 ? 1 : -1;
    var parentDeltaLocal = localDelta - localSign * lyricTranslationVisualGapValue();
    var parentAbsLocal = Math.abs(parentDeltaLocal);
    var parentDriftLocal = currentTranslation ? 0 : ((Number(rowDrift) || 0) * clampRange(0.70 + parentAbsLocal * 0.10, 0.65, 1.20));
    return -parentDeltaLocal * lineStepWorld + parentDriftLocal - localSign * lyricTranslationVisualGapValue() * translationLineStepWorld;
  }
  var parentIndex = entry.parentIndex != null && isFinite(Number(entry.parentIndex))
    ? Number(entry.parentIndex)
    : (entry.lineIndex != null && isFinite(Number(entry.lineIndex)) ? Number(entry.lineIndex) : null);
  var parentVirtual = parentIndex != null ? lyricPrimaryVirtualIndex(parentIndex) : activeLine;
  var rowVirtual = entry.virtualIndex != null && isFinite(Number(entry.virtualIndex))
    ? Number(entry.virtualIndex)
    : lyricLayerVirtualIndex(entry, fallbackIndex, activeLine, true);
  var baseOffset = scrollOffset == null || !isFinite(Number(scrollOffset)) ? activeLine : Number(scrollOffset);
  var parentDelta = parentVirtual - baseOffset;
  var parentAbs = Math.abs(parentDelta);
  var parentDrift = currentTranslation ? 0 : ((Number(rowDrift) || 0) * clampRange(0.70 + parentAbs * 0.10, 0.65, 1.20));
  var sign = rowVirtual >= parentVirtual ? 1 : -1;
  return -parentDelta * lineStepWorld + parentDrift - sign * lyricTranslationVisualGapValue() * translationLineStepWorld;
}


function lyricLineAllowedForDisplayMode(lineIndex, targetLineIndex, mode) {
  if (lineIndex == null || !isFinite(Number(lineIndex))) return true;
  var delta = Math.round(Number(lineIndex) - Number(targetLineIndex || 0));
  var offsets = lyricDisplayOffsetsForMode(mode);
  for (var i = 0; i < offsets.length; i++) {
    if (Math.round(Number(offsets[i]) || 0) === delta) return true;
  }
  return false;
}


function lyricNearestPrimaryLineIndexForVirtual(virtualIndex, fallbackLineIndex) {
  var count = typeof lyricsLines !== 'undefined' && lyricsLines ? lyricsLines.length : 0;
  if (!count || !isFinite(Number(virtualIndex))) return Math.max(0, Math.round(Number(fallbackLineIndex) || 0));
  var value = Number(virtualIndex);
  var low = 0;
  var high = count - 1;
  while (low < high) {
    var middle = Math.floor((low + high) / 2);
    if (lyricPrimaryVirtualIndex(middle) < value) low = middle + 1;
    else high = middle;
  }
  var upper = low;
  var lower = Math.max(0, upper - 1);
  return Math.abs(lyricPrimaryVirtualIndex(lower) - value) <= Math.abs(lyricPrimaryVirtualIndex(upper) - value)
    ? lower
    : upper;
}


function lyricRowVisualDelta(entry, index, activeLine) {
  entry = entry || {};
  var raw = index - activeLine;
  if (entry.virtualIndex != null || entry.lineIndex != null || entry.parentIndex != null) {
    var trackIndex = activeLine != null && isFinite(Number(activeLine)) ? Number(activeLine) : 0;
    raw = lyricRowVirtualIndex(entry, index) - trackIndex;
  }
  if (entry.translationLine && entry.parentRole === 'current' && !(entry.virtualIndex != null || entry.lineIndex != null || entry.parentIndex != null)) {
    var gap = lyricTranslationGapValue();
    return raw >= 0 ? gap : -gap;
  }
  return raw;
}


function lyricRowDepthZ(entry, index, activeLine) {
  var delta = lyricRowVisualDelta(entry, index, activeLine);
  var abs = Math.min(5.5, Math.abs(delta));
  return 0.055 - Math.pow(abs, 1.06) * 0.145;
}


function lyricRowDepthScale(entry, index, activeLine) {
  var abs = Math.min(5.5, Math.abs(lyricRowVisualDelta(entry, index, activeLine)));
  return clampRange(1 - abs * 0.026, 0.84, 1.02);
}


function makeLyricBackfaceReadableMaterial(opts) {
  opts = opts || {};
  var color = opts.color && opts.color.isColor ? opts.color.clone() : new THREE.Color(opts.color == null ? 0xffffff : opts.color);
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: opts.map || null },
      uColor: { value: color },
      uOpacity: { value: opts.opacity == null ? 0 : clampRange(Number(opts.opacity) || 0, 0, 1) }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D uMap;',
      'uniform vec3 uColor;',
      'uniform float uOpacity;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);',
      '  vec4 tex = texture2D(uMap, uv);',
      '  gl_FragColor = vec4(uColor, tex.a * uOpacity);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: opts.blending || THREE.NormalBlending
  });
}

function setLyricTextureMaterialOpacity(mat, value) {
  value = clampRange(Number(value) || 0, 0, 1);
  if (mat && mat.uniforms && mat.uniforms.uOpacity) mat.uniforms.uOpacity.value = value;
  else if (mat) mat.opacity = value;
}

function getLyricTextureMaterialOpacity(mat) {
  if (mat && mat.uniforms && mat.uniforms.uOpacity) return Number(mat.uniforms.uOpacity.value) || 0;
  return mat && isFinite(Number(mat.opacity)) ? Number(mat.opacity) : 0;
}

function setLyricTextureMaterialColor(mat, color) {
  if (!mat || !color) return;
  if (mat.uniforms && mat.uniforms.uColor && mat.uniforms.uColor.value && mat.uniforms.uColor.value.copy) mat.uniforms.uColor.value.copy(color);
  else if (mat.color && mat.color.copy) mat.color.copy(color);
}

function lyricBackgroundAdaptStrengthValue() {
  var fallback = fxDefaults && isFinite(Number(fxDefaults.lyricBackgroundAdapt)) ? Number(fxDefaults.lyricBackgroundAdapt) : 0;
  var value = fx && fx.lyricBackgroundAdapt != null ? Number(fx.lyricBackgroundAdapt) : fallback;
  return clampRange(value, 0, 1);
}

function lyricBackdropAdaptActive() {
  return (!fx || fx.lyricBackdropAdapt !== false) && lyricBackgroundAdaptStrengthValue() > 0.001;
}

function lyricReadabilityColorForBrightBackdrop(strength) {
  if (typeof THREE === 'undefined') return null;
  if (!lyricReadabilityLightColor) lyricReadabilityLightColor = new THREE.Color(0xffffff);
  if (!lyricReadabilityDarkColor) lyricReadabilityDarkColor = new THREE.Color(0x04070c);
  if (!lyricReadabilityMixColor) lyricReadabilityMixColor = new THREE.Color(0xffffff);
  return lyricReadabilityMixColor.copy(lyricReadabilityLightColor).lerp(lyricReadabilityDarkColor, clampRange(strength * 0.92, 0, 0.92));
}


function makeLyricLineMask(entry, baseMask, asActive) {
  entry = entry || {};
  var primaryLine = !entry.translationLine;
  var drawEntry = cloneStageLyricEntryForLayer(entry, {
    role: asActive ? 'current' : (entry.role || 'context'),
    alpha: 1,
    scale: primaryLine ? 1 : (entry.scale || lyricTranslationScaleValue())
  });
  return compactLyricLineMaskTexture(makeLyricMask({
    mode: 'single',
    key: 'line|' + (drawEntry.role || '') + '|' + Math.round((drawEntry.scale || 1) * 1000) + '|' + drawEntry.text,
    activeLine: 0,
    entries: [drawEntry]
  }, {
    fontSize: baseMask && (baseMask.logicalFontSize || baseMask.fontSize),
    lineHeight: baseMask && (baseMask.logicalLineHeight || baseMask.lineHeight)
  }));
}


function lyricTranslationMeshScale(entry) {
  if (!entry || !entry.translationLine) return 1;
  var scale = isFinite(Number(entry.scale)) ? Number(entry.scale) : lyricTranslationScaleValue();
  var defaultScale = fxDefaults && isFinite(Number(fxDefaults.lyricTranslationScale)) ? Number(fxDefaults.lyricTranslationScale) : 0.78;
  var roleBoost = entry.parentRole === 'current' ? 1.08 : 0.92;
  var defaultEntryScale = clampRange(defaultScale * roleBoost, entry.parentRole === 'current' ? 0.70 : 0.50, entry.parentRole === 'current' ? 1.12 : 0.96);
  return clampRange(scale / Math.max(0.01, defaultEntryScale), 0.72, 1.34);
}


function lyricRowLogicalWorldWidth(mask, baseWorldW) {
  mask = mask || {};
  baseWorldW = Math.max(0.1, Number(baseWorldW) || 6.10);
  var logicalWidth = Math.max(1, Number(mask.logicalWidth) || Number(mask.width) || 2048);
  // 2048 is the visual-size baseline used by the original continuous track.
  // A larger logical canvas prevents clipping; it must widen the plane rather
  // than squeeze the same-size glyphs into the old plane.
  return baseWorldW * clampRange(logicalWidth / 2048, 1, 3);
}


function lyricViewportSafeMarginPx(viewportWidth) {
  return clampRange(Math.max(1, Number(viewportWidth) || 1) * 0.045, 42, 92);
}


function lyricViewportFitRatio(viewportWidth, centerX, projectedUnitTextWidth, intendedScale, marginPx) {
  viewportWidth = Math.max(1, Number(viewportWidth) || 1);
  centerX = Number(centerX);
  projectedUnitTextWidth = Math.max(0, Number(projectedUnitTextWidth) || 0);
  intendedScale = Math.max(0.001, Number(intendedScale) || 1);
  marginPx = clampRange(Number(marginPx) || lyricViewportSafeMarginPx(viewportWidth), 0, viewportWidth * 0.25);
  if (!isFinite(centerX) || projectedUnitTextWidth <= 0.001) return 1;
  var leftSpace = Math.max(0, centerX - marginPx);
  var rightSpace = Math.max(0, viewportWidth - marginPx - centerX);
  // The lyric stays centred on its authored world position, so the shorter
  // side is the real limit. This deliberately does not force every long line
  // to one fixed width: a centred row may use nearly the entire viewport,
  // while an intentionally offset row respects the smaller free side.
  var availableWidth = Math.max(1, Math.min(leftSpace, rightSpace) * 2);
  var intendedWidth = projectedUnitTextWidth * intendedScale;
  if (intendedWidth <= availableWidth) return 1;
  return clampRange(availableWidth / intendedWidth, 0.22, 1);
}


function lyricRowLiveViewportScale(row, intendedScale) {
  if (!row || !row.mesh || !row.lineMask || !lyricViewportFitLeft || !lyricViewportFitRight || typeof camera === 'undefined' || !camera) return 1;
  var windowWidth = typeof window !== 'undefined' ? Number(window.innerWidth) || 0 : 0;
  var documentWidth = !windowWidth && typeof document !== 'undefined' && document.documentElement
    ? Number(document.documentElement.clientWidth) || 0
    : 0;
  var viewportWidth = typeof window !== 'undefined'
    ? Math.max(1, windowWidth || documentWidth || 1)
    : Math.max(1, documentWidth || 1);
  if (viewportWidth <= 1) return 1;
  var currentScale = Math.max(0.001, Math.abs(Number(row.mesh.scale && row.mesh.scale.x) || 1));
  var maskWidth = Math.max(1, Number(row.lineMask.width) || 1);
  var textWidth = Math.max(1, Number(row.lineMask.activeTextWidth) || Number(row.lineMask.textWidth) || maskWidth);
  var localTextWidth = Math.max(0.001, Number(row.lineWorldW) || 0.001) * clampRange(textWidth / maskWidth, 0.02, 1);
  try {
    row.mesh.updateWorldMatrix(true, false);
    lyricViewportFitLeft.set(-localTextWidth * 0.5, 0, 0);
    lyricViewportFitRight.set(localTextWidth * 0.5, 0, 0);
    row.mesh.localToWorld(lyricViewportFitLeft);
    row.mesh.localToWorld(lyricViewportFitRight);
    lyricViewportFitLeft.project(camera);
    lyricViewportFitRight.project(camera);
  } catch (error) {
    return 1;
  }
  if (!isFinite(lyricViewportFitLeft.x) || !isFinite(lyricViewportFitRight.x)) return 1;
  var leftPx = (lyricViewportFitLeft.x + 1) * viewportWidth * 0.5;
  var rightPx = (lyricViewportFitRight.x + 1) * viewportWidth * 0.5;
  var centerX = (leftPx + rightPx) * 0.5;
  var currentProjectedWidth = Math.abs(rightPx - leftPx);
  var projectedUnitTextWidth = currentProjectedWidth / currentScale;
  var safeMargin = lyricViewportSafeMarginPx(viewportWidth);
  var ratio = lyricViewportFitRatio(
    viewportWidth,
    centerX,
    projectedUnitTextWidth,
    intendedScale,
    safeMargin
  );
  row.viewportFitScale = ratio;
  row.viewportFitAvailableLeft = Math.max(0, centerX - safeMargin);
  row.viewportFitAvailableRight = Math.max(0, viewportWidth - safeMargin - centerX);
  return ratio;
}


function makeLyricRowGlowMesh(row, pal, worldW, preparedGlowTexture) {
  if (!row || !row.lineMask) return null;
  pal = pal || {};
  worldW = Math.max(0.1, Number(worldW) || 6.10);
  var lineMask = row.lineMask;
  var lineWorldH = Math.max(0.05, Number(row.lineWorldH) || worldW * ((lineMask.height || 1) / Math.max(1, lineMask.width || 1)));
  var lineTextWorldW = worldW * ((lineMask.activeTextWidth || lineMask.textWidth || lineMask.width) / Math.max(1, lineMask.width || 1));
  lineTextWorldW = clampRange(lineTextWorldW, worldW * 0.10, worldW * 1.00);
  var glowRaster = lyricGlowRasterMetrics(lineMask);
  var rowGlowTex = preparedGlowTexture || makeLyricGlowTexture(row.text || '', glowRaster.fontSize, glowRaster.textWidth, lineMask.lines, glowRaster.lineHeight, lineMask.fitScaleX, lineMask.entries, lineMask.activeLine, null, glowRaster.scale);
  var rowGlowMeta = rowGlowTex.userData || {};
  var rowGlowTextPx = Math.max(1, rowGlowMeta.textWidth || lineMask.activeTextWidth || lineMask.textWidth || lineMask.width || 1);
  var rowGlowTextureRatio = Math.max(1, (rowGlowMeta.width || rowGlowTextPx) / rowGlowTextPx);
  var rowGlowPad = lineWorldH * (row.isTranslation ? 0.42 : 0.62);
  var rowGlowWorldW = clampRange(
    Math.max(
      lineTextWorldW + rowGlowPad,
      lineTextWorldW * Math.max(rowGlowTextureRatio, row.isTranslation ? 1.04 : 1.08)
    ),
    lineTextWorldW + rowGlowPad * 0.62,
    worldW * (row.isTranslation ? 1.00 : 1.08)
  );
  // Preserve the texture's real aspect ratio.  A fixed 0.12 floor makes a
  // very wide lyric glow plane much too tall, so maximum strength turns long
  // lines into a thick scalloped band while short lines remain correct.
  var rowGlowAspect = Math.max(0.001, (rowGlowMeta.height || lineMask.height || 1) / Math.max(1, rowGlowMeta.width || lineMask.width || 1));
  var rowGlowWorldH = clampRange(rowGlowWorldW * rowGlowAspect, lineWorldH * (row.isTranslation ? 0.56 : 0.66), lineWorldH * (row.isTranslation ? 1.12 : 1.36));
  var glowMat = makeLyricBackfaceReadableMaterial({
    map: rowGlowTex,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    color: lyricRowGlowThreeColor(pal, !!row.isTranslation)
  });
  var glowGeo = new THREE.PlaneGeometry(rowGlowWorldW, rowGlowWorldH, 1, 1);
  var glow = new THREE.Mesh(glowGeo, glowMat);
  glow.renderOrder = row.isTranslation ? 42.98 : 42.48;
  glow.position.set(row.baseX || 0, row.baseY || 0, (row.baseZ || 0) - 0.030);
  glow.scale.setScalar(row.baseScale || 1);
  return { glow: glow, glowMat: glowMat };
}

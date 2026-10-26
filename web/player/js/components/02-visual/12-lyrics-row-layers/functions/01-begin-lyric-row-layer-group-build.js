'use strict';



function beginLyricRowLayerGroupBuild(payload, mask, worldW, worldH, pal, motionProfile) {
  payload = normalizeStageLyricPayload(payload);
  var root = new THREE.Group();
  root.renderOrder = 43;
  var contextGroup = new THREE.Group();
  var readabilityGroup = new THREE.Group();
  var rows = [];
  var usesTrack = !!(payload && payload.mode !== 'single' && Array.isArray(payload.trackEntries) && payload.trackEntries.length && payload.trackIndex != null && isFinite(Number(payload.trackIndex)));
  var activeLineIndex = usesTrack ? Number(payload.trackIndex) : (payload ? payload.activeLine : 0);
  var activeLine = usesTrack ? lyricPrimaryVirtualIndex(activeLineIndex) : activeLineIndex;
  var entries = usesTrack ? payload.trackEntries : (payload && payload.entries || []);
  var lineStepWorld = lyricTrackLineStepWorld(mask, worldH);
  var translationLineStepWorld = lyricTranslationLineStepWorld(mask, worldH);
  var displayLineCount = lyricDisplayLineCountForMode(payload && payload.mode);
  var visibleRadius = Math.max(0.85, displayLineCount * 0.50 * lyricPrimarySlotStepValue());
  var textOnly = !!(payload && payload.trackTextOnly);
  var activeMesh = null;
  var activeMat = null;
  var activeWorldH = 0.72;
  var activeTargetLineIndex = activeLineIndex;
  var readabilityPhaseCount = typeof LYRIC_READABILITY_BUILD_PHASES === 'number' ? LYRIC_READABILITY_BUILD_PHASES : 3;
  var glowPhaseCount = typeof LYRIC_GLOW_BUILD_PHASES === 'number' ? LYRIC_GLOW_BUILD_PHASES : 6;
  var totalPhases = 0;
  for (var pi = 0; pi < entries.length; pi++) {
    var phaseEntry = entries[pi] || {};
    var phaseHasGlow = !phaseEntry.translationLine || phaseEntry.parentRole === 'current' || usesTrack;
    totalPhases += textOnly ? 1 : (1 + readabilityPhaseCount + (phaseHasGlow ? glowPhaseCount : 1));
  }
  root.add(contextGroup);
  root.add(readabilityGroup);
  return {
    payload: payload,
    mask: mask,
    worldW: worldW,
    worldH: worldH,
    pal: pal,
    motionProfile: motionProfile,
    root: root,
    contextGroup: contextGroup,
    readabilityGroup: readabilityGroup,
    rows: rows,
    usesTrack: usesTrack,
    activeLineIndex: activeLineIndex,
    activeLine: activeLine,
    entries: entries,
    lineStepWorld: lineStepWorld,
    translationLineStepWorld: translationLineStepWorld,
    visibleRadius: visibleRadius,
    textOnly: textOnly,
    activeMesh: activeMesh,
    activeMat: activeMat,
    activeWorldH: activeWorldH,
    activeTargetLineIndex: activeTargetLineIndex,
    cursor: 0,
    totalPhases: totalPhases,
    completedPhases: 0,
    pendingRow: null,
    pendingPhase: 'line',
    lastPhase: '',
    done: entries.length === 0
  };
}


function beginLyricRowLayerBuildEntry(state) {
  if (!state || state.done) return false;
  var i = state.cursor;
  if (i >= state.entries.length) {
    state.done = true;
    return false;
  }
  var entry = state.entries[i] || {};
  var virtualIndex = lyricLayerVirtualIndex(entry, i, state.activeLine, state.usesTrack);
  var delta = virtualIndex - state.activeLine;
  var entryLineIndex = entry.lineIndex != null && isFinite(Number(entry.lineIndex)) ? Number(entry.lineIndex) : null;
  var isActive = !entry.translationLine && (state.usesTrack ? entryLineIndex === state.activeLineIndex : Math.abs(delta) < 0.001);
  var lineMask = makeLyricLineMask(entry, state.mask, isActive);
  var lineWorldW = lyricRowLogicalWorldWidth(lineMask, state.worldW);
  var lineWorldH = lineWorldW * (lineMask.height / lineMask.width);
  var lineY = -delta * state.lineStepWorld;
  if (entry.translationLine) {
    var translationLayoutEntry = !state.usesTrack
      ? cloneStageLyricEntryForLayer(entry, { virtualIndex: virtualIndex })
      : entry;
    lineY = lyricTranslationAnchoredY(translationLayoutEntry, i, state.activeLine, state.lineStepWorld, state.translationLineStepWorld, state.activeLine, 0, Math.abs(delta) < 0.001, state.usesTrack);
  }
  var lineAbs = Math.min(5.5, Math.abs(delta));
  var lineZ = 0.055 - Math.pow(lineAbs, 1.06) * 0.145;
  var lineScale = clampRange(1 - lineAbs * 0.026, 0.84, 1.02);
  var fontScale = lyricTranslationMeshScale(entry);
  if (entry.translationLine) lineScale *= fontScale;
  var lineGeo = new THREE.PlaneGeometry(lineWorldW, lineWorldH, 1, 1);
  var material;
  if (!entry.translationLine) {
    material = makeLyricShaderMaterial(lineMask, state.pal, state.motionProfile);
    material.uniforms.uOpacity.value = 0;
    if (material.uniforms.uActiveMix) material.uniforms.uActiveMix.value = isActive ? 1 : 0;
  } else {
    material = makeLyricBackfaceReadableMaterial({
      map: lineMask.texture,
      opacity: 0,
      color: entry.translationLine
        ? lyricThreeColor(state.pal.highlight || state.pal.primary, '#eaf6ff', 0.42)
        : lyricThreeColor(state.pal.primary || state.pal.secondary, '#d6f8ff', 0.34)
    });
  }
  var mesh = new THREE.Mesh(lineGeo, material);
  mesh.renderOrder = isActive ? 43.4 : (42.6 - lineAbs * 0.015);
  mesh.position.set(0, lineY, lineZ);
  mesh.scale.setScalar(lineScale);
  mesh.visible = false;
  if (isActive) state.root.add(mesh);
  else state.contextGroup.add(mesh);

  var targetAlpha = entry.alpha == null ? 1 : clampRange(Number(entry.alpha), 0, 1);
  if (isActive) targetAlpha = 1;
  state.pendingRow = {
    mesh: mesh,
    mat: material,
    readability: null,
    readabilityMat: null,
    glow: null,
    glowMat: null,
    readabilityBuild: null,
    glowBuild: null,
    lineMask: lineMask,
    baseLineTexture: lineMask.texture,
    qualityTexture: null,
    qualityPendingTexture: null,
    qualityTier: 1,
    qualityPendingTier: 0,
    qualityRasterKey: '',
    qualityPendingKey: '',
    qualityQueuedKey: '',
    qualityBytes: 0,
    qualityPendingBytes: 0,
    qualityGeneration: 0,
    qualityLastUsedAt: 0,
    qualityHotUntil: 0,
    qualityWanted: false,
    qualityFallbackUntil: 0,
    qualitySelectionFrame: 0,
    qualityProjectedPoolBytes: 0,
    qualityProjectedTier: 0,
    lineWorldW: lineWorldW,
    lineWorldH: lineWorldH,
    text: entry.text || '',
    isActive: isActive,
    isPrimary: !entry.translationLine,
    isTranslation: !!entry.translationLine,
    targetAlpha: targetAlpha,
    baseY: lineY,
    baseZ: lineZ,
    baseScale: lineScale,
    viewportFitScale: 1,
    fontScale: fontScale,
    virtualIndex: virtualIndex,
    lineIndex: entryLineIndex,
    parentIndex: entry.parentIndex != null && isFinite(Number(entry.parentIndex)) ? Number(entry.parentIndex) : undefined,
    parentRole: entry.parentRole || '',
    delta: delta,
    renderWindowActive: false,
    renderRevealAt: 0,
    renderLineUploaded: false,
    renderReadabilityUploaded: false,
    renderGlowUploaded: false
  };
  state.pendingPhase = state.textOnly ? 'complete' : 'readability';
  state.lastPhase = 'row-line';
  state.completedPhases += 1;
  if (state.textOnly) {
    state.rows.push(state.pendingRow);
    if (isActive) {
      state.activeMesh = mesh;
      state.activeMat = material;
      state.activeWorldH = lineWorldH;
      if (entryLineIndex != null) state.activeTargetLineIndex = entryLineIndex;
    }
    state.cursor += 1;
    state.pendingRow = null;
    state.pendingPhase = 'line';
    state.done = state.cursor >= state.entries.length;
  }
  return true;
}


function appendLyricRowReadabilityLayer(state) {
  var row = state && state.pendingRow;
  if (!row || state.pendingPhase !== 'readability') return false;
  if (!row.readabilityBuild) row.readabilityBuild = beginLyricReadabilityTextureBuild(row.lineMask);
  var readabilityDone = stepLyricReadabilityTextureBuild(row.readabilityBuild);
  state.lastPhase = 'row-readability-' + (row.readabilityBuild.lastPhase || 'step');
  state.completedPhases += 1;
  if (!readabilityDone) return true;
  var readabilityTex = finishLyricReadabilityTextureBuild(row.readabilityBuild);
  var readabilityMat = makeLyricBackfaceReadableMaterial({
    map: readabilityTex,
    opacity: 0,
    color: 0xffffff
  });
  var readability = new THREE.Mesh(new THREE.PlaneGeometry(row.lineWorldW || state.worldW, row.lineWorldH, 1, 1), readabilityMat);
  readability.renderOrder = row.mesh.renderOrder - 0.05;
  readability.position.set(0, row.baseY, row.baseZ - 0.012);
  readability.scale.setScalar(row.baseScale);
  readability.visible = false;
  state.readabilityGroup.add(readability);
  row.readability = readability;
  row.readabilityMat = readabilityMat;
  row.readabilityBuild = null;
  state.pendingPhase = 'glow';
  return true;
}


function finishLyricRowLayerBuildEntry(state) {
  var row = state && state.pendingRow;
  if (!row || state.pendingPhase !== 'glow') return false;
  var glow = null;
  var glowMat = null;
  var shouldCreateRowGlow = !row.isTranslation || row.parentRole === 'current' || state.usesTrack;
  if (shouldCreateRowGlow) {
    if (!row.glowBuild) {
      var glowRaster = lyricGlowRasterMetrics(row.lineMask);
      row.glowBuild = beginLyricGlowTextureBuild(row.text || '', glowRaster.fontSize, glowRaster.textWidth, row.lineMask.lines, glowRaster.lineHeight, row.lineMask.fitScaleX, row.lineMask.entries, row.lineMask.activeLine, null, glowRaster.scale);
    }
    var glowDone = stepLyricGlowTextureBuild(row.glowBuild);
    state.lastPhase = 'row-glow-' + (row.glowBuild.lastPhase || 'step');
    state.completedPhases += 1;
    if (!glowDone) return true;
    var preparedGlowTexture = finishLyricGlowTextureBuild(row.glowBuild);
    var rowGlow = makeLyricRowGlowMesh({
      text: row.text,
      lineMask: row.lineMask,
      lineWorldH: row.lineWorldH,
      isTranslation: row.isTranslation,
      baseY: row.baseY,
      baseZ: row.baseZ,
      baseScale: row.baseScale
    }, state.pal, row.lineWorldW || state.worldW, preparedGlowTexture);
    if (rowGlow) {
      glow = rowGlow.glow;
      glowMat = rowGlow.glowMat;
      glow.visible = false;
      state.readabilityGroup.add(glow);
    }
    row.glowBuild = null;
  } else {
    state.lastPhase = 'row-glow-skip';
    state.completedPhases += 1;
  }
  row.glow = glow;
  row.glowMat = glowMat;
  state.rows.push(row);
  if (row.isActive) {
    state.activeMesh = row.mesh;
    state.activeMat = row.mat;
    state.activeWorldH = row.lineWorldH;
    if (row.lineIndex != null) state.activeTargetLineIndex = row.lineIndex;
  }
  state.cursor += 1;
  state.pendingRow = null;
  state.pendingPhase = 'line';
  state.done = state.cursor >= state.entries.length;
  return true;
}


function appendLyricRowLayerBuildPhase(state) {
  if (!state || state.done) return false;
  if (!state.pendingRow) return beginLyricRowLayerBuildEntry(state);
  if (state.pendingPhase === 'readability') return appendLyricRowReadabilityLayer(state);
  return finishLyricRowLayerBuildEntry(state);
}


function appendLyricRowLayerBuildEntry(state) {
  if (!state || state.done) return false;
  var startCursor = state.cursor;
  while (!state.done && state.cursor === startCursor) appendLyricRowLayerBuildPhase(state);
  return state.cursor > startCursor;
}


function stepLyricRowLayerGroupBuild(state, maxPhases, budgetMs) {
  if (!state || state.done) return true;
  var limit = Math.max(1, Number(maxPhases) || 1);
  var budget = Number(budgetMs);
  if (!isFinite(budget) || budget <= 0) budget = Infinity;
  var startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  var completed = 0;
  while (!state.done && completed < limit) {
    appendLyricRowLayerBuildPhase(state);
    completed += 1;
    if (completed > 0 && budget !== Infinity) {
      var now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      if (now - startedAt >= budget) break;
    }
  }
  return !!state.done;
}


function finishLyricRowLayerGroupBuild(state) {
  if (!state) return null;
  return {
    group: state.root,
    contextGroup: state.contextGroup,
    readabilityGroup: state.readabilityGroup,
    rows: state.rows,
    activeMesh: state.activeMesh,
    activeMat: state.activeMat,
    activeWorldH: state.activeWorldH,
    usesTrack: state.usesTrack,
    displayMode: state.payload && state.payload.mode,
    trackKey: state.payload && state.payload.trackKey || '',
    trackStart: state.payload && state.payload.trackStart,
    trackEnd: state.payload && state.payload.trackEnd,
    trackLightweight: !!(state.payload && state.payload.trackLightweight),
    trackTextOnly: !!(state.payload && state.payload.trackTextOnly),
    trackTargetIndex: state.activeLine,
    trackTargetLineIndex: state.activeTargetLineIndex,
    trackTargetVirtualIndex: state.activeLine,
    trackVisibleRadius: state.visibleRadius,
    lineStepWorld: state.lineStepWorld,
    translationLineStepWorld: state.translationLineStepWorld
  };
}


function releaseLyricRowLayerBuildCanvas(build) {
  if (!build) return;
  if (build.texture && build.texture.dispose) build.texture.dispose();
  build.texture = null;
  if (build.canvas) {
    build.canvas.width = 1;
    build.canvas.height = 1;
  }
  build.ctx = null;
  build.canvas = null;
  build.sourceMask = null;
  build.mask = null;
  build.entries = null;
  build.lines = null;
  build.drawLines = null;
}


function cancelLyricRowLayerGroupBuild(state) {
  if (!state) return;
  var pendingRow = state.pendingRow;
  if (pendingRow) {
    releaseLyricRowLayerBuildCanvas(pendingRow.readabilityBuild);
    releaseLyricRowLayerBuildCanvas(pendingRow.glowBuild);
    pendingRow.readabilityBuild = null;
    pendingRow.glowBuild = null;
  }
  if (state.root) disposeLyricMesh(state.root);
  state.pendingRow = null;
  state.entries = null;
  state.rows = null;
  state.root = null;
  state.contextGroup = null;
  state.readabilityGroup = null;
  state.done = true;
}


function makeLyricRowLayerGroup(payload, mask, worldW, worldH, pal, motionProfile) {
  var state = beginLyricRowLayerGroupBuild(payload, mask, worldW, worldH, pal, motionProfile);
  while (!stepLyricRowLayerGroupBuild(state, 1024, Infinity)) { /* synchronous compatibility path */ }
  return finishLyricRowLayerGroupBuild(state);
}


function lyricQualityNowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
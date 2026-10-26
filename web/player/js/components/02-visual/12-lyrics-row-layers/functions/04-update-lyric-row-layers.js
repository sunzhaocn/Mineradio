'use strict';



function updateLyricRowLayers(data, opts) {
  if (!data || !data.rowLayers || !data.rowLayers.length) return;
  opts = opts || {};
  var opacity = clampRange(Number(opts.opacity) || 0, 0, 1);
  var readability = clampRange(Number(opts.readability) || 0.58, 0, 1);
  var contextIntro = opts.contextIntro == null ? 1 : clampRange(Number(opts.contextIntro) || 0, 0, 1);
  var shownProgress = clampRange(Number(opts.shownProgress) || 0, 0, 1);
  var contextDrift = Number(opts.contextDrift) || 0;
  var style = opts.style || 'glass';
  var t = Number(opts.time) || 0;
  var seed = Number(opts.seed) || 0;
  var renderBase = opts.renderBase == null ? 43 : Number(opts.renderBase);
  if (!isFinite(renderBase)) renderBase = 43;
  if (data.rowLayerGroup) data.rowLayerGroup.renderOrder = renderBase;
  if (data.contextGroup) data.contextGroup.renderOrder = renderBase;
  if (data.readabilityGroup) data.readabilityGroup.renderOrder = renderBase;
  var translationMode = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode);
  var displayMode = normalizeLyricDisplayMode(data.displayMode || (fx && fx.lyricDisplayMode));
  var singleLineStaticSwap = displayMode === 'single' && !data.usesTrack;
  var currentTranslationOpacity = lyricTranslationOpacityValue();
  var previewMotionLock = opts.previewMotionLock === true;
  var motionBlend = previewMotionLock ? 0 : clampRange(opts.motionBlend == null ? 1 : Number(opts.motionBlend) || 0, 0, 1);
  var jitterX = (Number(opts.jitterX) || 0) * motionBlend;
  var jitterY = (Number(opts.jitterY) || 0) * motionBlend;
  var verticalFloatOn = !previewMotionLock && motionBlend > 0.001 && (typeof lyricVerticalFloatEnabled === 'function' ? lyricVerticalFloatEnabled() : true);
  var baseEase = opts.ease == null ? 0.16 : clampRange(Number(opts.ease) || 0.16, 0.04, 1);
  var frameDelta = Number(opts.deltaTime);
  var frameScale = isFinite(frameDelta) && frameDelta > 0 ? clampRange(frameDelta * 60, 0.25, 3) : 1;
  // Preserve the 60 Hz feel while keeping the same motion duration when a
  // low-spec machine briefly renders at 30/45 Hz.
  var ease = 1 - Math.pow(1 - baseEase, frameScale);
  var pendingPayload = data.trackPersistent && data.trackPendingPayload ? data.trackPendingPayload : null;
  var pendingTargetLineIndex = pendingPayload && pendingPayload.trackIndex != null && isFinite(Number(pendingPayload.trackIndex))
    ? Number(pendingPayload.trackIndex)
    : null;
  // Loading may postpone the material/progress commit, but it must not
  // postpone the motion target.  Feeding every preview target into the same
  // track is what preserves the private build's continuous two-stage scroll.
  var targetLineIndex = pendingTargetLineIndex != null
    ? pendingTargetLineIndex
    : (opts.targetLineIndex != null && isFinite(Number(opts.targetLineIndex))
      ? Number(opts.targetLineIndex)
      : (isFinite(Number(data.trackTargetLineIndex)) ? Number(data.trackTargetLineIndex) : 0));
  var targetIndex = pendingTargetLineIndex != null
    ? lyricPrimaryVirtualIndex(targetLineIndex)
    : (opts.targetVirtualIndex != null && isFinite(Number(opts.targetVirtualIndex))
      ? Number(opts.targetVirtualIndex)
      : (isFinite(Number(data.trackTargetVirtualIndex)) ? Number(data.trackTargetVirtualIndex) : lyricPrimaryVirtualIndex(targetLineIndex)));
  var baseTrackEase = opts.trackEase == null ? clampRange(baseEase * 1.16, 0.08, 0.34) : clampRange(Number(opts.trackEase) || 0.18, 0.04, 0.60);
  var trackEase = 1 - Math.pow(1 - baseTrackEase, frameScale);
  var nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  var trackTargetJustCommitted = !!(data.trackPersistent && isFinite(Number(data.trackTargetCommittedAt)) && nowMs - Number(data.trackTargetCommittedAt) <= 34);
  var initialTextRevealPending = !!(data.usesTrack && data.renderInitialTextReady !== true);
  var textureEffectsAllowed = !initialTextRevealPending;
  var persistentTrackTransparentPrewarm = !!(data.usesTrack && data.trackPersistent && !initialTextRevealPending);
  var visibleRadiusForSnap = Math.max(1.2, Number(data.trackVisibleRadius) || 3);
  var currentScrollOffset = Number(data.trackScrollOffset);
  // Progress preview only suppresses decorative drift.  It must never turn
  // the shared lyric track into an integer, per-line snap.  Once the track is
  // primed, keep the same two-stage easing used by normal playback even when
  // the pointer moves a long distance.
  var persistentPrimedTrack = !!(data.trackPersistent && data.trackScrollPrimed);
  var continuousTrackSlotStep = 1;
  if (data.usesTrack && persistentPrimedTrack) {
    var trackLineCount = typeof lyricsLines !== 'undefined' && lyricsLines ? lyricsLines.length : 0;
    var neighborLineIndex = targetLineIndex < Math.max(0, trackLineCount - 1)
      ? targetLineIndex + 1
      : Math.max(0, targetLineIndex - 1);
    continuousTrackSlotStep = Math.abs(lyricPrimaryVirtualIndex(neighborLineIndex) - lyricPrimaryVirtualIndex(targetLineIndex));
    if (!isFinite(continuousTrackSlotStep) || continuousTrackSlotStep < 0.25) continuousTrackSlotStep = 1;
  }
  var needsScrollSnap = !isFinite(currentScrollOffset) || (!persistentPrimedTrack && !previewMotionLock && (
    (isFinite(Number(data.trackScrollSnapUntil)) && nowMs <= Number(data.trackScrollSnapUntil)) ||
    Math.abs(targetIndex - currentScrollOffset) > Math.max(3.2, visibleRadiusForSnap * 1.85)
  ));
  if (needsScrollSnap) {
    data.trackScrollOffset = targetIndex;
    data.trackScrollPrimed = true;
  } else {
    var trackStep = (targetIndex - data.trackScrollOffset) * trackEase;
    if (data.usesTrack && persistentPrimedTrack) {
      // Bound the shared phase, not individual meshes: no rendered frame may
      // skip across a complete primary lyric row, while normal adjacent-line
      // easing keeps exactly the same timing as before.
      var continuousTrackMaxRowsPerFrame = 0.68;
      var continuousTrackMaxStep = continuousTrackSlotStep * continuousTrackMaxRowsPerFrame;
      trackStep = clampRange(trackStep, -continuousTrackMaxStep, continuousTrackMaxStep);
    }
    data.trackScrollOffset += trackStep;
  }
  var scrollOffset = data.trackScrollOffset;
  var lineStepWorld = clampRange(Number(data.lineWorldStep) || 0.38, 0.20, 0.94);
  var translationLineStepWorld = clampRange(Number(data.translationLineStepWorld) || lineStepWorld, 0.20, 0.78);
  var displayedTrackOffset = typeof stageLyricResidentDisplayedScrollOffset === 'function'
    ? stageLyricResidentDisplayedScrollOffset(data, scrollOffset)
    : scrollOffset;
  var previewTrackCorridor = !!(
    previewMotionLock && data.usesTrack && data.trackPersistent &&
    isFinite(Number(displayedTrackOffset)) && Math.abs(targetIndex - Number(displayedTrackOffset)) > 0.20
  );
  var presentationLineIndex = previewTrackCorridor
    ? lyricNearestPrimaryLineIndexForVirtual(displayedTrackOffset, targetLineIndex)
    : targetLineIndex;
  var presentationIndex = previewTrackCorridor ? lyricPrimaryVirtualIndex(presentationLineIndex) : targetIndex;
  var visibilityScrollOffset = previewTrackCorridor ? Number(displayedTrackOffset) : scrollOffset;
  data.trackPreviewCorridorActive = previewTrackCorridor;
  data.trackPresentationLineIndex = presentationLineIndex;
  var rowDrift = previewMotionLock ? 0 : (0.5 - shownProgress) * contextDrift * motionBlend;
  var rowGlow = clampRange(Number(opts.rowGlow) || 0, 0, 1);
  var rowGlowBeat = clampRange(Number(opts.rowGlowBeat) || 0, 0, 1.5);
  var backdropAdapt = lyricBackdropAdaptActive() ? lyricBackgroundAdaptStrengthValue() : 0;
  var readabilityBackdropColor = backdropAdapt > 0.001 ? lyricReadabilityColorForBrightBackdrop(backdropAdapt) : null;
  var activeRow = null;
  var renderRevealCandidates = [];
  var lyricQualityTier = lyricTextureClarityScale();
  var contextHighQualityEnabled = !fx || fx.lyricContextHighQuality !== false;
  var qualityBuildDeferred = typeof isProgressDragPreviewActive === 'function' && isProgressDragPreviewActive();
  var lyricQualityCandidates = [];
  var revealOffsets = lyricDisplayOffsetsForMode(displayMode);
  var revealPrewarmMinOffset = 0;
  var revealPrewarmMaxOffset = 0;
  for (var offsetIndex = 0; offsetIndex < revealOffsets.length; offsetIndex++) {
    var revealOffset = Math.round(Number(revealOffsets[offsetIndex]) || 0);
    revealPrewarmMinOffset = Math.min(revealPrewarmMinOffset, revealOffset);
    revealPrewarmMaxOffset = Math.max(revealPrewarmMaxOffset, revealOffset);
  }
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    var liveDelta = (row.virtualIndex != null && isFinite(Number(row.virtualIndex)) ? Number(row.virtualIndex) : i) - scrollOffset;
    var targetDelta = (row.virtualIndex != null && isFinite(Number(row.virtualIndex)) ? Number(row.virtualIndex) : i) - presentationIndex;
    var abs = Math.abs(liveDelta);
    var targetAbs = Math.abs(targetDelta);
    var visibilityAbs = Math.abs((row.virtualIndex != null && isFinite(Number(row.virtualIndex)) ? Number(row.virtualIndex) : i) - visibilityScrollOffset);
    var rowLineIndex = row.lineIndex != null && isFinite(Number(row.lineIndex)) ? Number(row.lineIndex) : null;
    var isActive = !!row.isPrimary && (rowLineIndex != null ? rowLineIndex === presentationLineIndex : targetAbs < 0.015);
    row.delta = liveDelta;
    row.isActive = isActive;
    if (isActive) activeRow = row;
    var translationFocus = 0;
    var contextAlpha = row.isTranslation
      ? clampRange(row.targetAlpha * (1 - Math.max(0, targetAbs - 0.65) * 0.12), 0.08, 0.62)
      : clampRange(row.targetAlpha * (1 - Math.max(0, targetAbs - 0.25) * 0.070), 0.16, 0.92);
    var parentIndex = null;
    var parentDistance = Infinity;
    var currentTranslation = false;
    var singleLineTranslationSwap = false;
    var rowWindowLineIndex = rowLineIndex;
    if (row.isTranslation) {
      parentIndex = row.parentIndex != null && isFinite(Number(row.parentIndex))
        ? Number(row.parentIndex)
        : (row.virtualIndex != null ? Number(row.virtualIndex) - lyricTranslationVisualGapValue() : presentationLineIndex);
      rowWindowLineIndex = parentIndex;
      parentDistance = Math.abs(parentIndex - presentationLineIndex);
      currentTranslation = parentDistance < 0.001;
      var parentFade = clampRange((0.82 - parentDistance) / 0.34, 0, 1);
      parentFade = parentFade * parentFade * (3 - 2 * parentFade);
      if (translationMode === 'dual') {
        var currentParent = Math.abs(parentIndex - presentationLineIndex) < 0.001;
        var nextParent = Math.abs(parentIndex - (presentationLineIndex + 1)) < 0.001;
        parentFade = currentParent ? 1 : (nextParent ? 0.56 : 0);
      }
      if (translationMode !== 'multi') {
        translationFocus = parentFade;
        contextAlpha = clampRange(currentTranslationOpacity * parentFade, 0, currentTranslationOpacity);
      } else {
        translationFocus = parentFade;
        var contextTranslationAlpha = clampRange(row.targetAlpha * (1 - Math.max(0, parentDistance - 0.35) * 0.16), 0.08, 0.58);
        contextAlpha = clampRange(
          contextTranslationAlpha * (1 - parentFade) + currentTranslationOpacity * parentFade,
          0.08,
          Math.max(0.58, currentTranslationOpacity)
        );
      }
      if (data.usesTrack && parentIndex != null && isFinite(Number(parentIndex))) {
        var parentVirtualForVisibility = lyricPrimaryVirtualIndex(parentIndex);
        visibilityAbs = Math.abs(parentVirtualForVisibility - visibilityScrollOffset);
      } else if (currentTranslation || row.parentRole === 'current') {
        visibilityAbs = 0;
      }
      singleLineTranslationSwap = singleLineStaticSwap && (currentTranslation || row.parentRole === 'current');
    }
    var lineWindowAllowed = lyricLineAllowedForDisplayMode(rowWindowLineIndex, presentationLineIndex, displayMode);
    var rowLineOffset = rowWindowLineIndex != null && isFinite(Number(rowWindowLineIndex))
      ? Math.round(Number(rowWindowLineIndex) - presentationLineIndex)
      : 0;
    var lineUploadPrewarm = !!(
      data.usesTrack && !initialTextRevealPending && !lineWindowAllowed &&
      rowWindowLineIndex != null && isFinite(Number(rowWindowLineIndex)) &&
      rowLineOffset >= revealPrewarmMinOffset - 1 && rowLineOffset <= revealPrewarmMaxOffset + 1
    );
    var pendingWindowAllowed = pendingTargetLineIndex != null && lyricLineAllowedForDisplayMode(rowWindowLineIndex, pendingTargetLineIndex, displayMode);
    if (!lineWindowAllowed) {
      contextAlpha = 0;
      translationFocus = 0;
    }
    var motionAnchor = isActive || currentTranslation;
    var rowIntro = motionAnchor ? 1 : contextIntro;
    var visibleRadius = Math.max(0.85, Number(data.trackVisibleRadius) || 3);
    var visibleFade = lineWindowAllowed ? (motionAnchor ? 1 : clampRange((visibleRadius + 1.10 - visibilityAbs) / 1.10, 0, 1)) : 0;
    visibleFade = visibleFade * visibleFade * (3 - 2 * visibleFade);
    var renderWindowActive = !!(lineWindowAllowed && (motionAnchor || visibleFade > 0.002));
    if (renderWindowActive && !row.renderWindowActive) {
      var revealLane = Math.min(5, Math.max(0, Math.round(visibilityAbs)));
      row.renderWindowActive = true;
      row.renderRevealAt = nowMs + (motionAnchor || row.renderLineUploaded ? 0 : 10 + revealLane * 14) + (row.renderLineUploaded ? 0 : (row.isTranslation ? 8 : 0));
    } else if (!renderWindowActive && row.renderWindowActive) {
      row.renderWindowActive = false;
      row.renderRevealAt = 0;
    }
    var rowHighQualityAllowed = contextHighQualityEnabled || isActive || currentTranslation;
    if (lyricQualityTier <= 1 || !rowHighQualityAllowed) {
      if (row.qualityTexture || row.qualityPendingTexture || row.qualityQueuedKey) releaseLyricRowQuality(row, true);
    } else if (!initialTextRevealPending && (renderWindowActive || lineUploadPrewarm || pendingWindowAllowed)) {
      var qualityPriority = isActive ? 10 : (currentTranslation ? 11 : (row.isTranslation ? 22 : (lineUploadPrewarm ? 34 : 24 + Math.min(8, visibilityAbs))));
      lyricQualityCandidates.push({
        row: row,
        priority: qualityPriority,
        hotMs: renderWindowActive ? 1100 : 620
      });
    }
    var rowRevealAt = Number(row.renderRevealAt) || nowMs;
    var lineLayerVisible = renderWindowActive && (initialTextRevealPending || nowMs >= rowRevealAt);
    var readabilityLayerVisible = textureEffectsAllowed && lineLayerVisible && readability > 0.001 && nowMs >= rowRevealAt + 18;
    var existingGlowOpacity = row.glowMat ? getLyricTextureMaterialOpacity(row.glowMat) : 0;
    var glowLayerWanted = rowGlow > 0.001 || rowGlowBeat > 0.001 || existingGlowOpacity > 0.004;
    var glowLayerVisible = textureEffectsAllowed && lineLayerVisible && glowLayerWanted && nowMs >= rowRevealAt + 40;
    var anchorRevealPriority = isActive ? 0 : (currentTranslation ? 1 : null);
    var contextRevealPriority = 20 + Math.min(8, visibilityAbs) * 6 + (row.isTranslation ? 1 : 0);
    if (row.mesh) {
      row.mesh.visible = lineLayerVisible && !!row.renderLineUploaded;
      if ((lineLayerVisible || lineUploadPrewarm) && !row.renderLineUploaded) {
        var lineRevealPriority = lineUploadPrewarm
          ? 80 + Math.abs(rowLineOffset) + (row.isTranslation ? 1 : 0)
          : (anchorRevealPriority == null ? contextRevealPriority : anchorRevealPriority);
        renderRevealCandidates.push({ row: row, mesh: row.mesh, flag: 'renderLineUploaded', priority: lineRevealPriority });
      }
      if (row.renderLineUploaded && renderWindowActive && (row.qualityPendingTexture || (row.qualityTexture && lyricQualityCurrentMap(row) !== row.qualityTexture))) {
        renderRevealCandidates.push({ row: row, quality: true, priority: 50 + (isActive ? 0 : (currentTranslation ? 1 : Math.min(8, visibilityAbs))) });
      }
    }
    if (row.readability) {
      row.readability.visible = readabilityLayerVisible && !!row.renderReadabilityUploaded;
      if (readabilityLayerVisible && !row.renderReadabilityUploaded) {
        renderRevealCandidates.push({ row: row, mesh: row.readability, flag: 'renderReadabilityUploaded', priority: 100 + (anchorRevealPriority == null ? contextRevealPriority : anchorRevealPriority) });
      }
    }
    if (row.glow) {
      row.glow.visible = glowLayerVisible && !!row.renderGlowUploaded;
      if (glowLayerVisible && !row.renderGlowUploaded) {
        renderRevealCandidates.push({ row: row, mesh: row.glow, flag: 'renderGlowUploaded', priority: 200 + (anchorRevealPriority == null ? contextRevealPriority : anchorRevealPriority) });
      }
    }
    if (pendingWindowAllowed) {
      var pendingDistance = Math.abs(Number(rowWindowLineIndex) - pendingTargetLineIndex);
      var pendingPriority = pendingDistance * 4 + (row.isTranslation ? 1 : 0);
      if (row.mesh && !row.renderLineUploaded) {
        renderRevealCandidates.push({ row: row, mesh: row.mesh, flag: 'renderLineUploaded', priority: 4 + pendingPriority, transparentPrewarm: true });
      } else if (row.readability && !row.renderReadabilityUploaded) {
        renderRevealCandidates.push({ row: row, mesh: row.readability, flag: 'renderReadabilityUploaded', priority: 104 + pendingPriority, transparentPrewarm: true });
      } else if (row.glow && !row.renderGlowUploaded) {
        renderRevealCandidates.push({ row: row, mesh: row.glow, flag: 'renderGlowUploaded', priority: 204 + pendingPriority, transparentPrewarm: true });
      }
    }
    if (persistentTrackTransparentPrewarm) {
      var trackPrewarmOrder = Math.max(0, rowLineIndex == null ? i : Math.round(rowLineIndex)) * 2 + (row.isTranslation ? 1 : 0);
      if (row.mesh && !row.renderLineUploaded) {
        renderRevealCandidates.push({ row: row, mesh: row.mesh, flag: 'renderLineUploaded', priority: 300 + trackPrewarmOrder * 0.01, transparentPrewarm: true });
      } else if (row.readability && !row.renderReadabilityUploaded) {
        renderRevealCandidates.push({ row: row, mesh: row.readability, flag: 'renderReadabilityUploaded', priority: 400 + trackPrewarmOrder * 0.01, transparentPrewarm: true });
      } else if (row.glow && !row.renderGlowUploaded) {
        renderRevealCandidates.push({ row: row, mesh: row.glow, flag: 'renderGlowUploaded', priority: 500 + trackPrewarmOrder * 0.01, transparentPrewarm: true });
      }
    }
    var target = opacity * (isActive ? 1 : contextAlpha) * rowIntro * visibleFade;
    var depthFade = motionAnchor ? 1 : clampRange(1 - visibilityAbs * 0.055, 0.54, 1) * visibleFade;
    var yTarget = -liveDelta * lineStepWorld + (motionAnchor ? 0 : rowDrift * clampRange(0.70 + abs * 0.10, 0.65, 1.20));
    if (row.isTranslation) {
      yTarget = singleLineTranslationSwap && isFinite(Number(row.baseY))
        ? Number(row.baseY)
        : lyricTranslationAnchoredY(row, i, presentationIndex, lineStepWorld, translationLineStepWorld, scrollOffset, rowDrift, currentTranslation, !!data.usesTrack);
    }
    var zBase = 0.055 - Math.pow(Math.min(5.5, visibilityAbs), 1.06) * 0.145;
    var zTarget = zBase - (motionAnchor ? 0 : Math.abs(rowDrift) * 0.18) + (row.isTranslation ? translationFocus * 0.065 : 0);
    // Keep the focused lyric at its authored size even while the scroll
    // offset is still easing toward the newly committed line.
    var scaleDistance = motionAnchor ? 0 : visibilityAbs;
    var baseScale = clampRange(1 - Math.min(5.5, scaleDistance) * 0.026, 0.84, 1.02);
    if (row.isTranslation) baseScale *= clampRange(Number(row.fontScale) || 1, 0.72, 1.34);
    if (singleLineTranslationSwap) {
      if (isFinite(Number(row.baseZ))) zTarget = Number(row.baseZ);
      if (isFinite(Number(row.baseScale))) baseScale = Number(row.baseScale);
    } else {
      if (row.isTranslation) baseScale *= 1.00 + translationFocus * 0.16;
    }
    if ((row.isPrimary || row.isTranslation) && renderWindowActive && (!fx || fx.lyricLiveViewportFit !== false)) {
      baseScale *= lyricRowLiveViewportScale(row, baseScale);
    } else if (row.viewportFitScale !== 1) {
      row.viewportFitScale = 1;
    }
    var stableMotionIndex = row.virtualIndex != null && isFinite(Number(row.virtualIndex))
      ? Number(row.virtualIndex)
      : (rowLineIndex != null ? rowLineIndex : i);
    var scaleTarget = baseScale * (motionAnchor || !verticalFloatOn ? 1 : (1 + Math.sin(t * 0.68 + seed + stableMotionIndex * 0.71) * (style === 'float' ? 0.012 : 0.004) * motionBlend));
    var translationGlowFocus = row.isTranslation ? translationFocus : 0;
    if (row.mesh) {
      row.mesh.position.x += ((isActive ? jitterX : (currentTranslation ? jitterX * 0.82 : jitterX * 0.28)) - row.mesh.position.x) * (opts.glitchPulse ? 0.48 : 0.13);
      var rowYTarget = yTarget + (verticalFloatOn ? (isActive ? jitterY : (currentTranslation ? jitterY * 0.78 : jitterY * 0.24)) : 0);
      var rowYStep = (rowYTarget - row.mesh.position.y) * ease;
      if (data.usesTrack && persistentPrimedTrack) {
        var continuousRowMaxRowsPerFrame = 0.66;
        var continuousRowMaxStepWorld = continuousTrackSlotStep * lineStepWorld * continuousRowMaxRowsPerFrame;
        rowYStep = clampRange(rowYStep, -continuousRowMaxStepWorld, continuousRowMaxStepWorld);
      }
      row.mesh.position.y += rowYStep;
      row.mesh.position.z += (zTarget - row.mesh.position.z) * ease;
      row.mesh.scale.setScalar(row.mesh.scale.x + (scaleTarget - row.mesh.scale.x) * ease);
      row.mesh.renderOrder = isActive ? (renderBase + 0.40) : (row.isTranslation ? (renderBase + 0.05 + (currentTranslation ? 0.34 : translationFocus * 0.30)) : (renderBase - 0.40 - Math.min(5.5, abs) * 0.015));
    }
    if (row.mat && row.mat.uniforms) {
      if (row.mat.uniforms.uOpacity) {
        var lineOpacityTarget = data.usesTrack && (initialTextRevealPending || !lineLayerVisible || !row.renderLineUploaded) ? 0 : target * depthFade;
        if (initialTextRevealPending) row.mat.uniforms.uOpacity.value = 0;
        else {
          row.mat.uniforms.uOpacity.value += (lineOpacityTarget - row.mat.uniforms.uOpacity.value) * ease;
          if (trackTargetJustCommitted && lineOpacityTarget > 0.001 && row.renderLineUploaded && row.mat.uniforms.uOpacity.value < 0.004) {
            row.mat.uniforms.uOpacity.value = Math.min(lineOpacityTarget, 0.004);
          }
        }
      }
      if (row.mat.uniforms.uProgress) row.mat.uniforms.uProgress.value = isActive ? shownProgress : 0;
      if (row.mat.uniforms.uActiveMix) {
        var activeMixTarget = isActive ? 1 : 0;
        row.mat.uniforms.uActiveMix.value += (activeMixTarget - row.mat.uniforms.uActiveMix.value) * (isActive ? 0.34 : 0.62);
        if (!isActive && row.mat.uniforms.uActiveMix.value < 0.015) row.mat.uniforms.uActiveMix.value = 0;
      }
      if (row.mat.uniforms.uSolar && !isActive) {
        row.mat.uniforms.uSolar.value += (0 - row.mat.uniforms.uSolar.value) * 0.48;
        if (row.mat.uniforms.uSolar.value < 0.003) row.mat.uniforms.uSolar.value = 0;
      }
      if (row.mat.uniforms.uGlitchBurst && opts.glitchPulse) row.mat.uniforms.uGlitchBurst.value = isActive ? opts.glitchPulse : opts.glitchPulse * 0.35;
    } else if (row.mat) {
      var fallbackLineOpacityTarget = data.usesTrack && (initialTextRevealPending || !lineLayerVisible || !row.renderLineUploaded) ? 0 : target * depthFade;
      if (initialTextRevealPending) row.mat.opacity = 0;
      else {
        row.mat.opacity += (fallbackLineOpacityTarget - row.mat.opacity) * ease;
        if (trackTargetJustCommitted && fallbackLineOpacityTarget > 0.001 && row.renderLineUploaded && row.mat.opacity < 0.004) {
          row.mat.opacity = Math.min(fallbackLineOpacityTarget, 0.004);
        }
      }
    }
    if (row.readability) {
      row.readability.position.x += ((isActive ? jitterX * 0.46 : (currentTranslation ? jitterX * 0.40 : jitterX * 0.16)) - row.readability.position.x) * (opts.glitchPulse ? 0.42 : 0.12);
      if (data.usesTrack && persistentPrimedTrack && row.mesh) row.readability.position.y = row.mesh.position.y;
      else row.readability.position.y += (yTarget + (verticalFloatOn ? (isActive ? jitterY * 0.40 : (currentTranslation ? jitterY * 0.34 : jitterY * 0.12)) : 0) - row.readability.position.y) * ease;
      row.readability.position.z += (zTarget - 0.012 - row.readability.position.z) * ease;
      row.readability.scale.setScalar(row.readability.scale.x + (scaleTarget - row.readability.scale.x) * ease);
      row.readability.renderOrder = row.mesh ? row.mesh.renderOrder - 0.04 : (row.isTranslation ? renderBase : renderBase - 0.45);
    }
    if (row.readabilityMat) {
      var readabilityMix = row.isTranslation ? (0.46 + translationFocus * 0.18) : (isActive ? 0.74 : 0.52);
      if (backdropAdapt > 0.001) {
        readabilityMix = Math.max(readabilityMix, row.isTranslation
          ? (0.54 + backdropAdapt * 0.10)
          : (0.60 + backdropAdapt * 0.12));
      }
      if (readabilityBackdropColor) setLyricTextureMaterialColor(row.readabilityMat, readabilityBackdropColor);
      else if (lyricReadabilityLightColor) setLyricTextureMaterialColor(row.readabilityMat, lyricReadabilityLightColor);
      var readabilityBoost = 1 + backdropAdapt * (row.isTranslation ? 0.66 : 0.78);
      var readabilityOpacity = getLyricTextureMaterialOpacity(row.readabilityMat);
      var readabilityOpacityTarget = !data.usesTrack || (readabilityLayerVisible && row.renderReadabilityUploaded)
        ? target * readability * readabilityMix * readabilityBoost * depthFade
        : 0;
      setLyricTextureMaterialOpacity(row.readabilityMat, initialTextRevealPending ? 0 : readabilityOpacity + (readabilityOpacityTarget - readabilityOpacity) * ease);
    }
    if (row.glow) {
      var glowJitterX = isActive ? jitterX : (currentTranslation ? jitterX * 0.72 : (translationGlowFocus > 0.001 ? jitterX * 0.34 * translationGlowFocus : 0));
      var glowJitterY = verticalFloatOn ? (isActive ? jitterY * 0.92 : (currentTranslation ? jitterY * 0.64 : (translationGlowFocus > 0.001 ? jitterY * 0.30 * translationGlowFocus : 0))) : 0;
      var glowEase = motionAnchor ? Math.max(ease, 0.46) : Math.max(ease, 0.22);
      var glowTargetX = row.mesh ? row.mesh.position.x : glowJitterX;
      var glowTargetY = row.mesh ? row.mesh.position.y : (yTarget + glowJitterY);
      var glowTargetZ = row.mesh ? (row.mesh.position.z - 0.030) : (zTarget - 0.030);
      var glowTargetScale = row.mesh ? row.mesh.scale.x : scaleTarget;
      var glowLockedToText = !!row.mesh && (isActive || currentTranslation || translationGlowFocus > 0.001);
      if ((data.usesTrack && persistentPrimedTrack) || previewMotionLock || glowLockedToText) {
        row.glow.position.set(glowTargetX, glowTargetY, glowTargetZ);
        row.glow.scale.setScalar(glowTargetScale);
      } else {
        row.glow.position.x += (glowTargetX - row.glow.position.x) * (opts.glitchPulse ? 0.52 : Math.max(glowEase, 0.26));
        row.glow.position.y += (glowTargetY - row.glow.position.y) * glowEase;
        row.glow.position.z += (glowTargetZ - row.glow.position.z) * glowEase;
        row.glow.scale.setScalar(row.glow.scale.x + (glowTargetScale - row.glow.scale.x) * glowEase);
      }
      row.glow.renderOrder = row.isTranslation ? (renderBase - 0.02) : (renderBase - 0.52);
    }
    if (row.glowMat) {
      var glowOpacityTarget = isActive
        ? target * rowGlow * (1 + rowGlowBeat * 0.46) * depthFade
        : (row.isTranslation ? target * rowGlow * (currentTranslation ? (0.46 + rowGlowBeat * 0.08) : (0.30 + rowGlowBeat * 0.06) * translationGlowFocus) * depthFade : 0);
      if (backdropAdapt > 0.001) glowOpacityTarget *= (1 - backdropAdapt * 0.30);
      if (data.usesTrack && (!glowLayerVisible || !row.renderGlowUploaded)) glowOpacityTarget = 0;
      var glowOpacity = getLyricTextureMaterialOpacity(row.glowMat);
      var nextGlowOpacity = glowOpacity + (glowOpacityTarget - glowOpacity) * (glowOpacityTarget > glowOpacity ? 0.20 : 0.34);
      if (!isActive && nextGlowOpacity < 0.004) nextGlowOpacity = 0;
      setLyricTextureMaterialOpacity(row.glowMat, initialTextRevealPending ? 0 : nextGlowOpacity);
    }
  }
  registerLyricQualityCandidates(data, lyricQualityCandidates, lyricQualityTier, opts.qualityRootPriority, qualityBuildDeferred);
  var deferQualityCommit = lyricQualityState.deferFinalize;
  if (deferQualityCommit && renderRevealCandidates.length) {
    for (var deferredRevealIndex = 0; deferredRevealIndex < renderRevealCandidates.length; deferredRevealIndex++) {
      var deferredReveal = renderRevealCandidates[deferredRevealIndex];
      if (!deferredReveal || !deferredReveal.quality) continue;
      registerLyricQualityCommitCandidate(data, deferredReveal.row, (Number(opts.qualityRootPriority) || 0) + deferredReveal.priority);
    }
  }
  if (deferQualityCommit && lyricQualityCandidates.length) {
    for (var deferredPrewarmIndex = 0; deferredPrewarmIndex < lyricQualityCandidates.length; deferredPrewarmIndex++) {
      var deferredPrewarm = lyricQualityCandidates[deferredPrewarmIndex];
      if (!deferredPrewarm || !deferredPrewarm.row || !deferredPrewarm.row.renderLineUploaded || !deferredPrewarm.row.qualityPendingTexture) continue;
      registerLyricQualityCommitCandidate(data, deferredPrewarm.row, (Number(opts.qualityRootPriority) || 0) + 240 + deferredPrewarm.priority);
    }
  }
  if (!deferQualityCommit) finalizeLyricQualitySelectionFrame();
  if (renderRevealCandidates.length) {
    renderRevealCandidates.sort(function (a, b) { return a.priority - b.priority; });
    for (var revealIndex = 0; revealIndex < renderRevealCandidates.length; revealIndex++) {
      var reveal = renderRevealCandidates[revealIndex];
      if (reveal.quality && deferQualityCommit) continue;
      if (!consumeLyricRenderUploadFrameBudget()) break;
      if (reveal.quality) {
        commitLyricRowQuality(reveal.row);
        continue;
      }
      reveal.row[reveal.flag] = true;
      reveal.mesh.visible = true;
    }
  }
  updateLyricQualityStats(lyricQualityTier);
  if (initialTextRevealPending) {
    var initialTextRows = 0;
    var initialTextRowsReady = true;
    for (var readyIndex = 0; readyIndex < data.rowLayers.length; readyIndex++) {
      var readyRow = data.rowLayers[readyIndex];
      if (!readyRow || !readyRow.mesh || !readyRow.renderWindowActive) continue;
      initialTextRows += 1;
      if (!readyRow.renderLineUploaded) initialTextRowsReady = false;
    }
    if (initialTextRows > 0 && initialTextRowsReady) {
      data.renderInitialTextReady = true;
      data.renderInitialTextReadyAt = nowMs;
      if (!opts.initialRevealReflow) {
        var revealOpts = {};
        for (var revealOptKey in opts) revealOpts[revealOptKey] = opts[revealOptKey];
        revealOpts.initialRevealReflow = true;
        updateLyricRowLayers(data, revealOpts);
        return;
      }
    }
  }
  if (activeRow && activeRow.mat && activeRow.mat.uniforms) {
    data.textMat = activeRow.mat;
    data.activeRowMesh = activeRow.mesh;
  }
}
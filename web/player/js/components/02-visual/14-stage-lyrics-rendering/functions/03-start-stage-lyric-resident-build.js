'use strict';



function startStageLyricResidentBuild(mesh, targetIndex, start, end, options) {
  options = options || {};
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.trackPersistent) return false;
  cancelStageLyricResidentBuild();
  var payload = buildStageLyricResidentPayload(targetIndex, start, end, { textOnly: options.textOnly === true });
  if (!payload) return false;
  var maskLayout = data.persistentMaskLayout || { fontSize: 128, lineHeight: 138 };
  var state = beginLyricRowLayerGroupBuild(payload, maskLayout, Number(data.worldW) || 6.10, Number(data.worldH) || 1.2, stageLyrics.palette, lyricMotionProfile());
  // Resident chunks are extensions of one continuous track.  Reuse the
  // original track spacing instead of recalculating it from a compact raster.
  if (state && isFinite(Number(data.lineWorldStep))) state.lineStepWorld = Number(data.lineWorldStep);
  if (state && isFinite(Number(data.translationLineStepWorld))) state.translationLineStepWorld = Number(data.translationLineStepWorld);
  var job = {
    mesh: mesh,
    trackKey: data.trackKey,
    targetIndex: targetIndex,
    start: start,
    end: end,
    reason: options.reason || '',
    textOnly: options.textOnly === true,
    effectsOnly: options.effectsOnly === true,
    interactive: options.interactive === true,
    state: state,
    token: stageLyricResidentBuild.token,
    startedAt: stageLyricNowMs(),
    maxChunkMs: 0
  };
  stageLyricResidentBuild.job = job;
  if (typeof window !== 'undefined') {
    window.__mineradioLyricResidentStats = {
      active: true,
      rootId: mesh.id,
      trackKey: data.trackKey,
      buildStart: start,
      buildEnd: end,
      reason: job.reason,
      residentPrimaryCount: data.trackResidentPrimaryCount,
      residentRows: data.rowLayers.length
    };
  }
  scheduleStageLyricResidentBuildWork(job, 0);
  return true;
}


function stageLyricPersistentPrimaryMap(data) {
  var map = {};
  if (!data || !Array.isArray(data.rowLayers)) return map;
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    if (row && row.isPrimary && row.lineIndex != null && isFinite(Number(row.lineIndex))) map[Math.round(Number(row.lineIndex))] = true;
  }
  return map;
}


function stageLyricPersistentResidentRowMap(data) {
  var map = {};
  if (!data || !Array.isArray(data.rowLayers)) return map;
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    var key = stageLyricResidentRowKey(row);
    if (key) map[key] = row;
  }
  return map;
}


function stageLyricPersistentLineRowsResident(data, lineIndex, rowMap) {
  lineIndex = Math.round(Number(lineIndex));
  if (!isFinite(lineIndex) || !lyricsLines || lineIndex < 0 || lineIndex >= lyricsLines.length) return true;
  var entry = stageLyricTrackBaseEntry(lineIndex);
  if (!entry) return true;
  rowMap = rowMap || stageLyricPersistentResidentRowMap(data);
  if (!rowMap[lineIndex + '|primary']) return false;
  if (
    normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) !== 'off' &&
    makeStageLyricTranslationEntry(entry, false) &&
    !rowMap[lineIndex + '|translation']
  ) return false;
  return true;
}


function stageLyricPersistentLineEffectsResident(data, lineIndex, rowMap) {
  lineIndex = Math.round(Number(lineIndex));
  if (!isFinite(lineIndex) || !lyricsLines || lineIndex < 0 || lineIndex >= lyricsLines.length) return true;
  var entry = stageLyricTrackBaseEntry(lineIndex);
  if (!entry) return true;
  rowMap = rowMap || stageLyricPersistentResidentRowMap(data);
  var primary = rowMap[lineIndex + '|primary'];
  if (!primary || !primary.readability || !primary.glow) return false;
  if (normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) !== 'off' && makeStageLyricTranslationEntry(entry, false)) {
    var translation = rowMap[lineIndex + '|translation'];
    if (!translation || !translation.readability || !translation.glow) return false;
  }
  return true;
}


function stageLyricPersistentTargetRowsReady(mesh, targetIndex, options) {
  options = options || {};
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.trackPersistent || !lyricsLines || !lyricsLines.length) return false;
  targetIndex = Math.max(0, Math.min(lyricsLines.length - 1, Math.round(Number(targetIndex) || 0)));
  var offsets = lyricDisplayOffsetsForMode(data.displayMode || (fx && fx.lyricDisplayMode));
  var required = {};
  for (var oi = 0; oi < offsets.length; oi++) {
    var lineIndex = targetIndex + Math.round(Number(offsets[oi]) || 0);
    if (lineIndex < 0 || lineIndex >= lyricsLines.length) continue;
    var entry = stageLyricTrackBaseEntry(lineIndex);
    if (!entry) continue;
    required[lineIndex + '|primary'] = true;
    if (normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) !== 'off' && makeStageLyricTranslationEntry(entry, lineIndex === targetIndex)) {
      required[lineIndex + '|translation'] = true;
    }
  }
  var requiredKeys = Object.keys(required);
  if (!requiredKeys.length) return false;
  var rows = stageLyricPersistentResidentRowMap(data);
  for (var ki = 0; ki < requiredKeys.length; ki++) {
    var requiredRow = rows[requiredKeys[ki]];
    if (!requiredRow || !requiredRow.mesh || !requiredRow.renderLineUploaded) return false;
    if (options.effects === true) {
      if (!requiredRow.readability || !requiredRow.renderReadabilityUploaded) return false;
      if (!requiredRow.glow || !requiredRow.renderGlowUploaded) return false;
    }
  }
  return true;
}


function stageLyricPersistentTargetEffectsReady(mesh, targetIndex) {
  return stageLyricPersistentTargetRowsReady(mesh, targetIndex, { effects: true });
}


function stageLyricPersistentNextTextRunwayRange(data, targetIndex, rowMap) {
  if (!data || !lyricsLines || !lyricsLines.length) return null;
  var last = lyricsLines.length - 1;
  targetIndex = Math.max(0, Math.min(last, Math.round(Number(targetIndex) || 0)));
  rowMap = rowMap || stageLyricPersistentResidentRowMap(data);
  var nextIndex = -1;
  var previousIndex = -1;
  for (var next = targetIndex; next <= last; next++) {
    if (lyricLineDisplayTextAt(next) && !stageLyricPersistentLineRowsResident(data, next, rowMap)) {
      nextIndex = next;
      break;
    }
  }
  for (var previous = targetIndex - 1; previous >= 0; previous--) {
    if (lyricLineDisplayTextAt(previous) && !stageLyricPersistentLineRowsResident(data, previous, rowMap)) {
      previousIndex = previous;
      break;
    }
  }
  if (nextIndex < 0 && previousIndex < 0) {
    data.trackTextRunwayComplete = true;
    data.trackTextRunwayReadyAt = stageLyricNowMs();
    return null;
  }
  data.trackTextRunwayComplete = false;
  var preferPrevious = data.trackTextRunwayDirection === 'previous';
  var usePrevious = previousIndex >= 0 && (nextIndex < 0 || preferPrevious);
  data.trackTextRunwayDirection = usePrevious ? 'next' : 'previous';
  var chunkSize = normalizeLyricTranslationMode(fx && fx.lyricTranslationMode) === 'off' ? 36 : 24;
  if (usePrevious) {
    return {
      start: Math.max(0, previousIndex - chunkSize + 1),
      end: previousIndex
    };
  }
  return {
    start: nextIndex,
    end: Math.min(last, nextIndex + chunkSize - 1)
  };
}


function commitStageLyricPersistentPendingTarget(mesh) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  var payload = data && data.trackPendingPayload;
  if (!payload || payload.trackIndex == null || !stageLyricPersistentTargetRowsReady(mesh, payload.trackIndex)) return false;
  return setLyricTrackTarget(mesh, payload);
}


function ensureStageLyricPersistentTrackRows(mesh, targetIndex, options) {
  options = options || {};
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.trackPersistent || !lyricsLines || !lyricsLines.length || stageLyrics.current !== mesh) return false;
  var last = lyricsLines.length - 1;
  targetIndex = Math.max(0, Math.min(last, Math.round(Number(targetIndex) || 0)));
  var residentRowMap = stageLyricPersistentResidentRowMap(data);
  var offsets = lyricDisplayOffsetsForMode(data.displayMode || (fx && fx.lyricDisplayMode));
  var minOffset = 0;
  var maxOffset = 0;
  for (var oi = 0; oi < offsets.length; oi++) {
    minOffset = Math.min(minOffset, Math.round(Number(offsets[oi]) || 0));
    maxOffset = Math.max(maxOffset, Math.round(Number(offsets[oi]) || 0));
  }
  var interactivePreview = !!(options.interactive || stageLyricProgressPreviewActive());
  // Normal playback keeps a long, text-only runway similar to the private
  // build's continuous track, without paying its 200+ row startup cost.
  var desiredStart = Math.max(0, targetIndex + minOffset - (interactivePreview ? 4 : 6));
  var desiredEnd = Math.min(last, targetIndex + maxOffset + (interactivePreview ? 10 : 24));
  var visibleStart = Math.max(0, targetIndex + minOffset);
  var visibleEnd = Math.min(last, targetIndex + maxOffset);
  var targetMissing = !stageLyricPersistentLineRowsResident(data, targetIndex, residentRowMap);
  var firstVisibleMissing = -1;
  for (var visibleIndex = visibleStart; visibleIndex <= visibleEnd; visibleIndex++) {
    if (lyricLineDisplayTextAt(visibleIndex) && !stageLyricPersistentLineRowsResident(data, visibleIndex, residentRowMap)) { firstVisibleMissing = visibleIndex; break; }
  }
  var firstMissing = firstVisibleMissing;
  if (firstMissing < 0) {
    for (var i = desiredStart; i <= desiredEnd; i++) {
      if (lyricLineDisplayTextAt(i) && !stageLyricPersistentLineRowsResident(data, i, residentRowMap)) { firstMissing = i; break; }
    }
  }
  if (firstMissing < 0) {
    var firstEffectsMissing = -1;
    for (var effectIndex = visibleStart; effectIndex <= visibleEnd; effectIndex++) {
      if (lyricLineDisplayTextAt(effectIndex) && !stageLyricPersistentLineEffectsResident(data, effectIndex, residentRowMap)) {
        firstEffectsMissing = effectIndex;
        break;
      }
    }
    cancelStageLyricResidentDemand();
    if (firstEffectsMissing >= 0) {
      var effectJob = stageLyricResidentBuild.job;
      if (effectJob && effectJob.mesh === mesh) {
        if (!effectJob.textOnly && effectJob.start <= visibleStart && effectJob.end >= visibleEnd) return true;
        cancelStageLyricResidentBuild();
      }
      return startStageLyricResidentBuild(mesh, targetIndex, visibleStart, visibleEnd, {
        reason: options.reason || 'persistent-track-visible-effects',
        effectsOnly: true,
        interactive: interactivePreview
      });
    }
    // Once the visible window is complete, keep extending the cheap text-only
    // track in the background until the whole song is resident.  This restores
    // the private build's one-piece scroll without paying for off-screen glow
    // and readability layers.
    if (!interactivePreview && !data.trackPendingPayload) {
      var activeRunwayJob = stageLyricResidentBuild.job;
      if (activeRunwayJob && activeRunwayJob.mesh === mesh) return true;
      var runwayRange = stageLyricPersistentNextTextRunwayRange(data, targetIndex, residentRowMap);
      if (runwayRange) {
        return startStageLyricResidentBuild(mesh, targetIndex, runwayRange.start, runwayRange.end, {
          reason: options.reason || 'persistent-track-full-text-runway',
          textOnly: true,
          interactive: false
        });
      }
    }
    trimStageLyricPersistentTrackRows(mesh, targetIndex);
    return true;
  }
  if (options.urgent && !options.coalesced && stageLyricProgressPreviewActive()) {
    return scheduleStageLyricResidentDemand(mesh, targetIndex, options);
  }
  cancelStageLyricResidentDemand();
  var buildStart = firstVisibleMissing >= 0 ? visibleStart : firstMissing;
  var buildEnd = firstVisibleMissing >= 0 ? visibleEnd : buildStart;
  var usable = 0;
  for (var initialIndex = buildStart; initialIndex <= buildEnd; initialIndex++) {
    if (lyricLineDisplayTextAt(initialIndex) && !stageLyricPersistentLineRowsResident(data, initialIndex, residentRowMap)) usable += 1;
  }
  var chunkLimit = interactivePreview ? Math.max(8, offsets.length) : Math.max(28, offsets.length);
  if (!interactivePreview || firstVisibleMissing < 0) {
    while (buildEnd < desiredEnd && usable < chunkLimit) {
      buildEnd += 1;
      if (lyricLineDisplayTextAt(buildEnd) && !stageLyricPersistentLineRowsResident(data, buildEnd, residentRowMap)) usable += 1;
    }
  }
  buildEnd = Math.max(buildStart, Math.min(last, buildEnd));
  var activeJob = stageLyricResidentBuild.job;
  if (activeJob && activeJob.mesh === mesh) {
    var activeCoversVisibleWindow = activeJob.start <= visibleStart && activeJob.end >= visibleEnd;
    if (firstVisibleMissing >= 0 && activeCoversVisibleWindow && (!interactivePreview || activeJob.textOnly)) return true;
    if (firstVisibleMissing < 0 && !targetMissing) return true;
    cancelStageLyricResidentBuild();
  }
  return startStageLyricResidentBuild(mesh, targetIndex, buildStart, buildEnd, {
    reason: options.reason || (targetMissing ? 'persistent-track-demand' : 'persistent-track-ahead'),
    textOnly: true,
    interactive: interactivePreview
  });
}


function trimStageLyricPersistentTrackRows(mesh, targetIndex, options) {
  options = options || {};
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !data.trackPersistent || !Array.isArray(data.rowLayers) || !data.rowLayers.length || !lyricsLines || !lyricsLines.length) return false;
  targetIndex = Math.max(0, Math.min((lyricsLines && lyricsLines.length ? lyricsLines.length - 1 : 0), Math.round(Number(targetIndex) || 0)));
  var offsets = lyricDisplayOffsetsForMode(data.displayMode || (fx && fx.lyricDisplayMode));
  var minOffset = 0;
  var maxOffset = 0;
  for (var oi = 0; oi < offsets.length; oi++) {
    minOffset = Math.min(minOffset, Math.round(Number(offsets[oi]) || 0));
    maxOffset = Math.max(maxOffset, Math.round(Number(offsets[oi]) || 0));
  }
  var interactive = options.interactive === true;
  var keepStart = Math.max(0, targetIndex + minOffset - (interactive ? 3 : 6));
  var keepEnd = Math.min(lyricsLines.length - 1, targetIndex + maxOffset + (interactive ? 5 : 24));
  var preserveTargetIndex = Number(options.preserveTargetIndex);
  var preserveStart = Infinity;
  var preserveEnd = -Infinity;
  if (interactive && isFinite(preserveTargetIndex)) {
    preserveTargetIndex = Math.max(0, Math.min(lyricsLines.length - 1, Math.round(preserveTargetIndex)));
    preserveStart = Math.max(0, preserveTargetIndex + minOffset - 2);
    preserveEnd = Math.min(lyricsLines.length - 1, preserveTargetIndex + maxOffset + 2);
  }
  var releasedEffects = 0;
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    var lineIndex = row && row.isTranslation
      ? (row.parentIndex != null ? Number(row.parentIndex) : Number(row.lineIndex))
      : Number(row && row.lineIndex);
    var roundedLineIndex = isFinite(lineIndex) ? Math.round(lineIndex) : null;
    var keepForTarget = roundedLineIndex != null && roundedLineIndex >= keepStart && roundedLineIndex <= keepEnd;
    var keepForCommittedWindow = roundedLineIndex != null && roundedLineIndex >= preserveStart && roundedLineIndex <= preserveEnd;
    var keepEffects = roundedLineIndex == null || keepForTarget || keepForCommittedWindow ||
      roundedLineIndex === targetIndex || roundedLineIndex === preserveTargetIndex;
    if (keepEffects) continue;
    // Text rows are the continuous whole-song runway.  Only their expensive
    // off-screen effect layers are evicted; deleting the text row itself would
    // reintroduce the load/merge break the user sees while seeking.
    if (row.readability) {
      disposeLyricMesh(row.readability);
      row.readability = null;
      row.readabilityMat = null;
      row.renderReadabilityUploaded = false;
      releasedEffects += 1;
    }
    if (row.glow) {
      disposeLyricMesh(row.glow);
      row.glow = null;
      row.glowMat = null;
      row.renderGlowUploaded = false;
      releasedEffects += 1;
    }
  }
  updateStageLyricPersistentResidentBounds(data);
  return releasedEffects > 0;
}
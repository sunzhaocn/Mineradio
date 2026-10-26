'use strict';



function cancelStageLyricResidentBuild() {
  cancelStageLyricResidentDemand();
  if (stageLyricResidentBuild.timer) clearTimeout(stageLyricResidentBuild.timer);
  if (stageLyricResidentBuild.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(stageLyricResidentBuild.raf);
  stageLyricResidentBuild.timer = 0;
  stageLyricResidentBuild.raf = 0;
  stageLyricResidentBuild.token += 1;
  var job = stageLyricResidentBuild.job;
  stageLyricResidentBuild.job = null;
  if (job && job.state) {
    if (typeof cancelLyricRowLayerGroupBuild === 'function') cancelLyricRowLayerGroupBuild(job.state);
    else if (job.state.root) disposeLyricMesh(job.state.root);
  }
  if (typeof window !== 'undefined' && window.__mineradioLyricResidentStats) {
    window.__mineradioLyricResidentStats.active = false;
  }
}


function cancelStageLyricResidentDemand() {
  if (stageLyricResidentDemand.timer) clearTimeout(stageLyricResidentDemand.timer);
  stageLyricResidentDemand.timer = 0;
  stageLyricResidentDemand.mesh = null;
  stageLyricResidentDemand.targetIndex = -1;
  stageLyricResidentDemand.options = null;
}


function scheduleStageLyricResidentDemand(mesh, targetIndex, options) {
  stageLyricResidentDemand.mesh = mesh;
  stageLyricResidentDemand.targetIndex = targetIndex;
  stageLyricResidentDemand.options = options || {};
  if (stageLyricProgressPreviewActive()) stageLyricResidentDemand.options.interactive = true;
  if (stageLyricResidentDemand.timer) return true;
  stageLyricResidentDemand.timer = setTimeout(function () {
    var demandMesh = stageLyricResidentDemand.mesh;
    var demandTarget = stageLyricResidentDemand.targetIndex;
    var demandOptions = stageLyricResidentDemand.options || {};
    var coalescedOptions = {};
    for (var optionKey in demandOptions) coalescedOptions[optionKey] = demandOptions[optionKey];
    coalescedOptions.urgent = false;
    coalescedOptions.coalesced = true;
    cancelStageLyricResidentDemand();
    ensureStageLyricPersistentTrackRows(demandMesh, demandTarget, coalescedOptions);
  }, 48);
  return true;
}


function buildStageLyricResidentPayload(index, start, end, options) {
  options = options || {};
  if (!lyricsLines || !lyricsLines.length) return null;
  var mode = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode);
  var last = lyricsLines.length - 1;
  start = Math.max(0, Math.min(last, Math.round(Number(start) || 0)));
  end = Math.max(start, Math.min(last, Math.round(Number(end) || start)));
  index = Math.max(start, Math.min(end, Math.round(Number(index) || start)));
  var entries = [];
  var activeLine = 0;
  for (var i = start; i <= end; i++) {
    var entry = stageLyricTrackBaseEntry(i);
    if (!entry) continue;
    if (i === index) activeLine = entries.length;
    entries.push(entry);
  }
  if (!entries.length) return null;
  var translated = applyLyricTranslationModeToTrackEntries(entries, activeLine, entries.length * 2 + 2);
  return {
    mode: mode,
    key: 'resident|' + stageLyricTrackKeyForMode(mode) + '|' + start + '-' + end + '|' + index,
    activeLine: translated.activeLine,
    entries: translated.entries,
    trackIndex: index,
    trackKey: stageLyricTrackKeyForMode(mode),
    trackEntries: translated.entries,
    trackStart: start,
    trackEnd: end,
    trackLightweight: true,
    trackTextOnly: options.textOnly === true
  };
}


function disposeStageLyricResidentRow(row) {
  if (!row) return;
  if (typeof releaseLyricRowQuality === 'function') releaseLyricRowQuality(row, true);
  if (row.mesh) disposeLyricMesh(row.mesh);
  if (row.readability) disposeLyricMesh(row.readability);
  if (row.glow) disposeLyricMesh(row.glow);
}


function alignStageLyricResidentEffectToRow(row, effect, zOffset) {
  if (!row || !row.mesh || !effect) return;
  effect.position.copy(row.mesh.position);
  effect.position.z += Number(zOffset) || 0;
  effect.scale.copy(row.mesh.scale);
}


function stageLyricResidentDisplayedScrollOffset(data, fallbackOffset) {
  if (!data || !Array.isArray(data.rowLayers) || !data.rowLayers.length) return fallbackOffset;
  var lineStepWorld = clampRange(Number(data.lineWorldStep) || 0.38, 0.20, 0.94);
  var samples = [];
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    if (!row || !row.isPrimary || !row.mesh || !isFinite(Number(row.virtualIndex)) || !isFinite(Number(row.mesh.position.y))) continue;
    var visualOffset = Number(row.virtualIndex) + Number(row.mesh.position.y) / lineStepWorld;
    if (isFinite(visualOffset)) samples.push(visualOffset);
  }
  if (!samples.length) return fallbackOffset;
  samples.sort(function (a, b) { return a - b; });
  var middle = Math.floor(samples.length / 2);
  return samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) * 0.5;
}


function stageLyricResidentTransformSnapshot(data) {
  data = data || {};
  var previewMotionLock = typeof stageLyricProgressPreviewActive === 'function' && stageLyricProgressPreviewActive();
  var pendingLineIndex = data.trackPendingPayload && isFinite(Number(data.trackPendingPayload.trackIndex))
    ? Number(data.trackPendingPayload.trackIndex)
    : null;
  var targetLineIndex = previewMotionLock && pendingLineIndex != null
    ? pendingLineIndex
    : (isFinite(Number(data.trackTargetLineIndex)) ? Number(data.trackTargetLineIndex) : 0);
  var targetVirtualIndex = previewMotionLock
    ? lyricPrimaryVirtualIndex(targetLineIndex)
    : (isFinite(Number(data.trackTargetVirtualIndex)) ? Number(data.trackTargetVirtualIndex) : lyricPrimaryVirtualIndex(targetLineIndex));
  var sharedScrollOffset = isFinite(Number(data.trackScrollOffset)) ? Number(data.trackScrollOffset) : targetVirtualIndex;
  var displayedScrollOffset = stageLyricResidentDisplayedScrollOffset(data, sharedScrollOffset);
  return {
    previewMotionLock: previewMotionLock,
    targetLineIndex: targetLineIndex,
    targetVirtualIndex: targetVirtualIndex,
    // Resident rows join the coordinate system that is on screen *now*.
    // Pending/final targets only choose what to build; using them as the
    // birth coordinate makes late rows fly in from another scroll phase.
    scrollOffset: displayedScrollOffset
  };
}


function primeStageLyricResidentRowTransform(data, row, transformSnapshot) {
  if (!data || !row || !row.mesh) return;
  var snapshot = transformSnapshot || stageLyricResidentTransformSnapshot(data);
  var targetLineIndex = Number(snapshot.targetLineIndex) || 0;
  var targetVirtualIndex = isFinite(Number(snapshot.targetVirtualIndex)) ? Number(snapshot.targetVirtualIndex) : lyricPrimaryVirtualIndex(targetLineIndex);
  var scrollOffset = isFinite(Number(snapshot.scrollOffset)) ? Number(snapshot.scrollOffset) : targetVirtualIndex;
  var lineStepWorld = clampRange(Number(data.lineWorldStep) || 0.38, 0.20, 0.94);
  var translationLineStepWorld = clampRange(Number(data.translationLineStepWorld) || lineStepWorld, 0.20, 0.78);
  var rowVirtualIndex = isFinite(Number(row.virtualIndex)) ? Number(row.virtualIndex) : targetVirtualIndex;
  var rowLineIndex = isFinite(Number(row.lineIndex)) ? Number(row.lineIndex) : null;
  var isActive = !!row.isPrimary && rowLineIndex === targetLineIndex;
  var parentIndex = row.isTranslation
    ? (isFinite(Number(row.parentIndex)) ? Number(row.parentIndex) : rowLineIndex)
    : null;
  var currentTranslation = row.isTranslation && parentIndex === targetLineIndex;
  var visibilityAbs = row.isTranslation && parentIndex != null
    ? Math.abs(lyricPrimaryVirtualIndex(parentIndex) - scrollOffset)
    : Math.abs(rowVirtualIndex - scrollOffset);
  var yTarget = -(rowVirtualIndex - scrollOffset) * lineStepWorld;
  if (row.isTranslation) {
    yTarget = lyricTranslationAnchoredY(row, rowVirtualIndex, targetVirtualIndex, lineStepWorld, translationLineStepWorld, scrollOffset, 0, currentTranslation, true);
  }
  var zTarget = 0.055 - Math.pow(Math.min(5.5, visibilityAbs), 1.06) * 0.145 + (currentTranslation ? 0.065 : 0);
  var scaleDistance = isActive || currentTranslation ? 0 : visibilityAbs;
  var scaleTarget = clampRange(1 - Math.min(5.5, scaleDistance) * 0.026, 0.84, 1.02);
  if (row.isTranslation) {
    scaleTarget *= clampRange(Number(row.fontScale) || 1, 0.72, 1.34);
    if (currentTranslation) scaleTarget *= 1.16;
  }
  row.mesh.position.set(0, yTarget, zTarget);
  row.mesh.scale.setScalar(scaleTarget);
  alignStageLyricResidentEffectToRow(row, row.readability, -0.012);
  alignStageLyricResidentEffectToRow(row, row.glow, -0.030);
}


function mergeStageLyricResidentBundle(mesh, bundle) {
  var data = mesh && mesh.userData && mesh.userData.lyric;
  if (!data || !bundle || !Array.isArray(bundle.rows)) return 0;
  var existing = {};
  for (var i = 0; i < data.rowLayers.length; i++) {
    var existingKey = stageLyricResidentRowKey(data.rowLayers[i]);
    if (existingKey) existing[existingKey] = data.rowLayers[i];
  }
  var added = 0;
  var textParent = data.contextGroup || data.rowLayerGroup;
  var effectParent = data.readabilityGroup || data.rowLayerGroup;
  var transformSnapshot = stageLyricResidentTransformSnapshot(data);
  for (var ri = 0; ri < bundle.rows.length; ri++) {
    var row = bundle.rows[ri];
    var key = stageLyricResidentRowKey(row);
    var existingRow = key ? existing[key] : null;
    if (existingRow) {
      if (!existingRow.readability && row.readability) {
        if (row.readability.parent) row.readability.parent.remove(row.readability);
        effectParent.add(row.readability);
        existingRow.readability = row.readability;
        existingRow.readabilityMat = row.readabilityMat;
        existingRow.renderReadabilityUploaded = false;
        alignStageLyricResidentEffectToRow(existingRow, existingRow.readability, -0.012);
        row.readability = null;
        row.readabilityMat = null;
      }
      if (!existingRow.glow && row.glow) {
        if (row.glow.parent) row.glow.parent.remove(row.glow);
        effectParent.add(row.glow);
        existingRow.glow = row.glow;
        existingRow.glowMat = row.glowMat;
        existingRow.renderGlowUploaded = false;
        alignStageLyricResidentEffectToRow(existingRow, existingRow.glow, -0.030);
        row.glow = null;
        row.glowMat = null;
      }
      disposeStageLyricResidentRow(row);
      continue;
    }
    if (!key) {
      disposeStageLyricResidentRow(row);
      continue;
    }
    existing[key] = row;
    if (row.mesh) {
      if (row.mesh.parent) row.mesh.parent.remove(row.mesh);
      textParent.add(row.mesh);
    }
    if (row.readability) {
      if (row.readability.parent) row.readability.parent.remove(row.readability);
      effectParent.add(row.readability);
    }
    if (row.glow) {
      if (row.glow.parent) row.glow.parent.remove(row.glow);
      effectParent.add(row.glow);
    }
    row.renderWindowActive = false;
    row.renderRevealAt = 0;
    primeStageLyricResidentRowTransform(data, row, transformSnapshot);
    data.rowLayers.push(row);
    added += 1;
  }
  data.rowLayers.sort(function (a, b) {
    var av = isFinite(Number(a && a.virtualIndex)) ? Number(a.virtualIndex) : 0;
    var bv = isFinite(Number(b && b.virtualIndex)) ? Number(b.virtualIndex) : 0;
    return av - bv;
  });
  if (bundle.group) disposeLyricMesh(bundle.group);
  updateStageLyricPersistentResidentBounds(data);
  return added;
}


function finishStageLyricResidentBuild(job) {
  if (!job || stageLyricResidentBuild.job !== job) return;
  stageLyricResidentBuild.job = null;
  stageLyricResidentBuild.timer = 0;
  stageLyricResidentBuild.raf = 0;
  var bundle = finishLyricRowLayerGroupBuild(job.state);
  var data = job.mesh && job.mesh.userData && job.mesh.userData.lyric;
  if (!bundle || !data || !data.trackPersistent || stageLyrics.current !== job.mesh || data.trackKey !== job.trackKey) {
    if (bundle && bundle.group) disposeLyricMesh(bundle.group);
    return;
  }
  var added = mergeStageLyricResidentBundle(job.mesh, bundle);
  var demandIndex = data.trackPendingPayload && data.trackPendingPayload.trackIndex != null
    ? Number(data.trackPendingPayload.trackIndex)
    : Number(data.trackTargetLineIndex);
  if (!data.trackPendingPayload) trimStageLyricPersistentTrackRows(job.mesh, demandIndex);
  else if (job.interactive && job.textOnly && stageLyricProgressPreviewActive()) {
    // A long pointer drag can finish several now-stale text-only windows before
    // the newest demand is ready. Keep the committed window plus the newest
    // preview window, instead of retaining every row crossed by the pointer.
    trimStageLyricPersistentTrackRows(job.mesh, demandIndex, {
      interactive: true,
      preserveTargetIndex: data.trackTargetLineIndex
    });
  }
  // Keep extending the cheap text runway first.  Once it is complete,
  // ensureStageLyricPersistentTrackRows schedules effects only for the visible
  // window, so effect work can never split the continuous scrolling track.
  ensureStageLyricPersistentTrackRows(job.mesh, demandIndex, {
    reason: 'persistent-track-continue',
    urgent: !!data.trackPendingPayload,
    interactive: !!(job.interactive || stageLyricProgressPreviewActive())
  });
  if (typeof window !== 'undefined') {
    window.__mineradioLyricResidentStats = {
      active: !!stageLyricResidentBuild.job,
      rootId: job.mesh.id,
      trackKey: data.trackKey,
      residentStart: data.trackResidentStart,
      residentEnd: data.trackResidentEnd,
      residentPrimaryCount: data.trackResidentPrimaryCount,
      residentRows: data.rowLayers.length,
      lastAddedRows: added,
      lastBuildMs: Math.max(0, stageLyricNowMs() - job.startedAt)
    };
  }
}


function runStageLyricResidentBuild(job) {
  stageLyricResidentBuild.timer = 0;
  stageLyricResidentBuild.raf = 0;
  if (!job || stageLyricResidentBuild.job !== job || job.token !== stageLyricResidentBuild.token) return;
  var data = job.mesh && job.mesh.userData && job.mesh.userData.lyric;
  if (!data || !data.trackPersistent || stageLyrics.current !== job.mesh || data.trackKey !== job.trackKey) {
    cancelStageLyricResidentBuild();
    return;
  }
  if (stageLyricShouldYieldToPendingInput() && !job.interactive && !job.textOnly) {
    scheduleStageLyricResidentBuildWork(job, 12);
    return;
  }
  var startedAt = stageLyricNowMs();
  var phaseLimit = job.textOnly ? 8 : (job.interactive ? 5 : 2);
  var phaseBudget = job.textOnly ? 2.8 : (job.interactive ? 3.4 : 4.2);
  var done = stepLyricRowLayerGroupBuild(job.state, phaseLimit, phaseBudget);
  var chunkMs = stageLyricNowMs() - startedAt;
  job.maxChunkMs = Math.max(job.maxChunkMs, chunkMs);
  if (done) {
    finishStageLyricResidentBuild(job);
    return;
  }
  scheduleStageLyricResidentBuildWork(job, chunkMs >= 4.2 ? 8 : 0);
}


function scheduleStageLyricResidentBuildWork(job, delay) {
  if (!job || stageLyricResidentBuild.job !== job) return;
  delay = Math.max(0, Number(delay) || 0);
  var queue = function () {
    stageLyricResidentBuild.timer = 0;
    if (!job || stageLyricResidentBuild.job !== job) return;
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      stageLyricResidentBuild.raf = requestAnimationFrame(function () {
        stageLyricResidentBuild.raf = 0;
        runStageLyricResidentBuild(job);
      });
    } else {
      stageLyricResidentBuild.timer = setTimeout(function () { runStageLyricResidentBuild(job); }, 12);
    }
  };
  if (delay > 0) stageLyricResidentBuild.timer = setTimeout(queue, delay);
  else queue();
}
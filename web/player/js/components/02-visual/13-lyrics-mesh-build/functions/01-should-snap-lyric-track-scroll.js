'use strict';



function shouldSnapLyricTrackScroll(data, targetIndex, targetLineIndex, payload) {
  if (!data) return false;
  var currentOffset = Number(data.trackScrollOffset);
  if (!isFinite(currentOffset)) return true;
  var visibleRadius = Math.max(1.2, Number(data.trackVisibleRadius) || 3);
  var jump = Math.abs(targetIndex - currentOffset);
  if (!data.trackScrollPrimed) return true;
  var payloadWindowKey = lyricTrackScrollWindowKey(payload);
  if (payloadWindowKey && data.trackScrollWindowKey && data.trackScrollWindowKey !== payloadWindowKey) return true;
  if (jump > Math.max(2.75, visibleRadius * 1.55)) return true;
  var prevLine = Number(data.trackTargetLineIndex);
  if (isFinite(prevLine) && Math.abs(targetLineIndex - prevLine) > Math.max(6, visibleRadius * 2.7)) return true;
  return false;
}


function lyricTrackScrollWindowKey(payload) {
  if (!payload || !payload.trackKey) return '';
  // The visual scroll identity is the song/style track, not the current
  // resident row window.  Resident rows may stream in and out without ever
  // snapping or replacing the root lyric track.
  return payload.trackKey;
}


function snapLyricTrackScroll(data, targetIndex, payload) {
  if (!data || !isFinite(Number(targetIndex))) return;
  data.trackScrollOffset = Number(targetIndex);
  data.trackScrollPrimed = true;
  data.trackScrollWindowKey = lyricTrackScrollWindowKey(payload) || data.trackScrollWindowKey || '';
  data.trackScrollSnapUntil = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) + 120;
}


function updateLyricMeshProgress(mesh, progress, opts) {
  if (!mesh || !mesh.userData || !mesh.userData.lyric) return;
  opts = opts || {};
  progress = Math.max(0, Math.min(1, progress || 0));
  var d = mesh.userData.lyric;
  if (d.trackPersistent && d.trackPendingPayload) {
    d.trackPendingProgress = { value: progress, nativeKaraoke: !!opts.nativeKaraoke };
    return;
  }
  mesh.userData.targetLyricProgress = progress;
  mesh.userData.nativeKaraokeProgress = !!opts.nativeKaraoke;
  if (d.textMat && d.textMat.uniforms && d.textMat.uniforms.uProgress && !isFinite(d.textMat.uniforms.uProgress.value)) {
    d.textMat.uniforms.uProgress.value = progress;
  }
  mesh.userData.lastLyricProgress = progress;
}


function setLyricTrackTarget(mesh, payload) {
  if (!mesh || !mesh.userData || !mesh.userData.lyric || !payload) return false;
  var data = mesh.userData.lyric;
  if (!data.usesTrack || !data.rowLayers || !data.rowLayers.length) return false;
  if (!data.trackPersistent && !payload.trackLightweight && data.trackLightweight) return false;
  if (!payload.trackKey || data.trackKey !== payload.trackKey) return false;
  if (payload.trackIndex == null || !isFinite(Number(payload.trackIndex))) return false;
  var targetLineIndex = Number(payload.trackIndex);
  if (!data.trackPersistent && data.trackStart != null && isFinite(Number(data.trackStart)) && targetLineIndex < Number(data.trackStart)) return false;
  if (!data.trackPersistent && data.trackEnd != null && isFinite(Number(data.trackEnd)) && targetLineIndex > Number(data.trackEnd)) return false;
  var targetIndex = lyricPrimaryVirtualIndex(targetLineIndex);
  var snapTrackScroll = shouldSnapLyricTrackScroll(data, targetIndex, targetLineIndex, payload);
  // Once a whole-song track is primed, every target in that same coordinate
  // system stays continuous.  This also covers the short interval after the
  // pointer is released while a pending target finishes its material commit.
  if (
    data.trackPersistent && data.trackScrollPrimed && isFinite(Number(data.trackScrollOffset)) &&
    (!data.trackScrollWindowKey || data.trackScrollWindowKey === lyricTrackScrollWindowKey(payload))
  ) snapTrackScroll = false;
  var activeRow = null;
  for (var i = 0; i < data.rowLayers.length; i++) {
    var row = data.rowLayers[i];
    var rowLineIndex = row && row.lineIndex != null && isFinite(Number(row.lineIndex)) ? Number(row.lineIndex) : null;
    if (row && row.isPrimary && (rowLineIndex != null ? rowLineIndex === targetLineIndex : Math.abs((Number(row.virtualIndex) || 0) - targetIndex) < 0.015)) {
      activeRow = row;
      break;
    }
  }
  var persistentTargetReady = !data.trackPersistent || (
    typeof stageLyricPersistentTargetRowsReady === 'function' &&
    stageLyricPersistentTargetRowsReady(mesh, targetLineIndex)
  );
  if (!activeRow || !activeRow.mat || !activeRow.mat.uniforms || !persistentTargetReady) {
    if (data.trackPersistent && typeof ensureStageLyricPersistentTrackRows === 'function') {
      var previousPending = data.trackPendingPayload;
      if (!previousPending || Number(previousPending.trackIndex) !== targetLineIndex || previousPending.key !== payload.key) {
        data.trackPendingProgress = null;
      }
      data.trackPendingPayload = payload;
      ensureStageLyricPersistentTrackRows(mesh, targetLineIndex, { reason: 'persistent-track-demand', urgent: true });
      return true;
    }
    return false;
  }
  var pendingProgress = data.trackPendingProgress;
  data.trackPendingPayload = null;
  data.trackPendingProgress = null;
  data.trackTargetIndex = targetIndex;
  data.trackTargetLineIndex = targetLineIndex;
  data.trackTargetVirtualIndex = targetIndex;
  data.trackTargetCommittedAt = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  if (snapTrackScroll) snapLyricTrackScroll(data, targetIndex, payload);
  else {
    data.trackScrollPrimed = true;
    data.trackScrollWindowKey = lyricTrackScrollWindowKey(payload) || data.trackScrollWindowKey || '';
  }
  data.textMat = activeRow.mat;
  data.activeRowMesh = activeRow.mesh;
  mesh.userData.payload = payload;
  var committedProgress = pendingProgress ? Math.max(0, Math.min(1, Number(pendingProgress.value) || 0)) : 0;
  mesh.userData.targetLyricProgress = committedProgress;
  mesh.userData.shownLyricProgress = committedProgress;
  mesh.userData.nativeKaraokeProgress = !!(pendingProgress && pendingProgress.nativeKaraoke);
  mesh.userData.lastLyricProgress = committedProgress;
  if (data.textMat.uniforms.uProgress) data.textMat.uniforms.uProgress.value = committedProgress;
  scheduleLyricTrackBoundaryPrewarm(data, targetLineIndex);
  if (data.trackPersistent && typeof trimStageLyricPersistentTrackRows === 'function') {
    trimStageLyricPersistentTrackRows(mesh, targetLineIndex);
  }
  return true;
}

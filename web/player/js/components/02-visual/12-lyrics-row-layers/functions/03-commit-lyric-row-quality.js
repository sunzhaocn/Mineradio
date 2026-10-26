'use strict';



function commitLyricRowQuality(row) {
  if (!row || lyricQualityState.deferFinalize || row.qualityWanted !== true) return false;
  if (row.qualityPendingTexture) {
    var previous = row.qualityTexture;
    row.qualityTexture = row.qualityPendingTexture;
    row.qualityTier = row.qualityPendingTier;
    row.qualityRasterKey = row.qualityPendingKey;
    row.qualityBytes = row.qualityPendingBytes;
    row.qualityPendingTexture = null;
    row.qualityPendingTier = 0;
    row.qualityPendingKey = '';
    row.qualityPendingBytes = 0;
    setLyricRowTextureMap(row, row.qualityTexture);
    row.qualityFallbackUntil = 0;
    if (previous && previous !== row.qualityTexture && previous !== row.baseLineTexture) lyricQualityDisposeTexture(previous);
  } else if (row.qualityTexture) {
    setLyricRowTextureMap(row, row.qualityTexture);
  } else return false;
  row.qualityLastUsedAt = lyricQualityNowMs();
  lyricQualityRememberRow(row);
  lyricQualityRecount();
  return true;
}


function beginLyricQualitySelectionFrame(deferFinalize) {
  lyricQualityState.selectionFrame += 1;
  lyricQualityState.frameCandidates.length = 0;
  lyricQualityState.frameCommits.length = 0;
  lyricQualityState.deferFinalize = deferFinalize === true;
  for (var residentIndex = 0; residentIndex < lyricQualityState.residents.length; residentIndex++) {
    var residentRow = lyricQualityState.residents[residentIndex];
    if (residentRow) residentRow.qualityWanted = false;
  }
  for (var queueIndex = 0; queueIndex < lyricQualityState.queue.length; queueIndex++) {
    var queuedRow = lyricQualityState.queue[queueIndex] && lyricQualityState.queue[queueIndex].row;
    if (queuedRow) queuedRow.qualityWanted = false;
  }
}


function registerLyricQualityCandidates(data, candidates, tier, rootPriority, buildDeferred) {
  if (!lyricQualityOwnerActive(data) || !Array.isArray(candidates) || !candidates.length || tier <= 1) return;
  rootPriority = Number(rootPriority) || 0;
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (!candidate || !candidate.row) continue;
    lyricQualityState.frameCandidates.push({
      data: data,
      row: candidate.row,
      tier: tier,
      priority: rootPriority + (Number(candidate.priority) || 50),
      hotMs: Number(candidate.hotMs) || 620,
      buildDeferred: buildDeferred === true
    });
  }
}


function registerLyricQualityCommitCandidate(data, row, priority) {
  if (!lyricQualityOwnerActive(data, row) || !row || (!row.qualityPendingTexture && (!row.qualityTexture || lyricQualityCurrentMap(row) === row.qualityTexture))) return;
  lyricQualityState.frameCommits.push({
    data: data,
    row: row,
    priority: Number(priority) || 50
  });
}


function commitDeferredLyricQualityRows() {
  if (!lyricQualityState.frameCommits.length) return false;
  var commits = lyricQualityState.frameCommits.slice().sort(function (a, b) { return a.priority - b.priority; });
  var seen = [];
  for (var i = 0; i < commits.length; i++) {
    var candidate = commits[i];
    var row = candidate && candidate.row;
    if (!row || seen.indexOf(row) >= 0 || !lyricQualityOwnerActive(candidate.data, row)) continue;
    seen.push(row);
    if (row.qualityWanted !== true) continue;
    if (!row.qualityPendingTexture && (!row.qualityTexture || lyricQualityCurrentMap(row) === row.qualityTexture)) continue;
    if (!consumeLyricRenderUploadFrameBudget()) return false;
    return commitLyricRowQuality(row);
  }
  return false;
}


function lyricQualityCandidateTarget(candidate) {
  if (!candidate || !candidate.row || !candidate.row.lineMask) return null;
  var target = lyricQualityTargetMetrics(candidate.row.lineMask, candidate.tier);
  if (!target) return null;
  return {
    metrics: target,
    key: target.tier + 'x|' + target.width + 'x' + target.height + '|' + (Number(candidate.row.lineMask.stoneSeed) || 0)
  };
}


function lyricQualityRowMatchesTarget(row, targetInfo) {
  if (!row || !targetInfo) return false;
  var tier = targetInfo.metrics.tier;
  var key = targetInfo.key;
  return !!(
    (row.qualityTexture && row.qualityTier === tier && row.qualityRasterKey === key) ||
    (row.qualityPendingTexture && row.qualityPendingTier === tier && row.qualityPendingKey === key)
  );
}


function finalizeLyricQualitySelectionFrame() {
  lyricQualityState.deferFinalize = false;
  var tier = lyricTextureClarityScale();
  var now = lyricQualityNowMs();
  if (tier <= 1) {
    var baseRows = lyricQualityState.residents.slice();
    for (var baseIndex = 0; baseIndex < baseRows.length; baseIndex++) releaseLyricRowQuality(baseRows[baseIndex], true);
    pruneLyricQualityQueue(now);
    updateLyricQualityStats(tier);
    return;
  }
  var sorted = lyricQualityState.frameCandidates.slice().sort(function (a, b) { return a.priority - b.priority; });
  var candidates = [];
  var candidateRows = [];
  for (var sortedIndex = 0; sortedIndex < sorted.length; sortedIndex++) {
    var sortedCandidate = sorted[sortedIndex];
    if (!sortedCandidate || !lyricQualityOwnerActive(sortedCandidate.data, sortedCandidate.row) || candidateRows.indexOf(sortedCandidate.row) >= 0) continue;
    var targetInfo = lyricQualityCandidateTarget(sortedCandidate);
    if (!targetInfo) continue;
    sortedCandidate.targetInfo = targetInfo;
    candidates.push(sortedCandidate);
    candidateRows.push(sortedCandidate.row);
  }
  var maxRows = lyricQualityEffectiveMaxRows();
  var desiredRows = [];
  var desiredRowProjectedBytes = [];
  var desiredProjectedBytes = 0;
  var largestSelectionItem = 0;
  function rememberDesired(row, projectedBytes) {
    if (!row || desiredRows.indexOf(row) >= 0 || desiredRows.length >= maxRows) return false;
    desiredRows.push(row);
    var safeProjectedBytes = Math.max(0, Number(projectedBytes) || 0);
    desiredRowProjectedBytes.push(safeProjectedBytes);
    desiredProjectedBytes += safeProjectedBytes;
    return true;
  }
  var fallbackRows = lyricQualityState.residents.filter(function (row) {
    return row && (row.qualityTexture || row.qualityPendingTexture) && Number(row.qualityFallbackUntil) > now;
  }).sort(function (a, b) {
    return (Number(b.qualityLastUsedAt) || 0) - (Number(a.qualityLastUsedAt) || 0);
  });
  for (var fallbackIndex = 0; fallbackIndex < fallbackRows.length; fallbackIndex++) {
    var fallbackRow = fallbackRows[fallbackIndex];
    rememberDesired(fallbackRow, Math.max(0, Number(fallbackRow.qualityBytes) || 0) + Math.max(0, Number(fallbackRow.qualityPendingBytes) || 0));
  }
  // Select the current root first, then its nearest rows, using both the row
  // count and byte pool. Existing low-priority textures never get to reserve
  // the whole pool ahead of a newly active line merely because they already
  // happen to be resident.
  for (var selectionIndex = 0; selectionIndex < candidates.length; selectionIndex++) {
    var selectionCandidate = candidates[selectionIndex];
    if (desiredRows.indexOf(selectionCandidate.row) >= 0) continue;
    if (desiredRows.length >= maxRows) break;
    var selectionBytes = selectionCandidate.targetInfo.metrics.bytes;
    var nextLargestSelectionItem = Math.max(largestSelectionItem, selectionBytes);
    if (desiredProjectedBytes + selectionBytes > lyricQualityEffectiveBudgetBytes(tier, nextLargestSelectionItem)) continue;
    if (rememberDesired(selectionCandidate.row, selectionBytes)) largestSelectionItem = nextLargestSelectionItem;
  }
  var residentRows = lyricQualityState.residents.slice();
  for (var releaseIndex = 0; releaseIndex < residentRows.length; releaseIndex++) {
    var releaseRow = residentRows[releaseIndex];
    if (desiredRows.indexOf(releaseRow) < 0) releaseLyricRowQuality(releaseRow, true);
  }
  lyricQualityRecount();
  var buildCandidates = [];
  for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    var candidate = candidates[candidateIndex];
    var row = candidate.row;
    if (desiredRows.indexOf(row) < 0) continue;
    row.qualityWanted = true;
    row.qualityHotUntil = Math.max(Number(row.qualityHotUntil) || 0, now + candidate.hotMs);
    row.qualityLastUsedAt = now;
    var targetBytes = candidate.targetInfo.metrics.bytes;
    var desiredRowIndex = desiredRows.indexOf(row);
    var selectedProjectedBytes = desiredRowIndex >= 0 ? desiredRowProjectedBytes[desiredRowIndex] : targetBytes;
    var replacementProjectedPoolBytes = Math.max(0, desiredProjectedBytes - selectedProjectedBytes + targetBytes);
    row.qualitySelectionFrame = lyricQualityState.selectionFrame;
    row.qualityProjectedPoolBytes = replacementProjectedPoolBytes;
    row.qualityProjectedTier = tier;
    if (lyricQualityRowMatchesTarget(row, candidate.targetInfo)) continue;
    if (replacementProjectedPoolBytes > lyricQualityEffectiveBudgetBytes(tier, targetBytes)) continue;
    if (!candidate.buildDeferred) buildCandidates.push(candidate);
  }
  for (var desiredIndex = 0; desiredIndex < desiredRows.length; desiredIndex++) {
    var desiredRow = desiredRows[desiredIndex];
    if (!desiredRow) continue;
    desiredRow.qualityWanted = true;
    if (Number(desiredRow.qualityFallbackUntil) > now) desiredRow.qualityHotUntil = Math.max(Number(desiredRow.qualityHotUntil) || 0, Number(desiredRow.qualityFallbackUntil));
  }
  for (var buildIndex = 0; buildIndex < buildCandidates.length; buildIndex++) {
    var buildCandidate = buildCandidates[buildIndex];
    queueLyricRowQuality(buildCandidate.data, buildCandidate.row, buildCandidate.tier, buildCandidate.priority);
  }
  pruneLyricQualityQueue(now);
  commitDeferredLyricQualityRows();
  updateLyricQualityStats(tier);
}


function resetLyricRenderUploadFrameBudget(deferQualityFinalize) {
  lyricRenderUploadFrameBudget.frame += 1;
  lyricRenderUploadFrameBudget.remaining = 1;
  lyricRenderUploadFrameBudget.consumed = 0;
  beginLyricQualitySelectionFrame(deferQualityFinalize);
  if (typeof window !== 'undefined') {
    window.__mineradioLyricUploadBudgetStats = {
      frame: lyricRenderUploadFrameBudget.frame,
      consumed: 0,
      remaining: 1,
      maxConsumed: lyricRenderUploadFrameBudget.maxConsumed
    };
  }
}


function consumeLyricRenderUploadFrameBudget() {
  if (lyricRenderUploadFrameBudget.remaining <= 0) return false;
  lyricRenderUploadFrameBudget.remaining -= 1;
  lyricRenderUploadFrameBudget.consumed += 1;
  lyricRenderUploadFrameBudget.maxConsumed = Math.max(lyricRenderUploadFrameBudget.maxConsumed, lyricRenderUploadFrameBudget.consumed);
  if (typeof window !== 'undefined') {
    window.__mineradioLyricUploadBudgetStats = {
      frame: lyricRenderUploadFrameBudget.frame,
      consumed: lyricRenderUploadFrameBudget.consumed,
      remaining: lyricRenderUploadFrameBudget.remaining,
      maxConsumed: lyricRenderUploadFrameBudget.maxConsumed
    };
  }
  return true;
}
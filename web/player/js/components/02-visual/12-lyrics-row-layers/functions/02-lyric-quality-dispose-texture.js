'use strict';



function lyricQualityDisposeTexture(texture) {
  if (!texture) return;
  if (typeof disposeOwnedLyricTexture === 'function') disposeOwnedLyricTexture(texture);
  else if (!texture.userData || !texture.userData.__mineradioDisposed) {
    texture.userData = texture.userData || {};
    texture.userData.__mineradioDisposed = true;
    if (texture.dispose) texture.dispose();
  }
  if (texture.image && texture.image.tagName === 'CANVAS') {
    texture.image.width = 1;
    texture.image.height = 1;
  }
}


function lyricQualityResidentIndex(row) {
  return lyricQualityState.residents.indexOf(row);
}


function lyricQualityRememberRow(row) {
  if (row && lyricQualityResidentIndex(row) < 0) lyricQualityState.residents.push(row);
}


function lyricQualityForgetRow(row) {
  var index = lyricQualityResidentIndex(row);
  if (index >= 0) lyricQualityState.residents.splice(index, 1);
}


function lyricQualityOwnerActive(data, row) {
  return !!(
    data && data.__mineradioLyricQualityDisposed !== true &&
    Array.isArray(data.rowLayers) && (!row || data.rowLayers.indexOf(row) >= 0)
  );
}


function lyricQualityHasPendingTexture() {
  for (var i = 0; i < lyricQualityState.residents.length; i++) {
    if (lyricQualityState.residents[i] && lyricQualityState.residents[i].qualityPendingTexture) return true;
  }
  return false;
}


function lyricQualityCurrentMap(row) {
  return row && row.mat && row.mat.uniforms && row.mat.uniforms.uMap
    ? row.mat.uniforms.uMap.value
    : (row && row.mat ? row.mat.map : null);
}


function setLyricRowTextureMap(row, texture) {
  if (!row || !row.mat || !texture) return false;
  if (row.mat.uniforms && row.mat.uniforms.uMap) row.mat.uniforms.uMap.value = texture;
  else row.mat.map = texture;
  return true;
}


function lyricQualityRecount() {
  var bytes = 0;
  for (var i = lyricQualityState.residents.length - 1; i >= 0; i--) {
    var row = lyricQualityState.residents[i];
    if (!row || (!row.qualityTexture && !row.qualityPendingTexture)) {
      lyricQualityState.residents.splice(i, 1);
      continue;
    }
    bytes += Math.max(0, Number(row.qualityBytes) || 0) + Math.max(0, Number(row.qualityPendingBytes) || 0);
  }
  lyricQualityState.bytes = bytes;
  return bytes;
}


function updateLyricQualityStats(tier) {
  lyricQualityRecount();
  if (typeof window === 'undefined') return;
  var pending = 0;
  var targetWidth = 0;
  for (var i = 0; i < lyricQualityState.residents.length; i++) {
    var row = lyricQualityState.residents[i];
    if (row && row.qualityPendingTexture) pending += 1;
    var texture = row && (row.qualityPendingTexture || row.qualityTexture);
    if (texture && texture.image) targetWidth = Math.max(targetWidth, Number(texture.image.width) || 0);
  }
  window.__mineradioLyricQualityStats = {
    tier: clampRange(Math.round(Number(tier) || lyricTextureClarityScale()), 1, 4),
    bytes: lyricQualityState.bytes,
    budget: lyricQualityPoolBudgetBytes(tier || lyricTextureClarityScale()),
    rows: lyricQualityState.residents.length,
    pending: pending + lyricQualityState.queue.length,
    targetW: targetWidth,
    lastBuildMs: Math.round(lyricQualityState.lastBuildMs * 100) / 100
  };
}


function releaseLyricRowQuality(row, restoreBase) {
  if (!row) return;
  row.qualityGeneration = (Number(row.qualityGeneration) || 0) + 1;
  row.qualityQueuedKey = '';
  row.qualityPendingKey = '';
  if (restoreBase !== false && row.baseLineTexture && lyricQualityCurrentMap(row) !== row.baseLineTexture) {
    setLyricRowTextureMap(row, row.baseLineTexture);
  }
  var qualityTexture = row.qualityTexture;
  var pendingTexture = row.qualityPendingTexture;
  row.qualityTexture = null;
  row.qualityPendingTexture = null;
  row.qualityTier = 1;
  row.qualityPendingTier = 0;
  row.qualityRasterKey = '';
  row.qualityBytes = 0;
  row.qualityPendingBytes = 0;
  row.qualityWanted = false;
  row.qualityFallbackUntil = 0;
  row.qualitySelectionFrame = 0;
  row.qualityProjectedPoolBytes = 0;
  row.qualityProjectedTier = 0;
  lyricQualityForgetRow(row);
  if (qualityTexture && qualityTexture !== row.baseLineTexture) lyricQualityDisposeTexture(qualityTexture);
  if (pendingTexture && pendingTexture !== row.baseLineTexture && pendingTexture !== qualityTexture) lyricQualityDisposeTexture(pendingTexture);
  lyricQualityRecount();
}


function discardLyricRowPendingQuality(row) {
  if (!row) return;
  var pendingTexture = row.qualityPendingTexture;
  row.qualityPendingTexture = null;
  row.qualityPendingTier = 0;
  row.qualityPendingKey = '';
  row.qualityPendingBytes = 0;
  if (pendingTexture && pendingTexture !== row.baseLineTexture && pendingTexture !== row.qualityTexture) lyricQualityDisposeTexture(pendingTexture);
}


function invalidateLyricQualityTextures(reason, options) {
  options = options || {};
  var releaseCommitted = options.release === true || /clear-stage-lyrics|hard-release/i.test(String(reason || ''));
  lyricQualityState.generation += 1;
  if (lyricQualityState.timer) {
    clearTimeout(lyricQualityState.timer);
    lyricQualityState.timer = 0;
  }
  if (lyricQualityState.idle) {
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(lyricQualityState.idle);
    lyricQualityState.idle = 0;
  }
  for (var queuedIndex = 0; queuedIndex < lyricQualityState.queue.length; queuedIndex++) {
    var queuedRow = lyricQualityState.queue[queuedIndex] && lyricQualityState.queue[queuedIndex].row;
    if (!queuedRow) continue;
    queuedRow.qualityGeneration = (Number(queuedRow.qualityGeneration) || 0) + 1;
    queuedRow.qualityQueuedKey = '';
    queuedRow.qualityWanted = false;
  }
  lyricQualityState.queue.length = 0;
  var rows = lyricQualityState.residents.slice();
  var fallbackHotUntil = lyricQualityNowMs() + 3200;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row) continue;
    if (releaseCommitted) {
      releaseLyricRowQuality(row, true);
      continue;
    }
    // Keep the currently displayed quality texture as a visual fallback.
    // The new tier replaces it atomically after its own upload budget turn,
    // so changing quality or starting a track crossfade never flashes 1x.
    row.qualityGeneration = (Number(row.qualityGeneration) || 0) + 1;
    row.qualityQueuedKey = '';
    row.qualityWanted = !!row.qualityTexture;
    row.qualityHotUntil = Math.max(Number(row.qualityHotUntil) || 0, fallbackHotUntil);
    row.qualityFallbackUntil = Math.max(Number(row.qualityFallbackUntil) || 0, fallbackHotUntil);
    discardLyricRowPendingQuality(row);
    if (!row.qualityTexture) lyricQualityForgetRow(row);
  }
  lyricQualityRecount();
  if (releaseCommitted) {
    lyricQualityState.transitionBudgetUntil = 0;
    lyricQualityState.transitionBaseBytes = 0;
  } else {
    lyricQualityState.transitionBudgetUntil = fallbackHotUntil;
    lyricQualityState.transitionBaseBytes = lyricQualityState.bytes;
  }
  updateLyricQualityStats(lyricTextureClarityScale());
}


function lyricQualityInputPending() {
  var scheduling = typeof navigator !== 'undefined' && navigator.scheduling;
  return !!(scheduling && typeof scheduling.isInputPending === 'function' && scheduling.isInputPending());
}


function lyricQualityEffectiveBudgetBytes(tier, oneReplacementBytes) {
  var budget = lyricQualityPoolBudgetBytes(tier);
  var now = lyricQualityNowMs();
  if (Number(lyricQualityState.transitionBudgetUntil) > now) {
    budget = Math.max(budget, Math.max(0, Number(lyricQualityState.transitionBaseBytes) || 0) + Math.max(0, Number(oneReplacementBytes) || 0));
  } else if (lyricQualityState.transitionBudgetUntil) {
    lyricQualityState.transitionBudgetUntil = 0;
    lyricQualityState.transitionBaseBytes = 0;
  }
  return budget;
}


function lyricQualityEffectiveMaxRows() {
  return lyricQualityMaxResidentRows() + (Number(lyricQualityState.transitionBudgetUntil) > lyricQualityNowMs() ? 1 : 0);
}


function lyricQualityEnsureCapacity(extraBytes, pinnedRow, tier) {
  var budget = lyricQualityEffectiveBudgetBytes(tier, extraBytes);
  var maxRows = lyricQualityEffectiveMaxRows();
  lyricQualityRecount();
  if (!budget || extraBytes > budget) return false;
  // A quality build keeps the committed texture alive until the next upload
  // turn.  Permit that one atomic replacement even when an old 4x pool is
  // temporarily larger than the new 2x/3x pool, but never let a second
  // pending texture accumulate behind it.
  if (lyricQualityHasPendingTexture()) return false;
  var now = lyricQualityNowMs();
  var pinnedResident = lyricQualityResidentIndex(pinnedRow) >= 0;
  var atomicReplacement = !!(
    pinnedResident && pinnedRow && pinnedRow.qualityTexture &&
    Number(pinnedRow.qualitySelectionFrame) === lyricQualityState.selectionFrame &&
    Number(pinnedRow.qualityProjectedTier) === Number(tier) &&
    Number(pinnedRow.qualityProjectedPoolBytes) > 0
  );
  var candidates = lyricQualityState.residents.filter(function (row) {
    return row && row !== pinnedRow && row.qualityWanted !== true && Number(row.qualityFallbackUntil) <= now;
  });
  candidates.sort(function (a, b) {
    return (Number(a.qualityLastUsedAt) || 0) - (Number(b.qualityLastUsedAt) || 0);
  });
  while ((lyricQualityState.bytes + extraBytes > budget || (!pinnedResident && lyricQualityState.residents.length >= maxRows)) && candidates.length) {
    releaseLyricRowQuality(candidates.shift(), true);
  }
  lyricQualityRecount();
  if (atomicReplacement) {
    return pinnedResident && Number(pinnedRow.qualityProjectedPoolBytes) <= budget;
  }
  return lyricQualityState.bytes + extraBytes <= budget && (pinnedResident || lyricQualityState.residents.length < maxRows);
}


function scheduleLyricQualityBuild(delay) {
  if (lyricQualityState.timer || lyricQualityState.idle || !lyricQualityState.queue.length) return;
  if (delay > 0) {
    lyricQualityState.timer = setTimeout(function () {
      lyricQualityState.timer = 0;
      scheduleLyricQualityBuild(0);
    }, delay);
    return;
  }
  var run = function (deadline) {
    lyricQualityState.idle = 0;
    if (!lyricQualityState.queue.length) return;
    if ((typeof isProgressDragPreviewActive === 'function' && isProgressDragPreviewActive()) || lyricQualityInputPending()) {
      scheduleLyricQualityBuild(72);
      return;
    }
    if (deadline && !deadline.didTimeout && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 5) {
      scheduleLyricQualityBuild(24);
      return;
    }
    lyricQualityState.queue.sort(function (a, b) { return a.priority - b.priority; });
    var job = lyricQualityState.queue.shift();
    var row = job && job.row;
    var now = lyricQualityNowMs();
    if (!row || job.globalGeneration !== lyricQualityState.generation || job.rowGeneration !== row.qualityGeneration || row.qualityQueuedKey !== job.key || row.qualityWanted !== true || Number(row.qualityHotUntil) <= now || !lyricQualityOwnerActive(job.data, row)) {
      if (row && row.qualityQueuedKey === (job && job.key)) row.qualityQueuedKey = '';
      scheduleLyricQualityBuild(0);
      return;
    }
    row.qualityQueuedKey = '';
    // Capacity is checked before the expensive canvas render. Hot rows are
    // never evicted merely to satisfy another hot row; when two lyric roots
    // briefly overlap, the newcomer waits instead of causing build/dispose
    // oscillation every frame.
    if (!lyricQualityEnsureCapacity(job.bytes, row, job.tier)) {
      scheduleLyricQualityBuild(0);
      return;
    }
    var startedAt = lyricQualityNowMs();
    var built = makeLyricQualityTexture(row.lineMask, job.tier);
    lyricQualityState.lastBuildMs = lyricQualityNowMs() - startedAt;
    if (!built || job.globalGeneration !== lyricQualityState.generation || job.rowGeneration !== row.qualityGeneration || row.qualityWanted !== true || Number(row.qualityHotUntil) <= lyricQualityNowMs() || !lyricQualityOwnerActive(job.data, row)) {
      if (built && built.texture) lyricQualityDisposeTexture(built.texture);
      scheduleLyricQualityBuild(0);
      return;
    }
    if (!lyricQualityEnsureCapacity(built.bytes, row, job.tier)) {
      lyricQualityDisposeTexture(built.texture);
      scheduleLyricQualityBuild(48);
      return;
    }
    if (row.qualityPendingTexture && row.qualityPendingTexture !== row.qualityTexture) lyricQualityDisposeTexture(row.qualityPendingTexture);
    row.qualityPendingTexture = built.texture;
    row.qualityPendingTier = built.tier;
    row.qualityPendingKey = built.key;
    row.qualityPendingBytes = built.bytes;
    row.qualityLastUsedAt = lyricQualityNowMs();
    lyricQualityRememberRow(row);
    updateLyricQualityStats(job.tier);
    scheduleLyricQualityBuild(0);
  };
  if (typeof requestIdleCallback === 'function') {
    lyricQualityState.idle = requestIdleCallback(run, { timeout: 180 });
  } else {
    lyricQualityState.timer = setTimeout(function () {
      lyricQualityState.timer = 0;
      run({ didTimeout: true, timeRemaining: function () { return 8; } });
    }, 18);
  }
}


function queueLyricRowQuality(data, row, tier, priority) {
  if (!lyricQualityOwnerActive(data, row) || !row.lineMask || tier <= 1 || row.qualityWanted !== true || Number(row.qualityHotUntil) <= lyricQualityNowMs()) return;
  var target = lyricQualityTargetMetrics(row.lineMask, tier);
  if (!target) return;
  var key = target.tier + 'x|' + target.width + 'x' + target.height + '|' + (Number(row.lineMask.stoneSeed) || 0);
  if ((row.qualityTexture && row.qualityTier === tier && row.qualityRasterKey === key) || (row.qualityPendingTexture && row.qualityPendingTier === tier && row.qualityPendingKey === key) || row.qualityQueuedKey === key) return;
  row.qualityGeneration = (Number(row.qualityGeneration) || 0) + 1;
  row.qualityQueuedKey = key;
  lyricQualityState.queue.push({
    data: data,
    row: row,
    tier: tier,
    key: key,
    priority: Number(priority) || 50,
    bytes: target.bytes,
    rowGeneration: row.qualityGeneration,
    globalGeneration: lyricQualityState.generation
  });
  scheduleLyricQualityBuild(0);
}


function pruneLyricQualityQueue(now) {
  now = Number(now) || lyricQualityNowMs();
  if (!lyricQualityState.queue.length) return;
  lyricQualityState.queue = lyricQualityState.queue.filter(function (job) {
    var row = job && job.row;
    var valid = !!(row && job.globalGeneration === lyricQualityState.generation && job.rowGeneration === row.qualityGeneration && row.qualityQueuedKey === job.key && row.qualityWanted === true && Number(row.qualityHotUntil) > now && lyricQualityOwnerActive(job.data, row));
    if (!valid && row && row.qualityQueuedKey === (job && job.key)) row.qualityQueuedKey = '';
    return valid;
  });
}


function disposeLyricQualityOwner(data) {
  if (!data) return;
  data.__mineradioLyricQualityDisposed = true;
  var rows = Array.isArray(data.rowLayers) ? data.rowLayers.slice() : [];
  lyricQualityState.frameCandidates = lyricQualityState.frameCandidates.filter(function (candidate) {
    return candidate && candidate.data !== data && rows.indexOf(candidate.row) < 0;
  });
  lyricQualityState.frameCommits = lyricQualityState.frameCommits.filter(function (candidate) {
    return candidate && candidate.data !== data && rows.indexOf(candidate.row) < 0;
  });
  lyricQualityState.queue = lyricQualityState.queue.filter(function (job) {
    var remove = !!(job && (job.data === data || rows.indexOf(job.row) >= 0));
    if (remove && job.row && job.row.qualityQueuedKey === job.key) job.row.qualityQueuedKey = '';
    return !remove;
  });
  for (var i = 0; i < rows.length; i++) releaseLyricRowQuality(rows[i], true);
  pruneLyricQualityQueue(lyricQualityNowMs());
  updateLyricQualityStats(lyricTextureClarityScale());
}
'use strict';


function buildStageLyricDisplayPayload(index, options) {
  options = options || {};
  var mode = normalizeLyricDisplayMode(fx && fx.lyricDisplayMode);
  var current = stageLyricContextEntry(index, index);
  if (!current) return null;
  if (mode === 'single') {
    var singleTrack = stageLyricSingleLineTrackStub(index);
    var singleTranslated = applyLyricTranslationModeToEntries([current], 0);
    return {
      mode: mode,
      key: 'single|' + index + '|' + singleTranslated.entries.map(function (entry) { return entry.role + ':' + entry.text; }).join('\n'),
      activeLine: singleTranslated.activeLine,
      entries: singleTranslated.entries,
      trackIndex: index,
      trackKey: '',
      trackEntries: singleTrack.entries,
      trackStart: singleTrack.start,
      trackEnd: singleTrack.end,
      trackLightweight: false
    };
  }
  var track = options.lightweightTrack
    ? buildStageLyricMeshTrackEntries(index, mode, options)
    : buildStageLyricTrackEntries(index, mode);
  var offsets = lyricDisplayOffsetsForMode(mode);
  var entries = [];
  var activeLine = 0;
  for (var i = 0; i < offsets.length; i++) {
    var offset = offsets[i];
    var entry = stageLyricContextEntry(index + offset, index);
    if (!entry) continue;
    if (offset === 0) activeLine = entries.length;
    entries.push(entry);
  }
  if (mode === 'dual' && entries.length < 2) {
    var prev = stageLyricContextEntry(index - 1, index);
    if (prev) {
      entries.unshift(prev);
      activeLine += 1;
    }
  }
  if (!entries.length) entries = [current];
  activeLine = Math.max(0, Math.min(entries.length - 1, activeLine));
  var translated = applyLyricTranslationModeToEntries(entries, activeLine, entries.length * 2 + 2);
  entries = translated.entries;
  activeLine = translated.activeLine;
  return {
    mode: mode,
    key: mode + '|' + index + '|' + activeLine + '|' + entries.map(function (entry) { return entry.role + ':' + entry.text; }).join('\n'),
    activeLine: activeLine,
    entries: entries,
    trackIndex: index,
    trackKey: stageLyricTrackKeyForMode(mode),
    trackEntries: track.entries,
    trackStart: track.start,
    trackEnd: track.end,
    trackLightweight: !!track.lightweight
  };
}

function buildStageLyricPlaybackPayload(index) {
  var needsFirstLineTakeover = stageLyrics && stageLyrics.currentIdx < 0;
  var multiLineWarmup = stageLyricMultiLineWarmupLoad();
  var shouldStartLightweight = needsFirstLineTakeover && multiLineWarmup;
  if (multiLineWarmup) {
    var currentData = stageLyrics && stageLyrics.current && stageLyrics.current.userData && stageLyrics.current.userData.lyric;
    var currentIsLightweight = !!(currentData && currentData.trackLightweight);
    var lightweightPayload = buildStageLyricDisplayPayload(index, { lightweightTrack: true });
    if (needsFirstLineTakeover && (shouldStartLightweight || stageLyricPrewarmCanServePayload(lightweightPayload))) return lightweightPayload;
    if (currentIsLightweight && lightweightPayload && stageLyricMeshCanServePayload(stageLyrics.current, lightweightPayload)) return lightweightPayload;
    var fullPayload = buildStageLyricDisplayPayload(index);
    if (currentIsLightweight && fullPayload && !stageLyricPrewarmCanServePayload(fullPayload) && lightweightPayload) return lightweightPayload;
    return fullPayload;
  }
  return buildStageLyricDisplayPayload(index);
}


function findStageLyricIndexAtTime(t) {
  if (!lyricsLines || !lyricsLines.length) return -1;
  var target = (Number(t) || 0) + 0.05;
  var lo = 0;
  var hi = lyricsLines.length - 1;
  var ans = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    var lineTime = Number(lyricsLines[mid] && lyricsLines[mid].t) || 0;
    if (lineTime <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}


function retireCurrentStageLyricForIdle() {
  if (stageLyrics.current) {
    stageLyrics.current.userData.state = 'out';
    stageLyrics.current.userData.age = 0;
    stageLyrics.outgoing.push(stageLyrics.current);
    stageLyrics.current = null;
    stageLyrics.currentIdx = -1;
    stageLyrics.currentText = '';
    stageLyrics.currentDisplayKey = '';
    stageLyrics.currentPayload = null;
  }
}


function resetStageLyricResumeFrameGates() {
  var now = stageLyricNowMs();
  if (typeof resetFrameGate === 'function' && typeof mainFrameGates !== 'undefined' && mainFrameGates) {
    resetFrameGate(mainFrameGates.lyricsParticles, now);
    resetFrameGate(mainFrameGates.stageLyrics, now);
  }
}


function markStageLyricsPlaybackResume(reason) {
  reason = reason || 'playback-resume';
  stageLyricTrackSwitchBootstrapUntil = 0;
  if (stageLyrics.current && stageLyrics.current.userData) {
    stageLyrics.current.userData.state = 'in';
    stageLyrics.current.userData.age = Math.max(Number(stageLyrics.current.userData.age) || 0, 0.18);
  }
  stageLyrics.lastPlaybackResumeReason = reason;
  var canResumeWithoutWarmup = stageLyricCurrentCanResumeWithoutWarmup();
  var currentIsLightweight = stageLyricCurrentUsesLightweightTrack();
  var now = stageLyricNowMs();
  var idx = stageLyrics && stageLyrics.currentIdx >= 0 ? stageLyrics.currentIdx : chooseStageLyricPrewarmIndex();
  var repeatedResume = idx >= 0 && idx === stageLyricResumeWarmupLastIndex && now - stageLyricResumeWarmupLastAt < 760;
  stageLyricResumeWarmupLastAt = now;
  stageLyricResumeWarmupLastIndex = idx;
  if (canResumeWithoutWarmup) {
    resetStageLyricResumeFrameGates();
    return;
  }
  if (currentIsLightweight) {
    stageLyricResumeUpgradeDeferUntil = Math.max(Number(stageLyricResumeUpgradeDeferUntil) || 0, now + 520);
    if (!repeatedResume) requestStageLyricLightweightUpgrade(reason, 520);
  } else if (!repeatedResume) {
    // Media event names (play/playing) are not prewarm strategy names. A missing
    // visible lyric must recover its small current window before a full track.
    ensureStageLyricPlaybackWarmup('playback-resume', 16);
  }
  scheduleStageLyricSingleLineBootstrapPrewarm(reason || 'playback-resume', 24);
  resetStageLyricResumeFrameGates();
}


function tickLyricsParticles() {
  if (typeof playbackLyricsAreLoading === 'function' && playbackLyricsAreLoading()) return;
  if (!fx.particleLyrics) {
    if (stageLyrics.current || stageLyrics.currentText || (stageLyrics.outgoing && stageLyrics.outgoing.length)) clearStageLyrics();
    return;
  }
  var previewingSeek = stageLyricProgressPreviewActive();
  var holdLyricsOnPause = !fx || fx.lyricPauseHold !== false;
  var pausedWithTrack = !!(holdLyricsOnPause && audio && audio.src && audio.paused && !audio.ended && lyricsLines && lyricsLines.length);
  var mediaIsPlaying = !!(audio && audio.src && !audio.paused && !audio.ended && !audio.error);
  if (!audio || !lyricsLines.length || (audio && audio.ended)) {
    retireCurrentStageLyricForIdle();
    return;
  }
  if (!playing && !previewingSeek) {
    if (pausedWithTrack) {
      if (stageLyrics.current && stageLyrics.current.userData) {
        stageLyrics.current.userData.state = 'in';
        stageLyrics.current.userData.age = Math.max(Number(stageLyrics.current.userData.age) || 0, 0.18);
        return;
      }
      // A held pause may have no mesh yet (a late lyric response or an earlier
      // interrupted resume). Continue below to restore the current frozen line.
    } else if (!mediaIsPlaying) {
      retireCurrentStageLyricForIdle();
      return;
    }
  }
  var t = stageLyricPlaybackSeconds();
  var lyricT = typeof getAdjustedLyricPlaybackTime === 'function' ? getAdjustedLyricPlaybackTime(t) : t;
  var newIdx = findStageLyricIndexAtTime(lyricT);
  if (newIdx < 0) {
    var introText = currentLyricFallbackText();
    if (!introText) {
      clearStageLyrics();
      return;
    }
    if (stageLyrics.currentIdx !== -2 || stageLyrics.currentText !== introText) {
      stageLyrics.currentIdx = -2;
      stageLyrics.transitionLineStep = 0;
      if (previewingSeek && stageLyrics.current) {
        if (lyricsLines && lyricsLines.length) {
          requestStageLyricWarmup('intro-first-line', 100);
          scheduleStageLyricPrewarmForIndex(0, 'intro-first-line', 24);
        }
        return;
      }
      showStageLine(introText);
      if (lyricsLines && lyricsLines.length) {
        requestStageLyricWarmup('intro-first-line', 140);
        scheduleStageLyricPrewarmForIndex(0, 'intro-first-line', 24);
        if (typeof scheduleStageLyricFullTrackWarmup === 'function') scheduleStageLyricFullTrackWarmup('track-ready', 180);
      }
    }
    if (stageLyrics.current) {
      var firstLine = lyricsLines[0];
      var introEnd = firstLine && firstLine.t > 0 ? firstLine.t : Math.min((audio && audio.duration) || 4.8, 4.8);
      var introLine = { t: 0, text: introText, duration: Math.max(0.8, introEnd), charCount: Math.max(1, introText.length), fallback: true };
      updateLyricMeshProgress(stageLyrics.current, getLyricLineProgress(introLine, null, lyricT));
    }
    return;
  }
  if ((stageLyrics.currentIdx < 0 || !stageLyrics.current) && stageLyricWarmupPending()) {
    return;
  }
  var displayPayload = null;
  if (newIdx === stageLyrics.currentIdx && stageLyrics.current && stageLyrics.currentPayload) {
    displayPayload = stageLyrics.currentPayload;
    upgradeCurrentStageLyricFromPreparedTrack('same-line-upgrade');
  } else {
    displayPayload = buildStageLyricPlaybackPayload(newIdx);
  }
  if (!displayPayload) {
    clearStageLyrics();
    return;
  }
  var displayedNewLine = false;
  if (newIdx !== stageLyrics.currentIdx || stageLyrics.currentDisplayKey !== displayPayload.key) {
    stageLyrics.transitionLineStep = stageLyrics.currentIdx >= 0 && newIdx >= 0
      ? clampRange(newIdx - stageLyrics.currentIdx, -2, 2)
      : 0;
    var displayed = showStageLine(displayPayload, false, { noSyncBuild: true });
    if (!displayed && displayPayload && !displayPayload.trackLightweight && stageLyricMultiLineWarmupLoad()) {
      requestStageLyricDemandPrewarm(displayPayload);
      var lightweightFallback = buildStageLyricDisplayPayload(newIdx, { lightweightTrack: true });
      if (lightweightFallback) {
        displayed = showStageLine(lightweightFallback, false, { noSyncBuild: true });
        if (displayed) {
          displayPayload = lightweightFallback;
          if (typeof scheduleStageLyricFullTrackWarmup === 'function') scheduleStageLyricFullTrackWarmup('lightweight-upgrade', 96);
        }
      }
    }
    if (!displayed) {
      requestStageLyricDemandPrewarm(displayPayload);
      return;
    }
    if (displayPayload.trackLightweight && typeof scheduleStageLyricFullTrackWarmup === 'function') {
      scheduleStageLyricFullTrackWarmup('lightweight-upgrade', 96);
    }
    stageLyrics.currentIdx = newIdx;
    displayedNewLine = true;
  }
  if (stageLyrics.current) {
    var curLine = lyricsLines[newIdx] || { t: lyricT };
    var nextLine = lyricsLines[newIdx + 1];
    var progress = getLyricLineProgress(curLine, nextLine, lyricT);
    updateLyricMeshProgress(stageLyrics.current, progress, { nativeKaraoke: lyricLineHasNativeKaraoke(curLine) });
    if (stageLyricPayloadIsSingleLine(displayPayload) && (displayedNewLine || progress > 0.35)) {
      scheduleStageLyricSingleLineNextPrewarm(newIdx, lyricT, displayedNewLine ? 'single-line-next' : 'single-line-tail');
    }
  }
}


function disposeLyricsParticles() {
  clearStageLyrics();
  if (stageLyrics.starRiver) {
    if (stageLyrics.starRiver.parent) stageLyrics.starRiver.parent.remove(stageLyrics.starRiver);
    if (stageLyrics.starRiver.geometry) stageLyrics.starRiver.geometry.dispose();
    if (stageLyrics.starRiver.material) stageLyrics.starRiver.material.dispose();
    stageLyrics.starRiver = null;
  }
  if (stageLyrics.group) {
    scene.remove(stageLyrics.group);
    stageLyrics.group = null;
  }
}

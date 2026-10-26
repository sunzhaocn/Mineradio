'use strict';

// ============================================================
function audioGraphHealthy() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.atStartup) return !!audio;
  return !!(audio && audioReady && audioCtx && audioCtx.state !== 'closed' && source && audioSourceMedia === audio && analyser && beatAnalyser && (gainNode || analysisSinkNode));
}

function disconnectAudioGraphNodes(keepSource) {
  [source, analyser, beatAnalyser, gainNode, analysisSinkNode].forEach(function (node) {
    if (!node) return;
    try { node.disconnect(); } catch (e) { }
  });
  if (!keepSource) {
    source = null;
    audioSourceMedia = null;
  }
  analyser = null;
  beatAnalyser = null;
  gainNode = null;
  analysisSinkNode = null;
  audioReady = false;
}

function restoreMediaTimeWhenReady(media, seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  if (!media || !seconds) return;
  function applyTime() {
    try {
      if (media.duration && isFinite(media.duration)) media.currentTime = Math.min(seconds, Math.max(0, media.duration - 0.25));
      else media.currentTime = seconds;
    } catch (e) { }
  }
  applyTime();
  media.addEventListener('loadedmetadata', applyTime, { once: true });
}

function replaceAudioElementForGraphRecovery(reason, opts) {
  if (!audio) return false;
  opts = opts || {};
  var preservePlayback = opts.preservePlayback !== false;
  var oldAudio = audio;
  var src = preservePlayback ? (oldAudio.currentSrc || oldAudio.src || '') : '';
  var seconds = preservePlayback && isFinite(oldAudio.currentTime) ? oldAudio.currentTime : 0;
  var wasPaused = oldAudio.paused;
  var rate = oldAudio.playbackRate || 1;
  var endedHandler = preservePlayback ? oldAudio.onended : null;
  var metadataHandler = preservePlayback ? oldAudio.onloadedmetadata : null;
  var queueItemKey = oldAudio.__mineradioQueueItemKey;
  try { oldAudio.pause(); } catch (e) { }
  disconnectAudioGraphNodes(false);
  try {
    if (audioCtx && audioCtx.state !== 'closed' && audioCtx.close) audioCtx.close().catch(function () { });
  } catch (e) { }
  audioCtx = null;
  audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.preload = oldAudio.preload || 'auto';
  audio.loop = !!oldAudio.loop || (typeof playMode !== 'undefined' && playMode === 'single');
  audio.playbackRate = rate;
  audio.onended = endedHandler;
  audio.onloadedmetadata = metadataHandler;
  audio.__mineradioQueueItemKey = queueItemKey;
  bindPlaybackProgressEvents(audio);
  applyVolumeToAudio();
  if (src) {
    audio.src = src;
    restoreMediaTimeWhenReady(audio, seconds);
    if (!wasPaused) {
      try { audio.load(); } catch (e) { }
    }
  }
  applyAudioOutputDevice(audio);
  console.warn('audio graph recovery:', reason || 'unknown');
  return true;
}

function resetPlaybackAudioGraphForSourceSwitch(reason) {
  if (!audio) return;
  var preparedGraph = audio.__mineradioPreparedAudioGraph;
  var previousSourceMedia = audioSourceMedia;
  var sourceUsesCapture = !!(source && source.__mineradioUsesCapture);
  var mediaElementChanged = !!(source && previousSourceMedia && previousSourceMedia !== audio);
  // Chromium can permanently freeze the media clock when an element that was
  // once bound to MediaElementSource is later kept on captureStream across a
  // src change. Replace it before the caller assigns the next track so the new
  // Audio can establish one clean lifetime MediaElementSource binding.
  if (sourceUsesCapture && previousSourceMedia === audio) {
    replaceAudioElementForGraphRecovery(reason || 'capture-track-switch', { preservePlayback: false });
    return;
  }
  disconnectAudioGraphNodes(!sourceUsesCapture && !mediaElementChanged);
  if (
    preparedGraph
    && preparedGraph.context
    && preparedGraph.context.state !== 'closed'
    && preparedGraph.source
    && preparedGraph.analyser
    && preparedGraph.beatAnalyser
    && preparedGraph.gainNode
  ) {
    audioCtx = preparedGraph.context;
    source = preparedGraph.source;
    analyser = preparedGraph.analyser;
    beatAnalyser = preparedGraph.beatAnalyser;
    gainNode = preparedGraph.gainNode;
    analysisSinkNode = null;
    audioSourceMedia = audio;
    audio.__mineradioMediaSourceBound = true;
    preparedGraph.adopted = true;
    audioReady = true;
  }
}

function initAudio() {
  // A phone uses the media element's native audio output; no FFT graph is
  // needed when the visual runtime was never started for this page.
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.atStartup) return !!audio;
  if (!audio) return false;
  if (audioGraphHealthy()) return true;
  var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return false;
  if (audioCtx && audioCtx.state === 'closed') replaceAudioElementForGraphRecovery('closed-context');
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContextCtor();
  var keepSource = !!(source && audioSourceMedia === audio && source.context === audioCtx && audioCtx.state !== 'closed');
  var sourceUsesCapture = !!(keepSource && source.__mineradioUsesCapture);
  disconnectAudioGraphNodes(keepSource);
  if (!source) {
    var forceCapture = !!audio.__mineradioForceCaptureSource;
    // Once this Audio element has fallen back from its lifetime-bound
    // MediaElementSource, every later graph rebuild for the same element must
    // stay on captureStream. Keep this marker through failed/overlapping init
    // attempts; clearing it before capture has an audio track reopens the
    // forbidden MediaElementSource rebind path on the next retry.
    var mediaSource = null;
    if (!forceCapture && !audio.__mineradioMediaSourceBound && audioCtx.createMediaElementSource) {
      try {
        mediaSource = audioCtx.createMediaElementSource(audio);
      } catch (mediaErr) {
        mediaSource = null;
        audio.__mineradioMediaSourceBound = true;
        console.warn('media element source unavailable:', mediaErr && (mediaErr.message || mediaErr));
      }
    }
    if (!forceCapture && !mediaSource && audio.__mineradioMediaSourceBound) {
      replaceAudioElementForGraphRecovery('media-source-rebind');
      if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContextCtor();
      try {
        mediaSource = audioCtx.createMediaElementSource(audio);
      } catch (rebindingErr) {
        mediaSource = null;
        console.warn('media element source recovery failed:', rebindingErr && (rebindingErr.message || rebindingErr));
      }
    }
    var capturedStream = null;
    if (!mediaSource) {
      // Calling captureStream() while a freshly assigned src still has no
      // decoded media data can permanently leave Chromium with an empty audio
      // track and a frozen media clock. The track-switch retry path will call
      // initAudio() again after loadeddata/canplay, so wait instead of probing
      // an empty stream here.
      if (forceCapture && Number(audio.readyState) < 2) return false;
      try {
        if (audio && audio.captureStream && audioCtx.createMediaStreamSource) capturedStream = audio.captureStream();
      } catch (captureErr) {
        capturedStream = null;
        console.warn('capture stream source unavailable:', captureErr && (captureErr.message || captureErr));
      }
    }
    if (!mediaSource && !capturedStream) return false;
    try {
      source = mediaSource || audioCtx.createMediaStreamSource(capturedStream);
    } catch (captureSourceErr) {
      source = null;
      audioSourceMedia = null;
      console.warn('capture stream graph unavailable:', captureSourceErr && (captureSourceErr.message || captureSourceErr));
      return false;
    }
    source.__mineradioUsesCapture = !mediaSource;
    audioSourceMedia = audio;
    // This is a lifetime marker, not the type of the current graph source.
    // Never reset it merely because the active fallback happens to be capture.
    if (mediaSource) audio.__mineradioMediaSourceBound = true;
    sourceUsesCapture = !mediaSource;
  }
  analyser = audioCtx.createAnalyser();
  beatAnalyser = audioCtx.createAnalyser();
  gainNode = sourceUsesCapture ? null : audioCtx.createGain();
  analysisSinkNode = sourceUsesCapture ? audioCtx.createGain() : null;
  if (analysisSinkNode) analysisSinkNode.gain.value = 0;
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.58;
  beatAnalyser.fftSize = BEAT_FFT_SIZE;
  beatAnalyser.smoothingTimeConstant = 0.10;
  source.connect(analyser);
  source.connect(beatAnalyser);
  if (gainNode) {
    analyser.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  } else if (analysisSinkNode) {
    analyser.connect(analysisSinkNode);
    analysisSinkNode.connect(audioCtx.destination);
  }
  applyVolumeToAudio();
  frequencyData.fill(0);
  beatFrequencyData.fill(0);
  beatTimeDomainData.fill(128);
  resetRealtimeBeatEngine();
  audioReady = true;
  applyAudioOutputDevice(audio);
  return true;
}

function readPlaybackAnalyserSignal() {
  if (!analyser) return 0;
  try {
    analyser.getByteTimeDomainData(timeDomainData);
    analyser.getByteFrequencyData(frequencyData);
    var timeSum = 0;
    var freqSum = 0;
    var step = Math.max(1, Math.floor(timeDomainData.length / 256));
    for (var i = 0; i < timeDomainData.length; i += step) timeSum += Math.abs(timeDomainData[i] - 128);
    var freqStep = Math.max(1, Math.floor(frequencyData.length / 256));
    for (var j = 0; j < frequencyData.length; j += freqStep) freqSum += frequencyData[j];
    return (timeSum / Math.max(1, Math.ceil(timeDomainData.length / step)) / 128) + (freqSum / Math.max(1, Math.ceil(frequencyData.length / freqStep)) / 255);
  } catch (e) {
    return 0;
  }
}

function rebuildPlaybackGraphWithCapture(reason) {
  if (!audio || !audio.captureStream || !audioCtx || !audioCtx.createMediaStreamSource) return false;
  // Chromium freezes playback if an element is moved from its lifetime-bound
  // MediaElementSource to captureStream. Reconnect the existing source node
  // instead; a silent analyser must never be repaired by sacrificing the media
  // clock. Fresh, never-bound elements may still use capture as a fallback.
  if (audio.__mineradioMediaSourceBound) {
    if (!source || source.__mineradioUsesCapture || audioSourceMedia !== audio) return false;
    disconnectAudioGraphNodes(true);
    var reused = initAudio();
    if (reused) console.warn('audio analyser reconnected with lifetime media source:', reason || 'silent-graph');
    return reused;
  }
  disconnectAudioGraphNodes(false);
  audio.__mineradioForceCaptureSource = true;
  var ok = initAudio();
  if (ok) console.warn('audio analyser recovered with capture stream:', reason || 'silent-graph');
  return ok;
}

function schedulePlaybackAnalyserRecovery(reason) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.atStartup) return;
  var serial = ++playbackAnalyserRecoverySerial;
  var token = trackSwitchToken;
  var recoveryMedia = audio;
  var recoverySrc = recoveryMedia && (recoveryMedia.currentSrc || recoveryMedia.src || '');
  var previousMediaTime = recoveryMedia && isFinite(recoveryMedia.currentTime) ? recoveryMedia.currentTime : 0;
  var advancingSilentSamples = 0;
  [720, 1600, 2800].forEach(function (delay) {
    setTimeout(function () {
      if (serial !== playbackAnalyserRecoverySerial || token !== trackSwitchToken) return;
      if (!audio || audio !== recoveryMedia || audio.paused || audio.ended || !audio.src) return;
      if ((audio.currentSrc || audio.src || '') !== recoverySrc) return;
      if (!audioReady || !analyser || !source) {
        ensurePlaybackAudioGraph('analyser-health-missing-' + (reason || 'playback'));
        return;
      }
      var current = isFinite(audio.currentTime) ? audio.currentTime : 0;
      var mediaClockAdvanced = current >= previousMediaTime + 0.08;
      previousMediaTime = current;
      if (current < 0.45 || !mediaClockAdvanced) {
        advancingSilentSamples = 0;
        return;
      }
      var signal = readPlaybackAnalyserSignal();
      if (signal > 0.0025) {
        advancingSilentSamples = 0;
        return;
      }
      advancingSilentSamples++;
      // A single zero-energy sample during decoder startup is not enough to
      // rebuild the graph. Require the media clock to advance across samples;
      // a frozen clock is a media stall and must never be treated as a silent
      // analyser graph.
      if (advancingSilentSamples < 2) return;
      if (source && !source.__mineradioUsesCapture && audio.captureStream) {
        rebuildPlaybackGraphWithCapture(reason || 'silent-after-track-switch');
        ensurePlaybackAudioGraph('analyser-health-capture-' + (reason || 'playback'));
      }
    }, delay);
  });
}

function resumeAudioAnalysis() {
  if (audioCtx && audioCtx.state === 'closed') {
    replaceAudioElementForGraphRecovery('resume-closed-context');
    initAudio();
  }
  if (audioCtx && audioCtx.state === 'suspended') return audioCtx.resume().catch(function (e) { console.warn('audio context resume failed:', e); });
  return Promise.resolve();
}

async function ensurePlaybackAudioGraph(reason) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.atStartup) return !!audio;
  if (!audio) return false;
  if (!audioGraphHealthy()) initAudio();
  await resumeAudioAnalysis();
  if (!audioGraphHealthy()) initAudio();
  await resumeAudioAnalysis();
  if (!audioGraphHealthy()) console.warn('audio graph still unhealthy:', reason || 'playback');
  return audioGraphHealthy();
}


function ensureUiSfxContext() {
  var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!uiSfxCtx || uiSfxCtx.state === 'closed') uiSfxCtx = new AudioContextCtor();
  applyAudioOutputDevice(audio);
  if (uiSfxCtx.state === 'suspended' && uiSfxCtx.resume) uiSfxCtx.resume().catch(function () { });
  return uiSfxCtx;
}

'use strict';



function cuefieldTimelineExecution(pending) {
  var descriptor = cuefieldPendingDescriptor(pending);
  if (!pending || !descriptor) return null;
  if (window.CuefieldTimelineExecutor && typeof window.CuefieldTimelineExecutor.buildCuefieldTimelineExecution === 'function') {
    return window.CuefieldTimelineExecutor.buildCuefieldTimelineExecution({
      timeline: pending.timeline,
      entryTime: pending.entryTime,
      executionMode: pending.executionMode,
      targetVolume: targetVolume,
      mixStart: pending.mixStart,
      handoffAt: pending.handoffAt,
      audibleOverlap: pending.audibleOverlap,
      preRollDuration: pending.preRollDuration
    });
  }
  return { leadSec: 4, bStart: Math.max(0, Number(pending.entryTime) || 0), handoffDelayMs: 2600, actions: [] };
}


function cuefieldSetMediaTime(media, seconds) {
  if (!media) return;
  function setTime() {
    try { media.currentTime = Math.max(0, Number(seconds) || 0); } catch (_) { }
  }
  if (media.readyState >= 1) setTime();
  else media.addEventListener('loadedmetadata', setTime, { once: true });
}


function cuefieldCreatePreparedAudioGraph(media) {
  if (!media || media.__mineradioPreparedAudioGraph) return media && media.__mineradioPreparedAudioGraph || null;
  var graph = null;
  try {
    if ((!audioCtx || audioCtx.state === 'closed') && typeof initAudio === 'function') initAudio();
    if (!audioCtx || audioCtx.state === 'closed' || !audioCtx.createMediaElementSource) return null;
    graph = {
      context: audioCtx, source: null, filterNode: null, bassNode: null, midNode: null, highNode: null,
      analyser: null, beatAnalyser: null, gainNode: null, echoSendNode: null,
      echoDelayNode: null, echoFeedbackNode: null, echoWetNode: null, adopted: false
    };
    graph.source = audioCtx.createMediaElementSource(media);
    // A media element cannot be safely returned to direct-output mode after a
    // MediaElementSource has been created for it. Mark it immediately so a
    // later graph-construction failure can discard this element completely.
    media.__mineradioMediaSourceBound = true;
    graph.analyser = audioCtx.createAnalyser();
    graph.beatAnalyser = audioCtx.createAnalyser();
    graph.gainNode = audioCtx.createGain();
    graph.filterNode = audioCtx.createBiquadFilter();
    graph.filterNode.type = 'highpass';
    graph.filterNode.frequency.value = 20;
    graph.bassNode = audioCtx.createBiquadFilter();
    graph.bassNode.type = 'lowshelf';
    graph.bassNode.frequency.value = 180;
    graph.bassNode.gain.value = 0;
    graph.midNode = audioCtx.createBiquadFilter();
    graph.midNode.type = 'peaking';
    graph.midNode.frequency.value = 1200;
    graph.midNode.Q.value = 0.72;
    graph.midNode.gain.value = 0;
    graph.highNode = audioCtx.createBiquadFilter();
    graph.highNode.type = 'highshelf';
    graph.highNode.frequency.value = 5200;
    graph.highNode.gain.value = 0;
    if (audioCtx.createDelay) {
      graph.echoSendNode = audioCtx.createGain();
      graph.echoDelayNode = audioCtx.createDelay(2);
      graph.echoFeedbackNode = audioCtx.createGain();
      graph.echoWetNode = audioCtx.createGain();
      graph.echoSendNode.gain.value = 0;
      graph.echoFeedbackNode.gain.value = 0;
      graph.echoWetNode.gain.value = 0;
    }
    graph.analyser.fftSize = typeof FFT_SIZE !== 'undefined' ? FFT_SIZE : 2048;
    graph.analyser.smoothingTimeConstant = 0.58;
    graph.beatAnalyser.fftSize = typeof BEAT_FFT_SIZE !== 'undefined' ? BEAT_FFT_SIZE : 1024;
    graph.beatAnalyser.smoothingTimeConstant = 0.10;
    graph.gainNode.gain.value = 0;
    graph.source.connect(graph.filterNode);
    graph.filterNode.connect(graph.bassNode);
    graph.bassNode.connect(graph.midNode);
    graph.midNode.connect(graph.highNode);
    graph.highNode.connect(graph.analyser);
    graph.source.connect(graph.beatAnalyser);
    graph.analyser.connect(graph.gainNode);
    graph.gainNode.connect(audioCtx.destination);
    if (graph.echoSendNode) {
      graph.highNode.connect(graph.echoSendNode);
      graph.echoSendNode.connect(graph.echoDelayNode);
      graph.echoDelayNode.connect(graph.echoFeedbackNode);
      graph.echoFeedbackNode.connect(graph.echoDelayNode);
      graph.echoDelayNode.connect(graph.echoWetNode);
      graph.echoWetNode.connect(audioCtx.destination);
    }
    media.__mineradioPreparedAudioGraph = graph;
    return graph;
  } catch (error) {
    if (graph) {
      [graph.source, graph.filterNode, graph.bassNode, graph.midNode, graph.highNode,
        graph.analyser, graph.beatAnalyser, graph.gainNode, graph.echoSendNode,
        graph.echoDelayNode, graph.echoFeedbackNode, graph.echoWetNode].forEach(function (node) {
        try { if (node) node.disconnect(); } catch (_) { }
      });
    }
    if (media && media.__mineradioMediaSourceBound) media.__mineradioPreparedGraphFailed = true;
    try { delete media.__mineradioPreparedAudioGraph; } catch (_) { }
    console.warn('[CuefieldAutoMix] prepared audio graph fallback:', error && error.message || error);
    return null;
  }
}


function cuefieldWriteIncomingGain(media, value) {
  value = Math.max(0, Math.min(1, Number(value) || 0));
  var graph = media && media.__mineradioPreparedAudioGraph;
  if (graph && graph.gainNode) {
    try { graph.gainNode.gain.value = value; } catch (_) { }
    try { media.volume = 1; media.muted = false; } catch (_) { }
    return value;
  }
  try { media.volume = value; media.muted = false; } catch (_) { }
  return value;
}


function prepareCuefieldPendingAudio(pending) {
  var descriptor = cuefieldPendingDescriptor(pending);
  if (!descriptor || !descriptor.proxyUrl) return null;
  if (pending.preparedAudio && pending.preparedAudio.src) return pending.preparedAudio;
  stopCuefieldPreparedAudio();
  var execution = cuefieldTimelineExecution(pending);
  var media = new Audio();
  media.crossOrigin = 'anonymous';
  media.preload = 'auto';
  media.volume = 1;
  media.muted = false;
  cuefieldCreatePreparedAudioGraph(media);
  if (media.__mineradioPreparedGraphFailed) {
    try { media.pause(); media.removeAttribute('src'); media.load(); } catch (_) { }
    // The first element is permanently tied to a failed WebAudio source.
    // Recreate a clean element for the direct-volume fallback instead of
    // risking a silent B deck.
    media = new Audio();
    media.crossOrigin = 'anonymous';
    media.preload = 'auto';
    media.volume = 1;
    media.muted = false;
  }
  cuefieldWriteIncomingGain(media, 0);
  media.src = descriptor.proxyUrl;
  cuefieldSetMediaTime(media, execution && execution.bStart);
  try { media.load(); } catch (_) { }
  pending.preparedAudio = media;
  pending.timelineExecution = execution;
  cuefieldAutoMixPreparedAudio = media;
  return media;
}


function cuefieldDelay(delayMs, generation) {
  return new Promise(function (resolve) {
    var waiter = {
      timer: 0,
      resolve: function (ok) {
        var index = cuefieldDelayWaiters.indexOf(waiter);
        if (index >= 0) cuefieldDelayWaiters.splice(index, 1);
        resolve(!!ok);
      }
    };
    waiter.timer = setTimeout(function () {
      waiter.resolve(generation === cuefieldTransitionGeneration);
    }, Math.max(0, Number(delayMs) || 0));
    cuefieldDelayWaiters.push(waiter);
  });
}


function cuefieldTransitionStillCurrent(pending, context) {
  if (!pending || !context || !cuefieldAutoMixEnabled) return false;
  if (context.generation !== cuefieldTransitionGeneration) return false;
  if (pending.token !== trackSwitchToken || pending.currentIndex !== currentIdx) return false;
  if (!context.outgoingMedia || audio !== context.outgoingMedia) return false;
  if (context.outgoingMedia.paused && !context.outgoingMedia.ended) return false;
  if (pending.fromKey && cuefieldSongKey(playQueue[pending.currentIndex]) !== pending.fromKey) return false;
  if (pending.toKey && cuefieldSongKey(playQueue[pending.nextIndex]) !== pending.toKey) return false;
  return true;
}


function cuefieldRunEqualPowerCrossfade(pending, nextMedia, durationMs, context) {
  cancelCuefieldMediaFade();
  var serial = cuefieldMediaFadeSerial;
  var initialTarget = Math.max(0.0001, Number(targetVolume) || 0);
  var outgoingRatio = Math.max(0, Math.min(1, (typeof currentAudioOutputGain === 'function' ? currentAudioOutputGain() : initialTarget) / initialTarget));
  var fadeStartA = isFinite(Number(pending && pending.fadeStartA))
    ? Number(pending.fadeStartA)
    : Number(context.outgoingMedia && context.outgoingMedia.currentTime) || 0;
  var headroomDepth = pending && pending.mixType === 'beatmix' ? 0.16 : 0.10;
  var fadeWatchdogAt = Date.now() + durationMs + 1800;
  durationMs = Math.max(1, Number(durationMs) || 1);
  return new Promise(function (resolve) {
    var settled = false;
    cuefieldPairFadeResolve = resolve;
    function finish(ok) {
      if (settled) return;
      settled = true;
      if (cuefieldPairFadeResolve === resolve) cuefieldPairFadeResolve = null;
      if (cuefieldMediaFadeRaf) cancelAnimationFrame(cuefieldMediaFadeRaf);
      if (cuefieldMediaFadeTimer) clearInterval(cuefieldMediaFadeTimer);
      cuefieldMediaFadeRaf = 0;
      cuefieldMediaFadeTimer = 0;
      resolve(!!ok);
    }
    function applyStep() {
      if (settled) return;
      if (serial !== cuefieldMediaFadeSerial || !cuefieldTransitionStillCurrent(pending, context)) {
        finish(false);
        return;
      }
      if (Date.now() >= fadeWatchdogAt) {
        finish(false);
        return;
      }
      var mediaNow = Number(context.outgoingMedia && context.outgoingMedia.currentTime);
      var t = Math.max(0, Math.min(1, ((isFinite(mediaNow) ? mediaNow : fadeStartA) - fadeStartA) / (durationMs / 1000)));
      if (context.outgoingMedia && (context.outgoingMedia.ended || (isFinite(context.outgoingMedia.duration) && context.outgoingMedia.duration - mediaNow <= 0.025))) t = 1;
      var eased = t * t * (3 - 2 * t);
      var theta = eased * Math.PI * 0.5;
      var liveTarget = Math.max(0, Math.min(1, Number(targetVolume) || 0));
      var overlapHeadroom = 1 - Math.sin(Math.PI * eased) * headroomDepth;
      var outgoing = liveTarget * outgoingRatio * Math.cos(theta) * overlapHeadroom;
      var incoming = liveTarget * Math.sin(theta) * overlapHeadroom;
      if (typeof writeAudioOutputGain === 'function') writeAudioOutputGain(outgoing);
      cuefieldWriteIncomingGain(nextMedia, incoming);
      if (t >= 1) {
        if (typeof writeAudioOutputGain === 'function') writeAudioOutputGain(0);
        cuefieldWriteIncomingGain(nextMedia, liveTarget);
        finish(true);
      }
    }
    function tick() {
      applyStep();
      if (!settled) cuefieldMediaFadeRaf = requestAnimationFrame(tick);
    }
    cuefieldMediaFadeTimer = setInterval(function () {
      applyStep();
    }, 40);
    cuefieldMediaFadeRaf = requestAnimationFrame(tick);
  });
}


async function cuefieldWaitForMediaTime(media, targetTime, pending, context) {
  targetTime = Math.max(0, Number(targetTime) || 0);
  var watchdogAt = Date.now() + 7000;
  while (media && Number(media.currentTime) + 0.012 < targetTime) {
    if (!cuefieldTransitionStillCurrent(pending, context) || Date.now() >= watchdogAt) return false;
    if (!await cuefieldDelay(24, context.generation)) return false;
  }
  return cuefieldTransitionStillCurrent(pending, context);
}


function cuefieldRampParam(param, value, durationMs) {
  if (!param) return false;
  value = Number(value);
  durationMs = Math.max(0, Number(durationMs) || 0);
  try {
    var ctx = param.context || audioCtx;
    var now = ctx && Number(ctx.currentTime) || 0;
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else {
      if (param.cancelScheduledValues) param.cancelScheduledValues(now);
      if (param.setValueAtTime) param.setValueAtTime(Number(param.value) || 0, now);
    }
    if (durationMs && param.linearRampToValueAtTime) param.linearRampToValueAtTime(value, now + durationMs / 1000);
    else if (param.setValueAtTime) param.setValueAtTime(value, now);
    else param.value = value;
    return true;
  } catch (_) {
    try { param.value = value; return true; } catch (_) { return false; }
  }
}


function cuefieldVolumeCurveValue(curve, progress) {
  progress = Math.max(0, Math.min(1, Number(progress) || 0));
  if (curve === 'equal-power-in') return Math.sin(progress * Math.PI * 0.5);
  if (curve === 'equal-power-out') return Math.cos(progress * Math.PI * 0.5);
  if (curve === 'cubic-ease-in') return progress * progress * progress;
  if (curve === 'cubic-ease-out') return 1 - Math.pow(1 - progress, 3);
  return progress * progress * (3 - 2 * progress);
}


function cuefieldAnimateDeckVolume(deck, media, target, durationMs, curve, pending, context) {
  deck = deck === 'A' ? 'A' : 'B';
  var serial = ++cuefieldDeckVolumeSerial[deck];
  durationMs = Math.max(0, Number(durationMs) || 0);
  target = Math.max(0, Math.min(1, Number(target) || 0));
  var graph = media && media.__mineradioPreparedAudioGraph;
  var start = deck === 'A'
    ? (typeof currentAudioOutputGain === 'function' ? currentAudioOutputGain() : Number(targetVolume) || 0)
    : (graph && graph.gainNode ? Number(graph.gainNode.gain.value) || 0 : Number(media && media.volume) || 0);
  if (!durationMs) {
    if (deck === 'A' && typeof writeAudioOutputGain === 'function') writeAudioOutputGain(target);
    else cuefieldWriteIncomingGain(media, target);
    return;
  }
  var startedAt = performance.now();
  function tick(now) {
    if (serial !== cuefieldDeckVolumeSerial[deck] || !cuefieldTransitionStillCurrent(pending, context)) return;
    var progress = Math.max(0, Math.min(1, (now - startedAt) / durationMs));
    var shaped = cuefieldVolumeCurveValue(curve, progress);
    var value = curve === 'equal-power-out'
      ? target + (start - target) * shaped
      : start + (target - start) * shaped;
    if (deck === 'A' && typeof writeAudioOutputGain === 'function') writeAudioOutputGain(value);
    else cuefieldWriteIncomingGain(media, value);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}


function cuefieldApplyGraphEcho(graph, action, pending, context) {
  if (!graph || !graph.echoSendNode || !graph.echoDelayNode || !graph.echoFeedbackNode || !graph.echoWetNode) return false;
  var duration = Math.max(0, Number(action.durationMs) || 0);
  if (action.enabled === false) {
    cuefieldRampParam(graph.echoSendNode.gain, 0, duration);
    var tailMs = Math.max(300, Math.min(4000, Number(action.tailMs) || 1200));
    var decayStart = (Number(graph.context && graph.context.currentTime) || 0) + tailMs / 1000;
    var decayEnd = decayStart + 0.32;
    try {
      graph.echoFeedbackNode.gain.setValueAtTime(graph.echoFeedbackNode.gain.value, decayStart);
      graph.echoFeedbackNode.gain.linearRampToValueAtTime(0, decayEnd);
      graph.echoWetNode.gain.setValueAtTime(graph.echoWetNode.gain.value, decayStart);
      graph.echoWetNode.gain.linearRampToValueAtTime(0, decayEnd);
    } catch (_) {
      cuefieldRampParam(graph.echoFeedbackNode.gain, 0, 320);
      cuefieldRampParam(graph.echoWetNode.gain, 0, 320);
    }
    return true;
  }
  var bpm = Math.max(40, Math.min(240, Number(action.bpm) || 120));
  cuefieldRampParam(graph.echoDelayNode.delayTime, Math.max(0.04, Math.min(1.5, 60 / bpm * (Number(action.delayBeats) || 0.5))), duration);
  cuefieldRampParam(graph.echoFeedbackNode.gain, Math.max(0, Math.min(0.72, Number(action.feedback) || 0)), duration);
  cuefieldRampParam(graph.echoWetNode.gain, Math.max(0, Math.min(0.5, Number(action.wet) || 0)), duration);
  cuefieldRampParam(graph.echoSendNode.gain, 1, duration);
  return true;
}


function cuefieldApplyGraphDuck(graph, action) {
  if (!graph || !graph.bassNode || !graph.bassNode.gain || !graph.context) return false;
  var bpm = Math.max(40, Math.min(240, Number(action.bpm) || 120));
  var pulseSec = 60 / bpm * Math.max(0.25, Number(action.beats) || 1);
  var pulses = Math.max(1, Math.min(16, Math.round(Number(action.pulses) || 4)));
  var param = graph.bassNode.gain;
  var baseDb = Number(param.value) || 0;
  var depthDb = Math.max(-24, baseDb - 12 * Math.max(0.08, Math.min(0.75, Number(action.depth) || 0.35)));
  var attack = Math.min(pulseSec * 0.22, Math.max(0.005, Number(action.attack) || 24) / 1000);
  var hold = Math.min(pulseSec * 0.3, Math.max(0.01, Number(action.hold) || 70) / 1000);
  var release = Math.min(pulseSec * 0.46, Math.max(0.04, Number(action.release) || 180) / 1000);
  var now = Number(graph.context.currentTime) || 0;
  try {
    if (param.cancelScheduledValues) param.cancelScheduledValues(now);
    for (var i = 0; i < pulses; i++) {
      var at = now + i * pulseSec;
      param.setValueAtTime(baseDb, at);
      param.linearRampToValueAtTime(depthDb, at + attack);
      param.setValueAtTime(depthDb, at + attack + hold);
      param.linearRampToValueAtTime(baseDb, at + attack + hold + release);
    }
    return true;
  } catch (_) { return false; }
}
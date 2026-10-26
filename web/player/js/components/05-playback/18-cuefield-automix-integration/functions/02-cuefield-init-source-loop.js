'use strict';



function cuefieldInitSourceLoop() {
  if (!cuefieldSourceLoopRuntime && window.CuefieldSourceLoop && window.CuefieldSourceLoop.createCuefieldSourceLoop) {
    cuefieldSourceLoopRuntime = window.CuefieldSourceLoop.createCuefieldSourceLoop();
  }
  return cuefieldSourceLoopRuntime;
}


function cuefieldInitBridge() {
  if (!cuefieldBridgeEngine && window.CuefieldBridgeEngine && window.CuefieldBridgeEngine.createCuefieldBridgeEngine) {
    cuefieldBridgeEngine = window.CuefieldBridgeEngine.createCuefieldBridgeEngine();
  }
  return cuefieldBridgeEngine;
}


function cuefieldApplyTimelineAction(action, pending, nextMedia, context) {
  action = action || {};
  var graph = nextMedia && nextMedia.__mineradioPreparedAudioGraph;
  var deckMedia = action.deck === 'A' ? context.outgoingMedia : nextMedia;
  if (action.op === 'handoff') return Promise.resolve(true);
  if (action.op === 'play' && action.deck !== 'A') {
    if (!action.sourceZeroPreRoll && Math.abs((Number(nextMedia.currentTime) || 0) - Number(action.at || 0)) > 0.045) cuefieldSetMediaTime(nextMedia, action.at);
    return Promise.resolve(nextMedia.paused ? nextMedia.play() : true).then(function () { return true; }).catch(function () { return false; });
  }
  if (action.op === 'volume') {
    cuefieldAnimateDeckVolume(action.deck, nextMedia, action.target, action.durationMs, action.curve, pending, context);
    return Promise.resolve(true);
  }
  if (action.op === 'rate' && deckMedia) {
    try { deckMedia.playbackRate = Math.max(0.94, Math.min(1.06, Number(action.value) || 1)); return Promise.resolve(true); } catch (_) { return Promise.resolve(false); }
  }
  if (action.op === 'bridge') {
    var bridge = cuefieldInitBridge();
    var started = !!(bridge && bridge.start(action.bridge || pending.bridgePlan || {}, { audioContext: audioCtx }));
    pending.bridgeStarted = started;
    if (!started) pending.runtimeDowngrade = 'bridge-unavailable';
    return Promise.resolve(true);
  }
  if (action.op === 'loop') {
    var loop = cuefieldInitSourceLoop();
    var applied = !!(loop && loop.apply(action, deckMedia, pending.fromKey + '>' + pending.toKey));
    if (!applied) pending.runtimeDowngrade = 'source-loop-unavailable';
    return Promise.resolve(true);
  }
  if (action.deck === 'A') {
    pending.runtimeDowngrade = pending.runtimeDowngrade || ('outgoing-' + action.op + '-bypassed');
    return Promise.resolve(true);
  }
  if (!graph) {
    pending.runtimeDowngrade = pending.runtimeDowngrade || 'b-deck-graph-unavailable';
    return Promise.resolve(true);
  }
  if (action.op === 'filter') cuefieldRampParam(graph.filterNode && graph.filterNode.frequency, action.type === 'none' ? 20 : action.value, action.durationMs);
  else if (action.op === 'bass') cuefieldRampParam(graph.bassNode && graph.bassNode.gain, (Math.max(0, Math.min(1, Number(action.value) || 0)) - 1) * 18, action.durationMs);
  else if (action.op === 'spectrum') {
    cuefieldRampParam(graph.bassNode && graph.bassNode.gain, (Number(action.low) - 1) * 18, action.durationMs);
    cuefieldRampParam(graph.midNode && graph.midNode.gain, (Number(action.mid) - 1) * 18, action.durationMs);
    cuefieldRampParam(graph.highNode && graph.highNode.gain, (Number(action.high) - 1) * 18, action.durationMs);
  } else if (action.op === 'echo') cuefieldApplyGraphEcho(graph, action, pending, context);
  else if (action.op === 'duck') cuefieldApplyGraphDuck(graph, action);
  return Promise.resolve(true);
}


async function runCuefieldTimeline(pending, nextMedia, context) {
  var execution = pending.timelineExecution || cuefieldTimelineExecution(pending);
  if (!execution) return false;
  pending.timelineExecution = execution;
  clearCuefieldTimelineTimers();
  pending.executionFallback = nextMedia.__mineradioPreparedAudioGraph ? 'cuefield-timeline-graph' : 'volume-only-fallback';
  pending.actualMixStart = Number(context.outgoingMedia && context.outgoingMedia.currentTime) || 0;
  var actions = Array.isArray(execution.actions) ? execution.actions.slice() : [];
  var elapsedMs = 0;
  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    var delayMs = Math.max(0, Number(action.delayMs) || 0);
    if (delayMs > elapsedMs && !await cuefieldDelay(delayMs - elapsedMs, context.generation)) return false;
    elapsedMs = delayMs;
    if (!cuefieldTransitionStillCurrent(pending, context)) return false;
    if (action.optionalWhenLate && Number(action.maxLateMs) >= 0 && performance.now() - (context.startedAt + delayMs) > Number(action.maxLateMs)) continue;
    if (!await cuefieldApplyTimelineAction(action, pending, nextMedia, context)) return false;
  }
  var handoffDelayMs = Math.max(0, Number(execution.handoffDelayMs) || elapsedMs);
  if (handoffDelayMs > elapsedMs && !await cuefieldDelay(handoffDelayMs - elapsedMs, context.generation)) return false;
  if (!cuefieldTransitionStillCurrent(pending, context) || nextMedia.paused || nextMedia.ended) return false;
  cuefieldWriteIncomingGain(nextMedia, Math.max(0, Math.min(1, Number(targetVolume) || 0)));
  if (typeof writeAudioOutputGain === 'function') writeAudioOutputGain(0);
  var finalGraph = nextMedia && nextMedia.__mineradioPreparedAudioGraph;
  if (finalGraph) {
    cuefieldRampParam(finalGraph.filterNode && finalGraph.filterNode.frequency, 20, 160);
    cuefieldRampParam(finalGraph.bassNode && finalGraph.bassNode.gain, 0, 160);
    cuefieldRampParam(finalGraph.midNode && finalGraph.midNode.gain, 0, 160);
    cuefieldRampParam(finalGraph.highNode && finalGraph.highNode.gain, 0, 160);
    cuefieldRampParam(finalGraph.echoSendNode && finalGraph.echoSendNode.gain, 0, 120);
    cuefieldRampParam(finalGraph.echoFeedbackNode && finalGraph.echoFeedbackNode.gain, 0, 160);
    cuefieldRampParam(finalGraph.echoWetNode && finalGraph.echoWetNode.gain, 0, 160);
  }
  try { nextMedia.playbackRate = 1; } catch (_) { }
  if (cuefieldSourceLoopRuntime && cuefieldSourceLoopRuntime.stop) cuefieldSourceLoopRuntime.stop('handoff', true);
  if (cuefieldBridgeEngine && cuefieldBridgeEngine.stop) cuefieldBridgeEngine.stop('handoff');
  return true;
}


function cuefieldFeedbackContext(pending) {
  var from = playQueue[pending.currentIndex] || {};
  var to = playQueue[pending.nextIndex] || {};
  var chosen = pending.plan && pending.plan.chosen || {};
  var evaluation = chosen.evaluation || {};
  return {
    pair: {
      fromKey: pending.fromKey,
      toKey: pending.toKey,
      fromTitle: from.name || from.title || '',
      fromArtist: from.artist || '',
      toTitle: to.name || to.title || '',
      toArtist: to.artist || ''
    },
    transition: {
      recipe: chosen.recipe || '',
      transitionRecipe: chosen.transitionRecipe || pending.executionMode || '',
      executionMode: pending.executionMode || '',
      tier: evaluation.tier || '',
      score: chosen.score,
      evalScore: evaluation.score,
      risks: evaluation.risks || [],
      exitTime: pending.exitTime,
      entryTime: pending.entryTime
    }
  };
}


function showCuefieldFeedback(context) {
  if (!context) return;
  cuefieldFeedbackState.context = context;
  cuefieldFeedbackState.submitted = false;
  var root = document.getElementById('cuefield-feedback');
  var meta = document.getElementById('cuefield-feedback-meta');
  if (meta) meta.textContent = (context.pair.fromTitle || '当前歌曲') + ' → ' + (context.pair.toTitle || '下一首');
  if (root) root.classList.add('show');
  if (cuefieldFeedbackState.timer) clearTimeout(cuefieldFeedbackState.timer);
  cuefieldFeedbackState.timer = setTimeout(function () { if (root) root.classList.remove('show'); }, 30000);
}


function submitCuefieldFeedback(rating) {
  rating = Number(rating);
  if (rating < 1 || rating > 3 || !cuefieldFeedbackState.context || cuefieldFeedbackState.submitted) return;
  cuefieldFeedbackState.submitted = true;
  apiJson('/api/cuefield/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ rating: rating }, cuefieldFeedbackState.context))
  }).then(function () {
    var root = document.getElementById('cuefield-feedback');
    if (root) root.classList.remove('show');
    showToast('Cuefield 评分已保存');
  }).catch(function () {
    cuefieldFeedbackState.submitted = false;
    showToast('Cuefield 评分保存失败');
  });
}


function tickCuefieldAutoMix() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  if (!cuefieldAutoMixEnabled || !cuefieldAutoMix || cuefieldAutoMixExecuting || !audio) return;
  var nextIndex = cuefieldAutoMixNextIndex(currentIdx);
  var nextKey = nextIndex >= 0 ? cuefieldSongKey(playQueue[nextIndex]) : '';
  if (!cuefieldAutoMix.shouldTrigger({ token: trackSwitchToken, currentIndex: currentIdx, currentTime: audio.currentTime || 0, nextKey: nextKey })) return;
  var pending = cuefieldAutoMix.consumePending();
  if (pending) executeCuefieldAutoMix(pending);
}


function noteCuefieldAutoMixOutgoingEnded(media, token, index) {
  if (!media) return false;
  media.__mineradioCuefieldEndedDeferredToken = Number(token);
  media.__mineradioCuefieldEndedDeferredIndex = Number(index);
  return true;
}


function recoverCuefieldAutoMixEndedOutgoing(pending, context, reason) {
  var outgoing = context && context.outgoingMedia;
  var token = Number(context && context.outgoingToken);
  var index = Number(context && context.outgoingIndex);
  if (
    !outgoing
    || !outgoing.ended
    || !isFinite(token)
    || !isFinite(index)
    || trackSwitchToken !== token
    || currentIdx !== index
    || audio !== outgoing
  ) return false;
  if (outgoing.__mineradioCuefieldEndedRecoveryToken === token) return true;
  outgoing.__mineradioCuefieldEndedRecoveryToken = token;
  cuefieldAutoMixExecuting = false;
  if (cuefieldActiveTransitionContext === context) cuefieldActiveTransitionContext = null;
  updateCuefieldAutoMixUi(reason || 'fallback');
  if (
    playMode === 'single'
    && typeof restartSingleRepeatMedia === 'function'
    && restartSingleRepeatMedia(outgoing, token, index, 'cuefield-ended')
  ) return true;
  if (typeof finalizeListenSession === 'function') finalizeListenSession(true);
  setTimeout(function () {
    if (trackSwitchToken !== token || currentIdx !== index || audio !== outgoing) return;
    if (playMode === 'single') {
      playQueueAt(index, { autoRepeat: true, preserveHomeState: true, suppressPlayFailureNotice: true });
    } else if (typeof nextTrack === 'function') {
      nextTrack(false);
    } else if (pending && isFinite(Number(pending.nextIndex))) {
      playQueueAt(Number(pending.nextIndex), { skipShuffleOrder: true, suppressPlayFailureNotice: true, preserveHomeState: true });
    }
  }, 0);
  return true;
}


async function executeCuefieldAutoMix(pending) {
  if (!pending || cuefieldAutoMixExecuting || pending.token !== trackSwitchToken || pending.currentIndex !== currentIdx) return;
  if (cuefieldAutoMixBlockedByAlbumGapless(pending.currentIndex)) {
    stopCuefieldPreparedAudio(pending.preparedAudio);
    if (cuefieldAutoMix) cuefieldAutoMix.reset('album-gapless-priority');
    updateCuefieldAutoMixUi('waiting');
    return;
  }
  if (pending.fromKey && cuefieldSongKey(playQueue[pending.currentIndex]) !== pending.fromKey) return;
  if (pending.toKey && cuefieldSongKey(playQueue[pending.nextIndex]) !== pending.toKey) return;
  var transitionContext = {
    generation: ++cuefieldTransitionGeneration,
    startedAt: performance.now(),
    outgoingMedia: audio,
    outgoingToken: trackSwitchToken,
    outgoingIndex: currentIdx
  };
  cuefieldAutoMixExecuting = true;
  updateCuefieldAutoMixUi('handoff');
  var nextMedia = prepareCuefieldPendingAudio(pending);
  if (!nextMedia) {
    cuefieldAutoMixExecuting = false;
    updateCuefieldAutoMixUi('missing-audio');
    recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'missing-audio');
    return;
  }
  cuefieldActiveTransitionContext = transitionContext;
  try {
    cuefieldSetMediaTime(nextMedia, pending.timelineExecution && pending.timelineExecution.bStart);
    cuefieldWriteIncomingGain(nextMedia, 0);
    if (typeof applyAudioOutputDevice === 'function') await applyAudioOutputDevice(nextMedia);
    if (!cuefieldTransitionStillCurrent(pending, transitionContext)) {
      cuefieldAutoMixExecuting = false;
      stopCuefieldPreparedAudio(nextMedia);
      if (cuefieldActiveTransitionContext === transitionContext) cuefieldActiveTransitionContext = null;
      recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'fallback');
      return;
    }
    var execution = pending.timelineExecution || cuefieldTimelineExecution(pending);
    pending.timelineExecution = execution;
    var playAction = execution && Array.isArray(execution.actions)
      ? execution.actions.find(function (action) { return action && action.deck === 'B' && action.op === 'play'; })
      : null;
    if (!playAction || Number(playAction.delayMs) <= 40) await nextMedia.play();
  } catch (_) {
    cuefieldAutoMixExecuting = false;
    stopCuefieldPreparedAudio(nextMedia);
    if (cuefieldActiveTransitionContext === transitionContext) cuefieldActiveTransitionContext = null;
    updateCuefieldAutoMixUi('error');
    recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'error');
    showToast('Cuefield AutoMix：下一首预载失败');
    return;
  }
  var feedback = cuefieldFeedbackContext(pending);
  var handoffReady = await runCuefieldTimeline(pending, nextMedia, transitionContext);
  if (!handoffReady || !cuefieldTransitionStillCurrent(pending, transitionContext)) {
    cuefieldAutoMixExecuting = false;
    stopCuefieldPreparedAudio(nextMedia);
    if (
      transitionContext.generation === cuefieldTransitionGeneration
      && transitionContext.outgoingToken === trackSwitchToken
      && transitionContext.outgoingIndex === currentIdx
      && transitionContext.outgoingMedia === audio
      && audio
      && !audio.paused
      && !audio.ended
      && typeof rampAudioOutputGain === 'function'
    ) rampAudioOutputGain(targetVolume, 120);
    if (cuefieldActiveTransitionContext === transitionContext) cuefieldActiveTransitionContext = null;
    recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'fallback');
    return;
  }
  var descriptor = cuefieldPendingDescriptor(pending);
  var handoffSucceeded = false;
  async function runCuefieldNormalFallback() {
    var expectedFailedToken = transitionContext.outgoingToken + 1;
    if (
      trackSwitchToken !== expectedFailedToken
      || currentIdx !== pending.nextIndex
      || (audio !== nextMedia && audio !== transitionContext.outgoingMedia)
    ) return false;
    var fallbackOwnerMedia = audio;
    if (fallbackOwnerMedia === nextMedia) {
      try {
        nextMedia.pause();
        nextMedia.removeAttribute('src');
        nextMedia.load();
      } catch (_) { }
      if (transitionContext.outgoingMedia && transitionContext.outgoingMedia !== fallbackOwnerMedia) {
        try {
          transitionContext.outgoingMedia.pause();
          transitionContext.outgoingMedia.removeAttribute('src');
          transitionContext.outgoingMedia.load();
        } catch (_) { }
      }
    } else {
      stopCuefieldPreparedAudio(nextMedia);
    }
    var fallbackResult = await playQueueAt(pending.nextIndex, {
      preserveHomeState: true,
      skipShuffleOrder: true,
      suppressPlayFailureNotice: true
    });
    return !!(
      fallbackResult === true
      && currentIdx === pending.nextIndex
      && audio
      && audio.src
      && !audio.paused
      && !audio.ended
    );
  }
  try {
    var handoffResult = await playQueueAt(pending.nextIndex, {
      preserveHomeState: true,
      albumGaplessHandoff: true,
      albumGaplessMixed: true,
      preloadedAudio: nextMedia,
      preloadedData: descriptor && descriptor.playbackData || { url: descriptor && descriptor.proxyUrl || '' },
      preloadedProxyAudioUrl: descriptor && descriptor.proxyUrl || '',
      cuefieldAutoMix: true,
      fade: false
    });
    handoffSucceeded = !!(handoffResult === true && audio === nextMedia && currentIdx === pending.nextIndex && nextMedia.src && !nextMedia.paused && !nextMedia.ended);
    if (!handoffSucceeded) handoffSucceeded = await runCuefieldNormalFallback();
    if (handoffSucceeded) {
      var chosen = pending.plan && pending.plan.chosen || {};
      var recipe = chosen.transitionRecipe || chosen.recipeCandidate && chosen.recipeCandidate.recipe || chosen.recipe || pending.executionMode;
      if (recipe) {
        cuefieldRecentRecipes.push(String(recipe));
        cuefieldRecentRecipes = cuefieldRecentRecipes.slice(-2);
      }
      showCuefieldFeedback(feedback);
    }
  } catch (err) {
    console.warn('[CuefieldAutoMix] handoff failed:', err);
    try { handoffSucceeded = await runCuefieldNormalFallback(); } catch (_) { }
  } finally {
    if (!handoffSucceeded && audio !== nextMedia) stopCuefieldPreparedAudio(nextMedia);
    cuefieldAutoMixExecuting = false;
    if (cuefieldActiveTransitionContext === transitionContext) cuefieldActiveTransitionContext = null;
    updateCuefieldAutoMixUi(handoffSucceeded ? 'ready' : 'error');
    if (!handoffSucceeded) recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'error');
  }
}

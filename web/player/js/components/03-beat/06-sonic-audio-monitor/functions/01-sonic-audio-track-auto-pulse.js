'use strict';



function sonicAudioTrackAutoPulse(data, now, meta, bands) {
  var tracker = sonicAudioMonitorState.autoTrack;
  var levels = SONIC_AUDIO_BEAT_WINDOWS.map(function (win) {
    return sonicAudioHzRangeAverage(data, meta, win.startHz, win.endHz, true);
  });
  tracker.frames.push({
    time: now,
    levels: levels,
    lowDominance: (bands && bands.lowDominance) || 0,
    body: (bands && bands.body) || 0,
    vocal: (bands && bands.vocal) || 0,
    snap: (bands && bands.snap) || 0
  });
  while (tracker.frames.length && now - tracker.frames[0].time > 1450) tracker.frames.shift();
  if (now - tracker.lastAt <= 360 || tracker.frames.length < 8) return;
  tracker.lastAt = now;
  var scores = new Array(SONIC_AUDIO_BEAT_WINDOWS.length);
  for (var b = 0; b < scores.length; b++) scores[b] = { index: b, avg: 0, max: 0, score: 0 };
  for (var f = 1; f < tracker.frames.length; f++) {
    var cur = tracker.frames[f];
    var prev = tracker.frames[f - 1];
    var highMask = cur.vocal * 0.58 + cur.snap * 0.22 + cur.body * 0.18;
    var dominance = sonicAudioClamp(cur.lowDominance, 0.65, 2.20) / 2.20;
    for (var k = 0; k < scores.length; k++) {
      var diff = Math.max(0, cur.levels[k] - prev.levels[k]);
      var win = SONIC_AUDIO_BEAT_WINDOWS[k];
      var width = Math.max(1, win.endHz - win.startHz);
      var widthPenalty = sonicAudioClamp(Math.sqrt(82 / width), 0.68, 1.16);
      var bodyPenalty = win.endHz > 160 ? 1 / (1 + cur.body * 0.42 + highMask * 0.22) : 1;
      var weighted = diff * (win.bias || 1) * widthPenalty * bodyPenalty * (0.72 + dominance * 0.60) / (1 + highMask * 0.78);
      scores[k].avg += weighted;
      scores[k].max = Math.max(scores[k].max, weighted);
    }
  }
  scores.forEach(function (item) {
    item.avg /= Math.max(1, tracker.frames.length - 1);
    item.score = item.max * 0.70 + item.avg * 0.30;
  });
  scores.sort(function (a, b2) {
    if (Math.abs(b2.score - a.score) > 0.003) return b2.score - a.score;
    var aw = SONIC_AUDIO_BEAT_WINDOWS[a.index];
    var bw = SONIC_AUDIO_BEAT_WINDOWS[b2.index];
    return (aw.endHz - bw.endHz) || ((aw.endHz - aw.startHz) - (bw.endHz - bw.startHz));
  });
  if (!scores.length || scores[0].score < 0.010) return;
  var best = SONIC_AUDIO_BEAT_WINDOWS[scores[0].index];
  tracker.windowIndex = scores[0].index;
  tracker.hzStart = best.startHz;
  tracker.hzEnd = best.endHz;
  tracker.start = Math.round(sonicAudioClamp(sonicAudioHzToBase(meta, best.startHz), 0, SONIC_AUDIO_MAX_BAND_START));
  tracker.end = Math.round(sonicAudioClamp(sonicAudioHzToBase(meta, best.endHz), tracker.start + 1, SONIC_AUDIO_MAX_BAND_END));
  tracker.sensitivity = sonicAudioClamp(0.72 + Math.min(0.24, scores[0].score * 2.8), 0.72, 0.96);
}


function sonicAudioEvaluateSelectedTrigger(data, settings, dt, meta, beatData) {
  var trigger = sonicAudioMonitorState.trigger;
  var start = settings.autoTrack ? sonicAudioMonitorState.autoTrack.start : settings.bandStart;
  var end = settings.autoTrack ? sonicAudioMonitorState.autoTrack.end : settings.bandEnd;
  start = Math.round(sonicAudioClamp(start, 0, SONIC_AUDIO_MAX_BAND_START));
  end = Math.round(sonicAudioClamp(end, start + 1, SONIC_AUDIO_MAX_BAND_END));
  var manualHz = sonicAudioBaseRangeToHz(meta, start, end);
  var hzStart = settings.autoTrack ? sonicAudioMonitorState.autoTrack.hzStart : manualHz.startHz;
  var hzEnd = settings.autoTrack ? sonicAudioMonitorState.autoTrack.hzEnd : manualHz.endHz;
  var energy = settings.autoTrack && beatData ? beatData.kickLevel : sonicAudioHzRangeAverage(data, meta, hzStart, hzEnd, false);
  var startBin = sonicAudioHzToBin(meta, hzStart, 'floor');
  var endBin = sonicAudioHzToBin(meta, hzEnd, 'ceil');
  var flux = 0;
  var count = 0;
  for (var i = Math.min(startBin, endBin); i <= Math.max(startBin, endBin); i++) {
    var val = (data[i] || 0) / 255;
    var diff = val - (sonicAudioMonitorState.prev[i] || 0);
    if (diff > 0.01) flux += diff;
    count++;
  }
  flux /= Math.max(1, count);
  var triggered = false;
  var strength = 0;
  if (settings.autoTrack) {
    flux = Math.max(flux, beatData ? beatData.kickFlux * 0.72 : 0);
    trigger.smoothedFlux += (flux - trigger.smoothedFlux) * 0.48;
    trigger.history[trigger.historyIndex] = trigger.smoothedFlux;
    trigger.historyIndex = (trigger.historyIndex + 1) % trigger.history.length;
    var stats = sonicAudioFluxStats(trigger.history);
    var thresholdMultiplier = Math.max(0.1, 5.0 - sonicAudioMonitorState.autoTrack.sensitivity * 4.0);
    var adaptiveThreshold = Math.max(0.01, stats.avg + stats.stdDev * thresholdMultiplier);
    var isPeak = (beatData && beatData.kickOnset > 0) || (flux > adaptiveThreshold && flux > trigger.previousSmoothedFlux * 1.04);
    if (trigger.beatHold > 0) trigger.beatHold--;
    else if (isPeak) {
      triggered = true;
      trigger.beatHold = Math.max(3, Math.round(8 + (1 - settings.pulseStrength / 100) * 10));
      strength = sonicAudioClamp01(Math.max(flux * 24, (beatData ? beatData.kickConfidence : 0) * 0.68 + energy * 0.32) * (settings.pulseStrength / 100));
    }
    trigger.lastEnergy = Math.max(energy, trigger.smoothedFlux * 8);
    trigger.lastThreshold = adaptiveThreshold * 8;
    trigger.previousSmoothedFlux = trigger.smoothedFlux;
  } else {
    trigger.cooldownRemaining = Math.max(0, trigger.cooldownRemaining - Math.max(0, dt || 0));
    var threshold = settings.threshold / 100;
    if (trigger.cooldownRemaining <= 0 && energy > threshold) {
      triggered = true;
      trigger.cooldownRemaining = 0.18;
      strength = sonicAudioClamp01((energy - threshold) / Math.max(0.05, 1 - threshold) + settings.pulseStrength / 220);
    }
    trigger.lastEnergy = energy;
    trigger.lastThreshold = threshold;
  }
  trigger.pulse = Math.max(trigger.pulse * Math.pow(0.10, Math.max(0.001, dt || 1 / 60)), triggered ? strength : 0);
  return {
    triggerBandStart: start,
    triggerBandEnd: end,
    triggerHzStart: hzStart,
    triggerHzEnd: hzEnd,
    triggerEnergy: trigger.lastEnergy,
    triggerThreshold: trigger.lastThreshold,
    triggerPulse: trigger.pulse,
    triggerOnset: triggered ? 1 : 0
  };
}


function sonicAudioCopyRawAndPrevious(data) {
  var len = data.length;
  sonicAudioEnsureBuffers(len);
  sonicAudioMonitorState.raw.set(data);
}


function sonicAudioCommitPrevious(data) {
  for (var i = 0; i < data.length; i++) sonicAudioMonitorState.prev[i] = (data[i] || 0) / 255;
}


function sonicAudioDecayFrame(dt) {
  var frame = sonicAudioMonitorState.frame;
  var decay = Math.pow(0.08, Math.max(0.001, dt || 1 / 60));
  if (!frame) return null;
  [
    'subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance', 'air',
    'body', 'vocal', 'snap', 'lowDrive', 'treble', 'energy', 'kickEnvelope', 'kickLevel',
    'kickFlux', 'kickOnset', 'kickConfidence', 'kickLowDominance', 'triggerEnergy', 'triggerPulse', 'beat'
  ].forEach(function (key) {
    frame[key] = sonicAudioClamp01((Number(frame[key]) || 0) * decay);
  });
  sonicAudioMonitorState.trigger.pulse = frame.triggerPulse || 0;
  return frame;
}


function stepSonicAudioMonitor(rawData, dt, opts) {
  opts = opts || {};
  var settings = normalizeSonicAudioSettings(opts.fx || (typeof fx !== 'undefined' ? fx : null));
  var playing = opts.playing !== false && rawData && rawData.length && settings.enabled;
  if (!playing) return sonicAudioDecayFrame(dt);
  var data = rawData;
  var meta = sonicAudioResolveAnalysisMeta(data, opts);
  sonicAudioMonitorState.meta = meta;
  sonicAudioEnsureBuffers(data.length);
  var currentTime = Number(opts.currentTime);
  if (isFinite(currentTime)) {
    if (sonicAudioMonitorState.lastAudioTime > 0 && currentTime + 0.30 < sonicAudioMonitorState.lastAudioTime) {
      sonicAudioResetTransientState(meta);
      if (sonicAudioMonitorState.prev && sonicAudioMonitorState.prev.fill) sonicAudioMonitorState.prev.fill(0);
      sonicAudioMonitorState.smooth = {};
    }
    sonicAudioMonitorState.lastAudioTime = currentTime;
  }
  sonicAudioCopyRawAndPrevious(data);
  var now = performance.now();
  var values = sonicAudioComputeHzBands(data, meta);
  if (settings.autoTrack) sonicAudioTrackAutoPulse(data, now, meta, values);
  var lowSum = values.subBass + values.bass + values.lowMid + values.mid * 0.42;
  var midSum = values.mid * 0.58 + values.highMid + values.presence * 0.26;
  var highSum = values.presence * 0.74 + values.brilliance + values.air;
  var totalTone = Math.max(0.001, lowSum + midSum + highSum);
  var legacyBass = values.lowDrive;
  var legacyMid = sonicAudioClamp01(values.mid * 0.58 + values.highMid * 0.42);
  var legacyTreble = sonicAudioClamp01(values.presence * 0.42 + values.brilliance * 0.38 + values.air * 0.20);
  var energy = values.energy;
  var warmth = lowSum / totalTone;
  var brightness = highSum / totalTone;
  var smooth = sonicAudioMonitorState.smooth;
  Object.keys(values).forEach(function (key) {
    smooth[key] = sonicAudioFollowValue(smooth[key], values[key], 34, 10, dt || 1 / 60);
  });
  smooth.bass = (smooth.bass || 0);
  smooth.treble = sonicAudioFollowValue(smooth.treble, legacyTreble, 30, 9, dt || 1 / 60);
  smooth.energy = sonicAudioFollowValue(smooth.energy, energy, 28, 8, dt || 1 / 60);
  var beatData = sonicAudioStepBeatDetector(data, dt || 1 / 60, settings, meta, values);
  var triggerData = sonicAudioEvaluateSelectedTrigger(data, settings, dt || 1 / 60, meta, beatData);
  sonicAudioCommitPrevious(data);
  var kickEnvelope = sonicAudioClamp01(Math.max(beatData.kickEnvelope, triggerData.triggerPulse, Number(opts.beat) || 0));
  var frame = Object.assign({
    sonicDetailed: true,
    sonicHzDetailed: true,
    bass: smooth.bass || values.bass,
    mid: smooth.mid || values.mid,
    treble: smooth.treble || legacyTreble,
    energy: smooth.energy || energy,
    beat: kickEnvelope,
    warmth: warmth,
    brightness: brightness,
    sharpness: sonicAudioClamp01(brightness * 0.42 + values.snap * 0.14 + beatData.kickOnset * 0.28),
    smoothness: sonicAudioClamp01(1 - legacyTreble * 0.32 + legacyMid * 0.12),
    density: sonicAudioClamp01(0.40 + legacyTreble * 0.24 + values.vocal * 0.12 + kickEnvelope * 0.16)
  }, smooth, beatData, triggerData);
  frame.kickEnvelope = kickEnvelope;
  sonicAudioMonitorState.frame = frame;
  return frame;
}


function getSonicAudioMonitorSnapshot() {
  var frame = sonicAudioMonitorState.frame || {};
  return {
    frame: Object.assign({}, frame),
    panelOpen: !!sonicAudioMonitorState.panelOpen,
    rawLength: sonicAudioMonitorState.raw ? sonicAudioMonitorState.raw.length : 0,
    baseBins: SONIC_AUDIO_BASE_BINS,
    sampleRate: sonicAudioMonitorState.meta ? sonicAudioMonitorState.meta.sampleRate : 0,
    fftSize: sonicAudioMonitorState.meta ? sonicAudioMonitorState.meta.fftSize : 0,
    autoBandStart: sonicAudioMonitorState.autoTrack.start,
    autoBandEnd: sonicAudioMonitorState.autoTrack.end,
    lastOnsetAt: sonicAudioMonitorState.lastOnsetAt || 0
  };
}


function drawSonicAudioMonitorPanel() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) {
    sonicAudioMonitorState.raf = 0;
    return;
  }
  var panel = document.getElementById('sonic-audio-monitor-panel');
  var canvas = document.getElementById('sonic-audio-monitor-canvas');
  var meter = document.getElementById('sonic-audio-meter-fill');
  var label = document.getElementById('sonic-audio-monitor-label');
  if (!canvas || !panel || !sonicAudioMonitorState.panelOpen) {
    sonicAudioMonitorState.raf = 0;
    return;
  }
  var now = performance.now();
  if (now - sonicAudioMonitorState.lastDrawAt < 48) {
    sonicAudioMonitorState.raf = requestAnimationFrame(drawSonicAudioMonitorPanel);
    return;
  }
  sonicAudioMonitorState.lastDrawAt = now;
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;
  var w = canvas.width;
  var h = canvas.height;
  var raw = sonicAudioMonitorState.raw || [];
  var frame = sonicAudioMonitorState.frame || {};
  var start = frame.triggerBandStart == null ? 1 : frame.triggerBandStart;
  var end = frame.triggerBandEnd == null ? 4 : frame.triggerBandEnd;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(5,8,14,0.92)';
  ctx.fillRect(0, 0, w, h);
  var startX = sonicAudioClamp(start, 0, SONIC_AUDIO_MAX_BAND_END) / SONIC_AUDIO_BASE_BINS * w;
  var endX = sonicAudioClamp(end, 0, SONIC_AUDIO_MAX_BAND_END) / SONIC_AUDIO_BASE_BINS * w;
  ctx.fillStyle = 'rgba(244,210,138,0.14)';
  ctx.fillRect(Math.min(startX, endX), 0, Math.max(2, Math.abs(endX - startX)), h);
  var bars = Math.min(160, raw.length || 0);
  for (var i = 0; i < bars; i++) {
    var ratio = bars <= 1 ? 0 : i / (bars - 1);
    var idx = Math.min((raw.length || 1) - 1, Math.round(Math.pow(ratio, 1.24) * ((raw.length || 1) - 1)));
    var v = (raw[idx] || 0) / 255;
    var x = i / bars * w;
    var bw = Math.max(1, w / bars - 1);
    var bh = Math.max(1, v * (h - 14));
    var hue = 194 + ratio * 120;
    ctx.fillStyle = 'hsla(' + hue + ', 92%, ' + Math.round(54 + v * 18) + '%, 0.86)';
    ctx.fillRect(x, h - bh, bw, bh);
  }
  var threshold = sonicAudioClamp01(Number(frame.triggerThreshold) || 0);
  var energy = sonicAudioClamp01(Number(frame.triggerEnergy) || 0);
  var thresholdY = h - threshold * h;
  var energyY = h - energy * h;
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, thresholdY);
  ctx.lineTo(w, thresholdY);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,85,88,0.95)';
  ctx.beginPath();
  ctx.arc(Math.max(8, Math.min(w - 8, (startX + endX) / 2)), Math.max(8, Math.min(h - 8, energyY)), 4.5, 0, Math.PI * 2);
  ctx.fill();
  if (meter) meter.style.transform = 'scaleX(' + sonicAudioClamp01(frame.kickEnvelope || 0).toFixed(3) + ')';
  if (label) {
    var mode = (typeof fx !== 'undefined' && fx && fx.sonicAudioAutoTrack !== false) ? 'AUTO' : 'MANUAL';
    var hzStart = Math.round(Number(frame.triggerHzStart) || Number(frame.kickHzStart) || 0);
    var hzEnd = Math.round(Number(frame.triggerHzEnd) || Number(frame.kickHzEnd) || 0);
    var hzText = hzStart && hzEnd ? (' ' + hzStart + '-' + hzEnd + 'Hz') : (' ' + start + '-' + end);
    label.textContent = mode + hzText + ' / ' + (frame.kickWindowName || 'Classic');
  }
  sonicAudioMonitorState.raf = requestAnimationFrame(drawSonicAudioMonitorPanel);
}


function setSonicAudioMonitorPanelOpen(open) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  sonicAudioMonitorState.panelOpen = !!open;
  var panel = document.getElementById('sonic-audio-monitor-panel');
  var btn = document.getElementById('sonic-audio-monitor-toggle');
  if (panel) panel.classList.toggle('open', sonicAudioMonitorState.panelOpen);
  if (btn) btn.classList.toggle('active', sonicAudioMonitorState.panelOpen);
  if (sonicAudioMonitorState.panelOpen && !sonicAudioMonitorState.raf) {
    sonicAudioMonitorState.raf = requestAnimationFrame(drawSonicAudioMonitorPanel);
  }
}


function toggleSonicAudioMonitorPanel(force) {
  setSonicAudioMonitorPanelOpen(force == null ? !sonicAudioMonitorState.panelOpen : !!force);
}


function refreshSonicAudioMonitorUi() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  sonicAudioNormalizeFx();
  var monitorToggle = document.getElementById('t-sonicAudioMonitorEnabled');
  var autoToggle = document.getElementById('t-sonicAudioAutoTrack');
  if (monitorToggle && typeof fx !== 'undefined') monitorToggle.classList.toggle('on', fx.sonicAudioMonitorEnabled !== false);
  if (autoToggle && typeof fx !== 'undefined') autoToggle.classList.toggle('on', fx.sonicAudioAutoTrack !== false);
  if (sonicAudioMonitorState.panelOpen && !sonicAudioMonitorState.raf) {
    sonicAudioMonitorState.raf = requestAnimationFrame(drawSonicAudioMonitorPanel);
  }
}


function bindSonicAudioMonitorControls() {
  var btn = document.getElementById('sonic-audio-monitor-toggle');
  if (btn && !btn._sonicAudioMonitorBound) {
    btn._sonicAudioMonitorBound = true;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      toggleSonicAudioMonitorPanel();
    });
  }
  refreshSonicAudioMonitorUi();
}

'use strict';



function sonicAudioClamp(value, min, max) {
  value = Number(value);
  if (!isFinite(value)) value = min;
  return Math.max(min, Math.min(max, value));
}


function sonicAudioClamp01(value) {
  return sonicAudioClamp(value, 0, 1);
}


function sonicAudioBlendForRate(rate, dt) {
  return sonicAudioClamp(1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt || 0)), 0, 1);
}


function sonicAudioScaleBin(baseBin, len) {
  len = Math.max(1, Math.round(Number(len) || 1));
  return Math.max(0, Math.min(len - 1, Math.round((Number(baseBin) || 0) * len / SONIC_AUDIO_BASE_BINS)));
}


function sonicAudioResolveAnalysisMeta(data, opts) {
  opts = opts || {};
  var len = Math.max(1, data && data.length ? data.length : SONIC_AUDIO_BASE_BINS);
  var sampleRate = Number(opts.sampleRate)
    || (typeof audioCtx !== 'undefined' && audioCtx && Number(audioCtx.sampleRate))
    || SONIC_AUDIO_DEFAULT_SAMPLE_RATE;
  var fftSize = Number(opts.fftSize)
    || (typeof analyser !== 'undefined' && analyser && Number(analyser.fftSize))
    || len * 2;
  if (!isFinite(sampleRate) || sampleRate < 8000) sampleRate = SONIC_AUDIO_DEFAULT_SAMPLE_RATE;
  if (!isFinite(fftSize) || fftSize < len * 2) fftSize = len * 2;
  return {
    len: len,
    sampleRate: sampleRate,
    fftSize: fftSize,
    nyquist: sampleRate / 2,
    binHz: sampleRate / fftSize
  };
}


function sonicAudioHzToBin(meta, hz, mode) {
  meta = meta || sonicAudioResolveAnalysisMeta(null, null);
  var raw = (Number(hz) || 0) / Math.max(0.001, meta.binHz || 1);
  var bin = mode === 'ceil' ? Math.ceil(raw) : (mode === 'floor' ? Math.floor(raw) : Math.round(raw));
  return Math.max(1, Math.min(Math.max(1, meta.len - 1), bin));
}


function sonicAudioHzToBase(meta, hz) {
  meta = meta || sonicAudioResolveAnalysisMeta(null, null);
  var base = (Number(hz) || 0) / Math.max(1, meta.nyquist || SONIC_AUDIO_DEFAULT_SAMPLE_RATE / 2) * SONIC_AUDIO_BASE_BINS;
  return Math.round(sonicAudioClamp(base, 0, SONIC_AUDIO_MAX_BAND_END));
}


function sonicAudioBaseRangeToHz(meta, baseStart, baseEnd) {
  meta = meta || sonicAudioResolveAnalysisMeta(null, null);
  var nyquist = Math.max(1, meta.nyquist || SONIC_AUDIO_DEFAULT_SAMPLE_RATE / 2);
  var startHz = sonicAudioClamp(baseStart, 0, SONIC_AUDIO_MAX_BAND_END) / SONIC_AUDIO_BASE_BINS * nyquist;
  var endHz = sonicAudioClamp(baseEnd, 0, SONIC_AUDIO_MAX_BAND_END) / SONIC_AUDIO_BASE_BINS * nyquist;
  return {
    startHz: Math.min(startHz, endHz),
    endHz: Math.max(startHz, endHz)
  };
}


function sonicAudioBaseBinValue(data, baseBin) {
  if (!data || !data.length) return 0;
  return (data[sonicAudioScaleBin(baseBin, data.length)] || 0) / 255;
}


function sonicAudioRangeAverage(data, baseStart, baseEnd, weighted) {
  if (!data || !data.length) return 0;
  baseStart = Math.max(0, Math.round(Number(baseStart) || 0));
  baseEnd = Math.max(baseStart, Math.round(Number(baseEnd) || baseStart));
  var start = sonicAudioScaleBin(baseStart, data.length);
  var end = sonicAudioScaleBin(baseEnd, data.length);
  if (end < start) {
    var tmp = start;
    start = end;
    end = tmp;
  }
  var sum = 0;
  var total = 0;
  var center = (start + end) / 2;
  var half = Math.max(1, (end - start + 1) / 2);
  for (var i = start; i <= end; i++) {
    var weight = 1;
    if (weighted) {
      var distance = Math.abs(i - center);
      weight = 0.35 + 0.65 * (1 - Math.min(1, distance / half));
    }
    sum += ((data[i] || 0) / 255) * weight;
    total += weight;
  }
  return total > 0 ? sum / total : 0;
}


function sonicAudioHzRangeAverage(data, meta, hzStart, hzEnd, weighted) {
  if (!data || !data.length) return 0;
  meta = meta || sonicAudioResolveAnalysisMeta(data, null);
  var start = sonicAudioHzToBin(meta, Math.min(hzStart, hzEnd), 'floor');
  var end = sonicAudioHzToBin(meta, Math.max(hzStart, hzEnd), 'ceil');
  if (end < start) {
    var tmp = start;
    start = end;
    end = tmp;
  }
  var sum = 0;
  var total = 0;
  var center = (start + end) / 2;
  var half = Math.max(1, (end - start + 1) / 2);
  for (var i = start; i <= end; i++) {
    var weight = 1;
    if (weighted) {
      var distance = Math.abs(i - center);
      weight = 0.38 + 0.62 * (1 - Math.min(1, distance / half));
    }
    var v = (data[i] || 0) / 255;
    sum += v * v * weight;
    total += weight;
  }
  return total > 0 ? Math.sqrt(sum / total) : 0;
}


function sonicAudioFollowValue(previous, next, attackRate, releaseRate, dt) {
  previous = Number(previous) || 0;
  next = sonicAudioClamp01(next);
  var rate = next > previous ? attackRate : releaseRate;
  return previous + (next - previous) * sonicAudioBlendForRate(rate, dt || 1 / 60);
}


function sonicAudioComputeHzBands(data, meta) {
  var values = {};
  var energySum = 0;
  for (var b = 0; b < SONIC_AUDIO_BAND_EDGES.length; b++) {
    var band = SONIC_AUDIO_BAND_EDGES[b];
    var value = sonicAudioHzRangeAverage(data, meta, band[1], band[2], false);
    values[band[0]] = value;
    energySum += value;
  }
  values.kickSub = sonicAudioHzRangeAverage(data, meta, 38, 78, true);
  values.kickCore = sonicAudioHzRangeAverage(data, meta, 52, 165, true);
  values.kickPunch = sonicAudioHzRangeAverage(data, meta, 72, 190, true);
  values.kickWide = sonicAudioHzRangeAverage(data, meta, 38, 220, true);
  values.body = sonicAudioHzRangeAverage(data, meta, 165, 420, true);
  values.vocal = sonicAudioHzRangeAverage(data, meta, 420, 2600, false);
  values.snap = sonicAudioHzRangeAverage(data, meta, 1800, 9200, false);
  values.lowDrive = sonicAudioClamp01(values.kickCore * 0.86 + values.kickSub * 0.42 + values.body * 0.10);
  values.lowDominance = values.lowDrive / Math.max(0.001, values.vocal * 0.72 + values.body * 0.34 + values.snap * 0.12);
  values.energy = sonicAudioClamp01((energySum / SONIC_AUDIO_BAND_EDGES.length) * 0.82 + values.lowDrive * 0.18);
  return values;
}


function sonicAudioEnsureBuffers(len) {
  len = Math.max(1, Math.round(Number(len) || 512));
  if (!sonicAudioMonitorState.raw || sonicAudioMonitorState.raw.length !== len) {
    sonicAudioMonitorState.raw = new Uint8Array(len);
    sonicAudioMonitorState.prev = new Float32Array(len);
  }
}


function sonicAudioResetTransientState(meta) {
  sonicAudioMonitorState.beat = createSonicBeatState();
  sonicAudioMonitorState.kick = { noiseFloor: 0, kickLevel: 0, kickOnset: 0, kickEnvelope: 0 };
  sonicAudioMonitorState.trigger = {
    smoothedFlux: 0,
    previousSmoothedFlux: 0,
    history: new Array(40).fill(0),
    historyIndex: 0,
    beatHold: 0,
    cooldownRemaining: 0,
    lastEnergy: 0,
    lastThreshold: 0,
    pulse: 0
  };
  sonicAudioMonitorState.autoTrack.frames = [];
  sonicAudioMonitorState.autoTrack.lastAt = 0;
  sonicAudioMonitorState.autoTrack.windowIndex = 1;
  sonicAudioMonitorState.autoTrack.hzStart = 46;
  sonicAudioMonitorState.autoTrack.hzEnd = 118;
  if (meta) {
    sonicAudioMonitorState.autoTrack.start = sonicAudioHzToBase(meta, 46);
    sonicAudioMonitorState.autoTrack.end = sonicAudioHzToBase(meta, 118);
  } else {
    sonicAudioMonitorState.autoTrack.start = 1;
    sonicAudioMonitorState.autoTrack.end = 3;
  }
}


function normalizeSonicAudioSettings(sourceFx) {
  var f = sourceFx || (typeof fx !== 'undefined' ? fx : {}) || {};
  var start = Math.round(sonicAudioClamp(f.sonicAudioBandStart == null ? 1 : f.sonicAudioBandStart, 0, SONIC_AUDIO_MAX_BAND_START));
  var end = Math.round(sonicAudioClamp(f.sonicAudioBandEnd == null ? 4 : f.sonicAudioBandEnd, 2, SONIC_AUDIO_MAX_BAND_END));
  if (end < start + 1) end = Math.min(SONIC_AUDIO_MAX_BAND_END, start + 1);
  return {
    enabled: f.sonicAudioMonitorEnabled !== false,
    autoTrack: f.sonicAudioAutoTrack !== false,
    sensitivity: Math.round(sonicAudioClamp(f.sonicAudioSensitivity == null ? 100 : f.sonicAudioSensitivity, 0, 100)),
    bandStart: start,
    bandEnd: end,
    threshold: Math.round(sonicAudioClamp(f.sonicAudioThreshold == null ? 32 : f.sonicAudioThreshold, 0, 100)),
    pulseStrength: Math.round(sonicAudioClamp(f.sonicAudioPulseStrength == null ? 62 : f.sonicAudioPulseStrength, 0, 100))
  };
}


function sonicAudioNormalizeFx(sourceFx) {
  var f = sourceFx || (typeof fx !== 'undefined' ? fx : null);
  if (!f) return;
  var next = normalizeSonicAudioSettings(f);
  f.sonicAudioMonitorEnabled = next.enabled;
  f.sonicAudioAutoTrack = next.autoTrack;
  f.sonicAudioSensitivity = next.sensitivity;
  f.sonicAudioBandStart = next.bandStart;
  f.sonicAudioBandEnd = next.bandEnd;
  f.sonicAudioThreshold = next.threshold;
  f.sonicAudioPulseStrength = next.pulseStrength;
}


function sonicAudioBeatParams(sensitivity) {
  sensitivity = sonicAudioClamp(sensitivity, 0, 100);
  var lower = sensitivity <= 50 ? sensitivity / 50 : 1;
  var upper = sensitivity > 50 ? (sensitivity - 50) / 50 : 0;
  var strict = { thresholdStdDevGain: 2.6, thresholdFloor: 0.05, minTriggerFlux: 0.07 };
  var normal = { thresholdStdDevGain: 1.8, thresholdFloor: 0.028, minTriggerFlux: 0.045 };
  var sensitive = { thresholdStdDevGain: 1.1, thresholdFloor: 0.016, minTriggerFlux: 0.025 };
  var mid = {
    thresholdStdDevGain: strict.thresholdStdDevGain + (normal.thresholdStdDevGain - strict.thresholdStdDevGain) * lower,
    thresholdFloor: strict.thresholdFloor + (normal.thresholdFloor - strict.thresholdFloor) * lower,
    minTriggerFlux: strict.minTriggerFlux + (normal.minTriggerFlux - strict.minTriggerFlux) * lower
  };
  return {
    thresholdStdDevGain: mid.thresholdStdDevGain + (sensitive.thresholdStdDevGain - mid.thresholdStdDevGain) * upper,
    thresholdFloor: mid.thresholdFloor + (sensitive.thresholdFloor - mid.thresholdFloor) * upper,
    minTriggerFlux: mid.minTriggerFlux + (sensitive.minTriggerFlux - mid.minTriggerFlux) * upper
  };
}


function createSonicBeatState() {
  return {
    activeWindowIndex: 1,
    windowScores: new Array(SONIC_AUDIO_BEAT_WINDOWS.length).fill(0),
    previousWindowLevels: new Array(SONIC_AUDIO_BEAT_WINDOWS.length).fill(0),
    fluxHistory: new Array(90).fill(0),
    fluxHistoryIndex: 0,
    smoothedFlux: 0,
    previousSmoothedFlux: 0,
    cooldownRemaining: 0
  };
}


function sonicAudioFluxStats(history) {
  var sum = 0;
  var i;
  for (i = 0; i < history.length; i++) sum += history[i] || 0;
  var avg = sum / Math.max(1, history.length);
  var variance = 0;
  for (i = 0; i < history.length; i++) variance += Math.pow((history[i] || 0) - avg, 2);
  variance /= Math.max(1, history.length);
  return { avg: avg, stdDev: Math.sqrt(variance) };
}


function sonicAudioStepKickEnvelope(rawKickLevel, onset, dt) {
  var k = sonicAudioMonitorState.kick;
  var safeRaw = sonicAudioClamp01(rawKickLevel);
  var floorRate = safeRaw > k.noiseFloor ? 1.15 : 0.35;
  var noiseFloor = k.noiseFloor + (safeRaw - k.noiseFloor) * sonicAudioBlendForRate(floorRate, dt);
  var kickLevel = sonicAudioClamp01(safeRaw - noiseFloor - 0.025);
  var breathTarget = Math.min(0.11, kickLevel * 0.18);
  var onsetTarget = onset ? Math.max(0.48, kickLevel * 0.95) : 0;
  var targetEnvelope = Math.max(breathTarget, onsetTarget);
  var envelopeRate = targetEnvelope > k.kickEnvelope ? 42 : 11.5;
  var kickEnvelope = Math.max(breathTarget, k.kickEnvelope + (targetEnvelope - k.kickEnvelope) * sonicAudioBlendForRate(envelopeRate, dt));
  sonicAudioMonitorState.kick = {
    noiseFloor: noiseFloor,
    kickLevel: kickLevel,
    kickOnset: onset ? 1 : 0,
    kickEnvelope: sonicAudioClamp01(kickEnvelope)
  };
  return sonicAudioMonitorState.kick;
}


function sonicAudioStepBeatDetector(data, dt, settings, meta, bands) {
  if (!sonicAudioMonitorState.beat) sonicAudioMonitorState.beat = createSonicBeatState();
  var s = sonicAudioMonitorState.beat;
  var params = sonicAudioBeatParams(settings.sensitivity);
  var windowLevels = SONIC_AUDIO_BEAT_WINDOWS.map(function (win) {
    return sonicAudioHzRangeAverage(data, meta, win.startHz, win.endHz, true);
  });
  var nextScores = s.windowScores.map(function (score, index) {
    var fluxValue = Math.max(0, windowLevels[index] - (s.previousWindowLevels[index] || 0));
    var win = SONIC_AUDIO_BEAT_WINDOWS[index];
    var dominanceBoost = sonicAudioClamp((bands && bands.lowDominance) || 0, 0.65, 2.25) / 2.25;
    return score * 0.945 + fluxValue * (win.bias || 1) * (0.70 + dominanceBoost * 0.70);
  });
  var activeWindowIndex = settings.autoTrack && sonicAudioMonitorState.autoTrack.windowIndex != null
    ? sonicAudioMonitorState.autoTrack.windowIndex
    : (s.activeWindowIndex || 0);
  for (var i = 0; i < nextScores.length; i++) {
    if (nextScores[i] > nextScores[activeWindowIndex] * 1.10) activeWindowIndex = i;
  }
  var rawFlux = Math.max(0, windowLevels[activeWindowIndex] - (s.previousWindowLevels[activeWindowIndex] || 0));
  var smoothedFlux = s.smoothedFlux + (rawFlux - s.smoothedFlux) * 0.46;
  var stats = sonicAudioFluxStats(s.fluxHistory);
  var threshold = Math.max(params.thresholdFloor, stats.avg + stats.stdDev * params.thresholdStdDevGain);
  var cooldownRemaining = Math.max(0, s.cooldownRemaining - Math.max(0, dt || 0));
  var lowDominance = (bands && bands.lowDominance) || 0;
  var lowGate = (bands && bands.lowDrive) || windowLevels[activeWindowIndex] || 0;
  var vocalMask = bands ? (bands.vocal * 0.62 + bands.snap * 0.16) : 0;
  var drumGate = lowGate > 0.045 && (lowDominance > 0.78 || lowGate > vocalMask * 1.04 || ((bands && bands.kickSub) || 0) > 0.085);
  var instantRise = rawFlux > threshold && rawFlux >= params.minTriggerFlux;
  var peakConfirm = s.previousSmoothedFlux > threshold && s.previousSmoothedFlux >= smoothedFlux && s.previousSmoothedFlux >= params.minTriggerFlux * 0.86;
  var onset = cooldownRemaining <= 0 && drumGate && (instantRise || peakConfirm);
  var displayedFlux = instantRise ? rawFlux : (onset ? Math.max(s.previousSmoothedFlux, smoothedFlux) : smoothedFlux);
  var nextHistory = s.fluxHistory.slice();
  nextHistory[s.fluxHistoryIndex] = smoothedFlux;
  var nextHistoryIndex = (s.fluxHistoryIndex + 1) % nextHistory.length;
  var kickLevel = Math.max(windowLevels[activeWindowIndex], (bands && bands.lowDrive) || 0);
  var kick = sonicAudioStepKickEnvelope(kickLevel, onset, dt || 1 / 60);
  s.activeWindowIndex = activeWindowIndex;
  s.windowScores = nextScores;
  s.previousWindowLevels = windowLevels;
  s.fluxHistory = nextHistory;
  s.fluxHistoryIndex = nextHistoryIndex;
  s.smoothedFlux = smoothedFlux;
  s.previousSmoothedFlux = smoothedFlux;
  s.cooldownRemaining = onset ? 0.12 : cooldownRemaining;
  if (onset) sonicAudioMonitorState.lastOnsetAt = performance.now();
  var activeWindow = SONIC_AUDIO_BEAT_WINDOWS[activeWindowIndex];
  return {
    kickLevel: kick.kickLevel,
    kickFlux: displayedFlux,
    kickThreshold: threshold,
    kickOnset: onset ? 1 : 0,
    kickEnvelope: kick.kickEnvelope,
    kickConfidence: sonicAudioClamp(displayedFlux / Math.max(0.001, threshold * 1.85), 0, 1),
    kickLowDominance: sonicAudioClamp(lowDominance / 1.8, 0, 1),
    kickWindowName: activeWindow.name,
    kickWindowStart: sonicAudioHzToBase(meta, activeWindow.startHz),
    kickWindowEnd: sonicAudioHzToBase(meta, activeWindow.endHz),
    kickHzStart: activeWindow.startHz,
    kickHzEnd: activeWindow.endHz
  };
}
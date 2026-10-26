'use strict';

function flushPersistentVisualState() {
  try { saveLyricLayout(); } catch (e) { }
  try { saveFreeCameraState(); } catch (e) { }
}


function resetBeatCameraSync(t, options) {
  options = options || {};
  var preserveMomentum = !!options.preserveMomentum;
  beatCam.nextIdx = 0;
  beatCam.events.length = 0;
  if (!preserveMomentum) beatCam.punch = 0;
  beatCam.lastTriggerAt = -10;
  beatCam.lastRealtimeAt = -10;
  if (!preserveMomentum) {
    beatCam.thetaKick = 0;
    beatCam.phiKick = 0;
    beatCam.radiusKick = 0;
    beatCam.rollKick = 0;
  }
  beatCam.prevAudioTime = isFinite(t) ? t : -1;
  if (!preserveMomentum) camPunch = 0;
  beatCam.stats.map = 0;
  beatCam.stats.live = 0;
  beatCam.stats.merged = 0;
  beatCam.stats.liveBlocked = 0;
  if (!preserveMomentum) {
    liveCamAvg = 0;
    liveCamPeak = 0.28;
    liveCamLastRaw = 0;
  }
  resetRealtimeBeatEngine();
}

function primeCinemaAfterTrackStart(reason) {
  if (!fx || !fx.cinema || !beatCam) return;
  var shake = clampRange(Number(fx.cinemaShake) || 0, 0, 1.8);
  if (shake <= 0.001) return;
  var currentT = audio && isFinite(audio.currentTime) ? audio.currentTime : 0;
  cinemaDynamics.scale = Math.max(cinemaDynamics.scale || 0, 0.92);
  beatCam.lastTriggerAt = Math.min(beatCam.lastTriggerAt || -10, currentT - 0.48);
  beatCam.punch = Math.max(beatCam.punch || 0, 0.16);
  beatCam.radiusKick = Math.max(beatCam.radiusKick || 0, 0.085);
  beatCam.phiKick = Math.max(beatCam.phiKick || 0, 0.0048);
  beatCam.thetaKick += beatCam.thetaKick >= 0 ? 0.0022 : -0.0022;
  camPunch = Math.max(camPunch || 0, 0.11);
}


function syncBeatCameraToTime(t) {
  resetBeatCameraSync(t);
  if (!currentBeatMap) return;
  alignBeatCameraCursorToTime(t);
}


function alignBeatCameraCursorToTime(t) {
  if (!currentBeatMap) return;
  var beats = currentBeatMap.cameraBeats || currentBeatMap.beats || currentBeatMap.kicks || [];
  beatCam.nextIdx = 0;
  while (beatCam.nextIdx < beats.length) {
    var bt = typeof beats[beatCam.nextIdx] === 'number' ? beats[beatCam.nextIdx] : beats[beatCam.nextIdx].time;
    if (bt >= t + beatCam.lookahead) break;
    beatCam.nextIdx++;
  }
}


function easeBeatCamera(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}


function updateCinemaDynamics(rawEnergy, rawLow) {
  var e = clamp01(rawEnergy || 0);
  var l = clamp01(rawLow || 0);
  var isDj = djMode.active;
  var composite = clamp01(e * (isDj ? 0.52 : 0.62) + l * (isDj ? 0.48 : 0.38));
  if (isDj) {
    var prevEnergy = djMode.sectionEnergy || 0;
    var prevLow = djMode.sectionLow || 0;
    djMode.sectionEnergy += (e - djMode.sectionEnergy) * (e > djMode.sectionEnergy ? 0.030 : 0.010);
    djMode.sectionLow += (l - djMode.sectionLow) * (l > djMode.sectionLow ? 0.036 : 0.012);
    var change = Math.abs(e - prevEnergy) * 0.46 + Math.abs(l - prevLow) * 0.62;
    djMode.sectionChange += (change - djMode.sectionChange) * (change > djMode.sectionChange ? 0.055 : 0.018);
    djMode.visualPulse *= Math.pow(0.30, 1 / 60);
  }
  cinemaDynamics.avg += (composite - cinemaDynamics.avg) * (composite > cinemaDynamics.avg ? (isDj ? 0.018 : 0.010) : (isDj ? 0.006 : 0.004));
  cinemaDynamics.lowAvg += (l - cinemaDynamics.lowAvg) * (l > cinemaDynamics.lowAvg ? (isDj ? 0.022 : 0.012) : (isDj ? 0.007 : 0.005));
  cinemaDynamics.peak = Math.max(isDj ? 0.36 : 0.30, cinemaDynamics.peak * (isDj ? 0.9980 : 0.9988), composite);
  var floor = Math.max(0.10, cinemaDynamics.avg * 0.82);
  var span = Math.max(0.18, cinemaDynamics.peak - floor);
  var lift = clamp01((composite - floor) / span);
  lift = lift * lift * (3 - 2 * lift);
  var target = isDj
    ? 0.50 + lift * 0.66 + clamp01((l - cinemaDynamics.lowAvg) / 0.30) * 0.18 + clamp01(djMode.sectionChange * 2.4) * 0.08
    : 0.42 + lift * 0.56 + clamp01((l - cinemaDynamics.lowAvg) / 0.36) * 0.12;
  if (cinemaDynamics.avg < 0.18 && l < 0.32) target *= isDj ? 0.88 : 0.78;
  if (e > 0.48 && l > 0.46) target = Math.max(target, isDj ? 1.02 : 0.92);
  target = clampRange(target, isDj ? 0.42 : 0.34, isDj ? 1.24 : 1.08);
  cinemaDynamics.scale += (target - cinemaDynamics.scale) * (target > cinemaDynamics.scale ? (isDj ? 0.070 : 0.045) : (isDj ? 0.030 : 0.022));
}


function cameraDynamicsScale(extra) {
  var isDj = djMode.active;
  var djBoost = isDj ? (1.06 + clamp01(djMode.sectionLow) * 0.16 + clamp01(rtBeat.tempoConfidence) * 0.08) : 1;
  return clampRange((cinemaDynamics.scale || 0.82) * (cinemaTrackProfile.scale || 1) * (extra == null ? 1 : extra) * djBoost, isDj ? 0.24 : 0.18, isDj ? 1.42 : 1.18);
}


function cinemaTrackNameHint(song) {
  var label = ((song && song.name) || '') + ' ' + ((song && song.artist) || '');
  label = label.toLowerCase().replace(/\s+/g, '');
  if (/after17/.test(label)) return 0.46;
  if (/joey/.test(label)) return 1.08;
  return 1.0;
}


function cinemaAnalysisProfileForSong(song) {
  var title = String((song && (song.name || song.title)) || '').toLowerCase().replace(/\s+/g, '');
  var artist = String((song && song.artist) || '').toLowerCase().replace(/\s+/g, '');
  var label = title + ' ' + artist;
  if (/日落大道|sunsetboulevard/.test(label)) {
    return {
      id: 'sunset-boulevard-soft-groove',
      softGroove: true,
      phaseScan: true,
      localRefine: true,
      sparseCamera: true,
      introPattern: true
    };
  }
  return { id: 'default', softGroove: false, phaseScan: false, localRefine: false, sparseCamera: false, introPattern: false };
}


function resetCinemaTrackProfile(song) {
  var isDj = isPodcastSong(song);
  cinemaTrackProfile.scale = isDj ? 1.08 : 1.0;
  cinemaTrackProfile.target = isDj ? 1.10 : 1.0;
  cinemaTrackProfile.nameHint = isDj ? 1.12 : cinemaTrackNameHint(song);
  cinemaTrackProfile.frames = 0;
  cinemaTrackProfile.energyAvg = 0;
  cinemaTrackProfile.lowAvg = 0;
  cinemaTrackProfile.vocalAvg = 0;
  cinemaTrackProfile.melodyAvg = 0;
  cinemaTrackProfile.punchPeak = 0.10;
  cinemaTrackProfile.density = 0;
}


function updateCinemaTrackProfile(sample) {
  if (!sample) return;
  var p = cinemaTrackProfile;
  p.frames++;
  function follow(cur, next, k) { return cur + (next - cur) * k; }
  var early = p.frames < 360;
  var k = early ? 0.020 : 0.006;
  p.energyAvg = follow(p.energyAvg, clamp01(sample.energy), k);
  p.lowAvg = follow(p.lowAvg, clamp01(sample.low), k);
  p.vocalAvg = follow(p.vocalAvg, clamp01(sample.vocal), k * 0.8);
  p.melodyAvg = follow(p.melodyAvg, clamp01(sample.melody), k * 0.8);
  var punchRaw = clamp01((sample.lowOnset || 0) * 2.4 + (sample.energyOnset || 0) * 1.5 + sample.low * 0.16);
  p.punchPeak = Math.max(0.10, p.punchPeak * 0.9975, punchRaw);
  var lowDrive = clamp01((p.lowAvg - 0.20) / 0.42);
  var loudDrive = clamp01((p.energyAvg - 0.18) / 0.40);
  var punchDrive = clamp01((p.punchPeak - 0.13) / 0.36);
  var vocalSoft = clamp01((p.vocalAvg * 0.72 + p.melodyAvg * 0.42 - p.lowAvg * 0.34 - 0.08) / 0.42);
  var quietSoft = clamp01((0.24 - p.energyAvg) / 0.18);
  var target = djMode.active
    ? 0.72 + lowDrive * 0.34 + loudDrive * 0.18 + punchDrive * 0.42 - vocalSoft * 0.12 - quietSoft * 0.06
    : 0.54 + lowDrive * 0.28 + loudDrive * 0.22 + punchDrive * 0.34 - vocalSoft * 0.34 - quietSoft * 0.18;
  if (p.density) target += clamp01((p.density - 0.55) / 1.6) * 0.14;
  target *= p.nameHint || 1;
  target = clampRange(target, djMode.active ? 0.68 : 0.28, djMode.active ? 1.26 : 1.12);
  p.target = target;
  p.scale += (target - p.scale) * (target > p.scale ? (djMode.active ? 0.045 : 0.030) : (djMode.active ? 0.030 : 0.045));
}


function readSonicRealtimeCameraSample() {
  if (typeof sonicAudioMonitorState === 'undefined' || !sonicAudioMonitorState) return null;
  var frame = sonicAudioMonitorState.frame;
  if (!frame || frame.sonicDetailed !== true) return null;
  var sub = clamp01(Number(frame.subBass) || 0);
  var bassBand = clamp01(Number(frame.bass) || 0);
  var lowMid = clamp01(Number(frame.lowMid) || 0);
  var midBand = clamp01(Number(frame.mid) || 0);
  var highMid = clamp01(Number(frame.highMid) || 0);
  var presence = clamp01(Number(frame.presence) || 0);
  var low = clamp01(sub * 0.58 + bassBand * 0.78 + lowMid * 0.28);
  var kick = clamp01(Math.max(Number(frame.kickEnvelope) || 0, Number(frame.triggerPulse) || 0, Number(frame.beat) || 0));
  var kickDominance = clamp01(Number(frame.kickLowDominance) || 0);
  var onset = clamp01((Number(frame.kickFlux) || 0) * 1.55
    + (Number(frame.kickOnset) || 0) * 0.24
    + (Number(frame.triggerOnset) || 0) * 0.16
    + (Number(frame.triggerPulse) || 0) * 0.18);
  var competing = midBand * 0.58 + highMid * 0.32 + presence * 0.18;
  return {
    lowPresence: clamp01(low + kick * 0.26),
    lowAttack: clampRange(onset * 0.055 + kick * 0.018 + kickDominance * 0.018, 0, 0.14),
    score: clamp01((Number(frame.kickConfidence) || 0) * 0.52 + onset * 0.30 + kick * 0.16 + kickDominance * 0.12),
    strength: clamp01(0.34 + kick * 0.26 + low * 0.22 + onset * 0.24),
    lowDominance: Math.max(0.70, low / Math.max(0.001, competing), 0.78 + kickDominance * 0.70),
    lowFluxDominance: Math.max(0.96, 0.82 + onset * 1.28 + kickDominance * 0.24)
  };
}


function applyCinemaProfileFromBeatMap(map) {
  if (!map || !map.duration) return;
  var events = (map.cameraBeats || map.beats || []).filter(function (b) { return b && typeof b !== 'number' && b.camera !== false; });
  if (!events.length) return;
  var sumImpact = 0, sumLow = 0, primary = 0;
  events.forEach(function (b) {
    sumImpact += Math.max(b.impact || 0, b.strength || 0);
    sumLow += b.low || 0;
    if (b.primary !== false) primary++;
  });
  var avgImpact = sumImpact / events.length;
  var avgLow = sumLow / events.length;
  var density = events.length / Math.max(20, map.duration);
  cinemaTrackProfile.density = density;
  var target = 0.44 + clamp01((avgImpact - 0.20) / 0.55) * 0.38 + clamp01((avgLow - 0.24) / 0.48) * 0.18 + clamp01((density - 0.45) / 1.65) * 0.20 + clamp01(primary / Math.max(1, events.length)) * 0.08;
  target *= cinemaTrackProfile.nameHint || 1;
  target = clampRange(target, 0.28, 1.12);
  cinemaTrackProfile.target = target;
  cinemaTrackProfile.scale += (target - cinemaTrackProfile.scale) * (target < cinemaTrackProfile.scale ? 0.55 : 0.22);
}


function resetRealtimeBeatEngine() {
  rtBeat.subFast = rtBeat.subSlow = rtBeat.lowFast = rtBeat.lowSlow = 0;
  rtBeat.bodyFast = rtBeat.bodySlow = rtBeat.vocalFast = rtBeat.vocalSlow = rtBeat.snapFast = rtBeat.snapSlow = 0;
  rtBeat.prevSub = rtBeat.prevLow = rtBeat.prevBody = rtBeat.prevVocal = rtBeat.prevSnap = rtBeat.prevRms = 0;
  rtBeat.onsetAvg = 0.012;
  rtBeat.onsetPeak = 0.060;
  rtBeat.subPeak = 0.14;
  rtBeat.lowPeak = 0.18;
  rtBeat.bodyPeak = 0.16;
  rtBeat.vocalPeak = 0.16;
  rtBeat.snapPeak = 0.14;
  rtBeat.lastHitAt = -10;
  rtBeat.tempoGap = 0;
  rtBeat.tempoConfidence = 0;
  rtBeat.beatCount = 0;
  rtBeat.primedFrames = 0;
  rtBeat.warmupUntil = (audio && isFinite(audio.currentTime) ? audio.currentTime : 0) + (djMode.active ? 0.24 : 0.48);
  rtBeat.pulse = 0;
  rtBeat.score = 0;
  rtBeat.stats.hits = 0;
  rtBeat.stats.blocked = 0;
  rtBeat.stats.assisted = 0;
  rtBeat.stats.strong = 0;
  rtBeat.stats.rejected = 0;
}


function resetAudioVisualState(options) {
  options = options || {};
  var preserveEnvelope = !!options.preserveEnvelope;
  if (!preserveEnvelope) {
    bass = 0;
    mid = 0;
    treble = 0;
    audioEnergy = 0;
    beatPulse = 0;
    prevEnergy = 0;
    smoothBass = 0;
    smoothMid = 0;
    smoothTreb = 0;
    smoothEnergy = 0;
    bassPeak = 0.12;
    midPeak = 0.10;
    treblePeak = 0.08;
    energyPeak = 0.10;
    cinemaDynamics.avg = 0;
    cinemaDynamics.lowAvg = 0;
    cinemaDynamics.peak = 0.30;
    cinemaDynamics.scale = 0.82;
  }
  scheduledBeatPulse = 0;
  scheduledBeatFlag = false;
  beatOnsetFlag = false;
  if (djMode.active && !preserveEnvelope) resetDjModeMeter();
}


function beatEventTime(ev) {
  return typeof ev === 'number' ? ev : (ev && isFinite(ev.time) ? ev.time : Infinity);
}


function yieldToPaint() {
  return new Promise(function (resolve) {
    if (isHiddenForBackgroundOptimization() || typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
    } else {
      requestAnimationFrame(function () { setTimeout(resolve, 0); });
    }
  });
}


function yieldToIdle(timeout) {
  return new Promise(function (resolve) {
    if (isHiddenForBackgroundOptimization()) {
      setTimeout(resolve, Math.min(timeout || 80, 80));
      return;
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(function () { resolve(); }, { timeout: timeout || 1200 });
    } else {
      setTimeout(resolve, timeout ? Math.min(timeout, 600) : 160);
    }
  });
}


function scheduleAnalysisTask(fn, timeout) {
  if (typeof fn !== 'function') return;
  if (isHiddenForBackgroundOptimization()) {
    setTimeout(fn, 0);
    return;
  }
  if (window.requestIdleCallback) {
    requestIdleCallback(fn, { timeout: timeout || 900 });
  } else {
    setTimeout(fn, Math.min(timeout || 420, 420));
  }
}


function scheduleVisualApply(fn, delay, timeout) {
  if (typeof fn !== 'function') return;
  setTimeout(function () {
    if (isHiddenForBackgroundOptimization() || typeof requestAnimationFrame !== 'function') {
      fn();
      return;
    }
    var run = function () { requestAnimationFrame(fn); };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: timeout || 360 });
    else run();
  }, delay || 0);
}


function scheduleUiWarmTask(fn, timeout) {
  if (typeof fn !== 'function') return;
  var run = function () { requestAnimationFrame(fn); };
  if (isHiddenForBackgroundOptimization() || typeof requestAnimationFrame !== 'function') {
    setTimeout(fn, 0);
  } else if (window.requestIdleCallback) {
    requestIdleCallback(run, { timeout: timeout || 220 });
  } else {
    requestAnimationFrame(fn);
  }
}


function cancelBeatAnalysisTimer() {
  if (beatAnalysisTimer) {
    clearTimeout(beatAnalysisTimer);
    beatAnalysisTimer = null;
  }
}


function cancelBeatPrefetchTimer() {
  if (beatPrefetchTimer) {
    clearTimeout(beatPrefetchTimer);
    beatPrefetchTimer = null;
  }
}
'use strict';



function beatAnalysisYieldMs(options, currentMs, prefetchMs) {
  options = options || {};
  if (options.prefetch) return prefetchMs == null ? 620 : prefetchMs;
  if (options.background) return currentMs == null ? 120 : currentMs;
  return Math.min(currentMs == null ? 120 : currentMs, 160);
}

function beatBandRms(data, sampleRate, fftSize, hz0, hz1) {
  var binHz = sampleRate / fftSize;
  var cacheKey = data.length + '|' + sampleRate + '|' + fftSize + '|' + hz0 + '|' + hz1;
  var range = beatBandRangeCache[cacheKey];
  if (!range) {
    range = {
      a: Math.max(1, Math.floor(hz0 / binHz)),
      b: Math.min(data.length - 1, Math.ceil(hz1 / binHz))
    };
    beatBandRangeCache[cacheKey] = range;
  }
  var a = range.a;
  var b = range.b;
  var span = Math.max(1, b - a + 1);
  var stride = span > 72 && typeof runtimeAnalysisStride === 'function'
    ? runtimeAnalysisStride('wide-band', span)
    : 1;
  var sum = 0, count = 0;
  for (var i = a; i <= b; i += stride) {
    var v = data[i] / 255;
    sum += v * v;
    count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}


function processRealtimeBeatEngine(dt) {
  if (!beatAnalyser || !audioCtx || !audio || audio.paused) return null;
  dt = Math.max(0.001, Math.min(0.080, dt || 0.016));
  var dj = djMode.active;
  beatAnalyser.getByteFrequencyData(beatFrequencyData);
  beatAnalyser.getByteTimeDomainData(beatTimeDomainData);
  var sr = audioCtx.sampleRate || 44100;
  var sub = beatBandRms(beatFrequencyData, sr, beatAnalyser.fftSize, 38, 74);
  var kick = beatBandRms(beatFrequencyData, sr, beatAnalyser.fftSize, 52, 165);
  var body = beatBandRms(beatFrequencyData, sr, beatAnalyser.fftSize, 165, 420);
  var vocal = beatBandRms(beatFrequencyData, sr, beatAnalyser.fftSize, 420, 2600);
  var snap = beatBandRms(beatFrequencyData, sr, beatAnalyser.fftSize, 1800, 9200);
  var low = Math.min(1, kick * 0.86 + sub * 0.42);
  var rms = 0;
  var timeStride = (typeof runtimeAnalysisStride === 'function') ? runtimeAnalysisStride('time', beatTimeDomainData.length) : 1;
  var rmsCount = 0;
  for (var i = 0; i < beatTimeDomainData.length; i += timeStride) {
    var tv = (beatTimeDomainData[i] - 128) / 128;
    rms += tv * tv;
    rmsCount++;
  }
  rms = Math.sqrt(rms / Math.max(1, rmsCount));

  function follow(cur, next, upTau, downTau) {
    var tau = next > cur ? upTau : downTau;
    return cur + (next - cur) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
  }
  var fastMul = dj ? 0.86 : 1;
  var downMul = dj ? 0.94 : 1;
  var slowMul = dj ? 1.06 : 1;
  rtBeat.subFast = follow(rtBeat.subFast, sub, 0.018 * fastMul, 0.064 * downMul);
  rtBeat.subSlow = follow(rtBeat.subSlow, sub, 0.320 * slowMul, 0.520 * slowMul);
  rtBeat.lowFast = follow(rtBeat.lowFast, low, 0.016 * fastMul, 0.070 * downMul);
  rtBeat.lowSlow = follow(rtBeat.lowSlow, low, 0.300 * slowMul, 0.540 * slowMul);
  rtBeat.bodyFast = follow(rtBeat.bodyFast, body, 0.020 * fastMul, 0.082 * downMul);
  rtBeat.bodySlow = follow(rtBeat.bodySlow, body, 0.360 * slowMul, 0.600 * slowMul);
  rtBeat.vocalFast = follow(rtBeat.vocalFast, vocal, 0.026 * fastMul, 0.090 * downMul);
  rtBeat.vocalSlow = follow(rtBeat.vocalSlow, vocal, 0.340 * slowMul, 0.580 * slowMul);
  rtBeat.snapFast = follow(rtBeat.snapFast, snap, 0.012 * fastMul, 0.060 * downMul);
  rtBeat.snapSlow = follow(rtBeat.snapSlow, snap, 0.300 * slowMul, 0.520 * slowMul);

  var peakDecay = dj ? 0.988 : 0.990;
  rtBeat.subPeak = Math.max(rtBeat.subPeak * Math.pow(peakDecay, dt * 60), sub, 0.045);
  rtBeat.lowPeak = Math.max(rtBeat.lowPeak * Math.pow(dj ? 0.987 : 0.989, dt * 60), low, 0.060);
  rtBeat.bodyPeak = Math.max(rtBeat.bodyPeak * Math.pow(peakDecay, dt * 60), body, 0.040);
  rtBeat.vocalPeak = Math.max(rtBeat.vocalPeak * Math.pow(peakDecay, dt * 60), vocal, 0.040);
  rtBeat.snapPeak = Math.max(rtBeat.snapPeak * Math.pow(peakDecay, dt * 60), snap, 0.035);

  var subFlux = Math.max(0, sub - rtBeat.prevSub);
  var lowFlux = Math.max(0, low - rtBeat.prevLow);
  var bodyFlux = Math.max(0, body - rtBeat.prevBody);
  var vocalFlux = Math.max(0, vocal - rtBeat.prevVocal);
  var snapFlux = Math.max(0, snap - rtBeat.prevSnap);
  var rmsFlux = Math.max(0, rms - rtBeat.prevRms);
  var subRise = Math.max(0, rtBeat.subFast - rtBeat.subSlow);
  var lowRise = Math.max(0, rtBeat.lowFast - rtBeat.lowSlow);
  var bodyRise = Math.max(0, rtBeat.bodyFast - rtBeat.bodySlow);
  var vocalRise = Math.max(0, rtBeat.vocalFast - rtBeat.vocalSlow);
  var snapRise = Math.max(0, rtBeat.snapFast - rtBeat.snapSlow);
  var drumOnset = subRise * 0.88 + subFlux * 0.66 + lowRise * 1.62 + lowFlux * 1.34;
  var musicalOnset = bodyRise * 0.34 + bodyFlux * 0.24 + vocalRise * 0.52 + vocalFlux * 0.36 + snapRise * 0.08 + snapFlux * 0.06 + rmsFlux * 0.20;
  var onset = dj ? drumOnset * 1.05 + musicalOnset * 0.07 : drumOnset + musicalOnset * 0.16;

  var avgTau = onset > rtBeat.onsetAvg ? (dj ? 0.88 : 1.10) : (dj ? 0.30 : 0.34);
  rtBeat.onsetAvg = follow(rtBeat.onsetAvg, onset, avgTau, avgTau);
  rtBeat.onsetPeak = Math.max(rtBeat.onsetPeak * Math.pow(dj ? 0.986 : 0.988, dt * 60), onset, 0.032);
  var floor = rtBeat.onsetAvg * (dj ? 0.88 : 0.84);
  var score = clamp01((onset - floor) / Math.max(dj ? 0.013 : 0.014, rtBeat.onsetPeak - floor));
  var subNorm = clamp01(sub / Math.max(0.045, rtBeat.subPeak * (dj ? 0.72 : 0.70)));
  var lowNorm = clamp01(low / Math.max(0.060, rtBeat.lowPeak * (dj ? 0.74 : 0.72)));
  var bodyNorm = clamp01(body / Math.max(0.045, rtBeat.bodyPeak * (dj ? 0.74 : 0.72)));
  var vocalNorm = clamp01(vocal / Math.max(0.045, rtBeat.vocalPeak * 0.72));
  var snapNorm = clamp01(snap / Math.max(0.040, rtBeat.snapPeak * (dj ? 0.78 : 0.72)));
  var nowT = audio.currentTime || 0;
  rtBeat.primedFrames++;
  var warmingUp = nowT < rtBeat.warmupUntil || rtBeat.primedFrames < (dj ? 5 : 10);
  var gapFromLast = nowT - rtBeat.lastHitAt;
  var expectedGap = rtBeat.tempoGap > 0 ? rtBeat.tempoGap : 0;
  var phaseErr = expectedGap > 0 ? Math.abs(gapFromLast - expectedGap) : 99;
  var phaseWindow = expectedGap > 0 ? Math.max(dj ? 0.055 : 0.055, Math.min(dj ? 0.105 : 0.105, expectedGap * (dj ? 0.16 : 0.16))) : 0;
  var tempoDue = expectedGap > 0 && gapFromLast > expectedGap - phaseWindow && gapFromLast < expectedGap + phaseWindow;
  var lowPresence = Math.max(lowNorm, subNorm * 0.74);
  var lowAttack = lowRise + lowFlux * 0.72 + subRise * 0.58 + subFlux * 0.40;
  var lowDominance = low / Math.max(0.001, vocal * 0.84 + body * 0.36 + snap * 0.10);
  var lowFluxDominance = (lowFlux + subFlux * 0.58) / Math.max(0.001, vocalFlux * 0.72 + bodyFlux * 0.42 + snapFlux * 0.16);
  var sonicCamera = readSonicRealtimeCameraSample();
  var sonicKickAssist = false;
  if (sonicCamera) {
    lowPresence = Math.max(lowPresence, sonicCamera.lowPresence);
    lowAttack = Math.max(lowAttack, sonicCamera.lowAttack, lowAttack + sonicCamera.lowAttack * 0.35);
    score = Math.max(score, sonicCamera.score);
    lowDominance = Math.max(lowDominance, sonicCamera.lowDominance);
    lowFluxDominance = Math.max(lowFluxDominance, sonicCamera.lowFluxDominance);
    sonicKickAssist = sonicCamera.score > 0.44 && sonicCamera.lowPresence > 0.42 && sonicCamera.lowDominance > 0.96;
  }
  var voiceMask = dj
    ? (vocalNorm > 0.64 && lowDominance < 0.88 && lowFluxDominance < 1.02 && subNorm < 0.50 && !sonicKickAssist)
    : (vocalNorm > 0.60 && lowDominance < 0.80 && lowFluxDominance < 1.04 && !sonicKickAssist);
  var fastGroove = rtBeat.tempoGap > 0 && rtBeat.tempoGap < (dj ? 0.48 : 0.52);
  var drumGate = lowPresence > (dj ? 0.38 : 0.34) && lowAttack > Math.max(dj ? 0.012 : 0.011, rtBeat.onsetAvg * (dj ? 0.30 : 0.26)) && !voiceMask;
  drumGate = drumGate && (lowDominance > (dj ? 0.78 : 0.64) || lowFluxDominance > (dj ? 1.04 : 0.92) || subNorm > (dj ? 0.54 : 0.48) || sonicKickAssist);
  var strongTransient = drumGate && score > (dj ? 0.48 : 0.46) && (drumOnset > rtBeat.onsetAvg * (dj ? 0.72 : 0.66) || sonicKickAssist);
  var kickTransient = drumGate && score > (dj ? 0.36 : 0.34) && lowAttack > Math.max(dj ? 0.015 : 0.014, rtBeat.onsetAvg * (dj ? 0.40 : 0.34));
  var fastTransient = drumGate && (fastGroove || sonicKickAssist) && score > (dj ? 0.34 : 0.32) && lowPresence > (dj ? 0.42 : 0.38);
  var tempoAssist = tempoDue && rtBeat.tempoConfidence > (dj ? 0.34 : 0.34) && drumGate && lowPresence > (dj ? 0.42 : 0.36) && score > (dj ? 0.24 : 0.18) && lowAttack > Math.max(0.012, rtBeat.onsetAvg * (dj ? 0.34 : 0.26));
  var candidateHit = strongTransient || kickTransient || fastTransient || tempoAssist;
  if (warmingUp && !sonicKickAssist) candidateHit = false;
  var hasTempoLock = expectedGap >= (dj ? 0.32 : 0.42) && expectedGap <= (dj ? 0.92 : 0.88) && rtBeat.tempoConfidence > (dj ? 0.36 : 0.38);
  var lockedWindow = hasTempoLock ? Math.max(dj ? 0.062 : 0.070, Math.min(dj ? 0.118 : 0.110, expectedGap * (dj ? 0.17 : 0.16))) : 0;
  var gapRaw = nowT - rtBeat.lastHitAt;
  var rhythmAccept = false;
  if (candidateHit) {
    if (rtBeat.lastHitAt < 0) {
      rhythmAccept = (strongTransient || sonicKickAssist) && score > (dj ? 0.50 : 0.50) && lowPresence > (dj ? 0.44 : 0.40);
    } else if (hasTempoLock) {
      var oneBeatErr = Math.abs(gapRaw - expectedGap);
      var twoBeatErr = Math.abs(gapRaw - expectedGap * 2);
      rhythmAccept = oneBeatErr <= lockedWindow && (kickTransient || strongTransient || fastTransient);
      rhythmAccept = rhythmAccept || (twoBeatErr <= lockedWindow * 1.35 && strongTransient && score > (dj ? 0.54 : 0.58));
      rhythmAccept = rhythmAccept || (gapRaw > expectedGap * 1.20 && (strongTransient || fastTransient) && lowPresence > (dj ? 0.44 : 0.38));
      if (dj) {
        rhythmAccept = rhythmAccept || (gapRaw > expectedGap * 1.24 && strongTransient && score > 0.56 && lowDominance > 0.92);
      }
    } else {
      var looseRealtimeMin = dj ? 0.285 : Math.max(0.255, beatCam.realtimeMinInterval * 0.72);
      rhythmAccept = gapRaw >= looseRealtimeMin && (strongTransient || (kickTransient && score > (dj ? 0.42 : 0.40)) || fastTransient) && score > (dj ? 0.46 : 0.42) && lowPresence > (dj ? 0.44 : 0.38);
    }
  }
  var hit = candidateHit && rhythmAccept;
  if (!hit && (candidateHit || score > 0.42 || vocalNorm > 0.62 || bodyNorm > 0.54)) rtBeat.stats.rejected++;
  var minGap = hasTempoLock
    ? Math.max(dj ? 0.255 : 0.255, Math.min(dj ? 0.430 : 0.460, expectedGap * (dj ? 0.54 : 0.56)))
    : (dj ? 0.285 : Math.max(0.255, beatCam.realtimeMinInterval * 0.72));
  if (hit && gapRaw < minGap) {
    if ((fastTransient || sonicKickAssist) && gapRaw > minGap * 0.78 && score > (dj ? 0.42 : 0.40) && lowPresence > (dj ? 0.44 : 0.38)) {
      hit = true;
    } else {
      rtBeat.stats.blocked++;
      hit = false;
    }
  }

  rtBeat.prevSub = sub;
  rtBeat.prevLow = low;
  rtBeat.prevBody = body;
  rtBeat.prevVocal = vocal;
  rtBeat.prevSnap = snap;
  rtBeat.prevRms = rms;
  rtBeat.score = score;
  rtBeat.pulse *= Math.pow(dj ? 0.24 : 0.18, dt);
  rtBeat.tempoConfidence *= Math.pow(dj ? 0.992 : 0.996, dt * 60);

  if (!hit) {
    if (dj) {
      djMode.tempoGap = rtBeat.tempoGap;
      djMode.tempoConfidence = rtBeat.tempoConfidence;
    }
    return { hit: false, score: score, low: lowNorm, body: bodyNorm, vocal: vocalNorm, snap: snapNorm, tempoConfidence: rtBeat.tempoConfidence };
  }

  var gapShift = 0;
  if (rtBeat.lastHitAt > 0) {
    var gap = nowT - rtBeat.lastHitAt;
    while (gap > (dj ? 0.96 : 0.88)) gap *= 0.5;
    while (gap < (dj ? 0.32 : 0.42)) gap *= 2.0;
    if (gap >= (dj ? 0.32 : 0.42) && gap <= (dj ? 0.96 : 0.88)) {
      gapShift = rtBeat.tempoGap ? Math.abs(gap - rtBeat.tempoGap) / Math.max(0.001, rtBeat.tempoGap) : 0;
      var tempoEase = hasTempoLock ? (dj ? 0.12 : 0.10) : (dj ? 0.24 : 0.22);
      if (dj && gapShift > 0.16 && strongTransient && lowDominance > 0.95) tempoEase = Math.min(0.36, tempoEase + gapShift * 0.45);
      rtBeat.tempoGap = rtBeat.tempoGap ? rtBeat.tempoGap * (1 - tempoEase) + gap * tempoEase : gap;
      rtBeat.tempoConfidence = Math.min(1, rtBeat.tempoConfidence + (tempoAssist ? (dj ? 0.04 : 0.04) : (dj ? 0.16 : 0.18)));
    }
  }
  rtBeat.lastHitAt = nowT;
  rtBeat.beatCount++;
  rtBeat.stats.hits++;
  if (tempoAssist) rtBeat.stats.assisted++;
  if (strongTransient || kickTransient) rtBeat.stats.strong++;
  var strength = dj
    ? clamp01(0.18 + score * 0.38 + lowPresence * 0.34 + Math.min(1.35, lowDominance) * 0.08 + rmsFlux * 0.72)
    : clamp01(0.24 + score * 0.36 + lowPresence * 0.34 + Math.min(1.25, lowDominance) * 0.07 + rmsFlux * 0.95);
  if (sonicCamera) strength = Math.max(strength, sonicCamera.strength);
  if (tempoAssist) strength = Math.max(strength, (dj ? 0.46 : 0.48) + rtBeat.tempoConfidence * (dj ? 0.10 : 0.10) + lowPresence * (dj ? 0.14 : 0.14));
  var comboSlot = (rtBeat.beatCount - 1) % 4;
  var combo = comboSlot === 0 ? 'downbeat' : (comboSlot === 1 ? 'push' : (comboSlot === 2 ? 'drop' : 'rebound'));
  if (strength > 0.84 && comboSlot !== 0) combo = 'accent';
  if (dj && strength > 0.78 && snapNorm > 0.56 && comboSlot !== 0) combo = 'accent';
  if (dj && gapShift > 0.14 && strongTransient && lowPresence > 0.52) combo = 'downbeat';
  rtBeat.pulse = Math.max(rtBeat.pulse, strength);
  if (dj) {
    djMode.tempoGap = rtBeat.tempoGap;
    djMode.tempoConfidence = rtBeat.tempoConfidence;
    djMode.sectionChange = Math.max(djMode.sectionChange, Math.min(1, gapShift * 1.4));
    djMode.visualPulse = Math.max(djMode.visualPulse, strength);
    djMode.lastBeatAt = nowT;
  }
  return {
    hit: true,
    time: dj ? Math.max(0, nowT - 0.026) : nowT,
    strength: strength,
    confidence: dj ? clamp01(score * 0.58 + lowPresence * 0.30 + rtBeat.tempoConfidence * 0.12) : clamp01(score * 0.62 + lowPresence * 0.26 + rtBeat.tempoConfidence * 0.12),
    low: Math.max(0.05, lowPresence),
    body: Math.max(0.02, bodyNorm * (dj ? 0.50 : 0.62)),
    snap: Math.max(0.02, snapNorm * (dj ? 0.86 : 1)),
    mass: dj ? clamp01(lowPresence * 0.84 + bodyNorm * 0.10) : clamp01(lowPresence * 0.76 + bodyNorm * 0.20),
    sharpness: dj ? clamp01(snapNorm * 0.58 + bodyNorm * 0.10) : clamp01(snapNorm * 0.70 + bodyNorm * 0.12),
    tempoAssist: tempoAssist,
    tempoGap: rtBeat.tempoGap,
    combo: combo,
    score: score,
    lowDominance: lowDominance,
    dj: dj
  };
}


function mergeRealtimeBeatCamera(time, amp, tone) {
  var best = null;
  var bestDist = beatCam.realtimeMergeWindow;
  for (var i = 0; i < beatCam.events.length; i++) {
    var dist = Math.abs((beatCam.events[i].hit || 0) - time);
    if (dist < bestDist) {
      best = beatCam.events[i];
      bestDist = dist;
    }
  }
  if (!best) return false;
  var nowT = audio ? audio.currentTime : uniforms.uTime.value;
  best.hit = time;
  best.start = nowT - (best.attack || beatCam.attack) * 0.42;
  var mergeMaxAmp = ((tone && tone.dj) || djMode.active) ? 0.62 : 0.62;
  best.amp = Math.min(mergeMaxAmp, Math.max(best.amp || 0, amp));
  if (tone) {
    best.zoomAmp = Math.max(best.zoomAmp || 0, tone.zoomAmp);
    best.thetaAmp = Math.max(best.thetaAmp || 0, tone.thetaAmp);
    best.phiAmp = Math.max(best.phiAmp || 0, tone.phiAmp);
    best.rollAmp = Math.max(best.rollAmp || 0, tone.rollAmp || 0);
    best.low = Math.max(best.low || 0, tone.low);
    best.body = Math.max(best.body || 0, tone.body);
    best.snap = Math.max(best.snap || 0, tone.snap);
    best.mode = tone.mode || best.mode;
    best.dj = !!tone.dj || !!best.dj;
  }
  best.source = 'hybrid';
  beatCam.stats.merged++;
  return true;
}
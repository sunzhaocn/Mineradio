'use strict';

async function analyzeAudioBeats(audioUrl, durationSec, token, options) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return null;
  const _invocationState = {audioUrl: audioUrl, durationSec: durationSec, token: token, options: options};
  _invocationState.renderBand = analyzeAudioBeatsRenderBand.bind(undefined, _invocationState);
  _invocationState.makeFrameEnergy = analyzeAudioBeatsMakeFrameEnergy.bind(undefined, _invocationState);
  _invocationState.percentile = analyzeAudioBeatsPercentile.bind(undefined, _invocationState);
  _invocationState.bandAt = analyzeAudioBeatsBandAt.bind(undefined, _invocationState);
  _invocationState.makeOnset = analyzeAudioBeatsMakeOnset.bind(undefined, _invocationState);
  _invocationState.softGrooveFrameScore = analyzeAudioBeatsSoftGrooveFrameScore.bind(undefined, _invocationState);
  _invocationState.bestSoftGrooveFrameNear = analyzeAudioBeatsBestSoftGrooveFrameNear.bind(undefined, _invocationState);
  _invocationState.scoreSoftGrooveTempoOffset = analyzeAudioBeatsScoreSoftGrooveTempoOffset.bind(undefined, _invocationState);
  _invocationState.estimateSoftGrooveTempoOffset = analyzeAudioBeatsEstimateSoftGrooveTempoOffset.bind(undefined, _invocationState);
  _invocationState.refineSoftGrooveBeatTime = analyzeAudioBeatsRefineSoftGrooveBeatTime.bind(undefined, _invocationState);
  _invocationState.thinSoftGrooveCameraBeats = analyzeAudioBeatsThinSoftGrooveCameraBeats.bind(undefined, _invocationState);

  _invocationState.options = _invocationState.options || {};
  _invocationState.analysisProfile = cinemaAnalysisProfileForSong(_invocationState.options.song);
  _invocationState.softGrooveAnalysis = !!(_invocationState.analysisProfile && _invocationState.analysisProfile.softGroove);
  try {
    beatMapBusy = true;
    if (_invocationState.options.prefetch) showBeatChip('预热下一首节奏…');
    else if (_invocationState.options.background) showBeatChip('后台缓冲节奏…');
    await yieldToIdle(beatAnalysisYieldMs(_invocationState.options, 140, 760));
    if (_invocationState.token !== beatMapToken || window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) { hideBeatChip(); beatMapBusy = false; return null; }
    showBeatChip('正在分析节奏…');
    _invocationState.resp = await fetch(_invocationState.audioUrl);
    if (_invocationState.token !== beatMapToken) { hideBeatChip(); return null; }
    _invocationState.ab = await _invocationState.resp.arrayBuffer();
    if (_invocationState.token !== beatMapToken) { hideBeatChip(); return null; }

    // 用临时 AudioContext 解码 (我们不能复用 audioCtx 因为它可能 closed)
    _invocationState.TmpCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!_invocationState.TmpCtx) { hideBeatChip(); return null; }
    _invocationState.DecodeCtx = window.AudioContext || window.webkitAudioContext;
    _invocationState.dc = new _invocationState.DecodeCtx();
    _invocationState.buffer = await new Promise(function (resolve, reject) {
      _invocationState.dc.decodeAudioData(_invocationState.ab.slice(0), resolve, reject);
    }).catch(function (e) { console.warn('decode failed:', e); return null; });
    _invocationState.dc.close && _invocationState.dc.close();
    if (!_invocationState.buffer) { hideBeatChip(); return null; }
    if (_invocationState.token !== beatMapToken) { hideBeatChip(); return null; }

    _invocationState.musicTempoBeats = [];
    _invocationState.musicTempoGridStep = 0;
    _invocationState.musicTempoTask = _invocationState.options.skipMusicTempo ? Promise.resolve(null) : analyzeMusicTempoInWorker(_invocationState.buffer, _invocationState.token);

    // 用 OfflineAudioContext 分离低频重鼓 / 中频鼓身 / 高频敲击感.
    _invocationState.sr = _invocationState.buffer.sampleRate;
    
    _invocationState.bands = [];
    _invocationState.bands.push(await _invocationState.renderBand(38, 155));
    if (_invocationState.token !== beatMapToken || !_invocationState.bands[0]) { hideBeatChip(); return null; }
    _invocationState.bands.push(await _invocationState.renderBand(130, 420));
    if (_invocationState.token !== beatMapToken || !_invocationState.bands[1]) { hideBeatChip(); return null; }
    _invocationState.bands.push(await _invocationState.renderBand(420, 2600));
    if (_invocationState.token !== beatMapToken || !_invocationState.bands[2]) { hideBeatChip(); return null; }
    _invocationState.bands.push(await _invocationState.renderBand(1800, 9000));
    if (_invocationState.token !== beatMapToken) { hideBeatChip(); return null; }
    _invocationState.lowPcm = _invocationState.bands[0];
    _invocationState.bodyPcm = _invocationState.bands[1];
    _invocationState.vocalPcm = _invocationState.bands[2];
    _invocationState.snapPcm = _invocationState.bands[3];

    // 帧化能量 (10ms 窗口)
    _invocationState.winSize = Math.floor(_invocationState.sr * 0.010);
    
    _invocationState.frameBands = [];
    _invocationState.frameBands.push(await _invocationState.makeFrameEnergy(_invocationState.lowPcm));
    await yieldToIdle(beatAnalysisYieldMs(_invocationState.options, 90, 520));
    _invocationState.frameBands.push(await _invocationState.makeFrameEnergy(_invocationState.bodyPcm));
    await yieldToIdle(beatAnalysisYieldMs(_invocationState.options, 90, 520));
    _invocationState.frameBands.push(await _invocationState.makeFrameEnergy(_invocationState.vocalPcm));
    await yieldToIdle(beatAnalysisYieldMs(_invocationState.options, 90, 520));
    _invocationState.frameBands.push(await _invocationState.makeFrameEnergy(_invocationState.snapPcm));
    if (_invocationState.token !== beatMapToken || !_invocationState.frameBands[0] || !_invocationState.frameBands[1] || !_invocationState.frameBands[2] || !_invocationState.frameBands[3]) { hideBeatChip(); return null; }
    _invocationState.energy = _invocationState.frameBands[0];
    _invocationState.bodyEnergy = _invocationState.frameBands[1];
    _invocationState.vocalEnergy = _invocationState.frameBands[2];
    _invocationState.snapEnergy = _invocationState.frameBands[3];
    _invocationState.nFrames = Math.min(_invocationState.energy.length, _invocationState.bodyEnergy.length, _invocationState.vocalEnergy.length, _invocationState.snapEnergy.length);
    
    
    _invocationState.lowRef = Math.max(0.0008, _invocationState.percentile(_invocationState.energy, 0.86));
    _invocationState.bodyRef = Math.max(0.0008, _invocationState.percentile(_invocationState.bodyEnergy, 0.86));
    _invocationState.vocalRef = Math.max(0.0008, _invocationState.percentile(_invocationState.vocalEnergy, 0.86));
    _invocationState.snapRef = Math.max(0.0008, _invocationState.percentile(_invocationState.snapEnergy, 0.86));

    // 计算 onset (能量正向差分), 然后取峰
    
    _invocationState.onset = _invocationState.makeOnset(_invocationState.energy);
    _invocationState.bodyOnset = _invocationState.makeOnset(_invocationState.bodyEnergy);
    _invocationState.vocalOnset = _invocationState.makeOnset(_invocationState.vocalEnergy);
    _invocationState.snapOnset = _invocationState.makeOnset(_invocationState.snapEnergy);
    _invocationState.lowOnsetRef = Math.max(0.00025, _invocationState.percentile(_invocationState.onset, 0.88));
    _invocationState.bodyOnsetRef = Math.max(0.00025, _invocationState.percentile(_invocationState.bodyOnset, 0.88));
    _invocationState.vocalOnsetRef = Math.max(0.00025, _invocationState.percentile(_invocationState.vocalOnset, 0.88));
    _invocationState.snapOnsetRef = Math.max(0.00025, _invocationState.percentile(_invocationState.snapOnset, 0.88));

    

    

    

    

    

    

    // 自适应阈值: 滑动均值 + 标准差, 输出带强度的 beat 事件.
    _invocationState.winN = 50;  // 0.5 秒
    _invocationState.candidates = [];
    _invocationState.lastKickFrame = -_invocationState.winN;
    _invocationState.minIntervalFrames = 12;  // 120ms, 粒子可响应较密集的低频瞬态.
    for ((_invocationState.f = _invocationState.winN); _invocationState.f < _invocationState.nFrames - 5; _invocationState.f++) {
      _invocationState.sum = 0; _invocationState.sqSum = 0;
      for ((_invocationState.k = _invocationState.f - _invocationState.winN); _invocationState.k < _invocationState.f; _invocationState.k++) { _invocationState.sum += _invocationState.onset[_invocationState.k]; _invocationState.sqSum += _invocationState.onset[_invocationState.k] * _invocationState.onset[_invocationState.k]; }
      _invocationState.mean = _invocationState.sum / _invocationState.winN;
      _invocationState.std = Math.sqrt(Math.max(0, _invocationState.sqSum / _invocationState.winN - _invocationState.mean * _invocationState.mean));
      _invocationState.thresh = _invocationState.mean + _invocationState.std * 2.35 + 0.0045;
      if (_invocationState.onset[_invocationState.f] > _invocationState.thresh && _invocationState.onset[_invocationState.f] > _invocationState.onset[_invocationState.f - 1] && _invocationState.onset[_invocationState.f] >= _invocationState.onset[_invocationState.f + 1]) {
        if (_invocationState.f - _invocationState.lastKickFrame >= _invocationState.minIntervalFrames) {
          _invocationState.localScore = (_invocationState.onset[_invocationState.f] - _invocationState.thresh) / Math.max(0.006, _invocationState.std + _invocationState.mean * 0.35);
          _invocationState.candidates.push({
            frame: _invocationState.f,
            time: _invocationState.f * 0.010,
            raw: _invocationState.onset[_invocationState.f],
            score: _invocationState.localScore,
            lowTone: Math.min(2.0, _invocationState.bandAt(_invocationState.energy, _invocationState.f) / _invocationState.lowRef),
            bodyTone: Math.min(2.0, _invocationState.bandAt(_invocationState.bodyEnergy, _invocationState.f) / _invocationState.bodyRef),
            vocalTone: Math.min(2.0, _invocationState.bandAt(_invocationState.vocalEnergy, _invocationState.f) / _invocationState.vocalRef),
            snapTone: Math.min(2.0, _invocationState.bandAt(_invocationState.snapEnergy, _invocationState.f) / _invocationState.snapRef)
          });
          _invocationState.lastKickFrame = _invocationState.f;
        }
      }
      if (_invocationState.f > _invocationState.winN && _invocationState.f % 900 === 0) {
        await yieldToPaint();
        if (_invocationState.token !== beatMapToken) { hideBeatChip(); return null; }
      }
    }

    _invocationState.scores = _invocationState.candidates.map(function (b) { return b.score; }).sort(function (a, b) { return a - b; });
    _invocationState.p75 = _invocationState.scores.length ? _invocationState.scores[Math.floor(_invocationState.scores.length * 0.75)] : 1;
    _invocationState.p92 = _invocationState.scores.length ? _invocationState.scores[Math.floor(_invocationState.scores.length * 0.92)] : Math.max(1, _invocationState.p75);
    _invocationState.strongTimes = [];
    _invocationState.beats = _invocationState.candidates.map(function (b, i) {
      var strength = Math.max(0.18, Math.min(1, (b.score - _invocationState.p75 * 0.36) / Math.max(0.001, _invocationState.p92 - _invocationState.p75 * 0.36)));
      var lowDominance = b.lowTone / Math.max(0.001, b.vocalTone * 0.84 + b.bodyTone * 0.36 + b.snapTone * 0.10);
      var toneTotal = Math.max(0.001, b.lowTone + b.bodyTone * 0.72 + b.snapTone * 0.58);
      var lowMix = b.lowTone / toneTotal;
      var bodyMix = (b.bodyTone * 0.72) / toneTotal;
      var snapMix = (b.snapTone * 0.58) / toneTotal;
      var drumLike = b.lowTone > 0.38 && (lowMix > 0.42 || lowDominance > 0.72);
      if (strength > 0.55 && drumLike) _invocationState.strongTimes.push(b.time);
      var sharpness = Math.max(0.08, Math.min(1, snapMix * 1.55 + strength * 0.10));
      var mass = Math.max(0.25, Math.min(1, lowMix * 0.72 + bodyMix * 0.36 + strength * 0.20));
      var tone = snapMix > 0.34 && b.snapTone > 0.55 ? 'snap' : (bodyMix > 0.36 && b.bodyTone > 0.55 ? 'body' : (lowMix > 0.55 ? 'deep' : 'mixed'));
      return {
        time: b.time,
        strength: strength,
        confidence: Math.max(0.22, Math.min(1, b.score / Math.max(0.001, _invocationState.p92))),
        primary: drumLike && strength >= 0.50,
        camera: drumLike && strength >= 0.42,
        tone: tone,
        low: lowMix,
        body: bodyMix,
        snap: snapMix,
        mass: mass,
        sharpness: sharpness,
        index: i
      };
    });

    _invocationState.gaps = [];
    for ((_invocationState.gi = 1); _invocationState.gi < _invocationState.strongTimes.length; _invocationState.gi++) {
      _invocationState.gap = _invocationState.strongTimes[_invocationState.gi] - _invocationState.strongTimes[_invocationState.gi - 1];
      if (_invocationState.gap >= 0.26 && _invocationState.gap <= 0.86) _invocationState.gaps.push(_invocationState.gap);
    }
    _invocationState.gaps.sort(function (a, b) { return a - b; });
    _invocationState.gridStep = _invocationState.gaps.length ? _invocationState.gaps[Math.floor(_invocationState.gaps.length * 0.5)] : 0;
    _invocationState.cameraBeats = _invocationState.beats.filter(function (b) { return b.camera; });
    if (_invocationState.gridStep > 0) {
      for ((_invocationState.bi = 0); _invocationState.bi < _invocationState.beats.length; _invocationState.bi++) {
        _invocationState.prevGap = _invocationState.bi > 0 ? _invocationState.beats[_invocationState.bi].time - _invocationState.beats[_invocationState.bi - 1].time : _invocationState.gridStep;
        _invocationState.nextGap = _invocationState.bi < _invocationState.beats.length - 1 ? _invocationState.beats[_invocationState.bi + 1].time - _invocationState.beats[_invocationState.bi].time : _invocationState.gridStep;
        _invocationState.gridLike = Math.abs(_invocationState.prevGap - _invocationState.gridStep) < _invocationState.gridStep * 0.32 || Math.abs(_invocationState.nextGap - _invocationState.gridStep) < _invocationState.gridStep * 0.32;
        _invocationState.beats[_invocationState.bi].primary = _invocationState.beats[_invocationState.bi].camera && _invocationState.beats[_invocationState.bi].strength >= (_invocationState.gridLike ? 0.42 : 0.58);
      }
      if (_invocationState.gridStep >= 0.38 && _invocationState.gridStep <= 0.88 && _invocationState.strongTimes.length >= 4) {
        _invocationState.anchor = _invocationState.strongTimes[0];
        while (_invocationState.anchor - _invocationState.gridStep > 0.20) _invocationState.anchor -= _invocationState.gridStep;
        _invocationState.gridBeats = [];
        _invocationState.windowSec = Math.min(0.18, _invocationState.gridStep * 0.30);
        for ((_invocationState.gt = _invocationState.anchor); _invocationState.gt < _invocationState.buffer.duration - 0.05; _invocationState.gt += _invocationState.gridStep) {
          _invocationState.best = null;
          _invocationState.bestDist = _invocationState.windowSec;
          for ((_invocationState.ci = 0); _invocationState.ci < _invocationState.beats.length; _invocationState.ci++) {
            _invocationState.dist = Math.abs(_invocationState.beats[_invocationState.ci].time - _invocationState.gt);
            if (_invocationState.dist < _invocationState.bestDist) {
              _invocationState.best = _invocationState.beats[_invocationState.ci];
              _invocationState.bestDist = _invocationState.dist;
            }
          }
          if (_invocationState.best && _invocationState.best.camera) {
            _invocationState.best.primary = true;
            _invocationState.best.strength = Math.max(_invocationState.best.strength, 0.54);
            _invocationState.best.confidence = Math.max(_invocationState.best.confidence, 0.58);
            _invocationState.gridBeats.push(_invocationState.best);
          } else {
            _invocationState.gf = Math.max(0, Math.min(_invocationState.nFrames - 1, Math.round(_invocationState.gt / 0.010)));
            _invocationState.lowTone = Math.min(2.0, _invocationState.bandAt(_invocationState.energy, _invocationState.gf) / _invocationState.lowRef);
            _invocationState.bodyTone = Math.min(2.0, _invocationState.bandAt(_invocationState.bodyEnergy, _invocationState.gf) / _invocationState.bodyRef);
            _invocationState.vocalTone = Math.min(2.0, _invocationState.bandAt(_invocationState.vocalEnergy, _invocationState.gf) / _invocationState.vocalRef);
            _invocationState.snapTone = Math.min(2.0, _invocationState.bandAt(_invocationState.snapEnergy, _invocationState.gf) / _invocationState.snapRef);
            _invocationState.lowDominance = _invocationState.lowTone / Math.max(0.001, _invocationState.vocalTone * 0.84 + _invocationState.bodyTone * 0.36 + _invocationState.snapTone * 0.10);
            _invocationState.toneTotal = Math.max(0.001, _invocationState.lowTone + _invocationState.bodyTone * 0.72 + _invocationState.snapTone * 0.58);
            _invocationState.lowMix = _invocationState.lowTone / _invocationState.toneTotal;
            _invocationState.bodyMix = (_invocationState.bodyTone * 0.72) / _invocationState.toneTotal;
            _invocationState.snapMix = (_invocationState.snapTone * 0.58) / _invocationState.toneTotal;
            if (_invocationState.lowTone <= 0.38 || (_invocationState.lowMix <= 0.42 && _invocationState.lowDominance <= 0.72)) continue;
            _invocationState.gridBeats.push({
              time: _invocationState.gt,
              strength: 0.53,
              confidence: 0.60,
              primary: true,
              ghost: true,
              tone: 'grid',
              low: _invocationState.lowMix,
              body: _invocationState.bodyMix,
              snap: _invocationState.snapMix,
              mass: Math.max(0.35, Math.min(0.82, _invocationState.lowMix * 0.72 + _invocationState.bodyMix * 0.36 + 0.16)),
              sharpness: Math.max(0.08, Math.min(0.65, _invocationState.snapMix * 1.25)),
              index: _invocationState.gridBeats.length
            });
          }
        }
        _invocationState.cameraBeats = _invocationState.gridBeats;
      }
    }

    _invocationState.musicTempoResult = await _invocationState.musicTempoTask;
    if (_invocationState.token !== beatMapToken) { hideBeatChip(); return null; }
    if (_invocationState.musicTempoResult && _invocationState.musicTempoResult.beats && _invocationState.musicTempoResult.beats.length) {
      _invocationState.musicTempoBeats = normalizeMusicTempoBeats(_invocationState.musicTempoResult.beats || [], _invocationState.buffer.duration);
      _invocationState.musicTempoGridStep = medianGap(_invocationState.musicTempoBeats, 0.36, 1.00);
      console.log('music-tempo worker:', _invocationState.musicTempoResult.tempo, 'bpm, beats:', _invocationState.musicTempoBeats.length, 'step:', _invocationState.musicTempoGridStep);
    }

    if (_invocationState.musicTempoBeats.length >= 4) {
      _invocationState.musicTempoPhaseOffset = estimateTempoPhaseOffset(_invocationState.musicTempoBeats, _invocationState.beats, _invocationState.musicTempoGridStep || _invocationState.gridStep, _invocationState.buffer.duration);
      if (_invocationState.musicTempoPhaseOffset) {
        _invocationState.musicTempoBeats = _invocationState.musicTempoBeats.map(function (t) { return t + _invocationState.musicTempoPhaseOffset; })
          .filter(function (t) { return isFinite(t) && t >= 0.05 && t < _invocationState.buffer.duration - 0.05; });
        console.log('music-tempo phase correction:', _invocationState.musicTempoPhaseOffset.toFixed(3), 's');
      }
      if (_invocationState.analysisProfile.phaseScan) {
        _invocationState.softGroovePhaseOffset = _invocationState.estimateSoftGrooveTempoOffset(_invocationState.musicTempoBeats, _invocationState.musicTempoGridStep || _invocationState.gridStep);
        if (_invocationState.softGroovePhaseOffset) {
          _invocationState.musicTempoBeats = _invocationState.musicTempoBeats.map(function (t) { return t + _invocationState.softGroovePhaseOffset; })
            .filter(function (t) { return isFinite(t) && t >= 0.05 && t < _invocationState.buffer.duration - 0.05; });
          console.log('soft-groove phase correction:', _invocationState.softGroovePhaseOffset.toFixed(3), 's');
        }
      }
      _invocationState.tempoCameraBeats = [];
      _invocationState.tempoWindow = Math.min(0.16, Math.max(0.095, (_invocationState.musicTempoGridStep || 0.60) * 0.24));
      _invocationState.tempoMetrics = [];
      for ((_invocationState.ti = 0); _invocationState.ti < _invocationState.musicTempoBeats.length; _invocationState.ti++) {
        _invocationState.mtTime = _invocationState.musicTempoBeats[_invocationState.ti];
        _invocationState.refinedPoint = _invocationState.refineSoftGrooveBeatTime(_invocationState.mtTime, _invocationState.musicTempoGridStep || _invocationState.gridStep);
        _invocationState.metricTime = _invocationState.refinedPoint.time;
        _invocationState.nearest = null;
        _invocationState.nearestDist = _invocationState.tempoWindow;
        for ((_invocationState.nb = 0); _invocationState.nb < _invocationState.beats.length; _invocationState.nb++) {
          _invocationState.nd = Math.abs(_invocationState.beats[_invocationState.nb].time - _invocationState.metricTime);
          if (_invocationState.nd < _invocationState.nearestDist) {
            _invocationState.nearest = _invocationState.beats[_invocationState.nb];
            _invocationState.nearestDist = _invocationState.nd;
          }
        }
        _invocationState.mf = Math.max(0, Math.min(_invocationState.nFrames - 1, Math.round(_invocationState.metricTime / 0.010)));
        _invocationState.mtLowTone = Math.min(2.0, _invocationState.bandAt(_invocationState.energy, _invocationState.mf) / _invocationState.lowRef);
        _invocationState.mtBodyTone = Math.min(2.0, _invocationState.bandAt(_invocationState.bodyEnergy, _invocationState.mf) / _invocationState.bodyRef);
        _invocationState.mtVocalTone = Math.min(2.0, _invocationState.bandAt(_invocationState.vocalEnergy, _invocationState.mf) / _invocationState.vocalRef);
        _invocationState.mtSnapTone = Math.min(2.0, _invocationState.bandAt(_invocationState.snapEnergy, _invocationState.mf) / _invocationState.snapRef);
        _invocationState.mtLowRise = Math.min(2.5, (_invocationState.onset[_invocationState.mf] || 0) / _invocationState.lowOnsetRef);
        _invocationState.mtBodyRise = Math.min(2.5, (_invocationState.bodyOnset[_invocationState.mf] || 0) / _invocationState.bodyOnsetRef);
        _invocationState.mtVocalRise = Math.min(2.5, (_invocationState.vocalOnset[_invocationState.mf] || 0) / _invocationState.vocalOnsetRef);
        _invocationState.mtSnapRise = Math.min(2.5, (_invocationState.snapOnset[_invocationState.mf] || 0) / _invocationState.snapOnsetRef);
        _invocationState.mtLowDominance = _invocationState.mtLowTone / Math.max(0.001, _invocationState.mtVocalTone * 0.84 + _invocationState.mtBodyTone * 0.36 + _invocationState.mtSnapTone * 0.10);
        _invocationState.mtToneTotal = Math.max(0.001, _invocationState.mtLowTone + _invocationState.mtBodyTone * 0.72 + _invocationState.mtSnapTone * 0.58);
        _invocationState.mtLowMix = _invocationState.mtLowTone / _invocationState.mtToneTotal;
        _invocationState.mtBodyMix = (_invocationState.mtBodyTone * 0.72) / _invocationState.mtToneTotal;
        _invocationState.mtSnapMix = (_invocationState.mtSnapTone * 0.58) / _invocationState.mtToneTotal;
        _invocationState.mtPower = _invocationState.mtLowTone * 0.44 + _invocationState.mtBodyTone * 0.16 + _invocationState.mtSnapTone * 0.08 + Math.min(1.8, _invocationState.mtLowDominance) * 0.16 + (_invocationState.nearest ? _invocationState.nearest.strength * 0.46 : 0);
        if (_invocationState.softGrooveAnalysis) {
          _invocationState.vocalLeak = Math.max(0, _invocationState.mtVocalRise + _invocationState.mtVocalTone * 0.22 - (_invocationState.mtLowRise + _invocationState.mtBodyRise) * 0.50 - 0.14);
          _invocationState.mtPower = _invocationState.mtLowTone * 0.26 + _invocationState.mtBodyTone * 0.24 + _invocationState.mtLowRise * 0.34 + _invocationState.mtBodyRise * 0.32 + _invocationState.mtSnapRise * 0.06 + Math.min(1.7, _invocationState.mtLowDominance) * 0.10 + (_invocationState.nearest ? _invocationState.nearest.strength * 0.30 : 0) - _invocationState.vocalLeak * 0.16;
        }
        _invocationState.tempoMetrics.push({
          time: _invocationState.metricTime,
          gridTime: _invocationState.mtTime,
          nearest: _invocationState.nearest,
          lowTone: _invocationState.mtLowTone,
          bodyTone: _invocationState.mtBodyTone,
          snapTone: _invocationState.mtSnapTone,
          lowRise: _invocationState.mtLowRise,
          bodyRise: _invocationState.mtBodyRise,
          snapRise: _invocationState.mtSnapRise,
          lowDominance: _invocationState.mtLowDominance,
          lowMix: _invocationState.mtLowMix,
          bodyMix: _invocationState.mtBodyMix,
          snapMix: _invocationState.mtSnapMix,
          power: _invocationState.mtPower,
          softScore: _invocationState.refinedPoint.score || 0,
          index: _invocationState.ti
        });
      }
      _invocationState.tempoPowers = _invocationState.tempoMetrics.map(function (m) { return m.power; });
      _invocationState.tempoLowTones = _invocationState.tempoMetrics.map(function (m) { return m.lowTone; });
      _invocationState.tempoBodyTones = _invocationState.tempoMetrics.map(function (m) { return m.bodyTone; });
      _invocationState.tempoSnapTones = _invocationState.tempoMetrics.map(function (m) { return m.snapTone; });
      _invocationState.tempoLowRises = _invocationState.tempoMetrics.map(function (m) { return m.lowRise || 0; });
      _invocationState.tempoBodyRises = _invocationState.tempoMetrics.map(function (m) { return m.bodyRise || 0; });
      _invocationState.tempoSnapRises = _invocationState.tempoMetrics.map(function (m) { return m.snapRise || 0; });
      _invocationState.powerFloor = Math.max(0.001, _invocationState.percentile(_invocationState.tempoPowers, 0.25));
      _invocationState.powerCeil = Math.max(_invocationState.powerFloor + 0.001, _invocationState.percentile(_invocationState.tempoPowers, 0.90));
      _invocationState.lowFloor = Math.max(0.001, _invocationState.percentile(_invocationState.tempoLowTones, 0.25));
      _invocationState.lowCeil = Math.max(_invocationState.lowFloor + 0.001, _invocationState.percentile(_invocationState.tempoLowTones, 0.88));
      _invocationState.bodyFloor = Math.max(0.001, _invocationState.percentile(_invocationState.tempoBodyTones, 0.25));
      _invocationState.bodyCeil = Math.max(_invocationState.bodyFloor + 0.001, _invocationState.percentile(_invocationState.tempoBodyTones, 0.90));
      _invocationState.snapFloor = Math.max(0.001, _invocationState.percentile(_invocationState.tempoSnapTones, 0.25));
      _invocationState.snapCeil = Math.max(_invocationState.snapFloor + 0.001, _invocationState.percentile(_invocationState.tempoSnapTones, 0.90));
      _invocationState.lowRiseFloor = Math.max(0.001, _invocationState.percentile(_invocationState.tempoLowRises, 0.25));
      _invocationState.lowRiseCeil = Math.max(_invocationState.lowRiseFloor + 0.001, _invocationState.percentile(_invocationState.tempoLowRises, 0.90));
      _invocationState.bodyRiseFloor = Math.max(0.001, _invocationState.percentile(_invocationState.tempoBodyRises, 0.25));
      _invocationState.bodyRiseCeil = Math.max(_invocationState.bodyRiseFloor + 0.001, _invocationState.percentile(_invocationState.tempoBodyRises, 0.90));
      _invocationState.snapRiseFloor = Math.max(0.001, _invocationState.percentile(_invocationState.tempoSnapRises, 0.25));
      _invocationState.snapRiseCeil = Math.max(_invocationState.snapRiseFloor + 0.001, _invocationState.percentile(_invocationState.tempoSnapRises, 0.90));
      for ((_invocationState.tm = 0); _invocationState.tm < _invocationState.tempoMetrics.length; _invocationState.tm++) {
        _invocationState.m = _invocationState.tempoMetrics[_invocationState.tm];
        _invocationState.mtSlot = _invocationState.m.index % 4;
        _invocationState.powerRel = clamp01((_invocationState.m.power - _invocationState.powerFloor) / (_invocationState.powerCeil - _invocationState.powerFloor));
        _invocationState.lowRel = clamp01((_invocationState.m.lowTone - _invocationState.lowFloor) / (_invocationState.lowCeil - _invocationState.lowFloor));
        _invocationState.bodyRel = clamp01((_invocationState.m.bodyTone - _invocationState.bodyFloor) / (_invocationState.bodyCeil - _invocationState.bodyFloor));
        _invocationState.snapRel = clamp01((_invocationState.m.snapTone - _invocationState.snapFloor) / (_invocationState.snapCeil - _invocationState.snapFloor));
        _invocationState.lowRiseRel = clamp01(((_invocationState.m.lowRise || 0) - _invocationState.lowRiseFloor) / (_invocationState.lowRiseCeil - _invocationState.lowRiseFloor));
        _invocationState.bodyRiseRel = clamp01(((_invocationState.m.bodyRise || 0) - _invocationState.bodyRiseFloor) / (_invocationState.bodyRiseCeil - _invocationState.bodyRiseFloor));
        _invocationState.snapRiseRel = clamp01(((_invocationState.m.snapRise || 0) - _invocationState.snapRiseFloor) / (_invocationState.snapRiseCeil - _invocationState.snapRiseFloor));
        _invocationState.mtImpact = clamp01(_invocationState.powerRel * 0.50 + _invocationState.lowRel * 0.24 + _invocationState.bodyRel * 0.18 + _invocationState.snapRel * 0.08);
        if (_invocationState.m.nearest) _invocationState.mtImpact = Math.max(_invocationState.mtImpact, Math.min(1, _invocationState.m.nearest.strength * 0.58 + (_invocationState.m.nearest.primary ? 0.08 : 0)));
        if (_invocationState.softGrooveAnalysis) {
          _invocationState.mtImpact = clamp01(_invocationState.powerRel * 0.34 + _invocationState.lowRel * 0.18 + _invocationState.bodyRel * 0.18 + _invocationState.lowRiseRel * 0.24 + _invocationState.bodyRiseRel * 0.24 + _invocationState.snapRiseRel * 0.04);
          if (_invocationState.m.nearest) _invocationState.mtImpact = Math.max(_invocationState.mtImpact, Math.min(0.72, _invocationState.m.nearest.strength * 0.42 + (_invocationState.m.nearest.primary ? 0.06 : 0)));
        }
        _invocationState.activeCamera = _invocationState.mtImpact >= 0.20 || (_invocationState.mtSlot === 0 && _invocationState.mtImpact >= 0.15 && (_invocationState.lowRel > 0.20 || _invocationState.bodyRel > 0.26));
        _invocationState.activePulse = _invocationState.mtImpact >= 0.24 || (_invocationState.mtSlot === 0 && _invocationState.mtImpact >= 0.18);
        _invocationState.grooveEvidence = _invocationState.lowRiseRel * 0.52 + _invocationState.bodyRiseRel * 0.48 + _invocationState.lowRel * 0.20 + _invocationState.bodyRel * 0.18;
        if (_invocationState.softGrooveAnalysis) {
          _invocationState.activeCamera = _invocationState.mtImpact >= 0.19 || (_invocationState.mtSlot === 0 && _invocationState.mtImpact >= 0.135 && _invocationState.grooveEvidence >= 0.32);
          _invocationState.activePulse = _invocationState.mtImpact >= 0.23 || (_invocationState.mtSlot === 0 && _invocationState.mtImpact >= 0.165 && _invocationState.grooveEvidence >= 0.28);
        }
        _invocationState.downbeatLift = _invocationState.activeCamera ? (_invocationState.mtSlot === 0 ? 0.14 : (_invocationState.mtSlot === 2 ? 0.06 : 0)) : 0;
        _invocationState.mtStrength = 0.26 + _invocationState.powerRel * 0.23 + _invocationState.lowRel * 0.10 + _invocationState.bodyRel * 0.08 + _invocationState.snapRel * 0.04 + _invocationState.downbeatLift;
        if (_invocationState.m.nearest) _invocationState.mtStrength = Math.max(_invocationState.mtStrength, 0.42 + _invocationState.m.nearest.strength * 0.28);
        if (_invocationState.mtSlot === 0 && _invocationState.activeCamera) _invocationState.mtStrength = Math.max(_invocationState.mtStrength, 0.54 + _invocationState.mtImpact * 0.16);
        if (!_invocationState.activeCamera) _invocationState.mtStrength = Math.min(_invocationState.mtStrength, 0.36);
        if (_invocationState.softGrooveAnalysis) {
          _invocationState.mtStrength = 0.24 + _invocationState.powerRel * 0.18 + _invocationState.lowRel * 0.08 + _invocationState.bodyRel * 0.08 + _invocationState.lowRiseRel * 0.13 + _invocationState.bodyRiseRel * 0.12 + _invocationState.downbeatLift * 0.90;
          if (_invocationState.m.nearest) _invocationState.mtStrength = Math.max(_invocationState.mtStrength, 0.36 + _invocationState.m.nearest.strength * 0.22);
          if (_invocationState.mtSlot === 0 && _invocationState.activeCamera) _invocationState.mtStrength = Math.max(_invocationState.mtStrength, 0.50 + _invocationState.mtImpact * 0.15);
          if (_invocationState.mtSlot === 2 && _invocationState.activeCamera) _invocationState.mtStrength = Math.max(_invocationState.mtStrength, 0.43 + _invocationState.mtImpact * 0.10);
          if (!_invocationState.activeCamera) _invocationState.mtStrength = Math.min(_invocationState.mtStrength, 0.34);
          _invocationState.mtStrength = Math.max(0.28, Math.min(0.76, _invocationState.mtStrength));
        } else {
          _invocationState.mtStrength = Math.max(0.30, Math.min(0.82, _invocationState.mtStrength));
        }
        _invocationState.lowForCamera = Math.max(0.22, Math.min(0.78, _invocationState.m.lowMix * 0.82 + _invocationState.lowRel * 0.18));
        _invocationState.tempoCameraBeats.push({
          time: _invocationState.m.time,
          strength: _invocationState.mtStrength,
          confidence: _invocationState.m.nearest ? Math.max(0.60, _invocationState.m.nearest.confidence || 0) : Math.max(0.52, 0.48 + _invocationState.powerRel * 0.28),
          primary: _invocationState.activeCamera,
          camera: _invocationState.activeCamera,
          pulse: _invocationState.activePulse,
          impact: _invocationState.mtImpact,
          tone: 'music-tempo',
          grooveEvidence: _invocationState.grooveEvidence,
          low: _invocationState.lowForCamera,
          body: _invocationState.m.bodyMix,
          snap: _invocationState.m.snapMix,
          mass: Math.max(0.35, Math.min(0.86, _invocationState.lowForCamera * 0.68 + _invocationState.m.bodyMix * 0.24 + _invocationState.mtStrength * 0.16)),
          sharpness: Math.max(0.08, Math.min(0.65, _invocationState.m.snapMix * 1.18)),
          combo: _invocationState.mtSlot === 0 ? 'downbeat' : (_invocationState.mtSlot === 1 ? 'push' : (_invocationState.mtSlot === 2 ? 'drop' : 'rebound')),
          index: _invocationState.m.index
        });
      }
      if (_invocationState.tempoCameraBeats.length >= 4) {
        if (_invocationState.analysisProfile.sparseCamera) {
          _invocationState.tempoCameraBeats = _invocationState.thinSoftGrooveCameraBeats(_invocationState.tempoCameraBeats, _invocationState.musicTempoGridStep || _invocationState.gridStep, _invocationState.buffer.duration);
        }
        _invocationState.cameraBeats = _invocationState.tempoCameraBeats;
        _invocationState.gridStep = _invocationState.musicTempoGridStep || _invocationState.gridStep;
      }
    }

    _invocationState.kicks = _invocationState.beats.map(function (b) { return b.time; });
    _invocationState.visualBeatCount = 0;
    _invocationState.pulseBeats = _invocationState.cameraBeats.filter(function (b) {
      if (typeof b === 'number') {
        _invocationState.visualBeatCount++;
        return true;
      }
      var active = b.primary !== false && b.camera !== false && b.pulse !== false;
      if (active) _invocationState.visualBeatCount++;
      return active && (b.strength >= 0.38 || (b.impact || 0) >= 0.20);
    }).map(function (b) {
      if (typeof b === 'number') return { time: b, strength: 0.42, impact: 0.42 };
      return {
        time: b.time,
        strength: b.strength,
        impact: b.impact == null ? b.strength : b.impact,
        combo: b.combo,
        low: b.low,
        body: b.body,
        snap: b.snap
      };
    });
    await yieldToPaint();
    if (_invocationState.token !== beatMapToken) { hideBeatChip(); return null; }
    if (_invocationState.options.prefetch) hideBeatChip();
    else showBeatChip('节奏缓冲中…');
    return { kicks: _invocationState.kicks, beats: _invocationState.beats, pulseBeats: _invocationState.pulseBeats, cameraBeats: _invocationState.cameraBeats, gridStep: _invocationState.gridStep, tempoSource: _invocationState.musicTempoBeats.length >= 4 ? 'music-tempo' : 'local', analysisProfile: _invocationState.analysisProfile.id || 'default', duration: _invocationState.buffer.duration, visualBeatCount: _invocationState.visualBeatCount, analyzedAt: Date.now() };
  } catch (e) {
    console.warn('beat analysis failed:', e);
    hideBeatChip();
    return null;
  } finally {
    beatMapBusy = false;
  }
}

'use strict';

function analyzeAudioBeatsSoftGrooveFrameScore(_invocationState, frame) {
      var sf = Math.max(0, Math.min(_invocationState.nFrames - 1, Math.round(frame)));
      var lowTone = Math.min(2.2, _invocationState.bandAt(_invocationState.energy, sf) / _invocationState.lowRef);
      var bodyTone = Math.min(2.2, _invocationState.bandAt(_invocationState.bodyEnergy, sf) / _invocationState.bodyRef);
      var vocalTone = Math.min(2.2, _invocationState.bandAt(_invocationState.vocalEnergy, sf) / _invocationState.vocalRef);
      var snapTone = Math.min(2.2, _invocationState.bandAt(_invocationState.snapEnergy, sf) / _invocationState.snapRef);
      var lowRise = Math.min(2.6, (_invocationState.onset[sf] || 0) / _invocationState.lowOnsetRef);
      var bodyRise = Math.min(2.6, (_invocationState.bodyOnset[sf] || 0) / _invocationState.bodyOnsetRef);
      var vocalRise = Math.min(2.6, (_invocationState.vocalOnset[sf] || 0) / _invocationState.vocalOnsetRef);
      var snapRise = Math.min(2.6, (_invocationState.snapOnset[sf] || 0) / _invocationState.snapOnsetRef);
      var drumRise = lowRise * 0.52 + bodyRise * 0.42 + snapRise * 0.08;
      var drumTone = lowTone * 0.24 + bodyTone * 0.22 + snapTone * 0.05;
      var vocalLeak = Math.max(0, vocalRise + vocalTone * 0.30 - (lowRise + bodyRise) * 0.54 - 0.18);
      return Math.max(0, drumRise + drumTone - vocalLeak * 0.18);
    }

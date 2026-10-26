'use strict';

function analyzeAudioBeatsMakeOnset(_invocationState, arr) {
      var out = new Float32Array(_invocationState.nFrames);
      for (var oi = 1; oi < _invocationState.nFrames; oi++) {
        out[oi] = Math.max(0, arr[oi] - arr[oi - 1]);
      }
      return out;
    }

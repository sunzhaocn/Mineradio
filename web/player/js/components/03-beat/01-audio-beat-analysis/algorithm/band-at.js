'use strict';

function analyzeAudioBeatsBandAt(_invocationState, arr, f) {
      var a = arr[Math.max(0, f - 1)] || 0;
      var b = arr[f] || 0;
      var c = arr[Math.min(_invocationState.nFrames - 1, f + 1)] || 0;
      return (a + b * 2 + c) * 0.25;
    }

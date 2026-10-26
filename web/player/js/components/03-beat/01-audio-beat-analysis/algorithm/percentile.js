'use strict';

function analyzeAudioBeatsPercentile(_invocationState, arr, p) {
      var copy = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; });
      return copy.length ? copy[Math.floor(copy.length * p)] : 0.001;
    }

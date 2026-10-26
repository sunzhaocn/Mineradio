'use strict';

function analyzeAudioBeatsRefineSoftGrooveBeatTime(_invocationState, time, step) {
      if (!_invocationState.softGrooveAnalysis || !_invocationState.analysisProfile.localRefine) return { time: time, score: 0, base: 0 };
      var radius = Math.min(0.058, Math.max(0.024, (step || 0.55) * 0.095));
      var point = _invocationState.bestSoftGrooveFrameNear(time, radius);
      if (Math.abs(point.time - time) < 0.011) return { time: time, score: point.score, base: point.base };
      if (point.score < point.base * 1.045) return { time: time, score: point.score, base: point.base };
      return { time: point.time, score: point.score, base: point.base };
    }

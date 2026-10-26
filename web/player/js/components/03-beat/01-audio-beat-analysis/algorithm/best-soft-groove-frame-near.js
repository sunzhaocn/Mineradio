'use strict';

function analyzeAudioBeatsBestSoftGrooveFrameNear(_invocationState, time, radiusSec) {
      var center = Math.max(0, Math.min(_invocationState.nFrames - 1, Math.round(time / 0.010)));
      var radius = Math.max(1, Math.round(Math.max(0.010, radiusSec || 0.040) / 0.010));
      var base = _invocationState.softGrooveFrameScore(center);
      var bestFrame = center;
      var bestScore = base;
      for (var sf = Math.max(0, center - radius); sf <= Math.min(_invocationState.nFrames - 1, center + radius); sf++) {
        var dist = Math.abs(sf - center) / Math.max(1, radius);
        var score = _invocationState.softGrooveFrameScore(sf) * (1 - dist * 0.16);
        if (score > bestScore) {
          bestScore = score;
          bestFrame = sf;
        }
      }
      return { frame: bestFrame, time: bestFrame * 0.010, score: bestScore, base: base };
    }

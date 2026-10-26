'use strict';

async function analyzeAudioBeatsMakeFrameEnergy(_invocationState, pcm) {
      var frames = Math.floor(pcm.length / _invocationState.winSize);
      var out = new Float32Array(frames);
      for (var f = 0; f < frames; f++) {
        var s = 0;
        var off2 = f * _invocationState.winSize;
        for (var i = 0; i < _invocationState.winSize; i++) {
          var v = pcm[off2 + i];
          s += v * v;
        }
        out[f] = Math.sqrt(s / _invocationState.winSize);
        if (f > 0 && f % 520 === 0) {
          await yieldToPaint();
          if (_invocationState.token !== beatMapToken) return null;
        }
      }
      return out;
    }

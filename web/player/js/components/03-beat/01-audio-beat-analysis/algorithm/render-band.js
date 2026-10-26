'use strict';

async function analyzeAudioBeatsRenderBand(_invocationState, hpFreq, lpFreq) {
      var off = new _invocationState.TmpCtx(1, _invocationState.buffer.length, _invocationState.sr);
      var src = off.createBufferSource(); src.buffer = _invocationState.buffer;
      var node = src;
      if (hpFreq) {
        var hp = off.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = Math.min(hpFreq, _invocationState.sr * 0.45);
        hp.Q.value = 0.85;
        node.connect(hp);
        node = hp;
      }
      if (lpFreq) {
        var lp = off.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.min(lpFreq, _invocationState.sr * 0.45);
        lp.Q.value = 0.9;
        node.connect(lp);
        node = lp;
      }
      node.connect(off.destination);
      src.start(0);
      var renderedBand = await off.startRendering();
      if (_invocationState.token !== beatMapToken) return null;
      await yieldToIdle(beatAnalysisYieldMs(_invocationState.options, 110, 620));
      return renderedBand.getChannelData(0);
    }

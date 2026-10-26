'use strict';

// ============================================================
var prevTime = performance.now();

var renderPerfState = {
  mode: 'vsync',
  fps: 0,
  frames: 0,
  skipped: 0,
  longFrames: 0,
  targetFps: 0,
  displayHz: 60,
  adaptiveDivisor: 1,
  adaptiveKind: '',
  adaptivePressure: 0,
  adaptiveFrameCostMs: 0,
  adaptiveCadenceTick: 0,
  lastRenderAt: 0,
  lastSampleAt: performance.now()
};

window.__mineradioRenderPerf = renderPerfState;

if (window.__mineradioPerf && typeof window.__mineradioPerf.registerRenderState === 'function') {
  window.__mineradioPerf.registerRenderState(renderPerfState);
} else {
  window.__mineradioPerf = renderPerfState;
}

var splashWarmRenderLast = 0;

var fixedRenderCadenceState = {
  key: '',
  lastCheckAt: 0,
  phase: 0
};

var mainFrameGates = {
  audio: createFrameGate('main.audio', 60),
  shelf: createFrameGate('main.shelf', 30),
  lyricsParticles: createFrameGate('main.lyricsParticles', 45),
  stageLyrics: createFrameGate('main.stageLyrics', 45),
  skullParticles: createFrameGate('main.skullParticles', 45),
  homeAudio: createFrameGate('main.homeAudio', 15),
  desktopOverlay: createFrameGate('main.desktopOverlay', 12)
};

window.__mineradioMainFrameGates = mainFrameGates;

var mainLoopBackgroundTimer = 0;

var mainLoopAnimationRequested = false;

document.addEventListener('visibilitychange', function () {
  if (!mainLoopDeepBackgroundSleeping()) wakeMainLoopFromBackground();
});

window.addEventListener('focus', wakeMainLoopFromBackground);

// Desktop previews may enter the compact player and return; phones that
// started in simple mode keep the visual loop stopped for this page lifetime.
window.addEventListener('resize', wakeMainLoopFromBackground);

requestMainLoopAnimationFrame();

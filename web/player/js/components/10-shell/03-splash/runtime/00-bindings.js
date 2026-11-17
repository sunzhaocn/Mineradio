'use strict';

// ============================================================

document.body.classList.add('splash-active');

var prepareStartupSplash = !!window.desktopWindow?.prepareStartupSplash;

var splashAnimating = !prepareStartupSplash && !(window.mineradioSimplePlayer && window.mineradioSimplePlayer.active());

var splashCanvas = null, splashCtx = null;

var splashGl = null, splashGlProgram = null, splashGlBuffer = null, splashGlUniforms = null;

var splashW = 0, splashH = 0;

var splashDust = [];

var splashStreaks = [];

var splashShards = [];

var splashPixelRatio = 1;

var splashStartedAt = prepareStartupSplash ? 0 : performance.now();

var splashSoundPlayed = false;

var splashAudioCtx = null;

var splashSoundFallbackArmed = false;

var splashTimer = null;

var reduceSplashMotion = false;

var splashReadyToEnter = false;


function initMineradioSplashCanvas() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  splashCanvas = document.getElementById('splash-canvas');
  if (!splashCanvas) return;
  if (!reduceSplashMotion && initMineradioSplashWebgl(splashCanvas)) {
    splashCtx = null;
  } else {
    splashCtx = splashCanvas.getContext('2d');
    if (!splashCtx) {
      // A canvas with a failed WebGL program can still own a WebGL context.
      var fallbackCanvas = splashCanvas.cloneNode(false);
      splashCanvas.replaceWith(fallbackCanvas);
      splashCanvas = fallbackCanvas;
      splashCtx = splashCanvas.getContext('2d');
    }
  }
  function resize() {
    splashPixelRatio = Math.min(1.6, Math.max(1, window.devicePixelRatio || 1));
    splashW = window.innerWidth;
    splashH = window.innerHeight;
    splashCanvas.width = Math.max(1, Math.floor(splashW * splashPixelRatio));
    splashCanvas.height = Math.max(1, Math.floor(splashH * splashPixelRatio));
    if (splashCtx) splashCtx.setTransform(splashPixelRatio, 0, 0, splashPixelRatio, 0, 0);
    if (splashGl) splashGl.viewport(0, 0, splashCanvas.width, splashCanvas.height);
    splashDust = [];
    splashStreaks = [];
    splashShards = [];
    var count = reduceSplashMotion ? 28 : 84;
    for (var i = 0; i < count; i++) {
      splashDust.push({
        x: Math.random() * splashW,
        y: Math.random() * splashH,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.11,
        r: Math.random() * 1.35 + 0.28,
        a: Math.random() * 0.105 + 0.025,
        p: Math.random() * Math.PI * 2
      });
    }
    var streakColors = [
      'rgba(244,210,138,',
      'rgba(122,215,194,',
      'rgba(255,83,103,',
      'rgba(157,184,207,'
    ];
    var streakCount = reduceSplashMotion ? 6 : 22;
    for (var s = 0; s < streakCount; s++) {
      splashStreaks.push({
        x: Math.random() * splashW,
        y: splashH * (0.20 + Math.random() * 0.62),
        len: splashW * (0.12 + Math.random() * 0.24),
        width: 0.75 + Math.random() * 2.1,
        speed: splashW * (0.00028 + Math.random() * 0.00042),
        angle: (-10 + Math.random() * 20) * Math.PI / 180,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[s % streakColors.length],
        delay: Math.random() * 1.1,
        alpha: 0.18 + Math.random() * 0.36
      });
    }
    var shardCount = reduceSplashMotion ? 10 : 34;
    for (var h = 0; h < shardCount; h++) {
      splashShards.push({
        ox: (Math.random() - 0.5) * splashW * 0.92,
        oy: (Math.random() - 0.5) * splashH * 0.22,
        w: 18 + Math.random() * 86,
        h: 1 + Math.random() * 5,
        skew: (Math.random() - 0.5) * 20,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[h % streakColors.length],
        alpha: 0.10 + Math.random() * 0.24
      });
    }
  }
  resize();
  window.addEventListener('resize', resize);
}

if (!prepareStartupSplash) {
  initMineradioSplashCanvas();
  drawMineradioSplash();
}


onMineradioDomReady(function () {
  var s = document.getElementById('splash');
  if (!s) return;
  markAppPerf('dom-content-loaded');
  if (startupFastSkipPreference || window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) {
    s.classList.remove('preparing');
    dismissSplash({ instant: true });
    return;
  }
  armSplashSoundFallback();
  prewarmHomeWallpaperPreview();
  function requestSplashEnter() {
    playMineradioIntroSound();
    if (splashReadyToEnter) dismissSplash();
  }
  s.addEventListener('click', requestSplashEnter);
  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('splash-active')) return;
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      requestSplashEnter();
    }
  });
  function startSplash() {
    if (!reduceSplashMotion) playMineradioIntroSound();
    if (prepareStartupSplash) {
      s.classList.remove('preparing');
      splashStartedAt = performance.now();
      splashAnimating = true;
      markAppPerf('splash-start');
      drawMineradioSplash();
    }
    if (reduceSplashMotion) s.classList.add('reduce-motion');
    splashTimer = setTimeout(markSplashReadyToEnter, reduceSplashMotion ? 650 : 1500);
  }
  if (!prepareStartupSplash) {
    startSplash();
    return;
  }
  requestAnimationFrame(function () {
    initMineradioSplashCanvas();
    try {
      renderMainSceneForSplash(performance.now());
    } catch (error) {
      console.warn('Could not warm the player scene:', error);
    }
    if (splashGl) {
      // Prime the original shader and drawing surface before the animation clock starts.
      drawMineradioSplashWebgl(0);
      splashGl.finish();
    }
    markAppPerf('splash-prepared');

    // Let the first resize and layout frames settle while the scene is static.
    var deadline = performance.now() + 350;
    var previousFrame = performance.now();
    var steadyFrames = 0;
    function waitForSplashPaint() {
      var now = performance.now();
      steadyFrames = now - previousFrame <= 32 ? steadyFrames + 1 : 0;
      previousFrame = now;
      if (steadyFrames >= 3 || now >= deadline) {
        startSplash();
        return;
      }
      if (splashGl) drawMineradioSplashWebgl(0);
      requestAnimationFrame(waitForSplashPaint);
    }
    requestAnimationFrame(waitForSplashPaint);
  });
});

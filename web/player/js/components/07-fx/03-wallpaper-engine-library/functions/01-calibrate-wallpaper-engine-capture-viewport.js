'use strict';



function calibrateWallpaperEngineCaptureViewport(video, runtime) {
  if (!video || !runtime || runtime.sourceWindowAligned !== true) {
    resetWallpaperEngineCaptureViewport(video);
    return { scaleX: 1, scaleY: 1 };
  }
  var content = wallpaperEngineCaptureContentSize(runtime);
  var frameWidth = Number(video.videoWidth) || Number(runtime.width) || 0;
  var frameHeight = Number(video.videoHeight) || Number(runtime.height) || 0;
  var rawScaleX = content.width > 0 ? frameWidth / content.width : 1;
  var rawScaleY = content.height > 0 ? frameHeight / content.height : 1;
  var scaleX = rawScaleX > 1.015 && rawScaleX < 4.01 ? rawScaleX : 1;
  var scaleY = rawScaleY > 1.015 && rawScaleY < 4.01 ? rawScaleY : 1;
  // Wallpaper Engine's play-in-window surface is reported in Windows DIPs,
  // while desktopCapturer exposes a physical-pixel frame on scaled displays.
  // Crop the padded right/bottom portion by enlarging only the captured layer.
  if (scaleX !== 1 && scaleY !== 1 && Math.abs(scaleX - scaleY) <= 0.035) {
    var uniformScale = (scaleX + scaleY) / 2;
    scaleX = uniformScale;
    scaleY = uniformScale;
  }
  wallpaperEngineCaptureViewportScaleX = scaleX;
  wallpaperEngineCaptureViewportScaleY = scaleY;
  video.style.transformOrigin = '0 0';
  video.style.transform = (scaleX === 1 && scaleY === 1)
    ? ''
    : 'scale3d(' + scaleX.toFixed(6) + ',' + scaleY.toFixed(6) + ',1)';
  var layer = document.getElementById('wallpaper-engine-layer');
  if (layer) {
    layer.dataset.captureScaleX = scaleX.toFixed(6);
    layer.dataset.captureScaleY = scaleY.toFixed(6);
  }
  return { scaleX: scaleX, scaleY: scaleY };
}


function captureWallpaperEngineFreezeFrame() {
  var layer = document.getElementById('wallpaper-engine-layer');
  var canvas = document.getElementById('wallpaper-engine-freeze');
  var video = document.getElementById('wallpaper-engine-video');
  if (!layer || !canvas || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
  if (wallpaperEngineFreezeReleaseTimer) clearTimeout(wallpaperEngineFreezeReleaseTimer);
  wallpaperEngineFreezeReleaseTimer = 0;
  ++wallpaperEngineFreezeGeneration;
  try {
    var freezeScale = Math.min(1, 3840 / Math.max(1, video.videoWidth), 2160 / Math.max(1, video.videoHeight));
    var width = Math.max(1, Math.round(video.videoWidth * freezeScale));
    var height = Math.max(1, Math.round(video.videoHeight * freezeScale));
    var sourceWidth = Math.max(1, Math.min(video.videoWidth, Math.round(video.videoWidth / Math.max(1, wallpaperEngineCaptureViewportScaleX))));
    var sourceHeight = Math.max(1, Math.min(video.videoHeight, Math.round(video.videoHeight / Math.max(1, wallpaperEngineCaptureViewportScaleY))));
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
    if (!context) return false;
    context.globalCompositeOperation = 'copy';
    context.drawImage(video, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
  } catch (error) {
    return false;
  }
  wallpaperEngineFreezeVisible = true;
  layer.classList.add('ready', 'video-ready', 'engine-ready', 'freeze-ready');
  document.body.classList.add('wallpaper-engine-active');
  return true;
}


function clearWallpaperEngineFreezeFrame(immediate) {
  var layer = document.getElementById('wallpaper-engine-layer');
  var canvas = document.getElementById('wallpaper-engine-freeze');
  if (wallpaperEngineFreezeReleaseTimer) clearTimeout(wallpaperEngineFreezeReleaseTimer);
  wallpaperEngineFreezeReleaseTimer = 0;
  var generation = ++wallpaperEngineFreezeGeneration;
  wallpaperEngineFreezeVisible = false;
  if (layer) layer.classList.remove('freeze-ready');
  function releaseCanvas() {
    if (generation !== wallpaperEngineFreezeGeneration || wallpaperEngineFreezeVisible || !canvas) return;
    canvas.width = 1;
    canvas.height = 1;
  }
  if (immediate) releaseCanvas();
  else wallpaperEngineFreezeReleaseTimer = setTimeout(function () {
    wallpaperEngineFreezeReleaseTimer = 0;
    releaseCanvas();
  }, WALLPAPER_ENGINE_FREEZE_FADE_MS + 30);
}


function stopWallpaperEngineMediaStream(stream) {
  if (!stream || !stream.getTracks) return;
  stream.getTracks().forEach(function (track) {
    try { track.stop(); } catch (e) { }
  });
}


function stopWallpaperEnginePreparedCaptureStreams(sessionId) {
  var expected = String(sessionId || '');
  wallpaperEnginePreparedCaptureStreams.forEach(function (entry, id) {
    if (expected && id !== expected) return;
    if (entry && entry.timer) clearTimeout(entry.timer);
    stopWallpaperEngineMediaStream(entry && entry.stream);
    wallpaperEnginePreparedCaptureStreams.delete(id);
  });
}


function stopWallpaperEnginePreparedGlassCaptureStreams(sessionId) {
  var expected = String(sessionId || '');
  wallpaperEnginePreparedGlassCaptureStreams.forEach(function (entry, id) {
    if (expected && id !== expected) return;
    if (entry && entry.timer) clearTimeout(entry.timer);
    stopWallpaperEngineMediaStream(entry && entry.stream);
    wallpaperEnginePreparedGlassCaptureStreams.delete(id);
  });
}


function storeWallpaperEnginePreparedCaptureStream(sessionId, stream) {
  sessionId = String(sessionId || '');
  stopWallpaperEnginePreparedCaptureStreams(sessionId);
  var entry = { stream: stream, timer: 0 };
  entry.timer = setTimeout(function () {
    if (wallpaperEnginePreparedCaptureStreams.get(sessionId) !== entry) return;
    wallpaperEnginePreparedCaptureStreams.delete(sessionId);
    stopWallpaperEngineMediaStream(stream);
  }, WALLPAPER_ENGINE_PREPARED_STREAM_TTL_MS);
  wallpaperEnginePreparedCaptureStreams.set(sessionId, entry);
}


function takeWallpaperEnginePreparedCaptureStream(sessionId) {
  sessionId = String(sessionId || '');
  var entry = wallpaperEnginePreparedCaptureStreams.get(sessionId);
  if (!entry) return null;
  wallpaperEnginePreparedCaptureStreams.delete(sessionId);
  if (entry.timer) clearTimeout(entry.timer);
  return entry.stream || null;
}


function storeWallpaperEnginePreparedGlassCaptureStream(sessionId, stream) {
  sessionId = String(sessionId || '');
  stopWallpaperEnginePreparedGlassCaptureStreams(sessionId);
  var entry = { stream: stream, timer: 0 };
  entry.timer = setTimeout(function () {
    if (wallpaperEnginePreparedGlassCaptureStreams.get(sessionId) !== entry) return;
    wallpaperEnginePreparedGlassCaptureStreams.delete(sessionId);
    stopWallpaperEngineMediaStream(stream);
  }, WALLPAPER_ENGINE_PREPARED_STREAM_TTL_MS);
  wallpaperEnginePreparedGlassCaptureStreams.set(sessionId, entry);
}


function takeWallpaperEnginePreparedGlassCaptureStream(sessionId) {
  sessionId = String(sessionId || '');
  var entry = wallpaperEnginePreparedGlassCaptureStreams.get(sessionId);
  if (!entry) return null;
  wallpaperEnginePreparedGlassCaptureStreams.delete(sessionId);
  if (entry.timer) clearTimeout(entry.timer);
  return entry.stream || null;
}


function stopWallpaperEngineGlassCaptureStream(keepPreparedStreams) {
  ++wallpaperEngineGlassCaptureToken;
  if (wallpaperEngineGlassCaptureRetryTimer) clearTimeout(wallpaperEngineGlassCaptureRetryTimer);
  wallpaperEngineGlassCaptureRetryTimer = 0;
  wallpaperEngineGlassCaptureRetryAttempt = 0;
  if (!keepPreparedStreams) stopWallpaperEnginePreparedGlassCaptureStreams();
  var stream = wallpaperEngineGlassCaptureStream;
  wallpaperEngineGlassCaptureStream = null;
  stopWallpaperEngineMediaStream(stream);
  var video = document.getElementById('wallpaper-engine-glass-sampler-video');
  if (video) {
    video.onloadeddata = null;
    video.onerror = null;
    try { video.pause(); } catch (e) { }
    if (video.srcObject) {
      try { video.srcObject = null; } catch (e2) { }
    }
  }
  document.body.classList.remove('wallpaper-engine-glass-sampler-ready');
}


function stopWallpaperEngineCaptureStream(keepPreparedStreams) {
  cancelWallpaperEngineFirstFrameWait();
  cancelWallpaperEnginePointerActivity();
  if (!keepPreparedStreams) stopWallpaperEnginePreparedCaptureStreams();
  var stream = wallpaperEngineCaptureStream;
  wallpaperEngineCaptureStream = null;
  wallpaperEngineCaptureMode = '';
  stopWallpaperEngineMediaStream(stream);
  stopWallpaperEngineGlassCaptureStream(keepPreparedStreams);
  var video = document.getElementById('wallpaper-engine-video');
  resetWallpaperEngineCaptureViewport(video);
  if (video && video.srcObject) {
    try { video.srcObject = null; } catch (e2) { }
  }
}


async function hardenWallpaperEngineCaptureStream(stream) {
  if (!stream) return stream;
  var audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
  audioTracks.forEach(function (track) {
    try { if (stream.removeTrack) stream.removeTrack(track); } catch (e) { }
    try { track.stop(); } catch (e2) { }
  });
  var tracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
  var cursorResults = await Promise.all(tracks.map(function (track) {
    if (!track || typeof track.applyConstraints !== 'function') return Promise.resolve(false);
    return Promise.resolve(track.applyConstraints({ cursor: 'never' })).then(function () {
      try {
        var settings = typeof track.getSettings === 'function' ? track.getSettings() : null;
        // Chromium's legacy chromeMediaSource path can resolve applyConstraints
        // while silently omitting the cursor setting and continuing to bake a
        // delayed software pointer into the captured frame. Only an explicit
        // `never` acknowledgement counts as verified suppression.
        if (!settings || settings.cursor !== 'never') return false;
      } catch (e3) { return false; }
      return true;
    }).catch(function () { return false; });
  }));
  try {
    stream.__mineradioCursorSuppressed = !!tracks.length && cursorResults.every(function (value) { return value === true; });
  } catch (e4) { }
  return stream;
}


function wallpaperEngineCaptureFpsPreference() {
  var mode = typeof normalizeForegroundFpsMode === 'function'
    ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode)
    : 'vsync';
  var fixed = typeof foregroundFixedFpsForMode === 'function'
    ? foregroundFixedFpsForMode(mode)
    : (/^(45|60|75|90|120)$/.test(String(mode)) ? Number(mode) : 0);
  return Number(fixed) > 0 ? Math.max(24, Math.min(240, Math.round(Number(fixed)))) : 0;
}


function wallpaperEngineResolvedCaptureFps(value) {
  var fps = Number(value);
  if (!(fps > 0)) {
    fps = typeof estimatedDisplayRefreshHz === 'function' ? estimatedDisplayRefreshHz() : 60;
  }
  return Math.max(24, Math.min(240, Math.round(Number(fps) || 60)));
}


function wallpaperEngineRuntimeCaptureFps() {
  var preferred = wallpaperEngineCaptureFpsPreference();
  return preferred > 0 ? preferred : wallpaperEngineResolvedCaptureFps(0);
}


async function syncWallpaperEngineCaptureFrameRate() {
  var stream = wallpaperEngineCaptureStream;
  var track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (!track || typeof track.applyConstraints !== 'function') return { ok: false, skipped: true };
  var target = wallpaperEngineRuntimeCaptureFps();
  try {
    var capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
    var range = capabilities && capabilities.frameRate;
    if (range && Number(range.min) > 0) target = Math.max(Number(range.min), target);
    if (range && Number(range.max) > 0) target = Math.min(Number(range.max), target);
  } catch (e) { }
  try {
    await track.applyConstraints({ frameRate: { ideal: target, max: target } });
    try { track.contentHint = 'motion'; } catch (e2) { }
    return { ok: true, fps: target };
  } catch (error) {
    return { ok: false, error: String(error && (error.message || error.name) || error || 'FRAME_RATE_CONSTRAINT_FAILED').slice(0, 240) };
  }
}


function stopWallpaperEngineNativeSession(sessionId) {
  var api = wallpaperEngineDesktopApi();
  var stopAll = arguments.length === 0;
  var expected = String(sessionId || wallpaperEngineNativeSessionId || '');
  if (stopAll || !sessionId || expected === wallpaperEngineNativeSessionId) wallpaperEngineNativeSessionId = '';
  if (!api || typeof api.stopWallpaperEngineScene !== 'function') return Promise.resolve({ ok: true });
  return Promise.resolve(api.stopWallpaperEngineScene({ sessionId: expected, all: stopAll })).catch(function () {
    return { ok: false };
  });
}
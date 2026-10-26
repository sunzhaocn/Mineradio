'use strict';



async function openWallpaperEngineCaptureStream(sessionId, fps, sourceId, options) {
  if (!navigator.mediaDevices || !/^[a-f0-9]{24}$/i.test(String(sessionId || ''))) {
    throw new Error('WALLPAPER_CAPTURE_UNSUPPORTED');
  }
  options = options && typeof options === 'object' ? options : {};
  sourceId = String(sourceId || '');
  var maxFrameRate = wallpaperEngineResolvedCaptureFps(fps);
  var diagnostics = {
    sessionId: String(sessionId || ''),
    sourceId: sourceId,
    maxFrameRate: maxFrameRate,
    attempts: [],
    selectedPath: '',
    purpose: options.purpose === 'dwm-glass' ? 'dwm-glass' : 'scene',
    sourceIdOnly: options.sourceIdOnly === true,
    trustedCursorFreeSurface: options.trustedCursorFreeSurface === true
  };
  try {
    if (diagnostics.purpose === 'dwm-glass') window.__mineradioWallpaperEngineGlassCaptureDiagnostics = diagnostics;
    else window.__mineradioWallpaperEngineCaptureDiagnostics = diagnostics;
  } catch (e) { }
  function recordAttempt(path, stream, error) {
    var track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    var entry = {
      path: path,
      ok: !!track,
      cursorSuppressed: !!(stream && stream.__mineradioCursorSuppressed),
      settings: null,
      constraints: null,
      error: error ? String(error && (error.message || error.name) || error).slice(0, 500) : ''
    };
    try { entry.settings = track && typeof track.getSettings === 'function' ? track.getSettings() : null; } catch (e2) { }
    try { entry.constraints = track && typeof track.getConstraints === 'function' ? track.getConstraints() : null; } catch (e3) { }
    diagnostics.attempts.push(entry);
    return entry;
  }
  // The exact desktop-source path is the only built-in Chromium route that may
  // omit the captured cursor while keeping the real WE window under the host.
  // Use it only when the video track explicitly acknowledges cursor: never.
  // A resolved request without that acknowledgement is stopped immediately.
  var sourceError = null;
  if (/^window:\d+:\d+$/.test(sourceId) && typeof navigator.mediaDevices.getUserMedia === 'function') {
    try {
      var sourceStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          cursor: { exact: 'never' },
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxFrameRate: maxFrameRate
          }
        }
      });
      if (sourceStream && sourceStream.getVideoTracks && sourceStream.getVideoTracks().length) {
        var hardenedSourceStream = await hardenWallpaperEngineCaptureStream(sourceStream);
        try { hardenedSourceStream.__mineradioCapturePath = 'source-id-media'; } catch (e4) { }
        var sourceAttempt = recordAttempt('source-id-media', hardenedSourceStream, null);
        if (sourceAttempt.cursorSuppressed || options.trustedCursorFreeSurface === true
          || window.__mineradioAllowUnverifiedSourceCapture === true) {
          try { hardenedSourceStream.__mineradioUnverifiedCursorCapture = !sourceAttempt.cursorSuppressed; } catch (e5) { }
          diagnostics.selectedPath = 'source-id-media';
          return hardenedSourceStream;
        }
        stopWallpaperEngineMediaStream(hardenedSourceStream);
        sourceError = new Error('WALLPAPER_CAPTURE_CURSOR_SUPPRESSION_UNVERIFIED');
      } else {
        stopWallpaperEngineMediaStream(sourceStream);
        throw new Error('WALLPAPER_CAPTURE_STREAM_EMPTY');
      }
    } catch (error) {
      sourceError = error;
      recordAttempt('source-id-media', null, error);
    }
  }
  var displayError = null;
  if (options.sourceIdOnly === true) {
    displayError = new Error('DISPLAY_MEDIA_FALLBACK_DISABLED');
    recordAttempt('display-media-disabled', null, displayError);
  }
  // Electron still grants only the exact WE source here. On current Chromium,
  // getDisplayMedia can report cursor: always even when never was requested;
  // retain it as the visual compatibility fallback and record that fact rather
  // than treating the requested constraint as proof of cursor suppression.
  if (options.sourceIdOnly !== true && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
    try {
      var displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { frameRate: { ideal: maxFrameRate, max: maxFrameRate }, displaySurface: 'window', cursor: 'never' }
      });
      if (displayStream && displayStream.getVideoTracks && displayStream.getVideoTracks().length) {
        var hardenedDisplayStream = await hardenWallpaperEngineCaptureStream(displayStream);
        try { hardenedDisplayStream.__mineradioCapturePath = 'display-media'; } catch (e6) { }
        recordAttempt('display-media', hardenedDisplayStream, null);
        diagnostics.selectedPath = 'display-media';
        return hardenedDisplayStream;
      }
      stopWallpaperEngineMediaStream(displayStream);
      throw new Error('WALLPAPER_CAPTURE_STREAM_EMPTY');
    } catch (error) {
      displayError = error;
      recordAttempt('display-media', null, error);
    }
  }
  var displayName = String(displayError && displayError.name || 'Error');
  var displayMessage = String(displayError && displayError.message || displayError || 'display-media unavailable');
  var sourceMessage = String(sourceError && (sourceError.message || sourceError.name) || 'source-id-media unavailable');
  throw new Error('WALLPAPER_CAPTURE_FAILED: ' + displayName + ': ' + displayMessage + ' (source: ' + sourceMessage + ')');
}


function reportWallpaperEngineCaptureResult(sessionId, ok) {
  var api = wallpaperEngineDesktopApi();
  if (!api || typeof api.reportWallpaperEngineCaptureResult !== 'function') return Promise.resolve({ ok: false });
  return Promise.resolve(api.reportWallpaperEngineCaptureResult({ sessionId: String(sessionId || ''), ok: ok === true })).catch(function () {
    return { ok: false };
  });
}


function waitForWallpaperEngineVideoFirstFrame(video, item, token, sessionId, runtime) {
  cancelWallpaperEngineFirstFrameWait();
  var wait = {
    video: video,
    callbackId: 0,
    loadedDataHandler: null,
    timer: 0,
    raf1: 0,
    raf2: 0
  };
  wallpaperEngineFirstFrameWait = wait;

  function releaseWait() {
    if (wallpaperEngineFirstFrameWait !== wait) return false;
    wallpaperEngineFirstFrameWait = null;
    if (wait.timer) clearTimeout(wait.timer);
    wait.timer = 0;
    if (wait.video && wait.loadedDataHandler) {
      try { wait.video.removeEventListener('loadeddata', wait.loadedDataHandler); } catch (e) { }
    }
    if (wait.raf1 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wait.raf1);
    if (wait.raf2 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wait.raf2);
    wait.raf1 = 0;
    wait.raf2 = 0;
    wait.loadedDataHandler = null;
    return true;
  }

  function firstFrameReady() {
    if (!releaseWait()) return;
    if (!wallpaperEngineNativeStartIsCurrent(item, token)
      || wallpaperEngineNativeSessionId !== sessionId
      || wallpaperEngineCaptureStream !== video.srcObject) return;
    reportWallpaperEngineCaptureResult(sessionId, true).then(function (acknowledgement) {
      if (!wallpaperEngineNativeStartIsCurrent(item, token)
        || wallpaperEngineNativeSessionId !== sessionId
        || wallpaperEngineCaptureStream !== video.srcObject) return;
      if (!acknowledgement
        || acknowledgement.ok !== true
        || acknowledgement.accepted !== true
        || acknowledgement.captureReady !== true) {
        wallpaperEngineRuntimeError = String(acknowledgement && acknowledgement.error || 'WALLPAPER_CAPTURE_CONFIRMATION_FAILED');
        wallpaperEngineLayerFailed(item, 'engine', token);
        return;
      }
      calibrateWallpaperEngineCaptureViewport(video, runtime);
      wallpaperEngineLayerReady('video', token);
      clearWallpaperEngineFreezeFrame(false);
    });
  }

  function firstFrameTimedOut() {
    if (!releaseWait()) return;
    if (!wallpaperEngineNativeStartIsCurrent(item, token) || wallpaperEngineNativeSessionId !== sessionId) return;
    wallpaperEngineLayerFailed(item, 'engine', token);
  }

  wait.timer = setTimeout(firstFrameTimedOut, WALLPAPER_ENGINE_FIRST_FRAME_TIMEOUT_MS);
  if (typeof video.requestVideoFrameCallback === 'function') {
    wait.callbackId = video.requestVideoFrameCallback(function () { firstFrameReady(); });
  } else {
    wait.loadedDataHandler = function () {
      // loadeddata can reflect the reused video element's previous source.
      // Two paints after this session's event ensure its new pixels presented.
      wait.raf1 = requestAnimationFrame(function () {
        wait.raf2 = requestAnimationFrame(function () { firstFrameReady(); });
      });
    };
    video.addEventListener('loadeddata', wait.loadedDataHandler, { once: true });
  }
}


function wallpaperEngineNativeStartIsCurrent(item, token) {
  return token === wallpaperEngineLayerToken
    && wallpaperEngineSelection.active
    && wallpaperEngineSelection.id === item.id
    && !wallpaperEngineNativeHostUnavailable();
}


function wallpaperEngineGlassSamplerIsCurrent(sessionId, layerToken, captureToken) {
  return captureToken === wallpaperEngineGlassCaptureToken
    && layerToken === wallpaperEngineLayerToken
    && String(wallpaperEngineNativeSessionId || '') === String(sessionId || '')
    && wallpaperEngineSelection.active
    && wallpaperEngineSelection.kind === 'engine'
    && wallpaperEngineCaptureMode === 'dwm-thumbnail'
    && document.body.classList.contains('wallpaper-engine-dwm-active');
}


function waitForWallpaperEngineGlassSamplerFrame(video, stream, timeoutMs) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = 0;
    var pollTimer = 0;
    function finish(ok) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (pollTimer) clearTimeout(pollTimer);
      resolve(ok === true);
    }
    function ready() {
      var track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      return !!(video && video.srcObject === stream && track && track.readyState === 'live'
        && video.readyState >= 2 && video.videoWidth >= 2 && video.videoHeight >= 2);
    }
    function poll() {
      if (ready()) { finish(true); return; }
      pollTimer = setTimeout(poll, 40);
    }
    timer = setTimeout(function () { finish(false); }, Math.max(1000, Number(timeoutMs) || 5000));
    poll();
  });
}


function sampleWallpaperEngineGlassSamplerPixels(video) {
  if (!video || video.readyState < 2 || video.videoWidth < 2 || video.videoHeight < 2) return null;
  try {
    var canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 14;
    var context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    var rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    var rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (var sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4) {
      rgb[targetIndex++] = rgba[sourceIndex];
      rgb[targetIndex++] = rgba[sourceIndex + 1];
      rgb[targetIndex++] = rgba[sourceIndex + 2];
    }
    return rgb;
  } catch (e) {
    return null;
  }
}


function wallpaperEngineGlassSamplerPixelDifference(first, second) {
  if (!first || !second || first.length !== second.length || !first.length) return 0;
  var difference = 0;
  for (var index = 0; index < first.length; index += 1) {
    difference += Math.abs(first[index] - second[index]);
  }
  return difference / first.length;
}


function waitForWallpaperEngineGlassSamplerPixelChange(video, stream, baseline, timeoutMs) {
  return new Promise(function (resolve) {
    var settled = false;
    var pollTimer = 0;
    var deadline = performance.now() + Math.max(800, Number(timeoutMs) || 3200);
    function finish(result) {
      if (settled) return;
      settled = true;
      if (pollTimer) clearTimeout(pollTimer);
      resolve(result || null);
    }
    function poll() {
      var track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      if (!video || video.srcObject !== stream || !track || track.readyState !== 'live') {
        finish(null);
        return;
      }
      var current = sampleWallpaperEngineGlassSamplerPixels(video);
      var difference = wallpaperEngineGlassSamplerPixelDifference(baseline, current);
      if (current && (!baseline || difference >= 1.25)) {
        finish({ pixels: current, meanAbsoluteRgb: difference });
        return;
      }
      if (performance.now() >= deadline) { finish(null); return; }
      pollTimer = setTimeout(poll, 45);
    }
    pollTimer = setTimeout(poll, 80);
  });
}


function scheduleWallpaperEngineGlassSamplerCapture(sessionId, layerToken, attempt) {
  if (wallpaperEngineGlassCaptureRetryTimer) clearTimeout(wallpaperEngineGlassCaptureRetryTimer);
  wallpaperEngineGlassCaptureRetryTimer = 0;
  attempt = Math.max(0, Number(attempt) || 0);
  wallpaperEngineGlassCaptureRetryAttempt = attempt;
  if (attempt > 4 || layerToken !== wallpaperEngineLayerToken
    || String(wallpaperEngineNativeSessionId || '') !== String(sessionId || '')) return false;
  wallpaperEngineGlassCaptureRetryTimer = setTimeout(function () {
    wallpaperEngineGlassCaptureRetryTimer = 0;
    ensureWallpaperEngineGlassSamplerCapture(sessionId, layerToken, attempt);
  }, attempt === 0 ? 90 : Math.min(2400, 260 * Math.pow(1.8, attempt)));
  return true;
}
'use strict';



async function ensureWallpaperEngineGlassSamplerCapture(sessionId, layerToken, attempt) {
  sessionId = String(sessionId || '');
  attempt = Math.max(0, Number(attempt) || 0);
  var api = wallpaperEngineDesktopApi();
  var video = document.getElementById('wallpaper-engine-glass-sampler-video');
  if (!api || typeof api.prepareWallpaperEngineGlassCapture !== 'function' || !video
    || !/^[a-f0-9]{24}$/i.test(sessionId)
    || layerToken !== wallpaperEngineLayerToken
    || sessionId !== String(wallpaperEngineNativeSessionId || '')
    || wallpaperEngineCaptureMode !== 'dwm-thumbnail') return false;
  var activeTrack = wallpaperEngineGlassCaptureStream && wallpaperEngineGlassCaptureStream.getVideoTracks
    ? wallpaperEngineGlassCaptureStream.getVideoTracks()[0] : null;
  if (activeTrack && activeTrack.readyState === 'live'
    && String(video.dataset.wallpaperEngineSession || '') === sessionId) {
    document.body.classList.add('wallpaper-engine-glass-sampler-ready');
    return true;
  }
  if (typeof syncWallpaperEngineControlGlassSurface === 'function') {
    syncWallpaperEngineControlGlassSurface(true);
  }
  stopWallpaperEngineGlassCaptureStream(false);
  var captureToken = ++wallpaperEngineGlassCaptureToken;
  try {
    await new Promise(function (resolve) { setTimeout(resolve, 90); });
    if (!wallpaperEngineGlassSamplerIsCurrent(sessionId, layerToken, captureToken)) return false;
    var prepared = await api.prepareWallpaperEngineGlassCapture({
      sessionId: sessionId,
      fps: Math.min(60, wallpaperEngineRuntimeCaptureFps())
    });
    if (!wallpaperEngineGlassSamplerIsCurrent(sessionId, layerToken, captureToken)) {
      stopWallpaperEnginePreparedGlassCaptureStreams(sessionId);
      return false;
    }
    if (!prepared || prepared.ok !== true || prepared.capturePrepared !== true) {
      throw new Error(prepared && prepared.error || 'WALLPAPER_GLASS_CAPTURE_PREPARE_FAILED');
    }
    var stream = takeWallpaperEnginePreparedGlassCaptureStream(sessionId);
    var track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    if (!track) {
      stopWallpaperEngineMediaStream(stream);
      throw new Error('WALLPAPER_GLASS_CAPTURE_PREPARED_STREAM_MISSING');
    }
    wallpaperEngineGlassCaptureStream = stream;
    video.dataset.wallpaperEngineSession = sessionId;
    video.muted = true;
    video.loop = false;
    video.playsInline = true;
    video.srcObject = stream;
    try { track.contentHint = 'motion'; } catch (e) { }
    var playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') await playResult.catch(function () { return null; });
    var frameReady = await waitForWallpaperEngineGlassSamplerFrame(video, stream, 5000);
    if (!frameReady || !wallpaperEngineGlassSamplerIsCurrent(sessionId, layerToken, captureToken)
      || video.srcObject !== stream) {
      throw new Error('WALLPAPER_GLASS_CAPTURE_FIRST_FRAME_TIMEOUT');
    }
    var primingPixels = sampleWallpaperEngineGlassSamplerPixels(video);
    if (typeof api.activateWallpaperEngineDwmSurface !== 'function') {
      throw new Error('WALLPAPER_ENGINE_DWM_ACTIVATE_HANDLER_MISSING');
    }
    var activated = await api.activateWallpaperEngineDwmSurface({ sessionId: sessionId });
    if (!activated || activated.ok !== true || activated.active !== true
      || !wallpaperEngineGlassSamplerIsCurrent(sessionId, layerToken, captureToken)) {
      throw new Error(activated && activated.error || 'WALLPAPER_ENGINE_DWM_SURFACE_FAILED');
    }
    // The capture session was opened while the helper HWND was a plain black
    // surface. Confirm its pixels changed after DWM activation before exposing
    // the clipped sampler beneath the saved SVG glass. This remains reliable
    // even when Chromium marks the transparent host as document.hidden.
    var livePixels = await waitForWallpaperEngineGlassSamplerPixelChange(video, stream, primingPixels, 3600);
    if (!livePixels || !wallpaperEngineGlassSamplerIsCurrent(sessionId, layerToken, captureToken)) {
      throw new Error('WALLPAPER_GLASS_CAPTURE_LIVE_PIXELS_TIMEOUT');
    }
    wallpaperEngineGlassCaptureRetryAttempt = 0;
    document.body.classList.add('wallpaper-engine-glass-sampler-ready');
    try {
      window.__mineradioWallpaperEngineGlassSamplerState = {
        ok: true,
        sessionId: sessionId,
        captureMode: 'dwm-glass-svg-sampler',
        videoWidth: Number(video.videoWidth) || 0,
        videoHeight: Number(video.videoHeight) || 0,
        meanAbsoluteRgbFromPriming: Number(livePixels.meanAbsoluteRgb) || 0,
        trackSettings: typeof track.getSettings === 'function' ? track.getSettings() : null
      };
    } catch (e2) { }
    track.addEventListener('ended', function () {
      if (!wallpaperEngineGlassSamplerIsCurrent(sessionId, layerToken, captureToken)) return;
      stopWallpaperEngineGlassCaptureStream(false);
      scheduleWallpaperEngineGlassSamplerCapture(sessionId, layerToken, 1);
    }, { once: true });
    video.onerror = function () {
      if (!wallpaperEngineGlassSamplerIsCurrent(sessionId, layerToken, captureToken)) return;
      stopWallpaperEngineGlassCaptureStream(false);
      scheduleWallpaperEngineGlassSamplerCapture(sessionId, layerToken, 1);
    };
    return true;
  } catch (error) {
    if (captureToken === wallpaperEngineGlassCaptureToken) {
      try {
        window.__mineradioWallpaperEngineGlassSamplerState = {
          ok: false,
          sessionId: sessionId,
          captureMode: 'dwm-glass-svg-sampler',
          error: String(error && (error.message || error.name) || error || 'WALLPAPER_GLASS_CAPTURE_FAILED').slice(0, 500)
        };
      } catch (e3) { }
      stopWallpaperEngineGlassCaptureStream(false);
      scheduleWallpaperEngineGlassSamplerCapture(sessionId, layerToken, attempt + 1);
    }
    return false;
  }
}


async function startWallpaperEngineNativeBackground(item, token) {
  var api = wallpaperEngineDesktopApi();
  if (!api || typeof api.startWallpaperEngineScene !== 'function') throw new Error('WALLPAPER_ENGINE_RUNTIME_UNAVAILABLE');
  if (!wallpaperEngineNativeStartIsCurrent(item, token)) throw new Error('WALLPAPER_ENGINE_START_SUPERSEDED');
  var result = await api.startWallpaperEngineScene({
    id: item.id,
    width: Math.max(640, Math.min(3840, Math.round(window.innerWidth || 1920))),
    height: Math.max(360, Math.min(2160, Math.round(window.innerHeight || 1080))),
    fps: wallpaperEngineCaptureFpsPreference()
  });
  if (!result || result.ok === false) {
    var failedSessionId = String(result && result.sessionId || '');
    if (/^[a-f0-9]{24}$/i.test(failedSessionId)) {
      stopWallpaperEnginePreparedCaptureStreams(failedSessionId);
      await reportWallpaperEngineCaptureResult(failedSessionId, false);
      await stopWallpaperEngineNativeSession(failedSessionId);
    }
    throw new Error(result && result.error || 'WALLPAPER_ENGINE_SCENE_START_FAILED');
  }
  var sessionId = String(result.sessionId || '');
  if (!/^[a-f0-9]{24}$/i.test(sessionId)) throw new Error('WALLPAPER_ENGINE_SESSION_INVALID');
  if (!wallpaperEngineNativeStartIsCurrent(item, token)) {
    stopWallpaperEnginePreparedCaptureStreams(sessionId);
    await reportWallpaperEngineCaptureResult(sessionId, false);
    await stopWallpaperEngineNativeSession(sessionId);
    throw new Error('WALLPAPER_ENGINE_START_SUPERSEDED');
  }
  if (result.captureMode === 'dwm-thumbnail') {
    stopWallpaperEnginePreparedCaptureStreams();
    stopWallpaperEnginePreparedGlassCaptureStreams();
    stopWallpaperEngineCaptureStream(false);
    wallpaperEngineCaptureMode = 'dwm-thumbnail';
    wallpaperEngineNativeSessionId = sessionId;
    applyWallpaperEngineVisualSettings(true);
    var dwmAcknowledgement = await reportWallpaperEngineCaptureResult(sessionId, true);
    if (!wallpaperEngineNativeStartIsCurrent(item, token)
      || wallpaperEngineNativeSessionId !== sessionId) return;
    if (!dwmAcknowledgement
      || dwmAcknowledgement.ok !== true
      || dwmAcknowledgement.accepted !== true
      || dwmAcknowledgement.captureReady !== true) {
      wallpaperEngineRuntimeError = String(dwmAcknowledgement && dwmAcknowledgement.error
        || 'WALLPAPER_ENGINE_DWM_SURFACE_FAILED');
      wallpaperEngineLayerFailed(item, 'engine', token);
      return;
    }
    wallpaperEngineLayerReady('dwm', token);
    clearWallpaperEngineFreezeFrame(false);
    return;
  }
  stopWallpaperEngineGlassCaptureStream(false);
  var stream = takeWallpaperEnginePreparedCaptureStream(sessionId);
  if (!stream) {
    await reportWallpaperEngineCaptureResult(sessionId, false);
    await stopWallpaperEngineNativeSession(sessionId);
    throw new Error(result.captureError || 'WALLPAPER_CAPTURE_PREPARED_STREAM_MISSING');
  }
  if (!wallpaperEngineNativeStartIsCurrent(item, token)) {
    stopWallpaperEngineMediaStream(stream);
    await reportWallpaperEngineCaptureResult(sessionId, false);
    await stopWallpaperEngineNativeSession(sessionId);
    throw new Error('WALLPAPER_ENGINE_START_SUPERSEDED');
  }
  var video = document.getElementById('wallpaper-engine-video');
  if (!video) {
    stopWallpaperEngineMediaStream(stream);
    await reportWallpaperEngineCaptureResult(sessionId, false);
    await stopWallpaperEngineNativeSession(sessionId);
    throw new Error('WALLPAPER_ENGINE_VIDEO_LAYER_MISSING');
  }
  stopWallpaperEngineCaptureStream(true);
  wallpaperEngineCaptureStream = stream;
  wallpaperEngineCaptureMode = result.captureMode === 'main-prepared' ? 'main-prepared' : 'renderer-prepared';
  wallpaperEngineNativeSessionId = sessionId;
  video.muted = true;
  video.loop = false;
  video.playsInline = true;
  video.onloadedmetadata = function () {
    if (token !== wallpaperEngineLayerToken) return;
    calibrateWallpaperEngineCaptureViewport(video, result);
    requestWallpaperEngineVideoPlayback(video, item, 'engine', token, false, 0);
  };
  video.srcObject = stream;
  waitForWallpaperEngineVideoFirstFrame(video, item, token, sessionId, result);
  var track = stream.getVideoTracks && stream.getVideoTracks()[0];
  if (track) {
    try { track.contentHint = 'motion'; } catch (e2) { }
    track.addEventListener('ended', function () {
      if (token !== wallpaperEngineLayerToken || wallpaperEngineNativeHostUnavailable()) return;
      wallpaperEngineLayerFailed(item, 'engine', token);
    }, { once: true });
  }
  video.onerror = function () { wallpaperEngineLayerFailed(item, 'engine', token); };
  requestWallpaperEngineVideoPlayback(video, item, 'engine', token, false, 0);
}


function wallpaperEnginePlayWasInterrupted(error) {
  var name = String(error && error.name || '');
  var message = String(error && error.message || error || '');
  return name === 'AbortError' || /interrupted|pause\(\)|new load request/i.test(message);
}


function wallpaperEngineRuntimeErrorText(error) {
  var code = String(error && (error.code || error.message) || error || '');
  if (/WALLPAPER_ENGINE_HOST_ELEVATED/.test(code)) return 'Mineradio 正以管理员身份运行，无法捕获 WE 实时窗口；请取消“以管理员身份运行”后重启播放器';
  if (/WALLPAPER_ENGINE_NOT_INSTALLED/.test(code)) return '未找到 Wallpaper Engine 本体';
  if (/WALLPAPER_ENGINE_SIGNATURE_INVALID/.test(code)) return 'Wallpaper Engine 运行时签名无效';
  if (/WALLPAPER_ENGINE_WINDOW_CLOSE_FAILED/.test(code)) return '上一次 Mineradio 实时壁纸窗口仍在收尾，请稍后重试；Wallpaper Engine 本体会保留';
  if (/WALLPAPER_ENGINE_DWM_SURFACE_FAILED|WALLPAPER_ENGINE_PARALLAX_RELAY_FAILED/.test(code)) return 'WE 原生鼠标视差连接失败，本次会话已关闭；请再次点击重连';
  if (/WALLPAPER_ENGINE_CONTROL_FAILED/.test(code)) return 'WE 场景控制暂时未就绪，请稍后重试';
  if (/WALLPAPER_ENGINE_WINDOW_TIMEOUT/.test(code)) return 'WE 场景窗口启动超时';
  if (/WALLPAPER_ENGINE_CAPTURE_UNAVAILABLE|WALLPAPER_CAPTURE_UNSUPPORTED/.test(code)) return '当前系统不支持实时窗口捕获';
  if (/InvalidStateError/.test(code)) return 'WE 实时画面连接需要 Mineradio 保持在前台';
  if (/NotAllowedError|Permission denied|PermissionDismissed/i.test(code)) return 'WE 实时画面捕获权限被拒绝';
  if (/NotReadableError/.test(code)) return 'WE 实时捕获通道暂时忙，已清理本次会话；请再次点击重连';
  if (/WALLPAPER_ENGINE_REFRESH_SUPERSEDED/.test(code)) return 'WE 实时窗口正在切换，请重试';
  if (/WALLPAPER_CAPTURE_PREPARE_TIMEOUT/.test(code)) return 'WE 实时画面连接超时';
  if (/WALLPAPER_CAPTURE_PREPARE_HANDLER_MISSING|WALLPAPER_CAPTURE_PREPARED_STREAM_MISSING/.test(code)) return 'WE 实时画面连接尚未准备完成';
  if (/WALLPAPER_CAPTURE_FAILED|WALLPAPER_CAPTURE_STREAM_EMPTY/.test(code)) return 'WE 实时画面连接失败';
  if (/WALLPAPER_SCENE_PACKAGE_INVALID/.test(code)) return '所选 .pkg/.pak 不是有效的 Wallpaper Engine PKGV 场景包';
  if (/WALLPAPER_SCENE_MANIFEST_INVALID/.test(code)) return '该场景缺少有效的 project.json';
  if (/WALLPAPER_SCENE_NOT_FOUND/.test(code)) return '没有找到该项目的有效场景包';
  return 'WE 引擎运行失败';
}


function requestWallpaperEngineVideoPlayback(video, item, kind, token, revealLayer, attempt) {
  cancelWallpaperEngineVideoRetry();
  if (!video || token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active) return;
  var hostUnavailable = kind === 'engine' ? wallpaperEngineNativeHostUnavailable() : document.hidden;
  if (hostUnavailable) {
    try { video.pause(); } catch (e) { }
    if (revealLayer) wallpaperEngineLayerReady('video', token);
    return;
  }
  var promise;
  try {
    promise = video.play();
  } catch (error) {
    handleWallpaperEngineVideoPlayFailure(error, video, item, kind, token, revealLayer, attempt);
    return;
  }
  if (!promise || !promise.then) {
    if (revealLayer) wallpaperEngineLayerReady('video', token);
    return;
  }
  promise.then(function () {
    if (token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active) return;
    if (revealLayer) wallpaperEngineLayerReady('video', token);
  }).catch(function (error) {
    handleWallpaperEngineVideoPlayFailure(error, video, item, kind, token, revealLayer, attempt);
  });
}


function handleWallpaperEngineVideoPlayFailure(error, video, item, kind, token, revealLayer, attempt) {
  if (token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active) return;
  var hostUnavailable = kind === 'engine' ? wallpaperEngineNativeHostUnavailable() : document.hidden;
  var interrupted = hostUnavailable || wallpaperEnginePlayWasInterrupted(error);
  if (!interrupted) {
    wallpaperEngineLayerFailed(item, kind, token);
    return;
  }
  if (revealLayer) wallpaperEngineLayerReady('video', token);
  if (hostUnavailable || Number(attempt) >= 2) return;
  wallpaperEngineVideoRetryTimer = setTimeout(function () {
    wallpaperEngineVideoRetryTimer = 0;
    requestWallpaperEngineVideoPlayback(video, item, kind, token, false, Number(attempt) + 1);
  }, 160);
}


function clearWallpaperEngineLayerMedia(delay) {
  cancelWallpaperEngineVideoRetry();
  cancelWallpaperEngineFirstFrameWait();
  var token = wallpaperEngineLayerToken;
  var layer = document.getElementById('wallpaper-engine-layer');
  var image = document.getElementById('wallpaper-engine-image');
  var video = document.getElementById('wallpaper-engine-video');
  function release() {
    if (token !== wallpaperEngineLayerToken) return;
    if (layer) layer.classList.remove('ready', 'image-ready', 'video-ready', 'engine-ready', 'freeze-ready');
    clearWallpaperEngineFreezeFrame(true);
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
    }
    if (video) {
      video.onloadeddata = null;
      video.onerror = null;
      try { video.pause(); } catch (e) { }
      if (video.srcObject) {
        try { video.srcObject = null; } catch (e2) { }
      }
      video.removeAttribute('poster');
      video.removeAttribute('src');
      try { video.load(); } catch (e3) { }
    }
    stopWallpaperEngineCaptureStream();
  }
  if (delay) setTimeout(release, delay);
  else release();
}


function restoreOriginalBackgroundAfterWallpaperEngine() {
  document.body.classList.remove('wallpaper-engine-active', 'wallpaper-engine-dwm-active');
  stopWallpaperEngineGlassCaptureStream(false);
  if (typeof syncWallpaperEngineControlGlassSurface === 'function') {
    syncWallpaperEngineControlGlassSurface(true);
  }
  try {
    if (typeof applyCustomBackground === 'function') applyCustomBackground();
  } catch (e) { }
}


function suspendOriginalBackgroundForWallpaperEngine() {
  var video = document.getElementById('custom-bg-video');
  if (video) {
    try { video.pause(); } catch (e) { }
  }
}


function wallpaperEngineLayerReady(kind, token) {
  if (token !== wallpaperEngineLayerToken || !wallpaperEngineSelection.active) return;
  cancelWallpaperEngineHostRecovery(true);
  var layer = document.getElementById('wallpaper-engine-layer');
  if (!layer) return;
  layer.classList.remove('ready', 'image-ready', 'video-ready', 'engine-ready', 'freeze-ready');
  document.body.classList.toggle('wallpaper-engine-dwm-active', kind === 'dwm');
  if (kind !== 'dwm') {
    stopWallpaperEngineGlassCaptureStream(false);
    layer.classList.add(kind === 'video' ? 'video-ready' : 'image-ready', 'ready');
    if (kind === 'video' && wallpaperEngineSelection.kind === 'engine') layer.classList.add('engine-ready');
    if (kind === 'video' && wallpaperEngineSelection.kind === 'engine') queueWallpaperEnginePointerActivity();
  }
  document.body.classList.add('wallpaper-engine-active');
  applyWallpaperEngineVisualSettings(true);
  if (kind === 'dwm' && typeof animateWallpaperEngineControlGlassSurface === 'function') {
    animateWallpaperEngineControlGlassSurface(560);
  }
  if (kind === 'dwm') {
    scheduleWallpaperEngineGlassSamplerCapture(String(wallpaperEngineNativeSessionId || ''), token, 0);
  }
  suspendOriginalBackgroundForWallpaperEngine();
  wallpaperEngineRuntimeError = '';
  updateWallpaperEngineEntryUi();
  renderWallpaperEngineLibrary();
}
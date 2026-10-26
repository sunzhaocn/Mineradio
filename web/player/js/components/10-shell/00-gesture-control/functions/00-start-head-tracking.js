'use strict';

// ============================================================
function startHeadTracking() { }
     // stub: 兼容旧调用
function stopHeadTracking() { }


function clampParticleSpinVelocity(v) {
  if (!isFinite(v)) return 0;
  return Math.max(-PARTICLE_SPIN_MAX, Math.min(PARTICLE_SPIN_MAX, v));
}


function applyParticleSpinDrag(dx, dy, dt) {
  var rx = dy * PARTICLE_POINTER_SPIN_X;
  var ry = dx * PARTICLE_POINTER_SPIN_Y;
  gestureRotation.x += rx;
  gestureRotation.y += ry;
  if (dt > 0) {
    particleSpin.vx = clampParticleSpinVelocity(rx / dt * 0.46);
    particleSpin.vy = clampParticleSpinVelocity(ry / dt * 0.46);
  }
}


function resetParticleRotationTarget(syncVisual) {
  gestureRotation.x = 0;
  gestureRotation.y = 0;
  particleSpin.vx = 0;
  particleSpin.vy = 0;
  if (syncVisual && particles) {
    particles.rotation.set(0, 0, 0);
    if (bloomParticles) bloomParticles.rotation.set(0, 0, 0);
    if (floatGroup) floatGroup.rotation.set(0, 0, 0);
    if (backCoverGroup) backCoverGroup.rotation.set(0, 0, 0);
  }
}


function rebaseParticleRotationAxis(axis) {
  var limit = Math.PI * 10;
  if (Math.abs(gestureRotation[axis]) < limit) return;
  var offset = Math.round(gestureRotation[axis] / (Math.PI * 2)) * Math.PI * 2;
  gestureRotation[axis] -= offset;
  if (particles) particles.rotation[axis] -= offset;
  if (bloomParticles) bloomParticles.rotation[axis] -= offset;
  if (floatGroup) floatGroup.rotation[axis] -= offset;
  if (backCoverGroup) backCoverGroup.rotation[axis] -= offset;
  if (skullParticleGroup) skullParticleGroup.rotation[axis] -= offset;
  if (stageLyrics.group) stageLyrics.group.rotation[axis] -= offset;
}


function rebaseParticleRotationIfNeeded() {
  rebaseParticleRotationAxis('x');
  rebaseParticleRotationAxis('y');
}


function normalizeGestureSensitivity(value) {
  value = String(value || '').trim().toLowerCase();
  return /^(steady|balanced|quick)$/.test(value) ? value : 'balanced';
}


function gestureSensitivityProfile() {
  var mode = normalizeGestureSensitivity(fx && fx.gestureSensitivity);
  if (mode === 'steady') return { hold: 820, volumeHold: 620, swipeDistance: 0.245, swipeWindow: 620, cooldown: 1320 };
  if (mode === 'quick') return { hold: 470, volumeHold: 350, swipeDistance: 0.165, swipeWindow: 520, cooldown: 860 };
  return { hold: 640, volumeHold: 470, swipeDistance: 0.205, swipeWindow: 570, cooldown: 1080 };
}


function gestureLandmarkDistance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}


function gestureFingerExtended(lm, tipIndex, pipIndex, mcpIndex, palm) {
  var span = Math.max(0.045, gestureLandmarkDistance(lm[5], lm[17]));
  var tipPalm = gestureLandmarkDistance(lm[tipIndex], palm);
  var pipPalm = gestureLandmarkDistance(lm[pipIndex], palm);
  var tipMcp = gestureLandmarkDistance(lm[tipIndex], lm[mcpIndex]);
  var pipMcp = gestureLandmarkDistance(lm[pipIndex], lm[mcpIndex]);
  return tipPalm > pipPalm + span * 0.13 && tipMcp > pipMcp * 1.18;
}


function classifyGesturePlayerPose(lm, palm, pinchDist) {
  var span = Math.max(0.045, gestureLandmarkDistance(lm[5], lm[17]));
  var index = gestureFingerExtended(lm, 8, 6, 5, palm);
  var middle = gestureFingerExtended(lm, 12, 10, 9, palm);
  var ring = gestureFingerExtended(lm, 16, 14, 13, palm);
  var pinky = gestureFingerExtended(lm, 20, 18, 17, palm);
  var thumbReach = gestureLandmarkDistance(lm[4], palm);
  var thumbUp = thumbReach > span * 0.78 && lm[4].y < palm.y - span * 0.52;
  if (thumbUp && !index && !middle && !ring && !pinky) return 'like';
  if (index && middle && !ring && !pinky && gestureLandmarkDistance(lm[8], lm[12]) > span * 0.26) return 'play';
  if (index && middle && ring && !pinky) return 'lyrics';
  if (index && !middle && !ring && !pinky && pinchDist > span * 0.30) return 'volume';
  return '';
}


function resetGesturePlayerActionState(keepCooldown) {
  gestureActionState.candidate = '';
  gestureActionState.since = 0;
  gestureActionState.fired = false;
  gestureActionState.swipeAnchor = null;
  gestureActionState.volumeArmed = false;
  gestureActionState.volumeLastApply = 0;
  if (!keepCooldown) gestureActionState.cooldownUntil = 0;
}


function gesturePlayerActionsAllowed() {
  if (!gestureActive || !fx || fx.gesturePlayerActions === false) return false;
  if (!gestureHostVisible()) return false;
  if (document.body && document.body.classList.contains('desktop-software-locked')) return false;
  if (typeof progressDragState !== 'undefined' && progressDragState && progressDragState.active) return false;
  if (document.querySelector('.modal-mask.show,.modal.show,.login-easter-overlay.show,.login-easter-overlay.active')) return false;
  var active = document.activeElement;
  if (active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable)) return false;
  return true;
}


function setGestureCandidate(candidate, now, holdMs, label, detail) {
  if (gestureActionState.candidate !== candidate) {
    gestureActionState.candidate = candidate;
    gestureActionState.since = now;
    gestureActionState.fired = false;
  }
  var progress = Math.max(0, Math.min(1, (now - gestureActionState.since) / Math.max(1, holdMs)));
  showGestureHUD(label, progress, gestureActionState.fired ? '已执行，松手后可再次触发' : detail);
  return progress;
}


function executeGesturePlayerAction(action, now, cooldownMs) {
  if (gestureActionState.fired || now < gestureActionState.cooldownUntil) return false;
  gestureActionState.fired = true;
  gestureActionState.lastAction = action;
  gestureActionState.cooldownUntil = now + cooldownMs;
  try {
    if (action === 'play') {
      Promise.resolve(togglePlay()).catch(function () { });
      showToast('手势: 播放 / 暂停');
    } else if (action === 'like') {
      if (typeof toggleLikeCurrent === 'function') toggleLikeCurrent();
      showToast('手势: 喜欢当前歌曲');
    } else if (action === 'lyrics') {
      if (typeof setParticleLyricsSilently === 'function') {
        setParticleLyricsSilently(!fx.particleLyrics);
        saveLyricLayout({ user: true, reason: 'gesture-lyrics' });
        showToast(fx.particleLyrics ? '手势: 已显示歌词' : '手势: 已隐藏歌词');
      }
    } else if (action === 'next') {
      nextTrack(true);
      showToast('手势: 下一首');
    } else if (action === 'previous') {
      prevTrack(true);
      showToast('手势: 上一首');
    }
    return true;
  } catch (e) {
    console.warn('[GestureAction]', action, e);
    return false;
  }
}


function updateGestureSwipeAction(palm, openness, now, profile) {
  if (openness < 0.72) {
    gestureActionState.swipeAnchor = null;
    return false;
  }
  var anchor = gestureActionState.swipeAnchor;
  if (!anchor || now - anchor.time > profile.swipeWindow) {
    gestureActionState.swipeAnchor = { x: palm.x, y: palm.y, time: now };
    return false;
  }
  var dx = palm.x - anchor.x;
  var dy = palm.y - anchor.y;
  if (Math.abs(dy) > 0.16 || Math.abs(dx) < profile.swipeDistance || Math.abs(dx) < Math.abs(dy) * 1.65 || now < gestureActionState.cooldownUntil) return false;
  var action = dx < 0 ? 'next' : 'previous';
  gestureActionState.candidate = action;
  gestureActionState.since = now;
  gestureActionState.fired = false;
  gestureActionState.swipeAnchor = null;
  executeGesturePlayerAction(action, now, profile.cooldown);
  showGestureHUD(dx < 0 ? '左滑 · 下一首' : '右滑 · 上一首', 1, '已执行，回到中央后可继续');
  return true;
}


function updateGesturePlayerActions(lm, palm, openness, pinchDist, isPinch, isFist, now) {
  if (!gesturePlayerActionsAllowed()) {
    resetGesturePlayerActionState(true);
    return false;
  }
  var profile = gestureSensitivityProfile();
  if (!isPinch && !isFist && updateGestureSwipeAction(palm, openness, now, profile)) return true;
  if (isPinch || isFist || openness > 0.72) {
    if (openness <= 0.72) gestureActionState.swipeAnchor = null;
    gestureActionState.candidate = '';
    gestureActionState.since = 0;
    gestureActionState.fired = false;
    gestureActionState.volumeArmed = false;
    return false;
  }

  var pose = classifyGesturePlayerPose(lm, palm, pinchDist);
  if (!pose) {
    gestureActionState.candidate = '';
    gestureActionState.since = 0;
    gestureActionState.fired = false;
    gestureActionState.volumeArmed = false;
    return false;
  }
  if (pose === 'volume') {
    var volumeProgress = setGestureCandidate('volume', now, profile.volumeHold, '食指音量', '保持后上下移动调节音量');
    if (volumeProgress >= 1 && !gestureActionState.volumeArmed) {
      gestureActionState.volumeArmed = true;
      gestureActionState.volumeBaseY = palm.y;
      gestureActionState.volumeBaseValue = typeof targetVolume === 'number' ? targetVolume : 0.7;
      gestureActionState.volumeLastApply = 0;
    }
    if (gestureActionState.volumeArmed) {
      var nextVolume = Math.max(0, Math.min(1, gestureActionState.volumeBaseValue + (gestureActionState.volumeBaseY - palm.y) * 1.85));
      if (now - gestureActionState.volumeLastApply >= 80) {
        gestureActionState.volumeLastApply = now;
        if (typeof setVolume === 'function') setVolume(nextVolume, true);
      }
      showGestureHUD('音量 ' + Math.round(nextVolume * 100) + '%', nextVolume, '食指向上增加 · 向下降低');
    }
    return true;
  }

  var labels = {
    play: ['V 手势 · 播放', '保持以播放 / 暂停'],
    like: ['拇指向上 · 喜欢', '保持以收藏 / 取消收藏'],
    lyrics: ['三指 · 歌词', '保持以显示 / 隐藏歌词']
  };
  var progress = setGestureCandidate(pose, now, profile.hold, labels[pose][0], labels[pose][1]);
  if (progress >= 1) executeGesturePlayerAction(pose, now, profile.cooldown);
  return true;
}


function applyGestureSettingsUi() {
  if (!fx) return;
  var actions = document.getElementById('t-gesturePlayerActions');
  if (actions) actions.classList.toggle('on', fx.gesturePlayerActions !== false);
  var overlay = document.getElementById('t-gestureHandOverlay');
  if (overlay) overlay.classList.toggle('on', fx.gestureHandOverlay !== false);
  var mode = normalizeGestureSensitivity(fx.gestureSensitivity);
  document.querySelectorAll('#gesture-sensitivity-seg button').forEach(function (button) {
    button.classList.toggle('active', button.dataset.gestureSensitivity === mode);
  });
  if (handCanvas) handCanvas.classList.toggle('show', gestureActive && fx.gestureHandOverlay !== false);
}


function toggleGesturePlayerActions() {
  fx.gesturePlayerActions = fx.gesturePlayerActions === false;
  resetGesturePlayerActionState(true);
  applyGestureSettingsUi();
  saveLyricLayout({ user: true, reason: 'gesturePlayerActions' });
  showToast(fx.gesturePlayerActions ? '播放器手势已开启' : '仅保留粒子视觉手势');
}


function toggleGestureHandOverlay() {
  fx.gestureHandOverlay = fx.gestureHandOverlay === false;
  applyGestureSettingsUi();
  if (!fx.gestureHandOverlay && handCanvasCtx) handCanvasCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  saveLyricLayout({ user: true, reason: 'gestureHandOverlay' });
  showToast(fx.gestureHandOverlay ? '手部光迹已显示' : '手部光迹已隐藏，识别继续运行');
}


function setGestureSensitivity(mode) {
  fx.gestureSensitivity = normalizeGestureSensitivity(mode);
  resetGesturePlayerActionState(true);
  applyGestureSettingsUi();
  saveLyricLayout({ user: true, reason: 'gestureSensitivity' });
}


function gestureInferenceIntervalMs() {
  var quality = fx && String(fx.performanceQuality || 'eco');
  if (quality === 'high' || quality === 'ultra') return 42;
  if (quality === 'balanced') return 55;
  return 72;
}


function gestureModelComplexity() {
  // 手势是显式开启的交互能力，识别可靠性优先于模型降档。
  // 帧率仍按性能档限流，低配机不会因此把推理频率拉高。
  return 1;
}


function gestureHostVisible() {
  if (typeof desktopRuntimeState === 'object' && desktopRuntimeState && desktopRuntimeState.desktop) {
    // 完整桌面模式会把同一个 Mineradio HWND 嵌入桌面；此时 Electron
    // 的 isVisible/isMinimized 可能不代表用户肉眼看到的桌面宿主。
    if (desktopRuntimeState.embedded === true || desktopRuntimeState.interactive === true) return true;
    return desktopRuntimeState.minimized !== true && desktopRuntimeState.visible !== false;
  }
  return !document.hidden;
}


function syncGestureCameraUi() {
  if (!fx) return;
  var wantsGesture = fx.cam === 'gesture';
  var starting = wantsGesture && gestureLifecycleState === 'starting';
  var running = wantsGesture && gestureActive && gestureLifecycleState === 'active';
  document.querySelectorAll('#cam-seg button').forEach(function (button) {
    var mode = button.dataset.cam;
    button.classList.toggle('active', mode === 'gesture' ? (running || starting) : !wantsGesture);
    button.classList.toggle('pending', mode === 'gesture' && starting);
    button.setAttribute('aria-busy', mode === 'gesture' && starting ? 'true' : 'false');
    button.setAttribute('aria-pressed', mode === 'gesture' ? String(running) : String(!wantsGesture));
  });
}


function setGestureLifecycleState(state) {
  gestureLifecycleState = String(state || 'off');
  syncGestureCameraUi();
}


function persistGestureCameraDisabled(reason) {
  fx.cam = 'off';
  syncGestureCameraUi();
  try { saveLyricLayout({ user: true, reason: 'cam', syncDisk: true }); } catch (e) { }
  if (reason) console.warn('[GestureCamera] disabled:', reason);
}


function resumeSavedGestureControl(reason) {
  if (!fx || fx.cam !== 'gesture') {
    syncGestureCameraUi();
    return Promise.resolve(false);
  }
  if ((document.body && document.body.classList.contains('splash-active')) || !gestureHostVisible()) {
    setGestureLifecycleState('suspended');
    return Promise.resolve(false);
  }
  return Promise.resolve(startGestureControl()).then(function (started) {
    syncGestureCameraUi();
    return started === true;
  });
}
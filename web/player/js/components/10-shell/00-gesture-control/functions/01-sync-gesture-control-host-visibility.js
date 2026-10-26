'use strict';



function syncGestureControlHostVisibility(reason) {
  if (gestureHostResumeTimer) {
    clearTimeout(gestureHostResumeTimer);
    gestureHostResumeTimer = 0;
  }
  if (!fx || fx.cam !== 'gesture') {
    if (gestureActive || gestureStartPromise || gestureVideo || gestureCamera || gestureHands) stopGestureControl();
    else syncGestureCameraUi();
    return;
  }
  if (!gestureHostVisible()) {
    gestureStartEpoch++;
    gestureStartPromise = null;
    if (gestureActive || gestureVideo || gestureCamera || gestureHands) cleanupGestureControlRuntime('suspended');
    else setGestureLifecycleState('suspended');
    return;
  }
  if (document.body && document.body.classList.contains('splash-active')) return;
  gestureHostResumeTimer = setTimeout(function () {
    gestureHostResumeTimer = 0;
    resumeSavedGestureControl(reason || 'host-visible');
  }, 120);
}


async function startGestureControl() {
  if (gestureActive) return true;
  if (gestureStartPromise) return gestureStartPromise;
  var epoch = ++gestureStartEpoch;
  setGestureLifecycleState('starting');
  gestureStartPromise = startGestureControlInternal(epoch);
  try { return await gestureStartPromise; }
  finally {
    if (epoch === gestureStartEpoch) {
      gestureStartPromise = null;
      if (!gestureActive && gestureLifecycleState === 'starting') {
        setGestureLifecycleState(fx && fx.cam === 'gesture' ? 'suspended' : 'off');
      }
    }
  }
}


async function startGestureControlInternal(epoch) {
  showToast('正在加载手势识别…');
  try {
    var desktopApi = typeof getDesktopWindowApi === 'function' ? getDesktopWindowApi() : window.desktopWindow;
    if (desktopApi && typeof desktopApi.requestGestureCameraPermission === 'function') {
      var permissionGrant = await desktopApi.requestGestureCameraPermission();
      if (!permissionGrant || permissionGrant.ok !== true) {
        throw new Error(permissionGrant && permissionGrant.error || 'GESTURE_CAMERA_PERMISSION_GRANT_FAILED');
      }
    }
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js');
    if (epoch !== gestureStartEpoch || fx.cam !== 'gesture') return false;
    gestureVideo = document.createElement('video');
    gestureVideo.playsInline = true; gestureVideo.muted = true;
    gestureVideo.style.display = 'none';
    document.body.appendChild(gestureVideo);
    gestureHands = new Hands({ locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + f; } });
    // modelComplexity:1 比 0 更稳定, 但仍流畅. 提高 confidence 减少误检
    gestureHands.setOptions({ maxNumHands: 1, modelComplexity: gestureModelComplexity(), minDetectionConfidence: 0.58, minTrackingConfidence: 0.55 });
    gestureHands.onResults(function (res) {
      if (!gestureActive) return;
      var lm = res.multiHandLandmarks && res.multiHandLandmarks[0];
      if (!lm) { onHandLost(); return; }
      processHandFrame(lm);
    });
    gestureCamera = new Camera(gestureVideo, { onFrame: async function () {
      if (!gestureHands || gestureInferenceBusy || !gestureHostVisible()) return;
      var now = performance.now();
      if (now - gestureLastInferenceAt < gestureInferenceIntervalMs()) return;
      gestureLastInferenceAt = now;
      gestureInferenceBusy = true;
      try {
        await gestureHands.send({ image: gestureVideo });
      } catch (error) {
        // camera_utils 只会在 onFrame Promise resolve 后排下一帧；这里若把
        // 单帧错误继续抛出，整条摄像头 RAF 会永久停止。
        gestureInferenceErrorCount++;
        if (now - gestureLastInferenceErrorAt > 5000) {
          gestureLastInferenceErrorAt = now;
          console.warn('[GestureCamera] inference frame recovered:', error && (error.message || error.name) || error);
        }
        onHandLost();
      }
      finally { gestureInferenceBusy = false; }
    }, width: 480, height: 360 });
    await gestureCamera.start();
    if (epoch !== gestureStartEpoch || fx.cam !== 'gesture') {
      cleanupGestureControlRuntime();
      return false;
    }
    gestureActive = true;
    setGestureLifecycleState('active');
    // 准备 hand canvas
    handCanvas = document.getElementById('hand-canvas');
    handCanvasCtx = handCanvas.getContext('2d');
    resizeHandCanvas();
    handCanvas.classList.toggle('show', fx.gestureHandOverlay !== false);
    applyGestureSettingsUi();
    showToast('手势已开启: 粒子交互 + 播放控制');
    showGestureHUD('待命', 0, '把手放进视野');
    return true;
  } catch (e) {
    if (epoch !== gestureStartEpoch || !fx || fx.cam !== 'gesture') {
      cleanupGestureControlRuntime(fx && fx.cam === 'gesture' ? 'suspended' : 'off');
      return false;
    }
    console.warn('Gesture failed:', e);
    cleanupGestureControlRuntime('error');
    var denied = /NotAllowed|Permission|permission|GESTURE_CAMERA/i.test(String(e && (e.name + ' ' + e.message) || e || ''));
    showToast(denied ? '摄像头权限未开启，请在 Windows 隐私设置中允许桌面应用访问摄像头' : '手势启动失败，请检查摄像头是否被其他程序占用');
    persistGestureCameraDisabled(e && (e.message || e.name) || e || 'startup-failed');
    return false;
  }
}


function cleanupGestureControlRuntime(nextState) {
  try { if (gestureCamera && gestureCamera.stop) gestureCamera.stop(); } catch (e) { }
  try { if (gestureVideo && gestureVideo.srcObject) gestureVideo.srcObject.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
  try { if (gestureHands && gestureHands.close) gestureHands.close(); } catch (e) { }
  try { if (gestureVideo) gestureVideo.remove(); } catch (e) { }
  gestureVideo = null; gestureHands = null; gestureCamera = null;
  gestureActive = false;
  gestureInferenceBusy = false;
  gestureLastInferenceAt = 0;
  gestureLastInferenceErrorAt = 0;
  gestureInferenceErrorCount = 0;
  pinchState.active = false;
  handLmSmooth = null;
  uniforms.uHandActive.value = 0;
  if (uniforms.uGestureGrip) uniforms.uGestureGrip.value = 0;
  gestureGrip.value = 0;
  gestureGrip.target = 0;
  gestureGrip.openness = 1;
  resetGesturePlayerActionState(false);
  document.getElementById('gesture-hud').classList.remove('show');
  if (handCanvas) {
    handCanvas.classList.remove('show');
    if (handCanvasCtx) handCanvasCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  }
  setGestureLifecycleState(nextState || 'off');
}


function stopGestureControl() {
  gestureStartEpoch++;
  gestureStartPromise = null;
  if (!gestureActive && !gestureVideo && !gestureCamera && !gestureHands) return;
  cleanupGestureControlRuntime('off');
}


function resizeHandCanvas() {
  if (!handCanvas) return;
  var eco = fx && fx.performanceQuality === 'eco';
  var dpr = eco ? 1 : Math.min(devicePixelRatio || 1, 2);
  handCanvas.width = innerWidth * dpr;
  handCanvas.height = innerHeight * dpr;
  handCanvas.style.width = innerWidth + 'px';
  handCanvas.style.height = innerHeight + 'px';
  handCanvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}


function onHandLost() {
  // 平滑淡出, 不立即清零 — 给一点缓冲
  if (pinchState.active) pinchState.active = false;
  gestureGrip.target = 0;
  resetGesturePlayerActionState(true);
  uniforms.uHandActive.value *= 0.9;
  if (uniforms.uHandActive.value < 0.02) uniforms.uHandActive.value = 0;
  if (performance.now() - handLmLastSeen > 600) {
    handLmSmooth = null;
    if (handCanvasCtx) handCanvasCtx.clearRect(0, 0, innerWidth, innerHeight);
    showGestureHUD('待命', 0, '把手放进视野');
  }
}


// 把单帧 21 个 landmark 平滑到 handLmSmooth, 镜像 X (摄像头是反的)
function smoothLandmarks(lm) {
  if (!handLmSmooth) {
    handLmSmooth = lm.map(function (p) { return { x: 1 - p.x, y: p.y, z: p.z || 0 }; });
    return handLmSmooth;
  }
  var a = HAND_SMOOTH_ALPHA;
  for (var i = 0; i < 21; i++) {
    var srcX = 1 - lm[i].x;
    handLmSmooth[i].x += (srcX - handLmSmooth[i].x) * a;
    handLmSmooth[i].y += (lm[i].y - handLmSmooth[i].y) * a;
    handLmSmooth[i].z += ((lm[i].z || 0) - handLmSmooth[i].z) * a;
  }
  return handLmSmooth;
}


// 手掌中心 ≈ wrist(0) 和 mcp 平均 (5,9,13,17 是各指根)
function palmCenter(lm) {
  var px = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
  var py = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
  return { x: px, y: py };
}


function handOpenness(lm, palm) {
  var span = Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y);
  span = Math.max(0.055, span);
  var tips = [8, 12, 16, 20];
  var avg = 0;
  for (var i = 0; i < tips.length; i++) avg += Math.hypot(lm[tips[i]].x - palm.x, lm[tips[i]].y - palm.y);
  avg /= tips.length;
  return clampRange((avg / span - 0.62) / 0.78, 0, 1);
}


function processHandFrame(rawLm) {
  handLmLastSeen = performance.now();
  var lm = smoothLandmarks(rawLm);

  // 推开粒子位置: 手掌中心 (而非单一食指)
  var palm = palmCenter(lm);
  var openness = handOpenness(lm, palm);
  gestureGrip.openness += (openness - gestureGrip.openness) * 0.28;
  var gripTarget = clampRange(1 - openness, 0, 1);
  gestureGrip.target = gripTarget > 0.55 ? gripTarget : 0;
  var ndcX = palm.x * 2 - 1;
  var ndcY = -(palm.y * 2 - 1);
  var handLocalX = ndcX * PLANE_SIZE * 0.62;
  var handLocalY = ndcY * PLANE_SIZE * 0.62;
  if (particleLocalPointFromNdc(ndcX, ndcY, particlePointerLocalHit)) {
    // 平滑推动 (避免 uHandXY 跳变)
    handLocalX = particlePointerLocalHit.x;
    handLocalY = particlePointerLocalHit.y;
  }
  var cur = uniforms.uHandXY.value;
  cur.x += (handLocalX - cur.x) * 0.48;
  cur.y += (handLocalY - cur.y) * 0.48;
  var tgtActive = 0.44 + openness * 0.56;
  uniforms.uHandActive.value += (tgtActive - uniforms.uHandActive.value) * 0.26;

  // 捏合检测 (拇指 4 与食指 8)
  var pinchDist = Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y);
  var isPinch = pinchDist < 0.075 && openness > 0.28;
  var isFist = !isPinch && gripTarget > 0.68;
  var playerActionVisible = updateGesturePlayerActions(lm, palm, openness, pinchDist, isPinch, isFist, performance.now());

  if (isPinch && !pinchState.active) {
    unlockCenteredView();
    pinchState.active = true;
    pinchState.lastX = palm.x;
    pinchState.lastY = palm.y;
    pinchState.lastT = performance.now();
    particleSpin.vx = particleSpin.vy = 0;
    gestureGrip.target = Math.min(0.34, gestureGrip.target);
    if (!playerActionVisible) showGestureHUD('捏合拖动', 1, '移动手掌 -> 旋转封面');
  } else if (isPinch && pinchState.active) {
    unlockCenteredView();
    var dx = palm.x - pinchState.lastX;
    var dy = palm.y - pinchState.lastY;
    var nowPinch = performance.now();
    var pinchDt = Math.max(1 / 120, Math.min(0.08, (nowPinch - pinchState.lastT) / 1000 || 1 / 60));
    // v8: 方向修正 - 上下手与封面旋转同向
    var spinY = dx * PARTICLE_HAND_SPIN_Y;
    var spinX = dy * PARTICLE_HAND_SPIN_X;
    gestureRotation.y += spinY;
    gestureRotation.x += spinX;
    particleSpin.vy = clampParticleSpinVelocity(spinY / pinchDt * 0.48);
    particleSpin.vx = clampParticleSpinVelocity(spinX / pinchDt * 0.48);
    pinchState.lastX = palm.x;
    pinchState.lastY = palm.y;
    pinchState.lastT = nowPinch;
    gestureGrip.target = Math.min(0.34, gestureGrip.target);
    if (!playerActionVisible) showGestureHUD('拖动中', 1, '松手后保留惯性');
  } else if (!isPinch && pinchState.active) {
    pinchState.active = false;
    if (!playerActionVisible) showGestureHUD('松开', 0.4, '可继续触碰或捏合');
  } else if (isFist) {
    if (gestureGrip.lastState !== 'fist') {
      gestureGrip.pulse = 1;
      uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, 0.26);
    }
    gestureGrip.lastState = 'fist';
    if (!playerActionVisible) showGestureHUD('握拳收束', Math.max(0.55, gripTarget), '粒子向中心收缩');
  } else {
    if (gestureGrip.lastState === 'fist' && openness > 0.58) {
      uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, 0.18);
    }
    gestureGrip.lastState = openness > 0.62 ? 'open' : 'hover';
    if (!playerActionVisible) showGestureHUD(openness > 0.62 ? '张开恢复' : '悬停', 0.30 + openness * 0.34, openness > 0.72 ? '快速左右滑动可切歌' : '手掌推开粒子 / 捏合旋转 / 握拳收束');
  }

  if (fx.gestureHandOverlay !== false) drawHandSkeleton(lm, isPinch, openness, isFist);
  else if (handCanvasCtx) handCanvasCtx.clearRect(0, 0, innerWidth, innerHeight);
}
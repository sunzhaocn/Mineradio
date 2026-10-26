'use strict';


function defaultFreeCameraState() {
  return {
    active: false,
    locked: false,
    position: new THREE.Vector3(0, 0, 6.6),
    yaw: 0,
    pitch: 0,
    roll: 0,
    fov: BASE_FOV,
    velocity: new THREE.Vector3(),
    keys: {},
    resetTween: null
  };
}

function readFreeCameraState() {
  var state = defaultFreeCameraState();
  try {
    var raw = JSON.parse(localStorage.getItem(FREE_CAMERA_STORE_KEY) || '{}') || {};
    if (raw.position) {
      state.position.set(
        clampRange(Number(raw.position.x) || 0, -80, 80),
        clampRange(Number(raw.position.y) || 0, -80, 80),
        clampRange(Number(raw.position.z) || 6.6, -80, 80)
      );
    }
    state.yaw = clampRange(Number(raw.yaw) || 0, -Math.PI * 8, Math.PI * 8);
    state.pitch = clampRange(Number(raw.pitch) || 0, -Math.PI * 0.49, Math.PI * 0.49);
    state.roll = clampRange(Number(raw.roll) || 0, -Math.PI, Math.PI);
    state.fov = clampRange(Number(raw.fov) || BASE_FOV, 26, 72);
    state.locked = !!(raw.locked || raw.active);
    state.active = false;
  } catch (e) { }
  return state;
}


function sonicPresetCameraActive() {
  return !!(typeof SONIC_PRESET_INDEX !== 'undefined' && fx && Number(fx.preset) === SONIC_PRESET_INDEX);
}


function readSonicLyricLookAtTarget(out) {
  if (!sonicPresetCameraActive()) return false;
  if (fx && fx.lyricCameraLock) return false;
  if (typeof shouldUseWallpaperLyricCameraLock === 'function' && shouldUseWallpaperLyricCameraLock()) return false;
  if (typeof stageLyrics === 'undefined' || !stageLyrics || !stageLyrics.group) return false;
  if (!fx || !fx.particleLyrics) return false;
  if (!stageLyrics.current && !(stageLyrics.outgoing && stageLyrics.outgoing.length)) return false;
  var group = stageLyrics.group;
  if (group.updateMatrixWorld) group.updateMatrixWorld(true);
  if (group.getWorldPosition) {
    group.getWorldPosition(out);
  } else if (group.position && out.copy) {
    out.copy(group.position);
  } else {
    return false;
  }
  if (!Number.isFinite(out.x) || !Number.isFinite(out.y) || !Number.isFinite(out.z)) return false;
  out.x = clampRange(out.x, -2.4, 2.4);
  out.y = clampRange(out.y - 0.18, -1.55, 1.25);
  out.z = clampRange(out.z + 0.10, -2.6, 1.55);
  return true;
}


function freeCameraPointerLockElement() {
  return typeof renderer !== 'undefined' && renderer && renderer.domElement ? renderer.domElement : document.body;
}


function freeCameraPointerLockActive() {
  var el = freeCameraPointerLockElement();
  return !!document.pointerLockElement && (document.pointerLockElement === el || document.pointerLockElement === document.body);
}


function clearFreeCameraPointerLockRetry() {
  if (freeCameraPointerLock.retryTimer) {
    clearTimeout(freeCameraPointerLock.retryTimer);
    freeCameraPointerLock.retryTimer = 0;
  }
}


function scheduleFreeCameraPointerLockRetry(delay) {
  clearFreeCameraPointerLockRetry();
  if (!freeCamera || !freeCamera.active || !freeCameraPointerLock.desired) return;
  freeCameraPointerLock.retryTimer = setTimeout(function () {
    freeCameraPointerLock.retryTimer = 0;
    requestFreeCameraPointerLock('retry');
  }, Math.max(120, delay || 260));
}


function requestFreeCameraPointerLock(reason) {
  if (!freeCamera || !freeCamera.active) return false;
  var el = freeCameraPointerLockElement();
  if (!el || !el.requestPointerLock || freeCameraPointerLockActive()) return freeCameraPointerLockActive();
  freeCameraPointerLock.desired = true;
  var now = performance.now();
  if (now - freeCameraPointerLock.lastRequestAt < 180) return false;
  freeCameraPointerLock.lastRequestAt = now;
  try {
    el.focus && el.focus({ preventScroll: true });
  } catch (e) {
    try { el.focus && el.focus(); } catch (ignore) { }
  }
  try {
    var lockResult = el.requestPointerLock();
    if (lockResult && lockResult.catch) {
      lockResult.catch(function () {
        freeCameraPointer.seen = false;
        scheduleFreeCameraPointerLockRetry(360);
      });
    }
    return true;
  } catch (e) {
    freeCameraPointer.seen = false;
    scheduleFreeCameraPointerLockRetry(360);
    return false;
  }
}


function releaseFreeCameraPointerLock() {
  freeCameraPointerLock.desired = false;
  clearFreeCameraPointerLockRetry();
  freeCameraPointer.seen = false;
  try {
    if (document.pointerLockElement) document.exitPointerLock();
  } catch (e) { }
}


function saveFreeCameraState() {
  if (!freeCamera) return;
  try {
    localStorage.setItem(FREE_CAMERA_STORE_KEY, JSON.stringify({
      locked: !!freeCamera.locked,
      active: !!freeCamera.active,
      position: { x: freeCamera.position.x, y: freeCamera.position.y, z: freeCamera.position.z },
      yaw: freeCamera.yaw,
      pitch: freeCamera.pitch,
      roll: freeCamera.roll,
      fov: freeCamera.fov
    }));
  } catch (e) { }
}

function scheduleFreeCameraStateSave(delay) {
  if (freeCameraDeferredSaveTimer) return;
  freeCameraDeferredSaveTimer = setTimeout(function () {
    freeCameraDeferredSaveTimer = 0;
    saveFreeCameraState();
  }, delay || 720);
}

function easeOutCubic01(t) {
  t = clamp01(t);
  return 1 - Math.pow(1 - t, 3);
}

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function defaultOrbitStateForPreset(p) {
  p = Number(p) || 0;
  if (p === 1) return { theta: 0.0, phi: 0.03, radius: 6.2 };
  if (p === 2) return { theta: 0.0, phi: 0.15, radius: 7.0 };
  if (p === 3) return { theta: 0.0, phi: 0.05, radius: 8.0 };
  if (p === 4) return { theta: 0.0, phi: 0.04, radius: 6.5 };
  if (p === 6) return { theta: 0.18, phi: 0.10, radius: 7.4 };
  if (p === 9) return { theta: -0.08, phi: 0.12, radius: 7.4 };
  if (p === 10) return { theta: 0.0, phi: 0.02, radius: 7.15 };
  if (p === 11) return { theta: 0.10, phi: 0.11, radius: 7.0 };
  if (p === 12) return { theta: -0.12, phi: 0.18, radius: 7.35 };
  if (typeof SONIC_PRESET_INDEX !== 'undefined' && p === SONIC_PRESET_INDEX) {
    return {
      theta: SONIC_ORBIT_BASELINE.theta,
      phi: SONIC_ORBIT_BASELINE.phi,
      radius: SONIC_ORBIT_BASELINE.radius
    };
  }
  return { theta: 0.0, phi: 0.08, radius: 6.6 };
}

function applyPresetOrbitBaseline(p, opts) {
  opts = opts || {};
  if (p === 5) return false;
  var base = defaultOrbitStateForPreset(p);
  orbit.baselineTheta = base.theta;
  orbit.baselinePhi = clampRange(base.phi, orbit.minPhi, orbit.maxPhi);
  orbit.baselineRadius = clampRange(base.radius, orbit.minRadius, orbit.maxRadius);
  orbit.userTheta = orbit.baselineTheta;
  orbit.userPhi = orbit.baselinePhi;
  orbit.userRadius = orbit.baselineRadius;
  if (opts.syncCurrent) {
    orbit.theta = orbit.userTheta;
    orbit.phi = orbit.userPhi;
    orbit.radius = orbit.userRadius;
  }
  return true;
}

function dampCameraImpulseForRecenter(strength) {
  var damp = clampRange(strength == null ? 0.36 : strength, 0, 1);
  orbit.cineTheta *= damp;
  orbit.cinePhi *= damp;
  orbit.cineRadius *= damp;
  camPunch *= damp;
  if (typeof beatCam !== 'undefined' && beatCam) {
    beatCam.thetaKick *= damp;
    beatCam.phiKick *= damp;
    beatCam.radiusKick *= damp;
    beatCam.rollKick *= damp;
    beatCam.punch *= damp;
  }
}

function settleOrbitRecenterTarget() {
  orbit.userTheta = orbit.baselineTheta;
  orbit.userPhi = clampRange(orbit.baselinePhi, orbit.minPhi, orbit.maxPhi);
  orbit.userRadius = clampRange(orbit.baselineRadius, orbit.minRadius, orbit.maxRadius);
  orbit.recentering = false;
  orbit.recenterStartedAt = 0;
}

function captureCurrentOrbitAsBaseline() {
  var theta = Number.isFinite(orbit.theta) ? orbit.theta - (orbit.cineTheta || 0) : orbit.userTheta;
  var phi = Number.isFinite(orbit.phi) ? orbit.phi - (orbit.cinePhi || 0) : orbit.userPhi;
  var radius = Number.isFinite(orbit.radius) ? orbit.radius - (orbit.cineRadius || 0) : orbit.userRadius;
  orbit.baselineTheta = theta;
  orbit.baselinePhi = clampRange(phi, orbit.minPhi, orbit.maxPhi);
  orbit.baselineRadius = clampRange(radius, orbit.minRadius, orbit.maxRadius);
  orbit.userTheta = orbit.baselineTheta;
  orbit.userPhi = orbit.baselinePhi;
  orbit.userRadius = orbit.baselineRadius;
  orbit.centerLocked = true;
  orbit.recentering = false;
}

function getDefaultFreeCameraResetPose() {
  var baseTheta = Number.isFinite(orbit.baselineTheta) ? orbit.baselineTheta : 0;
  var basePhi = clampRange(Number.isFinite(orbit.baselinePhi) ? orbit.baselinePhi : 0.08, orbit.minPhi, orbit.maxPhi);
  var baseRadius = clampRange(Number.isFinite(orbit.baselineRadius) ? orbit.baselineRadius : 6.6, orbit.minRadius, orbit.maxRadius);
  var baseCy = Math.cos(basePhi);
  var pose = {
    position: new THREE.Vector3(
      baseRadius * baseCy * Math.sin(baseTheta),
      baseRadius * Math.sin(basePhi),
      baseRadius * baseCy * Math.cos(baseTheta)
    ),
    yaw: 0,
    pitch: 0,
    roll: 0,
    fov: BASE_FOV
  };
  FREE_CAMERA_RESET_MAT.lookAt(pose.position, ZERO_VEC, FREE_CAMERA_UP);
  FREE_CAMERA_RESET_QUAT.setFromRotationMatrix(FREE_CAMERA_RESET_MAT);
  FREE_CAMERA_EULER.setFromQuaternion(FREE_CAMERA_RESET_QUAT, 'YXZ');
  pose.pitch = FREE_CAMERA_EULER.x;
  pose.yaw = FREE_CAMERA_EULER.y;
  pose.roll = FREE_CAMERA_EULER.z;
  if (typeof SKULL_PRESET_INDEX !== 'undefined' && fx && fx.preset === SKULL_PRESET_INDEX && typeof setSkullCameraTargetVectors === 'function') {
    var look = new THREE.Vector3();
    var shelfComposition = typeof isSkullShelfCompositionActive === 'function' && isSkullShelfCompositionActive();
    setSkullCameraTargetVectors(pose.position, look, innerHeight > innerWidth * 1.08, shelfComposition, 0);
    FREE_CAMERA_RESET_MAT.lookAt(pose.position, look, FREE_CAMERA_UP);
    FREE_CAMERA_RESET_QUAT.setFromRotationMatrix(FREE_CAMERA_RESET_MAT);
    FREE_CAMERA_EULER.setFromQuaternion(FREE_CAMERA_RESET_QUAT, 'YXZ');
    pose.pitch = FREE_CAMERA_EULER.x;
    pose.yaw = FREE_CAMERA_EULER.y;
    pose.roll = FREE_CAMERA_EULER.z;
  }
  return pose;
}

function syncOrbitAfterFreeCameraReset(pose) {
  dampCameraImpulseForRecenter(0.08);
  if (typeof clearCenteredViewOffsets === 'function') clearCenteredViewOffsets();
  if (typeof focusHover !== 'undefined' && focusHover) {
    focusHover.wantType = null;
    if (focusHover.pendingTimer) { clearTimeout(focusHover.pendingTimer); focusHover.pendingTimer = null; }
    if (focusHover.exitTimer) { clearTimeout(focusHover.exitTimer); focusHover.exitTimer = null; }
  }
  orbit.focus.active = false;
  orbit.focus.type = null;
  orbit.focus.lookAt.set(0, 0, 0);
  orbit.lookAt.set(0, 0, 0);
  orbit.centerLocked = true;
  orbit.recentering = false;
  orbit.recenterStartedAt = 0;
  if (typeof skullWheelZoomTarget !== 'undefined') {
    skullWheelZoomTarget = 0;
    if (!(fx && fx.preset === SKULL_PRESET_INDEX)) skullWheelZoom = 0;
  }
  if (fx && fx.preset === SKULL_PRESET_INDEX) {
    if (typeof resetSkullPresetView === 'function') resetSkullPresetView(false, { smooth: true, keepLyricLock: true });
    return;
  }
  if (!pose || !pose.position) return;
  var px = Number(pose.position.x) || 0;
  var py = Number(pose.position.y) || 0;
  var pz = Number(pose.position.z) || 0;
  var radius = clampRange(Math.sqrt(px * px + py * py + pz * pz) || orbit.baselineRadius || 6.6, orbit.minRadius, orbit.maxRadius);
  var theta = Math.atan2(px, pz);
  var phi = clampRange(Math.asin(clampRange(py / Math.max(0.001, radius), -1, 1)), orbit.minPhi, orbit.maxPhi);
  orbit.baselineTheta = theta;
  orbit.baselinePhi = phi;
  orbit.baselineRadius = radius;
  orbit.userTheta = theta;
  orbit.userPhi = phi;
  orbit.userRadius = radius;
  orbit.theta = theta;
  orbit.phi = phi;
  orbit.radius = radius;
  if (typeof resetSkullPresetView === 'function') resetSkullPresetView(true);
  if ((fx && fx.lyricCameraLock) || shouldUseWallpaperLyricCameraLock()) requestStageLyricCameraSnap(14);
}

function captureFreeCameraFromCurrent() {
  if (!freeCamera) freeCamera = defaultFreeCameraState();
  camera.updateMatrixWorld(true);
  freeCamera.position.copy(camera.position);
  FREE_CAMERA_EULER.setFromQuaternion(camera.quaternion, 'YXZ');
  freeCamera.pitch = FREE_CAMERA_EULER.x;
  freeCamera.yaw = FREE_CAMERA_EULER.y;
  freeCamera.roll = FREE_CAMERA_EULER.z;
  freeCamera.fov = clampRange(camera.fov || BASE_FOV, 26, 72);
}

function applyFreeCameraToCamera() {
  if (!freeCamera || !(freeCamera.active || freeCamera.locked)) return false;
  var cameraShake = clampRange(Number(fx.cinemaShake) || 0, 0, 1.8);
  camera.position.copy(freeCamera.position);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(
    freeCamera.pitch + beatCam.phiKick * cameraShake * 0.45,
    freeCamera.yaw + beatCam.thetaKick * cameraShake * 0.45,
    freeCamera.roll + beatCam.rollKick * cameraShake
  );
  if (cameraShake > 0 && Math.abs(beatCam.radiusKick) > 0.0001) {
    FREE_CAMERA_SHAKE_DIR.set(0, 0, -1).applyEuler(camera.rotation);
    camera.position.addScaledVector(FREE_CAMERA_SHAKE_DIR, beatCam.radiusKick * cameraShake * 0.52);
  }
  var cameraPunch = Math.max(camPunch * 0.55, beatCam.punch * 0.54 + beatCam.radiusKick * 0.16) * cameraShake;
  var targetFov = clampRange(freeCamera.fov || BASE_FOV, 26, 72) - cameraPunch * 1.75;
  camera.fov += (targetFov - camera.fov) * (targetFov < camera.fov ? 0.24 : 0.12);
  camera.updateProjectionMatrix();
  camPunch *= 0.86;
  return true;
}

function updateFreeCameraHint() {
  var el = document.getElementById('free-camera-hint');
  if (el) el.classList.toggle('show', !!(freeCamera && freeCamera.active));
}
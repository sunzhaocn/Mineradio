'use strict';

// ============================================================
var orbit = {
  userTheta: 0.0, userPhi: 0.08, userRadius: 6.6,
  cineTheta: 0.0, cinePhi: 0.0, cineRadius: 0.0,
  theta: 0.0, phi: 0.08, radius: 6.6,
  minPhi: -Math.PI * 0.45, maxPhi: Math.PI * 0.45,
  minRadius: 2.4, maxRadius: 14.0,
  baselineTheta: 0.0, baselinePhi: 0.08, baselineRadius: 6.6,
  rotating: false, last: { x: 0, y: 0 },
  recentering: false,
  recenterStartedAt: 0,
  centerLocked: false,
  // v8: 镜头跟拍 (hover shelf / queue 时)
  lookAt: new THREE.Vector3(0, 0, 0),
  focus: {
    active: false,
    type: null,        // 'shelf-side' | 'shelf-stage' | 'queue'
    theta: 0.0, phi: 0.08, radius: 6.6,
    lookAt: new THREE.Vector3(0, 0, 0),
  },
  glowFollowX: 0,
  glowFollowY: 0,
  glowFollowRoll: 0,
  beatGlow: 0,
};

var SONIC_ORBIT_BASELINE = { theta: 0.00, phi: 0.18, radius: 8.4 };

var ZERO_VEC = new THREE.Vector3(0, 0, 0);

var SONIC_CAMERA_LYRIC_LOOK_AT = new THREE.Vector3(0, 0, 0);

var BASE_FOV = 45;

var camPunch = 0;

var cinemaT = 0;

var freeCamera = readFreeCameraState();

var FREE_CAMERA_MOVE = new THREE.Vector3();

var FREE_CAMERA_TARGET_VEL = new THREE.Vector3();

var FREE_CAMERA_SHAKE_DIR = new THREE.Vector3();

var FREE_CAMERA_EULER = new THREE.Euler(0, 0, 0, 'YXZ');

var FREE_CAMERA_RESET_MAT = new THREE.Matrix4();

var FREE_CAMERA_RESET_QUAT = new THREE.Quaternion();

var FREE_CAMERA_UP = new THREE.Vector3(0, 1, 0);

var freeCameraPointer = { seen: false, x: 0, y: 0 };

var freeCameraDeferredSaveTimer = 0;

var freeCameraPointerLock = { desired: false, retryTimer: 0, lastRequestAt: 0 };


document.addEventListener('pointerlockchange', function () {
  freeCameraPointer.seen = false;
  // A request may finish after an explicit camera handover has cancelled it.
  if (freeCameraPointerLockActive() && (!freeCamera || !freeCamera.active || !freeCameraPointerLock.desired)) {
    releaseFreeCameraPointerLock();
    return;
  }
  if (freeCamera && freeCamera.active && freeCameraPointerLock.desired && !freeCameraPointerLockActive()) {
    scheduleFreeCameraPointerLockRetry(240);
  }
});


document.addEventListener('pointerlockerror', function () {
  freeCameraPointer.seen = false;
  if (freeCamera && freeCamera.active && freeCameraPointerLock.desired) scheduleFreeCameraPointerLockRetry(420);
});

if (typeof fx !== 'undefined' && fx) applyPresetOrbitBaseline(fx.preset, { syncCurrent: true, startup: true });

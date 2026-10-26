'use strict';

// ============================================================
var FLOAT_COUNT = 1300;

var floatGroup = null;

var floatPositionsArr = null, floatBaseArr = null, floatPhaseArr = null, floatColorArr = null;


// ============================================================
//  安魂 — 3D 粒子建模层
// ============================================================
var SKULL_PRESET_INDEX = 6;

var SKULL_MODEL_BASE_ROTATION_X = -0.26;

var SKULL_MODEL_BASE_ROTATION_Y = 0.00;

var SKULL_MODEL_SCALE = 2.34;

var SKULL_MODEL_BASE_POSITION = { x: 0, y: 0.22, z: 0.10 };

var skullAmpPulse = 0;

var skullBeatFlash = 0;

var skullJawOpen = 0;

var skullCameraBlend = 0;

var skullWheelZoom = 0;

var skullWheelZoomTarget = 0;

var skullCameraTargetPos = new THREE.Vector3();

var skullCameraTargetLook = new THREE.Vector3();

var skullCameraBasePos = new THREE.Vector3();

var skullCameraBaseLook = new THREE.Vector3();

var skullCameraShelfPos = new THREE.Vector3();

var skullCameraShelfLook = new THREE.Vector3();

var skullCameraMixedLook = new THREE.Vector3();

var skullCameraCinemaRight = new THREE.Vector3();

var skullCameraCinemaUp = new THREE.Vector3();

var skullCameraCinemaForward = new THREE.Vector3();

var skullShelfCameraMix = 0;

var skullLyricMouthLocal = new THREE.Vector3(0.025, -0.72, 0.62);

var skullLyricMouthTarget = new THREE.Vector3();

var skullLyricMouthForward = new THREE.Vector3();

var skullLyricMouthQuat = new THREE.Quaternion();

var skullLyricReadableQuat = new THREE.Quaternion();

var skullParticleGroup = null;

var skullParticleOpacity = 0;

var skullParticleAsset = { data: null, promise: null, failed: false };

var skullBaseColors = {
  boneA: new THREE.Color('#b8ae98'),
  boneB: new THREE.Color('#fff4d8'),
  shadow: new THREE.Color('#100d0d'),
  light: new THREE.Color('#ffe3a0'),
  neutralBoneA: new THREE.Color('#9fb7c8'),
  neutralBoneB: new THREE.Color('#eef9ff'),
  neutralShadow: new THREE.Color('#070b12'),
  neutralLight: new THREE.Color('#d6f3ff')
};

var skullTintScratch = {
  tint: new THREE.Color(),
  soft: new THREE.Color(),
  bright: new THREE.Color(),
  dark: new THREE.Color(),
  boneA: new THREE.Color(),
  boneB: new THREE.Color(),
  shadow: new THREE.Color(),
  light: new THREE.Color()
};


// ============================================================
//  封面背面粒子层 (v7.2)
//   - 独立 Points, 放在 z=-1.5 (主封面平面背面)
//   - 颜色取自封面镜像 UV
//   - 慢呼吸 + 小幅 noise 漂移
//   - 跟主粒子同步旋转 (在主循环里赋值)
//   - 视角转到背面才能看到 — 不需要手动控制 visible
// ============================================================
var BACK_COVER_COUNT = 3000;

var backCoverGroup = null;

var backCoverColorArr = null;

// ============================================================
//  舞台歌词系统 v9 — Three.js 文字平面, 跟随专辑粒子 3D 运动

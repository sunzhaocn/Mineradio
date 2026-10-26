'use strict';

      // stub

var gestureVideo = null, gestureCamera = null, gestureHands = null;

var gestureActive = false;

// 21 个关键点的平滑缓存 (EMA): [{x,y}, ...]
var handLmSmooth = null;

var handLmLastSeen = 0;

// 捏合状态
var pinchState = { active: false, lastX: 0, lastY: 0, lastT: 0 };

// 物理旋转: 给 particles 一个角速度, 每帧衰减
var particleSpin = { vx: 0, vy: 0, damping: 0.90 };

// 手势驱动的总旋转 (累计角度), 输出到 particles
var gestureRotation = { x: 0, y: 0 };

var gestureGrip = { value: 0, target: 0, openness: 1, lastState: 'open', pulse: 0 };

var gestureActionState = {
  candidate: '',
  since: 0,
  fired: false,
  cooldownUntil: 0,
  swipeAnchor: null,
  volumeArmed: false,
  volumeBaseY: 0,
  volumeBaseValue: 0,
  volumeLastApply: 0,
  lastAction: ''
};

var gestureStartEpoch = 0;

var gestureStartPromise = null;

var gestureInferenceBusy = false;

var gestureLastInferenceAt = 0;

var gestureLastInferenceErrorAt = 0;

var gestureInferenceErrorCount = 0;

var gestureLifecycleState = 'off';

var gestureHostResumeTimer = 0;

var gestureLastHudSignature = '';

var gestureLastHudAt = 0;

var PARTICLE_POINTER_SPIN_X = 0.0032;

var PARTICLE_POINTER_SPIN_Y = 0.0034;

var PARTICLE_HAND_SPIN_X = 4.15;

var PARTICLE_HAND_SPIN_Y = 4.30;

var PARTICLE_SPIN_MAX = 6.2;

// 手骨架 canvas
var handCanvas = null, handCanvasCtx = null;

// 平滑系数 (越小越平滑, 但反应越慢)
var HAND_SMOOTH_ALPHA = 0.35;

window.addEventListener('resize', resizeHandCanvas);


// 画手掌骨架: 连线 + 关节圆点
//   骨架连接表 (MediaPipe 标准)
var HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],        // 拇指
  [0, 5], [5, 6], [6, 7], [7, 8],        // 食指
  [0, 9], [9, 10], [10, 11], [11, 12],   // 中指
  [0, 13], [13, 14], [14, 15], [15, 16], // 无名指
  [0, 17], [17, 18], [18, 19], [19, 20], // 小指
  [5, 9], [9, 13], [13, 17],           // 掌横连
];  // stub: 兼容旧调用


// ============================================================
//  Resize / 快捷键

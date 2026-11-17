'use strict';

// ============================================================
var idleGuideCanvas = null;

var idleGuideCtx = null;

var idleGuideW = 0, idleGuideH = 0, idleGuideDpr = 1;

var idleGuideParticles = [];

var idleGuideTrails = [[], [], [], []];

var idleGuideStartedAt = performance.now();

var idleGuideVisible = false;

var idleGuideLastFrameAt = performance.now();

var idleGuideDelayTimer = null;

// Keep Wallpaper as the only startup idle background.
var IDLE_GUIDE_BACKGROUND_ENABLED = false;

var idleGuideInteraction = {
  angle: 0,
  velocity: 0,
  rotX: -0.12,
  rotY: 0,
  spinX: 0,
  spinY: 0,
  zoom: 1,
  zoomTarget: 1,
  zoomPulse: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  lastT: 0,
  pointerX: 0.5,
  pointerY: 0.5,
  pointerActive: false,
  focus: 0,
  press: 0,
  tiltX: 0,
  tiltY: 0
};


// ============================================================
//  toast
// ============================================================
var toastTimer = null;


// ============================================================
//  摄像头 / 手势 v8 — 仅保留手势, 头部追踪已下线
//   - 21 个关键点用 EMA 平滑滤波, 消除抖动
//   - 食指尖 + 手掌中心 共同推开粒子 (真实手感, 不再是单点小球)
//   - 在 hand-canvas 上画出手掌骨架, 视觉跟随手
//   - 捏合 = 拖动旋转封面 (Y 反向修正)
//   - 没有挥扫 / 没有手势切歌

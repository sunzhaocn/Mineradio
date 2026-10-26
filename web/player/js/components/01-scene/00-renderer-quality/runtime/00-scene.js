'use strict';

// ============================================================
var scene = new THREE.Scene();

scene.background = null;

var camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);

var RENDER_DPR_CAP = 1.35;

var RENDER_PIXEL_BUDGET = 5200000;

var RENDER_MIN_DPR = 0.72;

// 0 = display vsync. Foreground visible motion must keep VSync cadence.
var RENDER_VISIBLE_VSYNC = true;

var RENDER_IDLE_FPS = 72;

var RENDER_IDLE_LARGE_FPS = 60;

var RENDER_IDLE_HUGE_FPS = 48;

var RENDER_ACTIVE_FPS = 90;

var RENDER_LARGE_FPS = 75;

var RENDER_HUGE_FPS = 60;

var RENDER_INTERACTION_FPS = 0;

var RENDER_INTERACTION_LARGE_FPS = 90;

var RENDER_INTERACTION_HUGE_FPS = 75;

var RENDER_INTERACTION_HOLD_MS = 900;

var renderInteractionBoostUntil = 0;

var renderInteractionReason = '';

var renderRefreshState = {
  lastRafAt: 0,
  hz: 60,
  stableHz: 60,
  samples: []
};

var adaptiveFrameLoadState = {
  avgMs: 0,
  lastCostMs: 0,
  lastTargetFps: 0,
  pressure: 0,
  level: 0
};

var renderer = window.mineradioSimplePlayer && window.mineradioSimplePlayer.atStartup
  ? window.mineradioSimplePlayer.createRenderer()
  : new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });

renderer.setClearColor(0x000000, 0);

renderer.setPixelRatio(getRenderPixelRatio());

renderer.setSize(innerWidth, innerHeight);

renderer.domElement.style.background = 'transparent';

renderer.domElement.style.display = 'block';

renderer.domElement.style.width = '100%';

renderer.domElement.style.height = '100%';

renderer.domElement.tabIndex = 0;

document.getElementById('canvas-container').appendChild(renderer.domElement);

// ============================================================
//  相机系统 v7.1 — 分离 user offset / cinema offset
//   - userOrbit: 用户拖拽的目标 (永久保留, 不会被电影模式覆盖)
//   - cinemaOffset: 电影模式的微偏移 (始终叠加, 即使用户在拖)
//   - 最终 theta = userOrbit.theta + cinemaOffset.theta
//   - 回正按钮 / 双击屏幕: 让 userOrbit 缓慢归零

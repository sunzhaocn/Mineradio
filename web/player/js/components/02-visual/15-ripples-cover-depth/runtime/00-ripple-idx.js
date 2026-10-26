'use strict';

// ============================================================
var rippleIdx = 0;

var lastRippleAt = 0;

var lastBassRising = false;

var rippleActiveCount = 0;

var BASS_THRESHOLD = 0.30;

var RIPPLE_COOLDOWN = 0.32;


var regions = [];

for (var ry = 0; ry < 3; ry++) for (var rx = 0; rx < 3; rx++) {
  regions.push({
    x: (rx / 2 - 0.5) * PLANE_SIZE * 0.72,
    y: (ry / 2 - 0.5) * PLANE_SIZE * 0.72,
  });
}


// 颜色渐变 tween (切歌时旧封面→新封面)
var colorMixTween = null;


// 粒子整体透明度 tween (启动 fade-in)
var alphaTween = null;

var floatAlphaTween = null;

var IDLE_PARTICLE_ALPHA = 0;


// 加载形态 tween (uLoading 0..1)
var loadingTween = null;

var loadingShownAt = 0;

var loadingHideTimer = null;

var coverDepthTween = null;

var neutralCoverEdgeCanvasCache = null;

// ============================================================
//  离线节拍预解析 (v7.2)
//    流程: fetch 完整音频 → OfflineAudioContext.decodeAudioData
//          → 低通滤波 (只保留 60-150Hz, 即 kick 频段)
//          → 短时能量曲线 → 自适应阈值检测峰值
//          → 输出 kick 时间戳数组 (单位: 秒)
//    优点: 完全规避人声干扰; 预先准备好节奏表
//    缺点: 每首歌首次要 1-3 秒

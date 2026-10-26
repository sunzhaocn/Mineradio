'use strict';

var stageLyricPrewarm = { timer: 0, workTimer: 0, workRaf: 0, build: null, mesh: null, key: '', token: 0, targetIndex: null, lightweight: false, dueAt: 0 };

var stageLyricSingleLinePrewarm = { items: {}, order: [], max: 10 };

var stageLyricWarmup = { until: 0, reason: '' };

var stageLyricRestoreWarmup = { time: 0, token: 0, until: 0, reason: '' };

var stageLyricFullTrackWarmupTimer = 0;

var stageLyricFullTrackWarmupTargetAt = 0;

var stageLyricFullTrackWarmupIdle = 0;

var stageLyricPlaybackWarmupLastAt = 0;

var stageLyricPlaybackWarmupLastIndex = -1;

var stageLyricResumeWarmupLastAt = 0;

var stageLyricResumeWarmupLastIndex = -1;

var stageLyricResumeUpgradeDeferUntil = 0;

var stageLyricLightweightUpgradeLastAt = 0;

var stageLyricTextLoadCache = { key: '', info: null };

var stageLyricTrackSwitchBootstrapUntil = 0;

var stageLyricResidentBuild = { job: null, timer: 0, raf: 0, token: 0 };

var stageLyricResidentDemand = { timer: 0, mesh: null, targetIndex: -1, options: null };

var stageLyricTrackGeneration = 0;


var lyricKaraokeMeasureCanvas = null;

var stageLyricTrackCache = { key: '', entries: null, lineMap: null, start: 0, end: -1 };

// ============================================================
//  涟漪触发系统 — 3×3 九宫格 + bass 上升沿

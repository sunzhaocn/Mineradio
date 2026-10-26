'use strict';

var firstPlayDone = false;

var sourceFallbackNoticeTimer = null;

var SOURCE_FALLBACK_SEARCH_TIMEOUT_MS = 6500;

var SOURCE_FALLBACK_DIRECT_PROVIDERS = ['netease', 'qq', 'kugou', 'qishui'];

// 每首歌单独计算恢复预算，汽水冷缓存准备也有时间完成。
var SOURCE_FALLBACK_RECOVERY_TIMEOUT_MS = 120000;

var sourceFallbackRecoverySerial = 0;

var activeSourceFallbackRecovery = null;

var sourceFallbackBudgetTimeoutResult = {};


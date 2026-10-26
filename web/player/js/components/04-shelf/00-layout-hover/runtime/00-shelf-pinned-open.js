'use strict';

// ============================================================
var shelfPinnedOpen = false;

var shelfManager = null;

var shelfOpenAnimAt = -10;

var shelfHoverCue = { target: 0, value: 0, x: 0, y: 0, lastAt: 0, enteredAt: 0, zoneActive: false, guide: false };

var shelfVisibility = 0;
  // 0..1, 侧栏自动隐藏的整体透明度系数
var shelfPlaybackSwitchGuardUntil = 0;

var shelfPlaybackSwitchGuardUntil = 0;

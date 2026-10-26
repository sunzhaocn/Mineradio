'use strict';



async function setCamMode(m) {
  if (m === 'head') m = 'gesture'; // v8: 头部追踪已下线, 兼容旧设置
  m = m === 'gesture' ? 'gesture' : 'off';
  fx.cam = m;
  if (m === 'off') {
    stopGestureControl();
    syncGestureCameraUi();
    saveLyricLayout({ user: true, reason: 'cam' });
    return true;
  }
  syncGestureCameraUi();
  saveLyricLayout({ user: true, reason: 'cam' });
  var started = await startGestureControl();
  syncGestureCameraUi();
  return started === true;
}

// ============================================================
//  更新提示预览

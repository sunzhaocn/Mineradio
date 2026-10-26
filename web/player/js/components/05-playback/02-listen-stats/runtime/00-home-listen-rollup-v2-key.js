'use strict';

var HOME_LISTEN_ROLLUP_V2_KEY = 'mineradio-listen-rollup-v2';

var listenSessionSerial = 0;

// 页面关闭前保存最后一次聆听；仅切到后台时不拆分播放会话。
window.addEventListener('pagehide', function () { finalizeListenSession(false); });
document.addEventListener('visibilitychange', function () {
  if (!document.hidden || !listenSession) return;
  tickListenSessionSnapshot(listenSession, false);
  recordRecentListenSession(listenSession, true);
});

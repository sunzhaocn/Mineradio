'use strict';


var deferredShelfRebuild = { raf: 0, reason: '', asyncCards: true, token: 0 };

window.addEventListener('blur', clearShelfPreviewOnPointerExit);

document.addEventListener('mouseleave', clearShelfPreviewOnPointerExit);

document.addEventListener('mouseout', function (e) {
  if (!e.relatedTarget && !e.toElement) clearShelfPreviewOnPointerExit(e);
});

// ============================================================
//  二级内容框 (歌单内的歌曲列表) — 同样 PSP 风格滚动

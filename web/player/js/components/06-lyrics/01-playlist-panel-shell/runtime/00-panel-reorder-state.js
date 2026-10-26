'use strict';


var panelReorderState = { timer: 0, active: false, pointerId: null, suppressClickUntil: 0 };

var reorderLongPressMs = 520;

var reorderMoveCancelPx = 9;

document.addEventListener('click', function (e) {
  if (miniQueueOpen && !(e.target && e.target.closest && e.target.closest('#bottom-bar'))) closeMiniQueue();
});

bindSmoothQueueScrolling();

bindPlaylistPanelLazyRender();

bindLongPressPanelReorder();

bindModalBackdropClose();

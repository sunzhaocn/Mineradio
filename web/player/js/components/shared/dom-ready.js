'use strict';

// Initializers register here while their external scripts load. The loader flushes
// these callbacks after every module and the document are ready, exactly once.
function onMineradioDomReady(callback) {
  if (window.MINERADIO_MODULE_STATUS.ready && document.readyState !== 'loading') {
    queueMicrotask(callback);
    return;
  }
  (window.MINERADIO_DOM_READY_CALLBACKS || (window.MINERADIO_DOM_READY_CALLBACKS = [])).push(callback);
}

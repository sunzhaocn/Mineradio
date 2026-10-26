'use strict';


var currentFxAutosaveDiskTimer = null;

var currentFxAutosaveDiskPayload = null;

var currentFxAutosaveBootAt = Date.now();

var currentFxAutosaveUserDirty = false;

var currentFxAutosaveLastUserReason = '';

var lyricLayoutSaveTimer = null;

var lyricLayoutSaveOpts = null;

window.addEventListener('beforeunload', flushLyricLayoutSave);

window.addEventListener('pagehide', flushLyricLayoutSave);

document.addEventListener('visibilitychange', function () {
  if (document.hidden) flushLyricLayoutSave();
});

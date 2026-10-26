'use strict';

var MEMORY_REDUCT_MASK_BITS = {
  workingSet: 1,
  modifiedList: 4,
  standbyList: 8,
  standbyLow: 16
};

var MEMORY_REDUCT_MASK_DEFAULT = 29;

var memorySnapshotTimer = 0;

var memoryLastSnapshotAt = 0;

var memoryLastStatusPayload = null;

var MEMORY_SAFE_REVISION = 3;


onMineradioDomReady(function () { setTimeout(bindSystemMemoryControls, 0); });

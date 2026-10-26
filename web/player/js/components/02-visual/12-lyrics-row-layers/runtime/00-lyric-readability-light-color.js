'use strict';


var lyricReadabilityLightColor = null;

var lyricReadabilityDarkColor = null;

var lyricReadabilityMixColor = null;


var lyricViewportFitLeft = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;

var lyricViewportFitRight = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;


var lyricRenderUploadFrameBudget = { frame: 0, remaining: 1, consumed: 0, maxConsumed: 0 };


var lyricQualityState = {
  queue: [],
  timer: 0,
  idle: 0,
  generation: 1,
  residents: [],
  bytes: 0,
  lastBuildMs: 0,
  frameCandidates: [],
  frameCommits: [],
  selectionFrame: 0,
  deferFinalize: false,
  transitionBudgetUntil: 0,
  transitionBaseBytes: 0
};

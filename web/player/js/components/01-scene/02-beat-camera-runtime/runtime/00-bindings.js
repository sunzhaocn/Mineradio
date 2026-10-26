'use strict';


window.addEventListener('beforeunload', flushPersistentVisualState);

window.addEventListener('pagehide', flushPersistentVisualState);


var beatBandRangeCache = Object.create(null);

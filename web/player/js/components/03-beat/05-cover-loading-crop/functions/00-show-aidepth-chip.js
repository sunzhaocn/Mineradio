'use strict';

var pendingCoverLoad = null;

function cancelPendingCoverLoad() {
  var operation = pendingCoverLoad;
  pendingCoverLoad = null;
  if (!operation) return;
  operation.cancelled = true;
  operation.images.forEach(function (img) {
    img.onload = img.onerror = null;
    // Removing src releases the browser's same-origin HTTP connection, whereas
    // an onload token check alone leaves an obsolete /api/cover downloading.
    try { img.removeAttribute('src'); } catch (e) { }
  });
  if (operation.reader) {
    operation.reader.onload = operation.reader.onerror = null;
    if (operation.reader.readyState === 1) {
      try { operation.reader.abort(); } catch (e) { }
    }
  }
}

function coverLoadStillCurrent(operation) {
  return !!operation && !operation.cancelled && pendingCoverLoad === operation &&
    (operation.trackToken == null || typeof trackSwitchToken === 'undefined' || operation.trackToken === trackSwitchToken) &&
    coverApplyStillCurrent(operation.opts);
}

function beginCoverLoad(opts) {
  opts = Object.assign({}, opts || {});
  var token = opts.trackToken;
  if (token == null && typeof trackSwitchToken !== 'undefined') token = trackSwitchToken;
  if ((token != null && typeof trackSwitchToken !== 'undefined' && token !== trackSwitchToken) || !coverApplyStillCurrent(opts)) return null;
  cancelPendingCoverLoad();
  if (token != null) opts.trackToken = token;
  pendingCoverLoad = { opts: opts, trackToken: token, images: [], reader: null, cancelled: false };
  return pendingCoverLoad;
}

function finishCoverLoad(operation) {
  if (pendingCoverLoad !== operation) return;
  operation.images.forEach(function (img) { img.onload = img.onerror = null; });
  if (operation.reader) operation.reader.onload = operation.reader.onerror = null;
  pendingCoverLoad = null;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('mineradio:playback-intent', cancelPendingCoverLoad);
}


function showAIDepthChip(text) {
  document.getElementById('ai-depth-text').textContent = text || 'AI 深度估计…';
  document.getElementById('ai-depth-chip').classList.add('show');
}

function hideAIDepthChip() {
  document.getElementById('ai-depth-chip').classList.remove('show');
}


function loadCoverFromUrl(directUrl, opts) {
  opts = opts || {};
  if (window.mineradioMediaCache && !opts.cacheResolved && !/^mineradio-local:/.test(directUrl || '')) {
    var cacheToken = typeof trackSwitchToken === 'undefined' ? null : trackSwitchToken;
    var cacheSong = typeof currentCoverSong === 'function' ? currentCoverSong() : null;
    var cachedOptions = Object.assign({}, opts, { cacheResolved: true, trackToken: cacheToken });
    mineradioMediaCache.cover(directUrl, cacheSong).then(function (data) {
      if (cacheToken !== trackSwitchToken || !coverApplyStillCurrent(cachedOptions)) return;
      if (data) applyCoverDataUrl(data, cachedOptions);
      else loadCoverFromUrl(directUrl, cachedOptions);
    });
    return;
  }
  var operation = beginCoverLoad(opts);
  if (!operation) return;
  opts = operation.opts;
  var preserveOnSwitch = !!(opts.trackSwitch || opts.seamlessCover || opts.seamlessTrackSwitch);
  if (!directUrl || typeof directUrl !== 'string' || (!/^https?:\/\//i.test(directUrl) && !/^mineradio-local:\/\/cover\//i.test(directUrl))) {
    finishCoverLoad(operation);
    if (!coverApplyStillCurrent(opts)) return;
    if (preserveOnSwitch && uniforms.uHasCover.value > 0.5) {
      document.getElementById('thumb-cover').removeAttribute('src');
      setControlCoverSrc('');
      setAlbumBackground('', { preserve: true });
      return;
    }
    currentCoverSource = null;
    coverProcessToken++;
    uniforms.uHasCover.value = 0; setCoverDepthState(0, 0, 1);
    resetFloatColorsToIdle();
    setAlbumBackground('');
    document.getElementById('thumb-cover').removeAttribute('src');
    setControlCoverSrc('');
    return;
  }
  var proxiedUrl = coverProxySrc(directUrl);
  if (!proxiedUrl) {
    finishCoverLoad(operation);
    if (preserveOnSwitch && uniforms.uHasCover.value > 0.5) return;
    uniforms.uHasCover.value = 0; setCoverDepthState(0, 0, 1);
    resetFloatColorsToIdle();
    setAlbumBackground('');
    setControlCoverSrc('');
    return;
  }
  var img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
  operation.images.push(img);
  img.onload = function () {
    if (!coverLoadStillCurrent(operation)) return;
    var size = coverTextureSizeForResolution(fx.coverResolution);
    var cv = document.createElement('canvas'); cv.width = cv.height = size;
    var cx = cv.getContext('2d');
    var iw = img.naturalWidth, ih = img.naturalHeight, s = Math.min(iw, ih);
    cx.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, size, size);
    finishCoverLoad(operation);
    setAlbumBackground(proxiedUrl || directUrl);
    applyCoverCanvas(cv, proxiedUrl || directUrl, Object.assign({}, opts, { coverKey: directUrl || proxiedUrl || '', coverSourceKind: 'url', coverSource: directUrl }));
  };
  img.onerror = function () {
    if (!coverLoadStillCurrent(operation)) return;
    var img2 = new Image(); img2.crossOrigin = 'anonymous'; img2.decoding = 'async';
    operation.images.push(img2);
    img2.onload = function () {
      if (!coverLoadStillCurrent(operation)) return;
      var size = coverTextureSizeForResolution(fx.coverResolution);
      var cv = document.createElement('canvas'); cv.width = cv.height = size;
      cv.getContext('2d').drawImage(img2, 0, 0, size, size);
      finishCoverLoad(operation);
      setAlbumBackground(directUrl);
      applyCoverCanvas(cv, directUrl, Object.assign({}, opts, { coverKey: directUrl || '', coverSourceKind: 'url', coverSource: directUrl }));
    };
    img2.onerror = function () {
      if (!coverLoadStillCurrent(operation)) return;
      finishCoverLoad(operation);
      if (preserveOnSwitch && uniforms.uHasCover.value > 0.5) return;
      currentCoverSource = null;
      uniforms.uHasCover.value = 0; setCoverDepthState(0, 0, 1);
      resetFloatColorsToIdle();
      setAlbumBackground('');
      setControlCoverSrc('');
    };
    img2.src = directUrl;
  };
  img.src = proxiedUrl;
}


function cssBackgroundUrl(src) {
  return 'url("' + String(src || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")';
}


function setAlbumBackground(src, opts) {
  opts = opts || {};
  var bg = document.getElementById('album-bg');
  var next = document.getElementById('album-bg-next');
  if (!bg) return;
  if (!src) {
    if (opts.preserve) return;
    albumBackgroundCurrentSrc = '';
    bg.classList.remove('visible');
    if (next) next.classList.remove('visible');
    bg.style.backgroundImage = '';
    if (next) next.style.backgroundImage = '';
    refreshCustomBackgroundAlbumMedia();
    return;
  }
  albumBackgroundCurrentSrc = src;
  if (!next) {
    bg.style.backgroundImage = cssBackgroundUrl(src);
    bg.classList.add('visible');
    refreshCustomBackgroundAlbumMedia();
    return;
  }
  var outgoing = albumBackgroundSlot === 0 ? bg : next;
  var incoming = albumBackgroundSlot === 0 ? next : bg;
  incoming.style.backgroundImage = cssBackgroundUrl(src);
  incoming.classList.add('visible');
  outgoing.classList.remove('visible');
  albumBackgroundSlot = albumBackgroundSlot === 0 ? 1 : 0;
  if (albumBackgroundClearTimer) clearTimeout(albumBackgroundClearTimer);
  albumBackgroundClearTimer = setTimeout(function () {
    albumBackgroundClearTimer = 0;
    if (!outgoing.classList.contains('visible')) outgoing.style.backgroundImage = '';
  }, 900);
  refreshCustomBackgroundAlbumMedia();
}


function refreshCustomBackgroundAlbumMedia() {
  if (typeof customBackgroundUsesAlbumCover !== 'function' || !customBackgroundUsesAlbumCover()) return;
  if (typeof updateCustomBackgroundControls === 'function') updateCustomBackgroundControls();
  else if (typeof applyCustomBackground === 'function') applyCustomBackground();
}


function makeSquareCoverCanvas(img, size, crop) {
  size = size || 512;
  var cv = document.createElement('canvas');
  cv.width = cv.height = size;
  var cx = cv.getContext('2d');
  cx.clearRect(0, 0, size, size);
  var iw = img.naturalWidth || img.width;
  var ih = img.naturalHeight || img.height;
  if (crop) {
    cx.drawImage(img, crop.sx, crop.sy, crop.sSize, crop.sSize, 0, 0, size, size);
  } else {
    var s = Math.min(iw, ih);
    cx.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, size, size);
  }
  return cv;
}


function coverCanvasToDataUrl(cv) {
  try {
    var webp = cv.toDataURL('image/webp', 0.88);
    if (/^data:image\/webp/i.test(webp)) return webp;
  } catch (e) { }
  return cv.toDataURL('image/jpeg', 0.88);
}


function applyCoverDataUrl(dataUrl, opts) {
  if (!dataUrl) return;
  var operation = beginCoverLoad(opts);
  if (!operation) return;
  opts = operation.opts;
  var img = new Image();
  img.decoding = 'async';
  operation.images.push(img);
  img.onload = function () {
    if (!coverLoadStillCurrent(operation)) return;
    var cv = makeSquareCoverCanvas(img, coverTextureSizeForResolution(fx.coverResolution));
    finishCoverLoad(operation);
    setAlbumBackground(dataUrl);
    applyCoverCanvas(cv, dataUrl, Object.assign({}, opts, { coverSourceKind: 'data', coverSource: dataUrl }));
  };
  img.onerror = function () { if (coverLoadStillCurrent(operation)) finishCoverLoad(operation); };
  img.src = dataUrl;
}


function commitCustomCoverCanvas(cv, opts) {
  var out = document.createElement('canvas');
  out.width = out.height = 512;
  out.getContext('2d').drawImage(cv, 0, 0, 512, 512);
  setCustomCoverForCurrent(coverCanvasToDataUrl(out), opts);
}


function loadCoverFromFile(file, opts) {
  var operation = beginCoverLoad(opts);
  if (!operation) return;
  opts = operation.opts;
  var reader = new FileReader();
  operation.reader = reader;
  reader.onload = function (e) {
    if (!coverLoadStillCurrent(operation)) return;
    var img = new Image();
    operation.images.push(img);
    img.onload = function () {
      if (!coverLoadStillCurrent(operation)) return;
      var iw = img.naturalWidth || img.width;
      var ih = img.naturalHeight || img.height;
      if (Math.abs(iw - ih) <= 1) {
        finishCoverLoad(operation);
        commitCustomCoverCanvas(makeSquareCoverCanvas(img, 512), opts);
      } else {
        openCoverCropModal(img, e.target.result, operation);
      }
    };
    img.onerror = function () { if (coverLoadStillCurrent(operation)) finishCoverLoad(operation); };
    img.src = e.target.result;
  };
  reader.onerror = function () { if (coverLoadStillCurrent(operation)) finishCoverLoad(operation); };
  reader.readAsDataURL(file);
}


function bindCoverCropModal() {
  if (coverCropBound) return;
  coverCropBound = true;
  var stage = document.getElementById('cover-crop-stage');
  var zoom = document.getElementById('cover-crop-zoom');
  if (!stage || !zoom) return;
  stage.addEventListener('pointerdown', function (e) {
    if (!coverCropState) return;
    e.preventDefault();
    coverCropState.dragging = true;
    coverCropState.lastX = e.clientX;
    coverCropState.lastY = e.clientY;
    stage.classList.add('dragging');
    if (stage.setPointerCapture) {
      try { stage.setPointerCapture(e.pointerId); } catch (err) { }
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!coverCropState || !coverCropState.dragging) return;
    e.preventDefault();
    var dx = e.clientX - coverCropState.lastX;
    var dy = e.clientY - coverCropState.lastY;
    coverCropState.lastX = e.clientX;
    coverCropState.lastY = e.clientY;
    coverCropState.x += dx;
    coverCropState.y += dy;
    updateCoverCropTransform();
  });
  function stopDrag() {
    if (!coverCropState) return;
    coverCropState.dragging = false;
    stage.classList.remove('dragging');
  }
  stage.addEventListener('pointerup', stopDrag);
  stage.addEventListener('pointercancel', stopDrag);
  stage.addEventListener('wheel', function (e) {
    if (!coverCropState) return;
    e.preventDefault();
    var next = coverCropState.scaleFactor + (e.deltaY < 0 ? 0.10 : -0.10);
    coverCropState.scaleFactor = Math.max(1, Math.min(3.2, next));
    zoom.value = coverCropState.scaleFactor;
    updateCoverCropTransform();
  }, { passive: false });
  zoom.addEventListener('input', function () {
    if (!coverCropState) return;
    coverCropState.scaleFactor = Math.max(1, Math.min(3.2, parseFloat(zoom.value) || 1));
    updateCoverCropTransform();
  });
}


function openCoverCropModal(img, dataUrl, operation) {
  bindCoverCropModal();
  var modal = document.getElementById('cover-crop-modal');
  var stage = document.getElementById('cover-crop-stage');
  var imgEl = document.getElementById('cover-crop-img');
  var zoom = document.getElementById('cover-crop-zoom');
  if (!modal || !stage || !imgEl || !zoom) return;
  imgEl.src = dataUrl;
  zoom.value = '1';
  coverCropState = {
    coverLoad: operation || null,
    img: img,
    dataUrl: dataUrl,
    naturalW: img.naturalWidth || img.width,
    naturalH: img.naturalHeight || img.height,
    stageSize: 0,
    baseScale: 1,
    scaleFactor: 1,
    x: 0,
    y: 0,
    dragging: false,
    lastX: 0,
    lastY: 0
  };
  openGsapModal(modal);
  requestAnimationFrame(function () {
    initCoverCropGeometry();
    pulseCoverCropStage();
  });
}


function initCoverCropGeometry() {
  if (!coverCropState) return;
  var stage = document.getElementById('cover-crop-stage');
  var rect = stage ? stage.getBoundingClientRect() : null;
  var size = rect ? Math.max(220, Math.round(rect.width)) : 312;
  coverCropState.stageSize = size;
  coverCropState.baseScale = size / Math.min(coverCropState.naturalW, coverCropState.naturalH);
  coverCropState.x = 0;
  coverCropState.y = 0;
  updateCoverCropTransform();
}


function clampCoverCropPan() {
  if (!coverCropState) return;
  var s = coverCropState.baseScale * coverCropState.scaleFactor;
  var rw = coverCropState.naturalW * s;
  var rh = coverCropState.naturalH * s;
  var maxX = Math.max(0, (rw - coverCropState.stageSize) / 2);
  var maxY = Math.max(0, (rh - coverCropState.stageSize) / 2);
  coverCropState.x = Math.max(-maxX, Math.min(maxX, coverCropState.x));
  coverCropState.y = Math.max(-maxY, Math.min(maxY, coverCropState.y));
}


function updateCoverCropTransform() {
  if (!coverCropState) return;
  clampCoverCropPan();
  var imgEl = document.getElementById('cover-crop-img');
  if (!imgEl) return;
  var baseW = coverCropState.naturalW * coverCropState.baseScale;
  var baseH = coverCropState.naturalH * coverCropState.baseScale;
  imgEl.style.width = baseW + 'px';
  imgEl.style.height = baseH + 'px';
  imgEl.style.transform = 'translate(-50%, -50%) translate(' + coverCropState.x + 'px,' + coverCropState.y + 'px) scale(' + coverCropState.scaleFactor + ')';
  drawCoverCropPreview();
}


function currentCoverCropRect() {
  if (!coverCropState) return null;
  var s = coverCropState.baseScale * coverCropState.scaleFactor;
  var rw = coverCropState.naturalW * s;
  var rh = coverCropState.naturalH * s;
  var left = coverCropState.stageSize / 2 - rw / 2 + coverCropState.x;
  var top = coverCropState.stageSize / 2 - rh / 2 + coverCropState.y;
  var sx = (0 - left) / s;
  var sy = (0 - top) / s;
  var sSize = coverCropState.stageSize / s;
  sx = Math.max(0, Math.min(coverCropState.naturalW - sSize, sx));
  sy = Math.max(0, Math.min(coverCropState.naturalH - sSize, sy));
  return { sx: sx, sy: sy, sSize: sSize };
}


function drawCoverCropPreview() {
  if (!coverCropState) return;
  var preview = document.getElementById('cover-crop-preview');
  var crop = currentCoverCropRect();
  if (!preview || !crop) return;
  var ctx = preview.getContext('2d');
  ctx.clearRect(0, 0, preview.width, preview.height);
  ctx.drawImage(coverCropState.img, crop.sx, crop.sy, crop.sSize, crop.sSize, 0, 0, preview.width, preview.height);
}


function pulseCoverCropStage() {
  var stage = document.getElementById('cover-crop-stage');
  if (!stage || !window.gsap) return;
  window.gsap.fromTo(stage, { scale: 0.985 }, { scale: 1, duration: 0.72, ease: 'expo.out', overwrite: true });
}


function closeCoverCropModal() {
  var modal = document.getElementById('cover-crop-modal');
  closeGsapModal(modal, function () {
    var imgEl = document.getElementById('cover-crop-img');
    if (imgEl) imgEl.removeAttribute('src');
    coverCropState = null;
  });
}


function commitCoverCrop() {
  if (!coverCropState) return;
  var operation = coverCropState.coverLoad;
  if (operation && !coverLoadStillCurrent(operation)) {
    closeCoverCropModal();
    return;
  }
  var crop = currentCoverCropRect();
  if (!crop) return;
  var cv = makeSquareCoverCanvas(coverCropState.img, 512, crop);
  if (operation) finishCoverLoad(operation);
  commitCustomCoverCanvas(cv, operation ? operation.opts : undefined);
  closeCoverCropModal();
}

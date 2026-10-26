'use strict';


function customBackgroundCropMediaSrc(media) {
  if (!media) return '';
  if (media.type === 'image') return media.src || '';
  if (media.type === 'video') {
    var activeVideo = document.getElementById('custom-bg-video');
    var activeSrc = activeVideo && (activeVideo.currentSrc || activeVideo.getAttribute('src')) || '';
    return activeSrc || media.src || '';
  }
  return '';
}

function bindCustomBackgroundCropModal() {
  if (customBackgroundCropModalBound) return;
  customBackgroundCropModalBound = true;
  var stage = document.getElementById('background-crop-stage');
  var zoom = document.getElementById('background-crop-zoom');
  if (!stage || !zoom) return;
  stage.addEventListener('pointerdown', function (e) {
    if (!customBackgroundCropModalState) return;
    e.preventDefault();
    customBackgroundCropModalState.dragging = true;
    customBackgroundCropModalState.lastX = e.clientX;
    customBackgroundCropModalState.lastY = e.clientY;
    stage.classList.add('dragging');
    if (stage.setPointerCapture) {
      try { stage.setPointerCapture(e.pointerId); } catch (err) { }
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!customBackgroundCropModalState || !customBackgroundCropModalState.dragging) return;
    e.preventDefault();
    var rect = stage.getBoundingClientRect();
    var dx = e.clientX - customBackgroundCropModalState.lastX;
    var dy = e.clientY - customBackgroundCropModalState.lastY;
    customBackgroundCropModalState.lastX = e.clientX;
    customBackgroundCropModalState.lastY = e.clientY;
    var zoomFactor = Math.max(1, Number(fx.backgroundMediaZoom) || 1);
    var nextX = (Number(fx.backgroundMediaCropX) || 50) - (dx / Math.max(1, rect.width)) * 100 / zoomFactor;
    var nextY = (Number(fx.backgroundMediaCropY) || 50) - (dy / Math.max(1, rect.height)) * 100 / zoomFactor;
    applyCustomBackgroundCropSnapshot({ x: nextX, y: nextY, zoom: zoomFactor });
  });
  function stopDrag() {
    if (!customBackgroundCropModalState) return;
    customBackgroundCropModalState.dragging = false;
    stage.classList.remove('dragging');
  }
  stage.addEventListener('pointerup', stopDrag);
  stage.addEventListener('pointercancel', stopDrag);
  stage.addEventListener('wheel', function (e) {
    if (!customBackgroundCropModalState) return;
    e.preventDefault();
    var current = customBackgroundCropSnapshot();
    current.zoom = clampRange(current.zoom + (e.deltaY < 0 ? 0.08 : -0.08), 1, 2.8);
    applyCustomBackgroundCropSnapshot(current);
  }, { passive: false });
  zoom.addEventListener('input', function () {
    if (!customBackgroundCropModalState) return;
    var current = customBackgroundCropSnapshot();
    current.zoom = clampRange(Number(zoom.value) || 1, 1, 2.8);
    applyCustomBackgroundCropSnapshot(current);
  });
}

function updateCustomBackgroundCropModalView() {
  var snapshot = customBackgroundCropSnapshot();
  var zoom = document.getElementById('background-crop-zoom');
  if (zoom) zoom.value = snapshot.zoom;
  ['background-crop-stage', 'background-crop-preview'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.setProperty('--bg-crop-modal-x', snapshot.x.toFixed(1) + '%');
    el.style.setProperty('--bg-crop-modal-y', snapshot.y.toFixed(1) + '%');
    el.style.setProperty('--bg-crop-modal-zoom', snapshot.zoom.toFixed(3));
  });
}

function releaseCustomBackgroundCropModalObjectUrl() {
  if (customBackgroundCropModalObjectUrl) {
    URL.revokeObjectURL(customBackgroundCropModalObjectUrl);
    customBackgroundCropModalObjectUrl = '';
  }
}

function setCustomBackgroundCropModalSource(media, src) {
  var stage = document.getElementById('background-crop-stage');
  var preview = document.getElementById('background-crop-preview');
  var img = document.getElementById('background-crop-img');
  var video = document.getElementById('background-crop-video');
  var previewImg = document.getElementById('background-crop-preview-img');
  var previewVideo = document.getElementById('background-crop-preview-video');
  [stage, preview].forEach(function (el) {
    if (!el) return;
    el.classList.toggle('media-image', media && media.type === 'image');
    el.classList.toggle('media-video', media && media.type === 'video');
  });
  if (img) img.removeAttribute('src');
  if (previewImg) previewImg.removeAttribute('src');
  [video, previewVideo].forEach(function (el) {
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    el.load();
  });
  if (!src) return;
  if (media.type === 'image') {
    if (img) img.src = src;
    if (previewImg) previewImg.src = src;
  } else if (media.type === 'video') {
    [video, previewVideo].forEach(function (el) {
      if (!el) return;
      el.src = src;
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      var p = el.play();
      if (p && p.catch) p.catch(function () { });
    });
  }
}

function openCustomBackgroundCropModal() {
  var media = customBackgroundActiveMedia();
  if (!media) {
    showToast('\u5148\u9009\u62e9\u5c01\u9762\u3001\u56fe\u7247\u6216\u89c6\u9891');
    return;
  }
  bindCustomBackgroundCropModal();
  var modal = document.getElementById('background-crop-modal');
  if (!modal) return;
  releaseCustomBackgroundCropModalObjectUrl();
  customBackgroundCropModalState = {
    media: media,
    original: customBackgroundCropSnapshot(),
    dragging: false,
    lastX: 0,
    lastY: 0
  };
  var src = customBackgroundCropMediaSrc(media);
  if (media.type === 'video' && !src && media.id) {
    getCustomBackgroundBlob(media.id).then(function (blob) {
      if (!customBackgroundCropModalState || customBackgroundCropModalState.media !== media || !blob) return;
      releaseCustomBackgroundCropModalObjectUrl();
      customBackgroundCropModalObjectUrl = URL.createObjectURL(blob);
      setCustomBackgroundCropModalSource(media, customBackgroundCropModalObjectUrl);
    }).catch(function () { showToast('\u80cc\u666f\u89c6\u9891\u8bfb\u53d6\u5931\u8d25'); });
  } else {
    setCustomBackgroundCropModalSource(media, src);
  }
  updateCustomBackgroundCropModalView();
  openGsapModal(modal);
  var stage = document.getElementById('background-crop-stage');
  if (stage && window.gsap) window.gsap.fromTo(stage, { scale: 0.985 }, { scale: 1, duration: 0.72, ease: 'expo.out', overwrite: true });
}

function closeCustomBackgroundCropModal(restoreOriginal) {
  var modal = document.getElementById('background-crop-modal');
  var original = customBackgroundCropModalState && customBackgroundCropModalState.original;
  if (restoreOriginal && original) applyCustomBackgroundCropSnapshot(original);
  closeGsapModal(modal, function () {
    setCustomBackgroundCropModalSource({ type: 'image' }, '');
    releaseCustomBackgroundCropModalObjectUrl();
    customBackgroundCropModalState = null;
  });
}

function cancelCustomBackgroundCropModal() {
  closeCustomBackgroundCropModal(true);
}

function resetCustomBackgroundCropInModal() {
  applyCustomBackgroundCropSnapshot({
    x: fxDefaults.backgroundMediaCropX == null ? 50 : fxDefaults.backgroundMediaCropX,
    y: fxDefaults.backgroundMediaCropY == null ? 50 : fxDefaults.backgroundMediaCropY,
    zoom: fxDefaults.backgroundMediaZoom == null ? 1 : fxDefaults.backgroundMediaZoom
  });
}

function commitCustomBackgroundCropModal() {
  saveLyricLayout({ user: true, reason: 'backgroundMediaCrop' });
  showToast('\u80cc\u666f\u88c1\u5207\u5df2\u66f4\u65b0');
  closeCustomBackgroundCropModal(false);
}

function openCustomBackgroundCropModalSoon() {
  setTimeout(function () {
    if (customBackgroundActiveMedia()) openCustomBackgroundCropModal();
  }, 80);
}

function setCustomBackgroundImage(src, silent) {
  var image = normalizeCustomBackgroundImage(src);
  fx.backgroundImage = image;
  fx.backgroundMedia = image ? { type: 'image', src: image } : null;
  fx.backgroundAlbumCover = false;
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'backgroundImage' });
  if (!silent) showToast(fx.backgroundImage ? '背景图片已应用' : '背景图片已清除');
}

function clearCustomBackgroundImage() {
  setCustomBackgroundImage('');
}

function setCustomBackgroundMedia(media, silent) {
  media = normalizeCustomBackgroundMedia(media);
  if (media && media.type === 'album') {
    setCustomBackgroundAlbumCover(true, silent);
    return;
  }
  fx.backgroundMedia = media;
  fx.backgroundImage = media && media.type === 'image' ? media.src : '';
  fx.backgroundAlbumCover = false;
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'backgroundMedia' });
  if (!silent) showToast(media ? (media.type === 'video' ? '背景视频已应用' : '背景图片已应用') : '背景媒体已清除');
}

function readBackgroundImageFile(file) {
  if (!file || !/^image\//i.test(file.type || '')) {
    showToast('请选择图片文件');
    return;
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    var img = new Image();
    img.onload = function () {
      var maxSide = 2200;
      var iw = img.naturalWidth || img.width || 1;
      var ih = img.naturalHeight || img.height || 1;
      var scale = Math.min(1, maxSide / Math.max(iw, ih));
      var w = Math.max(1, Math.round(iw * scale));
      var h = Math.max(1, Math.round(ih * scale));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, w, h);
      var out = '';
      try { out = cv.toDataURL('image/webp', 0.84); } catch (err) { }
      if (!/^data:image\/webp/i.test(out)) {
        try { out = cv.toDataURL('image/jpeg', 0.86); } catch (err2) { out = String(e.target.result || ''); }
      }
      setCustomBackgroundImage(out);
      openCustomBackgroundCropModalSoon();
    };
    img.onerror = function () { showToast('背景图片读取失败'); };
    img.src = e.target.result;
  };
  reader.onerror = function () { showToast('背景图片读取失败'); };
  reader.readAsDataURL(file);
}

function readBackgroundVideoFile(file) {
  if (!file || !/^video\//i.test(file.type || '')) {
    showToast('请选择视频文件');
    return;
  }
  var id = 'bg-video-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  putCustomBackgroundBlob(id, file, { name: file.name || '', mime: file.type || '', size: file.size || 0 }).then(function () {
    setCustomBackgroundMedia({ type: 'video', id: id, name: file.name || '', mime: file.type || '', size: file.size || 0 });
    openCustomBackgroundCropModalSoon();
  }).catch(function (err) {
    console.warn('background video store failed:', err);
    if ((file.size || 0) > 18 * 1024 * 1024) {
      showToast('视频较大，当前环境无法保存，请换小一点的视频');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      setCustomBackgroundMedia({ type: 'video', src: String(e.target.result || ''), name: file.name || '', mime: file.type || '', size: file.size || 0 });
      openCustomBackgroundCropModalSoon();
    };
    reader.onerror = function () { showToast('背景视频读取失败'); };
    reader.readAsDataURL(file);
  });
}

function readBackgroundMediaFile(file) {
  if (!file) return;
  if (/^image\//i.test(file.type || '')) readBackgroundImageFile(file);
  else if (/^video\//i.test(file.type || '')) readBackgroundVideoFile(file);
  else showToast('请选择图片或视频文件');
}

function defaultUiAccentColor() {
  return normalizeHexColor(fxDefaults.uiAccentColor || '#ffffff', '#ffffff');
}

function applyUiAccentColor() {
  var fallback = defaultUiAccentColor();
  var color = normalizeHexColor(fx.uiAccentColor || fallback, fallback);
  var rgb = hexToRgb(color);
  var root = document.documentElement;
  root.style.setProperty('--fc-accent', color);
  root.style.setProperty('--fc-accent-hov', color);
  root.style.setProperty('--fc-accent-rgb', rgb.r + ',' + rgb.g + ',' + rgb.b);
  root.style.setProperty('--glass-border', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.30)');
  root.style.setProperty('--glass-shadow-focus', '0 24px 72px rgba(0,0,0,.34),0 0 0 1px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.13),0 0 42px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.075),inset 0 1px 0 rgba(255,255,255,.20)');
}

function updateUiAccentControls() {
  applyUiAccentColor();
  var fallback = defaultUiAccentColor();
  var color = normalizeHexColor(fx.uiAccentColor || fallback, fallback);
  var picker = document.getElementById('ui-accent-picker');
  var value = document.getElementById('ui-accent-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}

function setUiAccentColor(color, silent) {
  var fallback = defaultUiAccentColor();
  fx.uiAccentColor = normalizeHexColor(color || fallback, fallback);
  updateUiAccentControls();
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  saveLyricLayout({ user: true, reason: 'uiAccentColor' });
  if (!silent) showToast('界面高亮: ' + fx.uiAccentColor.toUpperCase());
}

function resetUiAccentColor() {
  setUiAccentColor(defaultUiAccentColor());
}

function updateVisualTintControls() {
  var picker = document.getElementById('visual-tint-picker');
  var value = document.getElementById('visual-tint-value');
  var autoBtn = document.getElementById('visual-tint-auto-btn');
  var color = normalizeHexColor(fx.visualTintColor || '#9db8cf');
  document.documentElement.style.setProperty('--visual-tint', color);
  if (picker) picker.value = color;
  if (value) value.textContent = fx.visualTintMode === 'custom' ? color.toUpperCase() : '封面取色';
  if (autoBtn) autoBtn.classList.toggle('active', fx.visualTintMode !== 'custom');
}

function setVisualTintAuto() {
  fx.visualTintMode = 'auto';
  updateVisualTintControls();
  syncFxUniforms();
  saveLyricLayout({ user: true, reason: 'visualTintAuto' });
  showToast('视觉主色: 封面取色');
}

function resetVisualTintColor() {
  fx.visualTintMode = 'auto';
  fx.visualTintColor = normalizeHexColor(fxDefaults.visualTintColor || '#9db8cf');
  updateVisualTintControls();
  syncFxUniforms();
  saveLyricLayout({ user: true, reason: 'visualTintReset' });
  showToast('视觉主色已恢复默认');
}

function setVisualTintCustom(color, silent) {
  fx.visualTintMode = 'custom';
  fx.visualTintColor = normalizeHexColor(color || '#9db8cf');
  updateVisualTintControls();
  syncFxUniforms();
  saveLyricLayout({ user: true, reason: 'visualTintColor' });
  if (!silent) showToast('视觉主色: ' + fx.visualTintColor.toUpperCase());
}

function sonicGroundColorControl(key) {
  for (var i = 0; i < SONIC_GROUND_COLOR_CONTROLS.length; i++) {
    if (SONIC_GROUND_COLOR_CONTROLS[i].key === key || SONIC_GROUND_COLOR_CONTROLS[i].picker === key) return SONIC_GROUND_COLOR_CONTROLS[i];
  }
  return null;
}

function sonicHexRgb(hex, fallback) {
  hex = normalizeHexColor(hex || fallback || '#ffffff', fallback || '#ffffff').slice(1);
  var n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
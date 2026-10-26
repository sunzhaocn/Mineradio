'use strict';

function applyHomeAccentColor() {
  var color = normalizeHexColor(fx.homeAccentColor || '#00f5d4');
  var rgb = hexToRgb(color);
  document.documentElement.style.setProperty('--home-accent', color);
  document.documentElement.style.setProperty('--home-accent-rgb', rgb.r + ',' + rgb.g + ',' + rgb.b);
}

function updateHomeAccentControls() {
  applyHomeAccentColor();
  var color = normalizeHexColor(fx.homeAccentColor || '#00f5d4');
  var picker = document.getElementById('home-accent-picker');
  var value = document.getElementById('home-accent-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}

function setHomeAccentColor(color, silent) {
  fx.homeAccentColor = normalizeHexColor(color || '#00f5d4');
  updateHomeAccentControls();
  saveLyricLayout({ user: true, reason: 'homeAccentColor' });
  if (!silent) showToast('Home 填充: ' + fx.homeAccentColor.toUpperCase());
}

function resetHomeAccentColor() {
  setHomeAccentColor(fxDefaults.homeAccentColor || '#00f5d4');
}

function applyIconAccentColors() {
  var homeColor = normalizeHexColor(fx.homeIconColor || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a');
  var visualColor = normalizeHexColor(fx.visualIconColor || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff');
  var homeRgb = hexToRgb(homeColor);
  var visualRgb = hexToRgb(visualColor);
  var root = document.documentElement;
  root.style.setProperty('--home-icon-color', homeColor);
  root.style.setProperty('--home-icon-rgb', homeRgb.r + ',' + homeRgb.g + ',' + homeRgb.b);
  root.style.setProperty('--visual-icon-color', visualColor);
  root.style.setProperty('--visual-icon-rgb', visualRgb.r + ',' + visualRgb.g + ',' + visualRgb.b);
}

function updateIconAccentControls() {
  applyIconAccentColors();
  var homeColor = normalizeHexColor(fx.homeIconColor || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a');
  var visualColor = normalizeHexColor(fx.visualIconColor || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff');
  var homePicker = document.getElementById('home-icon-picker');
  var homeValue = document.getElementById('home-icon-value');
  var visualPicker = document.getElementById('visual-icon-picker');
  var visualValue = document.getElementById('visual-icon-value');
  if (homePicker) homePicker.value = homeColor;
  if (homeValue) homeValue.textContent = homeColor.toUpperCase();
  if (visualPicker) visualPicker.value = visualColor;
  if (visualValue) visualValue.textContent = visualColor.toUpperCase();
}

function setHomeIconColor(color, silent) {
  fx.homeIconColor = normalizeHexColor(color || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a');
  updateIconAccentControls();
  saveLyricLayout({ user: true, reason: 'homeIconColor' });
  if (!silent) showToast('主页图标: ' + fx.homeIconColor.toUpperCase());
}

function resetHomeIconColor() {
  setHomeIconColor(fxDefaults.homeIconColor || '#f4d28a');
}

function setVisualIconColor(color, silent) {
  fx.visualIconColor = normalizeHexColor(color || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff');
  updateIconAccentControls();
  saveLyricLayout({ user: true, reason: 'visualIconColor' });
  if (!silent) showToast('视觉图标: ' + fx.visualIconColor.toUpperCase());
}

function resetVisualIconColor() {
  setVisualIconColor(fxDefaults.visualIconColor || '#7fd8ff');
}

function customBackgroundCropNumber(key, fallback, min, max) {
  var n = Number(fx && fx[key]);
  if (!isFinite(n)) n = Number(fallback);
  if (!isFinite(n)) n = min;
  return clampRange(n, min, max);
}

function customBackgroundAlbumCoverSource() {
  var src = '';
  try {
    if (typeof albumBackgroundCurrentSrc !== 'undefined' && albumBackgroundCurrentSrc) src = String(albumBackgroundCurrentSrc || '');
  } catch (e) { }
  if (!src) {
    try {
      if (typeof currentCoverSource !== 'undefined' && currentCoverSource && currentCoverSource.src) src = String(currentCoverSource.src || '');
    } catch (e2) { }
  }
  if (!src) {
    try {
      var thumb = document.getElementById('thumb-cover');
      src = thumb && (thumb.currentSrc || thumb.src || thumb.getAttribute('src')) || '';
    } catch (e3) { }
  }
  if (!src) {
    try {
      var song = typeof sonicWorkshopCurrentSong === 'function' ? sonicWorkshopCurrentSong() : null;
      if (!song) song = Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
      if (!song) song = Array.isArray(playlist) && currentIdx >= 0 && currentIdx < playlist.length ? playlist[currentIdx] : null;
      if (song) src = typeof songCoverSrc === 'function' ? songCoverSrc(song, 640) : (song.customCover || song.cover || '');
    } catch (e4) { }
  }
  if (src && /^https?:\/\//i.test(src) && typeof coverProxySrc === 'function') return coverProxySrc(src, false) || src;
  return src || '';
}

function customBackgroundActiveMedia() {
  var media = normalizeCustomBackgroundMedia(fx.backgroundMedia || fx.backgroundImage);
  if ((typeof customBackgroundUsesAlbumCover === 'function' && customBackgroundUsesAlbumCover()) || (media && media.type === 'album')) {
    var albumSrc = customBackgroundAlbumCoverSource();
    return albumSrc ? { type: 'image', src: albumSrc, album: true } : null;
  }
  return media;
}

function applyCustomBackgroundCropVars(root, layer) {
  var cropX = customBackgroundCropNumber('backgroundMediaCropX', fxDefaults.backgroundMediaCropX == null ? 50 : fxDefaults.backgroundMediaCropX, 0, 100);
  var cropY = customBackgroundCropNumber('backgroundMediaCropY', fxDefaults.backgroundMediaCropY == null ? 50 : fxDefaults.backgroundMediaCropY, 0, 100);
  var zoom = customBackgroundCropNumber('backgroundMediaZoom', fxDefaults.backgroundMediaZoom == null ? 1 : fxDefaults.backgroundMediaZoom, 1, 2.8);
  var vars = [
    ['--custom-bg-position-x', cropX.toFixed(1) + '%'],
    ['--custom-bg-position-y', cropY.toFixed(1) + '%'],
    ['--custom-bg-zoom', zoom.toFixed(3)]
  ];
  vars.forEach(function (item) {
    if (root) root.style.setProperty(item[0], item[1]);
    if (layer) layer.style.setProperty(item[0], item[1]);
  });
}

function applyCustomBackground() {
  var color = normalizeHexColor(fx.backgroundColor || '#000000', '#000000');
  var rgb = hexToRgb(color);
  var albumMode = typeof customBackgroundUsesAlbumCover === 'function' && customBackgroundUsesAlbumCover();
  var media = customBackgroundActiveMedia();
  var image = media && media.type === 'image' ? media.src : '';
  var hasVideo = !!(media && media.type === 'video');
  var opacity = clampRange(fx.backgroundOpacity == null ? 1 : Number(fx.backgroundOpacity), 0, 1);
  var windowOpacity = clampRange(fx.windowBackgroundOpacity == null ? fxDefaults.windowBackgroundOpacity : Number(fx.windowBackgroundOpacity), 0, 1);
  var glassOpacity = clampRange(fx.backgroundGlassOpacity == null ? fxDefaults.backgroundGlassOpacity : Number(fx.backgroundGlassOpacity), 0, 1);
  var glassActive = glassOpacity > 0.001;
  var overlayOpacity = Math.max((media || albumMode) ? 0.18 : 0, glassActive ? glassOpacity * 0.42 : 0);
  var glassBlur = glassActive ? glassOpacity * 32 : 0;
  var glassSaturate = 1 + glassOpacity * 0.55;
  var glassBrightness = 1 + glassOpacity * 0.08;
  var glassVeil = glassOpacity * 0.075;
  var customColor = fx.backgroundColorMode === 'custom' || !!fx.backgroundColorCustom;
  var override = albumMode || !!media || customColor || opacity < 1 || windowOpacity < 0.999 || glassActive;
  var root = document.documentElement;
  var layer = document.getElementById('custom-bg');
  var video = document.getElementById('custom-bg-video');
  root.style.setProperty('--custom-bg-color', color);
  root.style.setProperty('--custom-bg-color-rgb', rgb.r + ', ' + rgb.g + ', ' + rgb.b);
  root.style.setProperty('--custom-bg-album-opacity', albumMode ? opacity.toFixed(3) : '1');
  applyCustomBackgroundCropVars(root, layer);
  document.body.classList.toggle('custom-background-override', override);
  document.body.classList.toggle('custom-background-flat', override && !media);
  document.body.classList.toggle('custom-background-album-cover', albumMode);
  document.body.classList.toggle('custom-background-video', hasVideo);
  document.body.classList.toggle('custom-window-transparent', windowOpacity < 0.999);
  document.body.classList.toggle('custom-bg-glass-active', glassActive);
  if (layer) {
    layer.style.setProperty('--custom-bg-image', image ? 'url("' + cssImageUrl(image) + '")' : 'none');
    layer.style.setProperty('--custom-bg-image-opacity', image ? opacity.toFixed(3) : '0');
    layer.style.setProperty('--custom-bg-video-opacity', hasVideo ? opacity.toFixed(3) : '0');
    layer.style.setProperty('--custom-bg-base-opacity', windowOpacity.toFixed(3));
    layer.style.setProperty('--custom-bg-overlay-opacity', overlayOpacity.toFixed(3));
    layer.style.setProperty('--custom-bg-glass-opacity', glassOpacity.toFixed(3));
    layer.style.setProperty('--custom-bg-glass-blur', glassBlur.toFixed(1) + 'px');
    layer.style.setProperty('--custom-bg-glass-saturate', glassSaturate.toFixed(3));
    layer.style.setProperty('--custom-bg-glass-brightness', glassBrightness.toFixed(3));
    layer.style.setProperty('--custom-bg-glass-veil', glassVeil.toFixed(3));
  }
  var token = ++customBgApplyToken;
  if (!video) return;
  if (!hasVideo) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (customBgObjectUrl) { URL.revokeObjectURL(customBgObjectUrl); customBgObjectUrl = ''; }
    return;
  }
  var wallpaperEngineActive = document.body.classList.contains('wallpaper-engine-active');
  if (wallpaperEngineActive) {
    video.pause();
    return;
  }
  function setVideoSrc(src) {
    if (token !== customBgApplyToken || !src) return;
    if (document.body.classList.contains('wallpaper-engine-active')) {
      video.pause();
      return;
    }
    if (customBgObjectUrl && customBgObjectUrl !== src) { URL.revokeObjectURL(customBgObjectUrl); customBgObjectUrl = ''; }
    if (video.getAttribute('src') !== src) {
      video.setAttribute('src', src);
      video.load();
    }
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    var p = video.play();
    if (p && p.catch) p.catch(function () { });
  }
  if (media.src) {
    setVideoSrc(media.src);
  } else if (media.id) {
    getCustomBackgroundBlob(media.id).then(function (blob) {
      if (token !== customBgApplyToken || !blob) return;
      if (customBgObjectUrl) URL.revokeObjectURL(customBgObjectUrl);
      customBgObjectUrl = URL.createObjectURL(blob);
      setVideoSrc(customBgObjectUrl);
    }).catch(function (err) { console.warn('background video load failed:', err); });
  }
}

function updateCustomBackgroundMediaPreview(media) {
  var preview = document.getElementById('bg-media-preview');
  if (!preview) return;
  media = media || customBackgroundActiveMedia();
  preview.classList.toggle('empty', !media);
  preview.classList.toggle('video', !!(media && media.type === 'video'));
  preview.style.removeProperty('background-image');
  preview.dataset.kind = '';
  if (!media) return;
  if (media.type === 'image' && media.src) {
    preview.style.backgroundImage = 'url("' + cssImageUrl(media.src) + '")';
    preview.dataset.kind = media.album ? 'COV' : 'IMG';
  } else if (media.type === 'video') {
    preview.dataset.kind = 'VID';
  }
}

function updateCustomBackgroundControls() {
  applyCustomBackground();
  var activeMedia = customBackgroundActiveMedia();
  var color = normalizeHexColor(fx.backgroundColor || '#000000', '#000000');
  var picker = document.getElementById('bg-color-picker');
  var value = document.getElementById('bg-color-value');
  var imageValue = document.getElementById('bg-image-value');
  var albumBtn = document.getElementById('bg-album-toggle-btn');
  var cropBtn = document.getElementById('bg-media-crop-btn');
  var customColor = fx.backgroundColorMode === 'custom' || !!fx.backgroundColorCustom;
  if (picker) picker.value = color;
  if (value) value.textContent = customColor ? color.toUpperCase() : '\u5c01\u9762\u6e10\u53d8';
  if (picker && picker.closest) {
    var row = picker.closest('.lyric-color-row');
    if (row) row.classList.toggle('bg-cover-mode', !customColor);
  }
  setRange('fx-bgopacity', fx.backgroundOpacity == null ? 1 : fx.backgroundOpacity);
  setRange('fx-windowbgopacity', fx.windowBackgroundOpacity == null ? fxDefaults.windowBackgroundOpacity : fx.windowBackgroundOpacity);
  setRange('fx-bgglassopacity', fx.backgroundGlassOpacity == null ? fxDefaults.backgroundGlassOpacity : fx.backgroundGlassOpacity);
  setRange('fx-bgcropx', customBackgroundCropNumber('backgroundMediaCropX', fxDefaults.backgroundMediaCropX == null ? 50 : fxDefaults.backgroundMediaCropX, 0, 100));
  setRange('fx-bgcropy', customBackgroundCropNumber('backgroundMediaCropY', fxDefaults.backgroundMediaCropY == null ? 50 : fxDefaults.backgroundMediaCropY, 0, 100));
  setRange('fx-bgzoom', customBackgroundCropNumber('backgroundMediaZoom', fxDefaults.backgroundMediaZoom == null ? 1 : fxDefaults.backgroundMediaZoom, 1, 2.8));
  if (imageValue) imageValue.textContent = customBackgroundMediaLabel(fx.backgroundMedia || fx.backgroundImage);
  if (albumBtn) {
    albumBtn.classList.toggle('active', typeof customBackgroundUsesAlbumCover === 'function' && customBackgroundUsesAlbumCover());
    albumBtn.setAttribute('aria-pressed', albumBtn.classList.contains('active') ? 'true' : 'false');
  }
  if (cropBtn) {
    cropBtn.disabled = !activeMedia;
    cropBtn.title = activeMedia ? '\u91cd\u65b0\u88c1\u5207\u5df2\u8bbe\u7f6e\u7684\u80cc\u666f\u5a92\u4f53' : '\u5148\u9009\u62e9\u5c01\u9762\u3001\u56fe\u7247\u6216\u89c6\u9891';
  }
  updateCustomBackgroundMediaPreview(activeMedia);
  applyBackgroundMediaHint();
}

function setCustomBackgroundColor(color, silent, customFlag) {
  fx.backgroundColor = normalizeHexColor(color || '#000000', '#000000');
  fx.backgroundColorMode = customFlag === false ? 'cover' : 'custom';
  fx.backgroundColorCustom = customFlag !== false;
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'backgroundColor' });
  if (!silent) showToast('背景颜色: ' + fx.backgroundColor.toUpperCase());
}

function setCustomBackgroundCoverMode(silent) {
  fx.backgroundColorMode = 'cover';
  fx.backgroundColorCustom = false;
  fx.backgroundColor = normalizeHexColor(fx.backgroundColor || fxDefaults.backgroundColor || '#000000', '#000000');
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'backgroundColorCover' });
  if (!silent) showToast('\u80cc\u666f\u989c\u8272: \u5c01\u9762\u6e10\u53d8');
}

function resetCustomBackgroundColor() {
  setCustomBackgroundCoverMode(false);
}

function setCustomBackgroundOpacity(value, silent) {
  fx.backgroundOpacity = clampRange(Number(value), 0, 1);
  fx.backgroundColorMode = 'custom';
  fx.backgroundColorCustom = true;
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'backgroundOpacity' });
  if (!silent) showToast('背景透明度: ' + Math.round(fx.backgroundOpacity * 100) + '%');
}

function setWindowBackgroundOpacity(value, silent) {
  fx.windowBackgroundOpacity = clampRange(Number(value), 0, 1);
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'windowBackgroundOpacity' });
  if (!silent) showToast('\u7a97\u53e3\u80cc\u666f\u900f\u660e: ' + Math.round(fx.windowBackgroundOpacity * 100) + '%');
}

function setBackgroundGlassOpacity(value, silent) {
  fx.backgroundGlassOpacity = clampRange(Number(value), 0, 1);
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'backgroundGlassOpacity' });
  if (!silent) showToast('\u6bdb\u73bb\u7483\u900f\u660e: ' + Math.round(fx.backgroundGlassOpacity * 100) + '%');
}

function setCustomBackgroundAlbumCover(enabled, silent) {
  fx.backgroundAlbumCover = enabled === true;
  if (fx.backgroundAlbumCover) {
    fx.backgroundMedia = null;
    fx.backgroundImage = '';
  }
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'backgroundAlbumCover' });
  if (!silent) showToast(fx.backgroundAlbumCover ? '\u80cc\u666f\u5a92\u4f53: \u5c01\u9762\u539f\u56fe' : '\u80cc\u666f\u5a92\u4f53: \u5df2\u5173\u95ed\u5c01\u9762');
}

function toggleCustomBackgroundAlbumCover() {
  setCustomBackgroundAlbumCover(!(typeof customBackgroundUsesAlbumCover === 'function' && customBackgroundUsesAlbumCover()));
}

function setCustomBackgroundCrop(key, value, silent) {
  var allowed = {
    backgroundMediaCropX: [0, 100, 50],
    backgroundMediaCropY: [0, 100, 50],
    backgroundMediaZoom: [1, 2.8, 1]
  };
  if (!allowed[key]) return;
  var meta = allowed[key];
  var next = clampRange(Number(value), meta[0], meta[1]);
  fx[key] = isFinite(next) ? next : meta[2];
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'backgroundMediaCrop' });
  if (!silent) showToast('\u80cc\u666f\u88c1\u5207\u5df2\u66f4\u65b0');
}

function resetCustomBackgroundCrop() {
  fx.backgroundMediaCropX = fxDefaults.backgroundMediaCropX == null ? 50 : fxDefaults.backgroundMediaCropX;
  fx.backgroundMediaCropY = fxDefaults.backgroundMediaCropY == null ? 50 : fxDefaults.backgroundMediaCropY;
  fx.backgroundMediaZoom = fxDefaults.backgroundMediaZoom == null ? 1 : fxDefaults.backgroundMediaZoom;
  updateCustomBackgroundControls();
  saveLyricLayout({ user: true, reason: 'backgroundMediaCrop' });
  showToast('\u80cc\u666f\u88c1\u5207\u5df2\u590d\u4f4d');
}

function customBackgroundCropSnapshot() {
  return {
    x: customBackgroundCropNumber('backgroundMediaCropX', fxDefaults.backgroundMediaCropX == null ? 50 : fxDefaults.backgroundMediaCropX, 0, 100),
    y: customBackgroundCropNumber('backgroundMediaCropY', fxDefaults.backgroundMediaCropY == null ? 50 : fxDefaults.backgroundMediaCropY, 0, 100),
    zoom: customBackgroundCropNumber('backgroundMediaZoom', fxDefaults.backgroundMediaZoom == null ? 1 : fxDefaults.backgroundMediaZoom, 1, 2.8)
  };
}

function applyCustomBackgroundCropSnapshot(snapshot) {
  if (!snapshot) return;
  fx.backgroundMediaCropX = clampRange(Number(snapshot.x), 0, 100);
  fx.backgroundMediaCropY = clampRange(Number(snapshot.y), 0, 100);
  fx.backgroundMediaZoom = clampRange(Number(snapshot.zoom), 1, 2.8);
  updateCustomBackgroundControls();
  updateCustomBackgroundCropModalView();
}
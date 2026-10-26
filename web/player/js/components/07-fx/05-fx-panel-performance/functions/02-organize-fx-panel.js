'use strict';


function organizeFxPanel() {
  if (typeof organizeFxConsoleWorkspace === 'function') {
    organizeFxConsoleWorkspace();
    return;
  }
  var panel = document.getElementById('fx-panel');
  if (!panel) return;
  if (panel._fxPanelOrganized) {
    setFxPanelTab(fxPanelTab);
    return;
  }
  var head = panel.querySelector('.fx-head');
  var tabMeta = [
    ['presets', '\u9884\u8bbe'],
    ['appearance', '\u5916\u89c2'],
    ['lyrics', '\u6b4c\u8bcd'],
    ['motion', '\u52a8\u6001'],
    ['advanced', '\u9ad8\u7ea7']
  ];
  var tabs = document.createElement('div');
  tabs.className = 'fx-panel-tabs';
  tabs.id = 'fx-panel-tabs';
  tabMeta.forEach(function (meta) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-fx-tab', meta[0]);
    btn.textContent = meta[1];
    tabs.appendChild(btn);
  });
  if (head && head.nextSibling) panel.insertBefore(tabs, head.nextSibling);
  else panel.insertBefore(tabs, panel.firstChild);
  var pages = {};
  var insertAfter = tabs;
  tabMeta.forEach(function (meta) {
    var page = document.createElement('div');
    page.className = 'fx-tab-page';
    page.setAttribute('data-fx-page', meta[0]);
    insertAfter.parentNode.insertBefore(page, insertAfter.nextSibling);
    insertAfter = page;
    pages[meta[0]] = page;
  });
  var original = Array.prototype.slice.call(panel.children).filter(function (child) {
    return child !== head && child !== tabs && !child.classList.contains('fx-tab-page');
  });
  var current = 'presets';
  original.forEach(function (node, idx) {
    var target;
    if (node.classList.contains('fx-section-label')) {
      target = fxPanelTargetForNode(original[idx + 1], current);
      current = target;
    } else {
      target = fxPanelTargetForNode(node, current);
      current = target;
    }
    (pages[target] || pages.presets).appendChild(node);
  });
  ['fx-lyric-fold', 'fx-overlay-fold', 'fx-stage-fold', 'fx-advanced'].forEach(function (id) {
    var fold = document.getElementById(id);
    if (fold) fold.classList.add('open');
  });
  tabs.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-fx-tab]') : null;
    if (!btn) return;
    setFxPanelTab(btn.getAttribute('data-fx-tab'));
  });
  panel._fxPanelOrganized = true;
  setFxPanelTab(fxPanelTab);
}


function fxControlBlock(id) {
  var el = document.getElementById(id);
  if (!el) return null;
  return el.closest('.fx-slider,.lyric-color-row,.lyric-color-grid,.fx-seg,.preset-grid,.user-archive-grid,.fx-font-grid') || el;
}

function setFxSectionBefore(id, text) {
  var block = fxControlBlock(id);
  if (!block || !block.parentNode) return;
  var prev = block.previousElementSibling;
  if (!prev || !prev.classList || !prev.classList.contains('fx-section-label')) {
    prev = document.createElement('div');
    prev.className = 'fx-section-label';
    block.parentNode.insertBefore(prev, block);
  }
  prev.textContent = text;
}

function setFxSliderLabel(id, text) {
  var block = fxControlBlock(id);
  var label = block && block.querySelector ? block.querySelector('label') : null;
  if (label) label.textContent = text;
}

function setFxSectionBeforeNode(node, text) {
  if (!node || !node.parentNode) return;
  var prev = node.previousElementSibling;
  if (!prev || !prev.classList || !prev.classList.contains('fx-section-label')) {
    prev = document.createElement('div');
    prev.className = 'fx-section-label';
    node.parentNode.insertBefore(prev, node);
  }
  prev.textContent = text;
}

function moveToggleToGrid(toggleId, grid) {
  var node = document.getElementById(toggleId);
  if (!node || !grid || node.parentNode === grid) return;
  grid.appendChild(node);
}

function ensureFxRangeControl(anchorId, id, label, min, max, step) {
  var existing = document.getElementById(id);
  if (existing) {
    existing.min = String(min);
    existing.max = String(max);
    existing.step = String(step);
    return;
  }
  var anchor = fxControlBlock(anchorId);
  if (!anchor || !anchor.parentNode) return;
  var block = document.createElement('div');
  block.className = 'fx-slider';
  var lab = document.createElement('label');
  lab.textContent = label;
  var input = document.createElement('input');
  input.id = id;
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  var output = document.createElement('output');
  block.appendChild(lab);
  block.appendChild(input);
  block.appendChild(output);
  anchor.parentNode.insertBefore(block, anchor.nextSibling);
}

function ensureLyricPrimaryControls() {
  var body = document.querySelector('#fx-lyric-fold .fx-fold-body');
  if (!body) return;
  var grid = document.getElementById('fx-lyric-primary-controls');
  if (!grid) {
    var label = document.createElement('div');
    label.className = 'fx-section-label';
    label.id = 'fx-lyric-primary-label';
    label.textContent = '歌词开关';
    grid = document.createElement('div');
    grid.className = 'fx-toggle-grid lyric-primary-toggle-grid';
    grid.id = 'fx-lyric-primary-controls';
    body.insertBefore(grid, body.firstChild);
    body.insertBefore(label, grid);
  }
  [
    't-desktopLyrics',
    't-desktopLyricsClickThrough',
    't-desktopLyricsCinema',
    't-desktopLyricsHighlight',
    't-lyricCameraLock',
    't-lyricGlow',
    't-lyricGlowBeat',
    't-lyricGlowParticles',
    't-backgroundStarRiver',
    't-lyricVerticalFloat',
    't-lyricPauseHold'
  ].forEach(function (id) { moveToggleToGrid(id, grid); });
}

function applyBackgroundMediaHint() {
  var value = document.getElementById('bg-image-value');
  if (value && !value.dataset.mediaHint) {
    value.dataset.mediaHint = '1';
    value.title = '支持封面原图、图片 / 视频上传，已设置媒体可重复裁切';
  }
  if (value) value.title = '\u652f\u6301\u5c01\u9762\u539f\u56fe\u3001\u56fe\u7247 / \u89c6\u9891\u4e0a\u4f20\uff0c\u5df2\u8bbe\u7f6e\u5a92\u4f53\u53ef\u91cd\u590d\u88c1\u5207';
  var label = value && value.closest ? value.closest('.fx-color-row-label') : null;
  if (label && !document.getElementById('bg-media-hint')) {
    var hint = document.createElement('small');
    hint.id = 'bg-media-hint';
    hint.textContent = '\u5c01\u9762\u539f\u56fe / \u56fe\u7247 / \u89c6\u9891';
    label.appendChild(hint);
  }
}

function relabelFxPanelControls() {
  setFxSliderLabel('fx-windowbgopacity', '\u7a97\u53e3\u80cc\u666f\u900f\u660e');
  setFxSliderLabel('fx-bgglassopacity', '\u6bdb\u73bb\u7483\u900f\u660e');
  setFxSliderLabel('fx-bgcropx', '\u88c1\u5207\u5de6\u53f3');
  setFxSliderLabel('fx-bgcropy', '\u88c1\u5207\u4e0a\u4e0b');
  setFxSliderLabel('fx-bgzoom', '\u88c1\u5207\u7f29\u653e');
  var title = document.querySelector('#fx-panel .fx-title');
  if (title) title.textContent = '视觉控制台';
  ensureLyricPrimaryControls();
  ensureFxRangeControl('fx-lyrictranslationgap', 'fx-lyrictranslationscale', '译文字号', 0.46, 1.12, 0.01);
  ensureFxRangeControl('fx-lyrictranslationscale', 'fx-lyrictranslationopacity', '译文透明', 0.20, 1, 0.01);
  applyBackgroundMediaHint();
  var overlayGrid = document.getElementById('t-cinema');
  overlayGrid = overlayGrid && overlayGrid.closest('.fx-toggle-grid');
  setFxSectionBeforeNode(overlayGrid, '镜头与叠加');
  setFxSectionBefore('preset-grid', '预设与存档');
  setFxSectionBefore('user-archive-grid', '用户存档');
  setFxSectionBefore('ui-accent-picker', '界面与背景');
  setFxSectionBefore('fx-intensity', '画面基础');
  setFxSectionBefore('fx-lyricglow', '歌词溢光强度');
  setFxSectionBefore('lyric-color-grid', '文字颜色');
  setFxSectionBefore('lyric-highlight-picker', '跟唱高亮');
  setFxSectionBefore('lyric-glow-row', '歌词溢光颜色');
  setFxSectionBefore('lyric-source-seg', '歌词来源');
  setFxSectionBefore('lyric-display-mode-seg', '歌词行数');
  setFxSectionBefore('lyric-motion-style-seg', '歌词动画');
  setFxSectionBefore('lyric-font-grid', '字体与字距');
  setFxSectionBefore('fx-lyricscale', '位置与角度');
  setFxSectionBefore('fx-desktoplyricssize', '桌面歌词');
  setFxSectionBefore('desktop-lyrics-fps-seg', '桌面歌词帧率');
  setFxSectionBefore('wallpaper-fps-seg', '壁纸帧率');
  setFxSectionBefore('close-behavior-seg', '关闭窗口');
  setFxSectionBefore('t-startupAutoplay', '启动播放');
  setFxSectionBefore('fx-playlistblur', '左侧歌单栏');
  setFxSectionBefore('shelf-seg', '3D 歌单架');
  setFxSectionBefore('shelf-camera-seg', '歌单架镜头');
  setFxSectionBefore('shelf-presence-seg', '歌单架显示');
  setFxSectionBefore('shelf-accent-picker', '歌单架外观');
  setFxSectionBefore('fx-shelfsize', '歌单架参数');
  setFxSectionBefore('fx-shelfdetailx', '歌单详情页位置');
  setFxSectionBefore('fx-shelfdetailopen', '歌单详情页动画');
  setFxSectionBefore('fx-shelfsummonopen', '歌单架唤出动画');
  setFxSectionBefore('cam-seg', '摄像头交互');
  setFxSectionBefore('fx-point', '粒子高级参数');
  setFxSliderLabel('fx-intensity', '律动强度');
  setFxSliderLabel('fx-depth', '画面景深');
  setFxSliderLabel('fx-coverres', '封面清晰度');
  setFxSliderLabel('fx-cineshake', '电影镜头');
  setFxSliderLabel('fx-lyricglow', '溢光强度');
  setFxSliderLabel('fx-bgopacity', '背景透明度');
  setFxSliderLabel('fx-glassaberration', '玻璃色差');
  setFxSliderLabel('fx-playlistblur', '左栏雾面');
  setFxSliderLabel('fx-playlistdensity', '左栏遮挡');
  setFxSliderLabel('fx-playlistopen', '左栏唤出秒数');
  setFxSliderLabel('fx-playlistclose', '左栏收起秒数');
  setFxSliderLabel('fx-lyricspacing', '字间距');
  setFxSliderLabel('fx-lyriclineheight', '行距');
  setFxSliderLabel('fx-lyricweight', '字重');
  setFxSliderLabel('fx-lyriccustomlines', '显示行数');
  setFxSliderLabel('fx-lyricglitchintensity', '故障强度');
  setFxSliderLabel('fx-lyricglitchslice', '切片幅度');
  setFxSliderLabel('fx-lyricglitchchroma', '色散强度');
  setFxSliderLabel('fx-lyricglitchrate', '触发速度');
  setFxSliderLabel('fx-lyricglitchjitter', '抖动幅度');
  setFxSliderLabel('fx-lyriccontextopacity', '上下句清晰');
  setFxSliderLabel('fx-lyriccontextspread', '上下句间距');
  setFxSliderLabel('fx-lyrictranslationgap', '译文间距');
  setFxSliderLabel('fx-lyrictranslationscale', '译文字号');
  setFxSliderLabel('fx-lyrictranslationopacity', '译文透明');
  setFxSliderLabel('fx-lyricedgefade', '边缘渐隐');
  setFxSliderLabel('fx-lyricmotionsoftness', '动画柔顺');
  setFxSliderLabel('fx-lyricscale', '歌词大小');
  setFxSliderLabel('fx-lyricx', '左右位置');
  setFxSliderLabel('fx-lyricy', '上下位置');
  setFxSliderLabel('fx-lyricz', '前后景深');
  setFxSliderLabel('fx-lyrictiltx', '上下旋转');
  setFxSliderLabel('fx-lyrictilty', '左右旋转');
  setFxSliderLabel('fx-desktoplyricssize', '桌面歌词大小');
  setFxSliderLabel('fx-desktoplyricsopacity', '桌面歌词透明度');
  setFxSliderLabel('fx-desktoplyricsy', '桌面歌词高度');
  setFxSliderLabel('fx-wallpaperopacity', '壁纸透明度');
  setFxSliderLabel('fx-shelfsize', '歌单架大小');
  setFxSliderLabel('fx-shelfx', '左右位置');
  setFxSliderLabel('fx-shelfy', '上下位置');
  setFxSliderLabel('fx-shelfz', '前后景深');
  setFxSliderLabel('fx-shelfangle', '侧向角度');
  setFxSliderLabel('fx-shelfopacity', '整体透明度');
  setFxSliderLabel('fx-shelfbgalpha', '背景透明度');
  setFxSliderLabel('fx-shelfdetailx', '详情左右');
  setFxSliderLabel('fx-shelfdetaily', '详情上下');
  setFxSliderLabel('fx-shelfdetailz', '详情前后');
  setFxSliderLabel('fx-shelfdetailscale', '详情大小');
  setFxSliderLabel('fx-shelfdetailanglex', '详情俯仰');
  setFxSliderLabel('fx-shelfdetailangley', '详情侧旋');
  setFxSliderLabel('fx-shelfdetailrowgap', '详情行间距');
  setFxSliderLabel('fx-shelfdetailopen', '展开秒数');
  setFxSliderLabel('fx-shelfdetailclose', '关闭秒数');
  setFxSliderLabel('fx-shelfdetailrowtime', '行入场秒数');
  setFxSliderLabel('fx-shelfdetailintro', '展开位移');
  setFxSliderLabel('fx-shelfdetailparallax', '悬浮视差');
  setFxSliderLabel('fx-shelfsummonopen', '唤出秒数');
  setFxSliderLabel('fx-shelfsummonclose', '收起秒数');
  setFxSliderLabel('fx-shelfsummonslide', '唤出位移');
  setFxSliderLabel('fx-shelfsummonstagger', '卡片错层');
  setFxSliderLabel('fx-shelfsummonscale', '唤出缩放');
  setFxSliderLabel('fx-shelfsummonparallax', '唤出视差');
  setFxSliderLabel('fx-shelfcamenter', '镜头进入速度');
  setFxSliderLabel('fx-shelfcamexit', '镜头离开速度');
  setFxSliderLabel('fx-point', '粒子尺寸');
  setFxSliderLabel('fx-speed', '运动速度');
  setFxSliderLabel('fx-twist', '粒子扭曲');
  setFxSliderLabel('fx-color', '色彩张力');
  setFxSliderLabel('fx-bloom', '光晕强度');
  setFxSliderLabel('fx-scatter', '离散感');
  setFxSliderLabel('fx-bgfade', '背景压暗');
}
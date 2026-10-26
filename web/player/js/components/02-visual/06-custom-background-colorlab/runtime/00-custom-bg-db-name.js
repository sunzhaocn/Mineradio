'use strict';


var CUSTOM_BG_DB_NAME = 'mineradio-custom-background-v1';

var CUSTOM_BG_STORE = 'media';

var customBgObjectUrl = '';

var customBgApplyToken = 0;

var colorLabState = { picker: null, id: '', h: 0, s: 1, v: 1, dragging: false };

var COLOR_LAB_PRESETS = [
  { name: '极黑', color: '#000000' },
  { name: '极白', color: '#ffffff' },
  { name: '克莱因蓝', color: '#002fa7' },
  { name: '法拉利红', color: '#f00000' },
  { name: '香槟金', color: '#c8a96a' },
  { name: '孔雀绿', color: '#006b5b' },
  { name: '午夜紫', color: '#2b164f' },
  { name: '银雾', color: '#d9dde2' }
];

window.addEventListener('resize', function () {
  if (window.requestAnimationFrame) requestAnimationFrame(repositionFxFloatingPanels);
  else repositionFxFloatingPanels();
});

'use strict';

// ============================================================
var AUDIO_UPLOAD_EXT_RE = /\.(mp3|flac|wav|ogg|m4a|aac|opus)$/i;

var IMAGE_UPLOAD_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;

var uploadFilePickerActiveUntil = 0;

var uploadFilePickerFocusArmed = false;

var uploadFilePickerFocusTimer = null;

var fileInput = document.getElementById('file-input');

if (fileInput) fileInput.addEventListener('change', function (e) { handleFiles(e.target.files, { mode: 'audio' }); e.target.value = ''; });

var coverInput = document.getElementById('cover-input');

if (coverInput) coverInput.addEventListener('change', function (e) { handleCoverFiles(e.target.files); e.target.value = ''; });

var folderInput = document.getElementById('folder-input');

if (folderInput) folderInput.addEventListener('change', function (e) { handleFiles(e.target.files, { mode: 'folder' }); e.target.value = ''; });

var lyricFontInput = document.getElementById('lyric-font-input');

if (lyricFontInput) lyricFontInput.addEventListener('change', function (e) { handleLyricFontFiles(e.target.files); e.target.value = ''; });

document.addEventListener('click', function (e) {
  var panel = document.getElementById('upload-panel');
  if (!panel || !panel.classList.contains('show')) return;
  if (e.target && e.target.closest && e.target.closest('#upload-actions')) return;
  closeUploadPanel();
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeUploadPanel();
});

var dropOv = document.getElementById('drop-overlay'), dragCount = 0;

document.addEventListener('dragenter', function (e) { e.preventDefault(); dragCount++; dropOv.classList.add('show'); });

document.addEventListener('dragleave', function (e) { e.preventDefault(); dragCount--; if (dragCount <= 0) { dragCount = 0; dropOv.classList.remove('show'); } });

document.addEventListener('dragover', function (e) { e.preventDefault(); });

document.addEventListener('drop', function (e) {
  e.preventDefault(); dragCount = 0; dropOv.classList.remove('show');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// ============================================================
//  控制台 — 预设卡片 + 主滑块 + 开关 + 三态

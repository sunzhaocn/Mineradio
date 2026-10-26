'use strict';



function closeVolumePanel(force) {
  var wrap = document.getElementById('volume-control');
  if (volumeCloseTimer) {
    clearTimeout(volumeCloseTimer);
    volumeCloseTimer = null;
  }
  if (!wrap) return;
  wrap.classList.remove('open');
  releaseVolumePanelFocus(wrap);
  if (force) {
    wrap.classList.add('handoff-closing');
    setTimeout(function () {
      if (wrap && !wrap.classList.contains('sibling-suppressed')) wrap.classList.remove('handoff-closing');
    }, 220);
  } else {
    wrap.classList.remove('handoff-closing');
  }
}


function setVolumePanelSiblingSuppressed(suppressed) {
  var wrap = document.getElementById('volume-control');
  if (!wrap) return;
  if (suppressed) {
    wrap.classList.add('sibling-suppressed');
    closeVolumePanel(true);
  } else {
    wrap.classList.remove('sibling-suppressed', 'handoff-closing');
  }
}


function toggleMute() {
  setVolume(targetVolume > 0.01 ? 0 : (lastNonZeroVolume || 0.8));
}


function bindVolumeControls() {
  var slider = document.getElementById('volume-slider');
  var fadeInSlider = document.getElementById('fade-in-slider');
  var fadeOutSlider = document.getElementById('fade-out-slider');
  var btn = document.getElementById('volume-btn');
  var wrap = document.getElementById('volume-control');
  function keepVolumePanelOpen() {
    if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null; }
    if (wrap && !wrap.classList.contains('sibling-suppressed')) wrap.classList.add('open');
  }
  function closeVolumePanelSoon() {
    if (volumeCloseTimer) clearTimeout(volumeCloseTimer);
    volumeCloseTimer = setTimeout(function () {
      volumeCloseTimer = null;
      if (wrap) closeVolumePanel(false);
    }, 520);
  }
  if (wrap) {
    wrap.addEventListener('mouseenter', keepVolumePanelOpen);
    wrap.addEventListener('mouseleave', closeVolumePanelSoon);
  }
  if (slider) {
    slider.addEventListener('input', function () { setVolume(slider.value, true); });
    slider.addEventListener('focus', keepVolumePanelOpen);
    slider.addEventListener('blur', closeVolumePanelSoon);
    slider.addEventListener('change', function () { showToast('音量 ' + Math.round(targetVolume * 100) + '%'); });
  }
  if (fadeInSlider) {
    fadeInSlider.addEventListener('input', function () { setAudioFadeSetting('in', fadeInSlider.value, true); });
    fadeInSlider.addEventListener('focus', keepVolumePanelOpen);
    fadeInSlider.addEventListener('blur', closeVolumePanelSoon);
    fadeInSlider.addEventListener('change', function () { setAudioFadeSetting('in', fadeInSlider.value, false); });
  }
  if (fadeOutSlider) {
    fadeOutSlider.addEventListener('input', function () { setAudioFadeSetting('out', fadeOutSlider.value, true); });
    fadeOutSlider.addEventListener('focus', keepVolumePanelOpen);
    fadeOutSlider.addEventListener('blur', closeVolumePanelSoon);
    fadeOutSlider.addEventListener('change', function () { setAudioFadeSetting('out', fadeOutSlider.value, false); });
  }
  if (btn) {
    btn.addEventListener('dblclick', function (e) { e.stopPropagation(); toggleMute(); });
  }
  if (wrap && !wrap._wheelBound) {
    wrap._wheelBound = true;
    wrap.addEventListener('wheel', adjustVolumeByWheel, { passive: false });
  }
  document.addEventListener('click', function (e) {
    if (!wrap) return;
    if (!wrap.contains(e.target)) {
      closeVolumePanel(false);
    }
  });
  updateVolumeUi();
  updateAudioFadeUi();
  applyVolumeToAudio();
}
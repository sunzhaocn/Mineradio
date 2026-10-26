'use strict';



function updatePlayModeButton(animate) {
  var label = playModeLabel(playMode);
  var nextMode = { loop: 'shuffle', shuffle: 'single', single: 'loop' }[playMode] || 'loop';
  var nextLabel = playModeLabel(nextMode);
  var chip = document.getElementById('play-mode-chip');
  var btn = document.getElementById('play-mode-btn');
  var icon = document.getElementById('play-mode-icon');
  if (chip) chip.textContent = label;
  if (btn) {
    btn.dataset.mode = playMode;
    btn.title = label + ' · 点击切换' + nextLabel;
    btn.setAttribute('aria-label', '播放模式：' + label + '，点击切换' + nextLabel);
    btn.classList.toggle('active', playMode !== 'loop');
  }
  if (icon) icon.innerHTML = playModeIconMarkup(playMode);
  if (!animate || !btn) return;
  if (window.gsap) {
    window.gsap.killTweensOf(btn);
    if (icon) window.gsap.killTweensOf(icon);
    window.gsap.timeline({ defaults: { overwrite: true } })
      .fromTo(btn, { scale: 0.86, rotate: -8 }, { scale: 1.12, rotate: 4, duration: 0.16, ease: 'power2.out' })
      .to(btn, { scale: 1, rotate: 0, duration: 0.34, ease: 'back.out(2.1)' });
    window.gsap.fromTo(btn,
      { boxShadow: '0 0 0 0 rgba(255,63,85,.36)' },
      { boxShadow: '0 0 0 14px rgba(255,63,85,0)', duration: 0.58, ease: 'sine.out', overwrite: false, onComplete: function () { window.gsap.set(btn, { clearProps: 'boxShadow' }); } }
    );
    if (icon) window.gsap.fromTo(icon, { y: 4, autoAlpha: 0.32, rotate: -22, scale: 0.74 }, { y: 0, autoAlpha: 1, rotate: 0, scale: 1, duration: 0.42, ease: 'expo.out', overwrite: true });
  } else {
    btn.classList.remove('mode-switching');
    void btn.offsetWidth;
    btn.classList.add('mode-switching');
    setTimeout(function () { btn.classList.remove('mode-switching'); }, 460);
  }
}


function cyclePlayMode() {
  var modes = ['loop', 'shuffle', 'single'];
  var idx = modes.indexOf(playMode);
  var prevMode = playMode;
  playMode = modes[(idx + 1) % modes.length];
  if (playMode === 'shuffle' && prevMode !== 'shuffle') {
    reorderQueueForShufflePlaybackOrder(currentIdx, { reason: 'play-mode-shuffle' });
  }
  if (typeof syncActiveAudioRepeatMode === 'function') syncActiveAudioRepeatMode(audio);
  if (playMode === 'single' && prevMode !== 'single') {
    if (typeof clearAlbumGaplessPreload === 'function') clearAlbumGaplessPreload('play-mode-single');
    if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('play-mode-single');
  }
  updatePlayModeButton(true);
  showToast('播放模式: ' + playModeLabel(playMode));
}

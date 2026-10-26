'use strict';



function pulseUpdateReady() {
  var entry = document.getElementById('update-entry');
  var btn = document.getElementById('update-primary-btn');
  if (!window.gsap) return;
  if (entry) {
    window.gsap.fromTo(entry,
      { scale: 0.96, filter: 'brightness(1)' },
      { scale: 1.05, filter: 'brightness(1.28)', duration: 0.26, yoyo: true, repeat: 1, ease: 'power2.out', overwrite: true }
    );
  }
  if (btn) {
    window.gsap.fromTo(btn,
      { scale: 0.985 },
      { scale: 1.015, duration: 0.22, yoyo: true, repeat: 1, ease: 'sine.inOut', overwrite: true }
    );
  }
}

try {
  if (new URLSearchParams(location.search).get('app') === 'ipad' && localStorage.getItem('mineradio-ipad-autohide-v2') !== '1') {
    localStorage.setItem('mineradio-controls-auto-hide-v1','1');
    localStorage.setItem('mineradio-ipad-autohide-v2','1');
  }
  if (localStorage.getItem('mineradio-startup-fast-skip-v1') === '1') {
    document.documentElement.classList.add('startup-fast-skip-preload');
  }
  document.documentElement.classList.add(localStorage.getItem('mineradio-diy-player-mode-v1') === '1' ? 'diy-mode-preload' : 'simple-mode-preload');
} catch (e) {
  document.documentElement.classList.add('simple-mode-preload');
}

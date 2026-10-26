'use strict';

// Select the phone's plain player before any scene or splash can acquire a GPU
// context. A page opened on a phone keeps this profile across orientation changes.
(function () {
  var desktop = !!(window.desktopWindow && window.desktopWindow.isDesktop);
  window.mineradioDetectTablet = function () {
    if (desktop || window.mineradioAndroidProfile === 'phone') return false;
    if (window.mineradioAndroidProfile === 'tablet') return true;
    var ua = navigator.userAgent, large = Math.min(screen.width,screen.height) >= 600;
    var apple = /iPad/.test(ua) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    var android = /Android/.test(ua) && !/Mobile/.test(ua);
    var ipadApp = new URLSearchParams(location.search).get('app') === 'ipad' && !/iPhone|iPod/.test(ua);
    return large && (apple || android || ipadApp);
  };
  window.mineradioTabletApp = window.mineradioDetectTablet();
  var mobile = window.matchMedia('(max-width: 900px)');
  // The iOS window controller keeps tablet visual resources available across
  // split-view changes. Every other client retains its original sticky profile.
  var iosLayout = window.mineradioIOSLayoutController;
  var atStartup = !desktop && !window.mineradioTabletApp && (iosLayout ? !iosLayout.bootstrapVisuals : mobile.matches);
  function active() { return !desktop && !window.mineradioTabletApp && (iosLayout ? iosLayout.simpleActive() : (atStartup || mobile.matches)); }
  function sync() {
    document.documentElement.classList.toggle('mobile-simple-player', active());
    window.dispatchEvent(new Event('mineradio:visual-profile-changed'));
  }
  function createRenderer() {
    // The shared scene declarations retain a small DOM surface for event and
    // layout compatibility. This adapter never creates a rendering context.
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    canvas.setAttribute('aria-hidden', 'true');
    return {
      isSimplePlayerRenderer: true,
      domElement: canvas,
      capabilities: { maxTextureSize: 2048, getMaxAnisotropy: function () { return 1; } },
      info: { render: { calls: 0, triangles: 0, points: 0, lines: 0 }, memory: { geometries: 0, textures: 0 }, programs: [] },
      renderLists: { dispose: function () {} },
      setClearColor: function () {}, setPixelRatio: function () {},
      setSize: function () {}, getPixelRatio: function () { return 1; },
      initTexture: function () {}, compile: function () {}, render: function () {}, dispose: function () {}
    };
  }
  window.mineradioSimplePlayer = Object.freeze({ active: active, atStartup: atStartup, createRenderer: createRenderer });
  mobile.addEventListener('change', sync);
  if (iosLayout) window.addEventListener('mineradio:ios-layout-changed', sync);
  sync();
})();

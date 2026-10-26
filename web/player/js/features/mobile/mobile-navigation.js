'use strict';

(function () {
  var body = document.body;
  var mobile = window.matchMedia('(max-width: 900px)');
  var pages = { home: '首页', search: '搜索', library: '音乐库', 'library-detail': '歌单', player: '正在播放' };
  var ready = false;
  var page = 'home';
  var nav = document.getElementById('web-mobile-nav');
  var mask = document.getElementById('web-library-mask');
  var bar = document.getElementById('bottom-bar');
  var search = document.getElementById('search-area');
  var title = document.getElementById('web-mobile-page-title');
  var back = document.getElementById('web-mobile-back');
  function isDesktop() { return !!(window.desktopWindow && window.desktopWindow.isDesktop); }
  function active() { return ready && !window.mineradioTabletApp && mobile.matches && !isDesktop() && body.classList.contains('web-adapter'); }
  function fromHash() {
    // Old mobile Settings links opened the visual console, which has no role
    // in the simple mobile player. Keep those bookmarks on a usable page.
    if (location.hash === '#mobile/settings') {
      window.history.replaceState(null, '', '#mobile/home');
      return 'home';
    }
    var match = location.hash.match(/^#mobile\/(home|search|library|library-detail|player)$/);
    return match ? match[1] : 'home';
  }
  function go(next, options) {
    if (next === 'settings') next = 'home';
    if (!active() || !pages[next]) return;
    options = options || {};
    if (options.history && page === next && body.dataset.mobilePage === next) return;
    if (document.activeElement && !search.contains(document.activeElement)) document.activeElement.blur();
    if (page !== next && page === 'search') document.getElementById('search-input').blur();
    page = next;
    body.dataset.mobilePage = page;
    if (typeof syncPlaybackLoadingLyricPosition === 'function') syncPlaybackLoadingLyricPosition();
    title.textContent = pages[page];
    back.hidden = page !== 'library-detail';
    var track = bar.querySelector('.control-track');
    var cover = document.getElementById('control-cover');
    if (page === 'player') {
      track.removeAttribute('role'); track.removeAttribute('tabindex'); track.removeAttribute('aria-label');
      cover.setAttribute('aria-label', '显示歌词');
    } else {
      track.setAttribute('role', 'button'); track.setAttribute('tabindex', '0'); track.setAttribute('aria-label', '打开播放页');
      cover.setAttribute('aria-label', '打开播放页');
    }
    nav.querySelectorAll('button').forEach(function (button) {
      var current = button.dataset.mobileDestination === (page === 'library-detail' ? 'library' : page);
      if (current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (!options.history) {
      var hash = '#mobile/' + page;
      if (location.hash !== hash) window.history[options.replace ? 'replaceState' : 'pushState'](null, '', hash);
    }
    if (window.webAnchoredMenus) window.webAnchoredMenus.closeAll();
    if (typeof closeControlSourceSwitcher === 'function') closeControlSourceSwitcher();
    if (typeof closeMiniQueue === 'function') closeMiniQueue();
    if (typeof closeVolumePanel === 'function') closeVolumePanel();
    var volume = document.getElementById('volume-control');
    if (volume) volume.classList.remove('open');
    if (page !== 'library-detail') {
      setPlaylistPanelPinned(false, true);
      closePlaylistPanelSoft('mobile-navigation');
      togglePlaylistPanel(false);
    }
    if (mask && page !== 'library') mask.hidden = true;
    if (mask) {
      var library = mask.querySelector('.web-library');
      library.setAttribute('role', 'region');
      library.removeAttribute('aria-modal');
    }
    if (page === 'library' && typeof window.openWebMusicLibrary === 'function') window.openWebMusicLibrary();
    if (page === 'search') {
      search.classList.add('peek');
      if (!document.getElementById('search-input').value && typeof renderSearchHistory === 'function') renderSearchHistory();
    }
    if (page === 'home') {
      homeForcedOpen = true;
      homeSuppressed = false;
      updateEmptyHomeVisibility();
    }
    setHomeControlsLocked(false);
    if (bar && (page === 'player' || hasActivePlaybackControls())) {
      bar.classList.add('visible');
      setControlsHidden(false);
    }
    body.classList.toggle('web-mobile-no-track', !hasActivePlaybackControls());
    window.dispatchEvent(new Event('resize'));
  }
  window.webMobileNavigation = { active: active, go: go, current: function () { return page; } };
  var stateFrame = 0;
  function syncContentState() {
    stateFrame = 0;
    if (!active()) return;
    body.classList.toggle('web-mobile-no-track', !hasActivePlaybackControls());
    var results = document.getElementById('search-results');
    body.classList.toggle('web-mobile-search-has-content', !!(results && results.textContent.trim()));
  }
  function scheduleContentState() { if (!stateFrame) stateFrame = requestAnimationFrame(syncContentState); }
  new MutationObserver(scheduleContentState).observe(document.getElementById('control-title'), { childList: true, subtree: true });
  new MutationObserver(scheduleContentState).observe(document.getElementById('search-results'), { childList: true, subtree: true });
  new MutationObserver(scheduleContentState).observe(body, { attributes: true, attributeFilter: ['class'] });
  nav.addEventListener('click', function (event) {
    var button = event.target.closest('[data-mobile-destination]');
    if (button) go(button.dataset.mobileDestination);
  });
  back.addEventListener('click', function () { go('library'); });
  if (bar) bar.addEventListener('click', function (event) {
    if (active() && page !== 'player' && event.target.closest('.control-track')) {
      event.preventDefault(); event.stopImmediatePropagation(); go('player');
    }
  }, true);
  if (bar) bar.addEventListener('keydown', function (event) {
    if (active() && page !== 'player' && (event.key === 'Enter' || event.key === ' ')
      && event.target.closest('.control-track')) {
      event.preventDefault(); event.stopImmediatePropagation(); go('player');
    }
  }, true);
  function syncViewport() {
    if (!ready) return;
    var compact = active();
    body.classList.toggle('web-mobile-active', compact);
    if (compact) go(fromHash(), { history: true });
    else {
      delete body.dataset.mobilePage;
      var track = bar.querySelector('.control-track');
      track.removeAttribute('role'); track.removeAttribute('tabindex'); track.removeAttribute('aria-label');
      document.getElementById('control-cover').setAttribute('aria-label', '专辑详情');
      if (mask) {
        mask.hidden = true;
        var library = mask.querySelector('.web-library');
        library.setAttribute('role', 'dialog'); library.setAttribute('aria-modal', 'true');
      }
    }
  }
  mobile.addEventListener('change', syncViewport);
  window.addEventListener('popstate', function () { if (active()) go(fromHash(), { history: true }); });
  window.addEventListener('hashchange', function () { if (active()) go(fromHash(), { history: true }); });
  function initialize() {
    if (ready || !body.classList.contains('web-adapter')) return;
    ready = true;
    var originalHome = goHome;
    goHome = function () { if (active()) go('home'); else return originalHome.apply(this, arguments); };
    var originalSearch = runHomeSearch;
    runHomeSearch = function () { if (active()) go('search'); return originalSearch.apply(this, arguments); };
    if (typeof openHomePlayerConsole === 'function') {
      var originalConsole = openHomePlayerConsole;
      openHomePlayerConsole = function () { if (active()) go('player'); else return originalConsole.apply(this, arguments); };
    }
    var actions = document.querySelector('.web-library-actions');
    if (actions) {
      var upload = document.createElement('button');
      upload.type = 'button'; upload.id = 'web-mobile-upload'; upload.textContent = '导入音乐';
      upload.addEventListener('click', function () { triggerUploadInput('audio'); });
      actions.appendChild(upload);
    }
    syncViewport();
    scheduleContentState();
  }
  window.addEventListener('mineradio:ready', initialize);
  if (window.MINERADIO_MODULE_STATUS && window.MINERADIO_MODULE_STATUS.ready) initialize();
})();

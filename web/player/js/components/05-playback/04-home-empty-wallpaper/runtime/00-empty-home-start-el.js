'use strict';

var emptyHomeStartEl = document.getElementById('empty-home');

if (emptyHomeStartEl) {
  emptyHomeStartEl.addEventListener('click', function (e) {
    var start = e.target && e.target.closest ? e.target.closest('[data-home-radio-start]') : null;
    if (!start || !emptyHomeStartEl.contains(start)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof openHomeDashboardRadio === 'function') openHomeDashboardRadio();
  }, true);
}

var homeWallpaperPrewarmStarted = false;

document.addEventListener('click', function (e) {
  if (!isHomeBlankDismissClick(e)) return;
  e.preventDefault();
  e.stopPropagation();
  dismissHomePage({ reason: 'blank-click' });
}, true);

'use strict';

var LOGIN_EASTER_EGG_BROWSER_PREVIEW_KEY = 'mineradio-login-easter-egg-browser-preview-v1';

var loginEasterEggStatusPromise = null;

var loginEasterEggState = {
  ready: false,
  unlocked: false,
  clickCount: 0,
  revealed: false,
  attempts: 0,
  prefixLocked: false,
  composing: false,
  validating: false,
  cinematicActive: false,
  cinematicReady: false,
  achievementTimer: null,
  focusRetryTimers: [],
  focusRequestId: 0
};


if (typeof document !== 'undefined') {
  onMineradioDomReady(function () { ensureLoginEasterEggStatus(false); });
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeLoginEasterEggCharacters: normalizeLoginEasterEggCharacters };
}

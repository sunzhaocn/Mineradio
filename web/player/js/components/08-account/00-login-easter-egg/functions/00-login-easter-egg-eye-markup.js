'use strict';



function loginEasterEggEyeMarkup(compact) {
  return '<span class="login-easter-eyes' + (compact ? ' compact' : '') + '" aria-hidden="true">' +
    '<i class="login-easter-eye login-easter-eye-big"></i>' +
    '<i class="login-easter-eye login-easter-eye-small"></i>' +
    '</span>';
}


function loginEasterEggBrowserPreviewUnlocked() {
  try { return localStorage.getItem(LOGIN_EASTER_EGG_BROWSER_PREVIEW_KEY) === '1'; } catch (_) { return false; }
}


async function ensureLoginEasterEggStatus(force) {
  if (!force && loginEasterEggState.ready) return loginEasterEggState.unlocked;
  if (!force && loginEasterEggStatusPromise) return loginEasterEggStatusPromise;
  loginEasterEggStatusPromise = (async function () {
    var api = window.desktopWindow;
    var status = null;
    if (api && typeof api.getLoginEasterEggStatus === 'function') {
      try { status = await api.getLoginEasterEggStatus(); } catch (_) { status = null; }
    } else {
      status = { ok: true, unlocked: loginEasterEggBrowserPreviewUnlocked(), browserPreview: true };
    }
    loginEasterEggState.ready = true;
    loginEasterEggState.unlocked = !!(status && status.ok && status.unlocked);
    return loginEasterEggState.unlocked;
  })().finally(function () { loginEasterEggStatusPromise = null; });
  return loginEasterEggStatusPromise;
}


function loginEasterEggAllowsStartupGuide() {
  return loginEasterEggState.ready && loginEasterEggState.unlocked;
}


function setLoginEasterEggMode(locked) {
  var modal = document.getElementById('login-modal');
  if (!modal) return;
  modal.classList.toggle('login-easter-egg-locked', !!locked);
  var gate = document.getElementById('login-easter-egg-gate');
  if (gate) gate.setAttribute('aria-hidden', locked ? 'false' : 'true');
}


function bindLoginEasterEggGate() {
  var input = document.getElementById('login-easter-egg-input');
  var shell = input && input.closest ? input.closest('.login-easter-input-shell') : null;
  if (!input || input.__loginEasterEggBound) return;
  input.__loginEasterEggBound = true;
  input.addEventListener('compositionstart', function () {
    clearLoginEasterEggFocusRetries();
    loginEasterEggState.composing = true;
  });
  input.addEventListener('compositionend', function (event) {
    loginEasterEggState.composing = false;
    handleLoginEasterEggInput(event);
  });
  input.addEventListener('beforeinput', function (event) {
    clearLoginEasterEggFocusRetries();
    if (!loginEasterEggState.prefixLocked || !/^delete/.test(String(event.inputType || ''))) return;
    if ((input.selectionStart || 0) <= 2 && (input.selectionEnd || 0) <= 2) event.preventDefault();
  });
  input.addEventListener('input', handleLoginEasterEggInput);
  input.addEventListener('keydown', function (event) {
    clearLoginEasterEggFocusRetries();
    if (event.isComposing || loginEasterEggState.composing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      validateLoginEasterEggValue();
    }
  });
  if (shell) {
    shell.addEventListener('pointerdown', function () {
      clearLoginEasterEggFocusRetries();
      window.requestAnimationFrame(function () { focusLoginEasterEggInput('wish-pointerdown-frame'); });
    });
    shell.addEventListener('click', function () { focusLoginEasterEggInput('wish-click'); });
  }
  var cinematic = document.getElementById('login-easter-unlock-cinematic');
  if (cinematic && !cinematic.__loginEasterEggBound) {
    cinematic.__loginEasterEggBound = true;
    cinematic.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      dismissLoginEasterEggCinematic();
    });
  }
}


async function prepareLoginEasterEggGate() {
  bindLoginEasterEggGate();
  var unlocked = await ensureLoginEasterEggStatus(false);
  setLoginEasterEggMode(!unlocked);
  if (!unlocked) {
    restoreLoginEasterEggInputSurface(false);
    window.setTimeout(function () {
      if (loginEasterEggState.revealed || loginEasterEggState.cinematicActive) return;
      var trigger = document.getElementById('login-easter-eye-trigger');
      if (trigger) trigger.focus({ preventScroll: true });
    }, 220);
  }
  return unlocked;
}


function replayLoginEasterEggClass(node, className) {
  if (!node) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}


function handleLoginEasterEggTap() {
  if (loginEasterEggState.revealed) {
    focusLoginEasterEggInput();
    return;
  }
  loginEasterEggState.clickCount = Math.min(5, loginEasterEggState.clickCount + 1);
  var trigger = document.getElementById('login-easter-eye-trigger');
  var hint = document.getElementById('login-easter-hint');
  if (trigger) {
    trigger.style.setProperty('--egg-tap-strength', String(loginEasterEggState.clickCount));
    replayLoginEasterEggClass(trigger, 'tap-feedback');
  }
  var hints = [
    '',
    '它好像看了你一眼',
    '再点几下',
    '它开始有点紧张了',
    '还差一下',
    ''
  ];
  if (hint) hint.textContent = hints[loginEasterEggState.clickCount] || '';
  if (loginEasterEggState.clickCount >= 5) revealLoginEasterEggWish();
}


function revealLoginEasterEggWish() {
  loginEasterEggState.revealed = true;
  restoreLoginEasterEggInputSurface(false);
  var gate = document.getElementById('login-easter-egg-gate');
  if (gate) gate.classList.add('is-revealed');
  scheduleLoginEasterEggInputFocus();
}


function clearLoginEasterEggFocusRetries() {
  var timers = loginEasterEggState.focusRetryTimers || [];
  timers.forEach(function (timer) { window.clearTimeout(timer); });
  loginEasterEggState.focusRetryTimers = [];
  loginEasterEggState.focusRequestId = (Number(loginEasterEggState.focusRequestId) || 0) + 1;
}


function requestLoginEasterEggKeyboardFocus(reason) {
  var api = window.desktopWindow;
  if (!api || typeof api.requestDesktopKeyboardFocus !== 'function') return Promise.resolve({ ok: true, browserPreview: true });
  try {
    return Promise.resolve(api.requestDesktopKeyboardFocus(
      'login-easter-egg-' + String(reason || 'input').slice(0, 48)
    )).catch(function () {
      return { ok: false, error: 'KEYBOARD_FOCUS_REQUEST_FAILED' };
    });
  } catch (_) {
    return Promise.resolve({ ok: false, error: 'KEYBOARD_FOCUS_REQUEST_FAILED' });
  }
}


function scheduleLoginEasterEggInputFocus() {
  clearLoginEasterEggFocusRetries();
  [0, 180, 920, 1480].forEach(function (delay) {
    loginEasterEggState.focusRetryTimers.push(window.setTimeout(function () {
      focusLoginEasterEggInput('reveal-' + delay);
    }, delay));
  });
}


function restoreLoginEasterEggInputSurface(clearValue) {
  var input = document.getElementById('login-easter-egg-input');
  if (!input) return null;
  input.disabled = false;
  input.readOnly = false;
  input.tabIndex = 0;
  input.removeAttribute('disabled');
  input.removeAttribute('readonly');
  input.removeAttribute('inert');
  input.removeAttribute('aria-disabled');
  input.style.removeProperty('pointer-events');
  var shell = input.closest ? input.closest('.login-easter-input-shell') : null;
  var wish = document.getElementById('login-easter-egg-wish');
  [shell, wish].forEach(function (node) {
    if (!node) return;
    node.removeAttribute('inert');
    node.removeAttribute('aria-disabled');
  });
  if (clearValue) input.value = '';
  return input;
}


function focusLoginEasterEggInput(reason) {
  var input = restoreLoginEasterEggInputSurface(false);
  if (!input || !loginEasterEggState.revealed || loginEasterEggState.composing) return;
  clearLoginEasterEggFocusRetries();
  if (document.activeElement === input && document.hasFocus()) {
    return;
  }
  if (document.hasFocus()) {
    input.focus({ preventScroll: true });
    try {
      var end = input.value.length;
      input.setSelectionRange(end, end);
    } catch (_) { }
    return;
  }
  var requestId = (Number(loginEasterEggState.focusRequestId) || 0) + 1;
  loginEasterEggState.focusRequestId = requestId;
  function applyInputFocus() {
    if (requestId !== loginEasterEggState.focusRequestId ||
        !loginEasterEggState.revealed ||
        loginEasterEggState.cinematicActive ||
        loginEasterEggState.composing) return;
    input.focus({ preventScroll: true });
    try {
      var end = input.value.length;
      input.setSelectionRange(end, end);
    } catch (_) { }
  }
  requestLoginEasterEggKeyboardFocus(reason || 'focus').then(function () {
    applyInputFocus();
    window.requestAnimationFrame(applyInputFocus);
  });
}


function normalizeLoginEasterEggCharacters(value) {
  return Array.from(String(value || '').replace(/\s+/g, '')).slice(0, 4);
}


function loginEasterEggVisibleValue(inputType) {
  var input = document.getElementById('login-easter-egg-input');
  var chars = normalizeLoginEasterEggCharacters(input ? input.value : '');
  if (!loginEasterEggState.prefixLocked) return chars.join('');
  var suffix;
  if (chars[0] === '世' && chars[1] === '界') suffix = chars.slice(2, 4);
  else if (/^delete/.test(String(inputType || '')) && chars.length < 2) suffix = [];
  else suffix = chars.slice(-2);
  return '世界' + suffix.join('');
}


function renderLoginEasterEggCells(value) {
  var chars = Array.from(String(value || ''));
  var cells = document.querySelectorAll('#login-easter-egg-cells .login-easter-cell');
  for (var i = 0; i < cells.length; i++) {
    cells[i].textContent = chars[i] || '';
    cells[i].classList.toggle('filled', !!chars[i]);
    cells[i].classList.toggle('fixed', loginEasterEggState.prefixLocked && i < 2);
  }
}


function handleLoginEasterEggInput(event) {
  if (loginEasterEggState.composing || loginEasterEggState.validating) return;
  var input = document.getElementById('login-easter-egg-input');
  if (!input) return;
  var value = loginEasterEggVisibleValue(event && event.inputType);
  input.value = value;
  renderLoginEasterEggCells(value);
  if (Array.from(value).length === 4) validateLoginEasterEggValue();
}


function setLoginEasterEggStatus(message, mode) {
  var status = document.getElementById('login-easter-status');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.mode = mode || '';
}


function resetLoginEasterEggInputAfterError() {
  var input = document.getElementById('login-easter-egg-input');
  if (!input) return;
  input.value = loginEasterEggState.prefixLocked ? '世界' : '';
  renderLoginEasterEggCells(input.value);
  loginEasterEggState.validating = false;
  focusLoginEasterEggInput();
}


async function requestLoginEasterEggUnlock(value) {
  var api = window.desktopWindow;
  if (api && typeof api.unlockLoginEasterEgg === 'function') {
    return api.unlockLoginEasterEgg(value);
  }
  var previewPassword = ['世', '界', '和', '平'].join('');
  if (value !== previewPassword) return { ok: false, unlocked: false, error: 'LOGIN_EASTER_EGG_INVALID' };
  try { localStorage.setItem(LOGIN_EASTER_EGG_BROWSER_PREVIEW_KEY, '1'); } catch (_) { }
  return { ok: true, unlocked: true, browserPreview: true };
}


async function requestLoginEasterEggReplayReset() {
  var api = window.desktopWindow;
  if (api && typeof api.resetLoginEasterEgg === 'function') {
    return api.resetLoginEasterEgg();
  }
  try { localStorage.removeItem(LOGIN_EASTER_EGG_BROWSER_PREVIEW_KEY); } catch (_) { }
  return { ok: true, unlocked: false, resetComplete: true, replayReset: true, browserPreview: true };
}


function resetLoginEasterEggUiForReplay() {
  clearLoginEasterEggFocusRetries();
  if (loginEasterEggState.achievementTimer) window.clearTimeout(loginEasterEggState.achievementTimer);
  loginEasterEggStatusPromise = null;
  loginEasterEggState.ready = true;
  loginEasterEggState.unlocked = false;
  loginEasterEggState.clickCount = 0;
  loginEasterEggState.revealed = false;
  loginEasterEggState.attempts = 0;
  loginEasterEggState.prefixLocked = false;
  loginEasterEggState.composing = false;
  loginEasterEggState.validating = false;
  loginEasterEggState.cinematicActive = false;
  loginEasterEggState.cinematicReady = false;
  loginEasterEggState.achievementTimer = null;
  loginEasterEggState.focusRetryTimers = [];
  loginEasterEggState.focusRequestId = (Number(loginEasterEggState.focusRequestId) || 0) + 1;
  try { localStorage.removeItem(LOGIN_EASTER_EGG_BROWSER_PREVIEW_KEY); } catch (_) { }
  var active = document.activeElement;
  if (active && typeof active.blur === 'function') {
    try { active.blur(); } catch (_) { }
  }
  var input = restoreLoginEasterEggInputSurface(true);
  renderLoginEasterEggCells('');
  setLoginEasterEggStatus('', '');
  var gate = document.getElementById('login-easter-egg-gate');
  if (gate) gate.classList.remove('is-revealed');
  var trigger = document.getElementById('login-easter-eye-trigger');
  if (trigger) {
    trigger.classList.remove('tap-feedback');
    trigger.style.removeProperty('--egg-tap-strength');
  }
  var hint = document.getElementById('login-easter-hint');
  if (hint) hint.textContent = '';
  var modal = document.getElementById('login-modal');
  if (modal) modal.classList.remove('login-easter-egg-unlocking');
  var cinematic = document.getElementById('login-easter-unlock-cinematic');
  if (cinematic) {
    cinematic.classList.remove('is-mounted', 'is-positioned', 'is-extracting', 'is-ready', 'is-dismissing');
    cinematic.setAttribute('aria-hidden', 'true');
    cinematic.setAttribute('tabindex', '-1');
  }
  var toast = document.getElementById('login-easter-achievement');
  if (toast) toast.classList.remove('show');
  setLoginEasterEggMode(true);
  bindLoginEasterEggGate();
}
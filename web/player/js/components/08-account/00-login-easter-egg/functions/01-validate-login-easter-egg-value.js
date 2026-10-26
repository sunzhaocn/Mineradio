'use strict';



async function validateLoginEasterEggValue() {
  if (loginEasterEggState.validating || loginEasterEggState.composing) return;
  var input = document.getElementById('login-easter-egg-input');
  if (!input) return;
  var value = loginEasterEggVisibleValue('');
  if (Array.from(value).length !== 4) return;
  loginEasterEggState.validating = true;
  var result;
  try { result = await requestLoginEasterEggUnlock(value); }
  catch (error) { result = { ok: false, error: String(error && error.message || error) }; }
  if (result && result.ok && result.unlocked) {
    playLoginEasterEggUnlockCinematic();
    return;
  }
  if (result && result.error === 'LOGIN_EASTER_EGG_RESET_INCOMPLETE') {
    setLoginEasterEggStatus('登录凭据清理未完成，请重启后再试', 'error');
    loginEasterEggState.validating = false;
    return;
  }
  if (result && result.error === 'LOGIN_EASTER_EGG_STATE_WRITE_FAILED') {
    setLoginEasterEggStatus('无法保存解锁状态，请释放系统盘空间后重试', 'error');
    loginEasterEggState.validating = false;
    return;
  }
  loginEasterEggState.attempts += 1;
  if (loginEasterEggState.attempts === 3) {
    loginEasterEggState.prefixLocked = true;
    setLoginEasterEggStatus('前两个字，已经替你想好了', 'hint');
  } else {
    setLoginEasterEggStatus(loginEasterEggState.attempts < 3 ? '愿望不太对' : '再想想后两个字', 'error');
  }
  replayLoginEasterEggClass(document.getElementById('login-easter-egg-wish'), 'error-shake');
  window.setTimeout(resetLoginEasterEggInputAfterError, 430);
}


function prepareLoginEasterEggPixelPhrase(phrase) {
  if (!phrase) return;
  Array.prototype.slice.call(phrase.children).forEach(function (charNode) {
    if (!charNode || charNode.querySelector('canvas')) return;
    var glyph = String(charNode.textContent || '').trim().slice(0, 1);
    if (!glyph) return;
    var canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    canvas.className = 'login-easter-pixel-glyph';
    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, 20, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 18px SimSun, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 10, 10.5);
    var pixels = ctx.getImageData(0, 0, 20, 20);
    for (var i = 0; i < pixels.data.length; i += 4) {
      var solid = pixels.data[i + 3] >= 92;
      pixels.data[i] = 255;
      pixels.data[i + 1] = 255;
      pixels.data[i + 2] = 255;
      pixels.data[i + 3] = solid ? 255 : 0;
    }
    ctx.putImageData(pixels, 0, 0);
    charNode.textContent = '';
    charNode.dataset.pixelGlyph = glyph;
    charNode.appendChild(canvas);
  });
}


function playLoginEasterEggUnlockCinematic() {
  clearLoginEasterEggFocusRetries();
  loginEasterEggState.ready = true;
  loginEasterEggState.unlocked = true;
  loginEasterEggState.validating = false;
  loginEasterEggState.cinematicActive = true;
  loginEasterEggState.cinematicReady = false;
  setLoginEasterEggStatus('愿望已收到', 'success');
  var modal = document.getElementById('login-modal');
  var cinematic = document.getElementById('login-easter-unlock-cinematic');
  var phrase = document.getElementById('login-easter-unlock-phrase');
  prepareLoginEasterEggPixelPhrase(phrase);
  var sourceCells = Array.prototype.slice.call(document.querySelectorAll('#login-easter-egg-cells .login-easter-cell'));
  var phraseChars = phrase ? Array.prototype.slice.call(phrase.querySelectorAll('span')) : [];
  if (!cinematic || sourceCells.length !== 4 || phraseChars.length !== 4) {
    completeLoginEasterEggUnlock();
    return;
  }
  cinematic.classList.remove('is-positioned', 'is-extracting', 'is-ready', 'is-dismissing');
  cinematic.classList.add('is-mounted');
  cinematic.setAttribute('aria-hidden', 'false');
  cinematic.setAttribute('tabindex', '0');
  phraseChars.forEach(function (charNode) {
    charNode.style.removeProperty('--extract-x');
    charNode.style.removeProperty('--extract-y');
  });
  window.requestAnimationFrame(function () {
    phraseChars.forEach(function (charNode, index) {
      var sourceRect = sourceCells[index].getBoundingClientRect();
      var targetRect = charNode.getBoundingClientRect();
      var fromX = sourceRect.left + sourceRect.width / 2 - (targetRect.left + targetRect.width / 2);
      var fromY = sourceRect.top + sourceRect.height / 2 - (targetRect.top + targetRect.height / 2);
      charNode.style.setProperty('--extract-x', fromX.toFixed(2) + 'px');
      charNode.style.setProperty('--extract-y', fromY.toFixed(2) + 'px');
    });
    cinematic.classList.add('is-positioned');
    void cinematic.offsetWidth;
    window.requestAnimationFrame(function () {
      cinematic.classList.add('is-extracting');
      window.setTimeout(function () {
        if (modal) modal.classList.add('login-easter-egg-unlocking');
      }, 520);
      window.setTimeout(function () {
        if (!loginEasterEggState.cinematicActive) return;
        loginEasterEggState.cinematicReady = true;
        cinematic.classList.add('is-ready');
        try { cinematic.focus({ preventScroll: true }); } catch (_) { }
      }, 2700);
    });
  });
}


function dismissLoginEasterEggCinematic() {
  if (!loginEasterEggState.cinematicActive || !loginEasterEggState.cinematicReady) return;
  loginEasterEggState.cinematicReady = false;
  var cinematic = document.getElementById('login-easter-unlock-cinematic');
  if (cinematic) cinematic.classList.add('is-dismissing');
  window.setTimeout(completeLoginEasterEggUnlock, 1250);
}


function completeLoginEasterEggUnlock() {
  loginEasterEggState.cinematicActive = false;
  loginEasterEggState.cinematicReady = false;
  var modal = document.getElementById('login-modal');
  var cinematic = document.getElementById('login-easter-unlock-cinematic');
  if (cinematic) {
    cinematic.classList.remove('is-mounted', 'is-positioned', 'is-extracting', 'is-ready', 'is-dismissing');
    cinematic.setAttribute('aria-hidden', 'true');
    cinematic.setAttribute('tabindex', '-1');
  }
  setLoginEasterEggMode(false);
  if (modal) modal.classList.remove('login-easter-egg-unlocking');
  if (typeof resumeLoginModalAfterGate === 'function') resumeLoginModalAfterGate();
  showLoginEasterEggAchievement();
}


function playLoginEasterEggAchievementChime() {
  var ctx = typeof ensureUiSfxContext === 'function' ? ensureUiSfxContext() : null;
  if (!ctx) return;
  try {
    var t = ctx.currentTime + 0.015;
    var master = ctx.createGain();
    var volume = Math.max(0, Math.min(1, typeof targetVolume === 'number' ? targetVolume : 0.72));
    master.gain.setValueAtTime(0.0001, t);
    master.gain.linearRampToValueAtTime(0.12 * (0.32 + volume * 0.68), t + 0.018);
    master.gain.exponentialRampToValueAtTime(0.0001, t + 1.22);
    master.connect(ctx.destination);

    [
      [1046.50, 0.00, 0.46],
      [1318.51, 0.10, 0.50],
      [1567.98, 0.21, 0.58],
      [2093.00, 0.36, 0.82],
    ].forEach(function (note, index) {
      var start = t + note[1];
      var end = start + note[2];
      var osc = ctx.createOscillator();
      var overtone = ctx.createOscillator();
      var gain = ctx.createGain();
      var overtoneGain = ctx.createGain();
      osc.type = 'sine';
      overtone.type = index === 3 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(note[0], start);
      overtone.frequency.setValueAtTime(note[0] * 2.01, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(index === 3 ? 0.68 : 0.52, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      overtoneGain.gain.setValueAtTime(0.0001, start);
      overtoneGain.gain.linearRampToValueAtTime(index === 3 ? 0.16 : 0.11, start + 0.004);
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, Math.min(end, start + 0.28));
      osc.connect(gain);
      overtone.connect(overtoneGain);
      gain.connect(master);
      overtoneGain.connect(master);
      osc.start(start);
      overtone.start(start);
      osc.stop(end + 0.02);
      overtone.stop(end + 0.02);
    });
    window.setTimeout(function () {
      try { master.disconnect(); } catch (_) { }
    }, 1450);
  } catch (error) {
    console.warn('Login achievement chime failed:', error);
  }
}


function showLoginEasterEggAchievement() {
  var toast = document.getElementById('login-easter-achievement');
  if (!toast) return;
  if (loginEasterEggState.achievementTimer) window.clearTimeout(loginEasterEggState.achievementTimer);
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  playLoginEasterEggAchievementChime();
  loginEasterEggState.achievementTimer = window.setTimeout(function () {
    toast.classList.remove('show');
    loginEasterEggState.achievementTimer = null;
  }, 5200);
}
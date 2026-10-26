'use strict';


function parseSpotifyConfigInput(text) {
  text = String(text || '').trim();
  if (!text) return {};
  var parsed = null;
  if (/^\s*\{/.test(text)) {
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  }
  if (parsed && typeof parsed === 'object') {
    var source = parsed.spotify && typeof parsed.spotify === 'object' ? parsed.spotify : parsed;
    return {
      clientId: source.clientId || source.client_id || source.id || '',
      redirectUri: source.redirectUri || source.redirect_uri || source.callbackUrl || source.callback_url || '',
      market: source.market || source.country || '',
      scope: source.scope || source.scopes || ''
    };
  }
  var payload = {};
  var loose = [];
  text.split(/[\r\n;]+/).forEach(function (part) {
    part = String(part || '').trim();
    if (!part) return;
    var pair = part.match(/^([A-Za-z0-9_\-\s]+)\s*[:=]\s*(.+)$/);
    if (!pair) {
      loose.push(part);
      return;
    }
    var key = pair[1].toLowerCase().replace(/[\s_-]+/g, '');
    var value = pair[2].trim();
    if (key === 'clientid' || key === 'spotifyclientid' || key === 'id') payload.clientId = value;
    else if (key === 'redirecturi' || key === 'callbackurl' || key === 'callback') payload.redirectUri = value;
    else if (key === 'market' || key === 'country') payload.market = value;
    else if (key === 'scope' || key === 'scopes') payload.scope = value;
  });
  if (!payload.clientId && loose.length) payload.clientId = loose[0];
  return payload;
}

async function openSpotifyDeveloperDashboard() {
  try {
    var api = window.desktopWindow;
    if (api && typeof api.openUpdatePage === 'function') await api.openUpdatePage(SPOTIFY_DEVELOPER_DASHBOARD_URL);
    else window.open(SPOTIFY_DEVELOPER_DASHBOARD_URL, '_blank');
  } catch (e) { }
  showToast('已打开 Spotify 开发者网页');
}

async function copySpotifyRedirectUri() {
  var ok = false;
  try {
    var api = window.desktopWindow;
    if (api && typeof api.copyText === 'function') {
      var res = await Promise.resolve(api.copyText(SPOTIFY_REDIRECT_URI));
      ok = !res || res.ok !== false;
    }
  } catch (e) { ok = false; }
  if (!ok && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(SPOTIFY_REDIRECT_URI);
      ok = true;
    } catch (e) { ok = false; }
  }
  if (!ok) {
    var helper = document.createElement('textarea');
    helper.value = SPOTIFY_REDIRECT_URI;
    helper.setAttribute('readonly', 'readonly');
    helper.style.position = 'fixed';
    helper.style.left = '-9999px';
    document.body.appendChild(helper);
    helper.select();
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(helper);
  }
  showToast(ok ? '已复制 Spotify 回调地址' : '复制失败，请手动复制回调地址');
}


function spotifySetupCurrentStep() {
  var configReady = !!(spotifyLoginStatus && spotifyLoginStatus.oauthConfigured);
  var loggedIn = !!(spotifyLoginStatus && spotifyLoginStatus.loggedIn);
  if (!configReady) return 1;
  if (!spotifySetupCallbackReady && !loggedIn) return 2;
  if (!loggedIn) return 3;
  return 4;
}


function setSpotifySetupOverall(message, kind) {
  var node = document.getElementById('spotify-setup-overall');
  if (!node) return;
  node.textContent = message || '按当前步骤继续，Mineradio 会自动检测。';
  node.className = 'spotify-setup-overall' + (kind ? (' ' + kind) : '');
}


function spotifySetupEscapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}


function renderSpotifySetupChecks() {
  var root = document.getElementById('spotify-setup-check-list');
  if (!root) return;
  var checks = spotifySetupDiagnostics && Array.isArray(spotifySetupDiagnostics.checks)
    ? spotifySetupDiagnostics.checks.filter(function (check) {
      return ['profile', 'scopes', 'library', 'playlists'].indexOf(check && check.id) >= 0;
    })
    : [];
  if (!checks.length) {
    root.innerHTML = '<span class="spotify-setup-check">等待账号授权</span><span class="spotify-setup-check">等待权限检测</span>';
    return;
  }
  root.innerHTML = checks.map(function (check) {
    var title = spotifySetupEscapeHtml(check && check.title || '接口');
    var message = spotifySetupEscapeHtml(check && check.message || '');
    return '<span class="spotify-setup-check ' + (check && check.ok ? 'ok' : 'fail') + '" title="' + message + '">' + title + '</span>';
  }).join('');
}


function renderSpotifySetupWizard() {
  var wizard = document.getElementById('spotify-setup-wizard');
  if (!wizard) return;
  var configReady = !!(spotifyLoginStatus && spotifyLoginStatus.oauthConfigured);
  var loggedIn = !!(spotifyLoginStatus && spotifyLoginStatus.loggedIn);
  var diagnosticsReady = !!(spotifySetupDiagnostics && spotifySetupDiagnostics.ready);
  var currentStep = spotifySetupCurrentStep();
  var completed = {
    1: configReady,
    2: spotifySetupCallbackReady || loggedIn,
    3: loggedIn,
    4: diagnosticsReady
  };
  [1, 2, 3, 4].forEach(function (step) {
    var card = document.getElementById('spotify-setup-step-' + step);
    var progress = document.querySelector('[data-spotify-progress="' + step + '"]');
    var state = document.querySelector('[data-spotify-step-state="' + step + '"]');
    var locked = step > currentStep && !completed[step];
    if (card) {
      card.classList.toggle('is-complete', !!completed[step]);
      card.classList.toggle('is-active', step === currentStep && !completed[step]);
      card.classList.toggle('is-locked', !!locked);
    }
    if (progress) {
      progress.classList.toggle('complete', !!completed[step]);
      progress.classList.toggle('current', step === currentStep && !completed[step]);
    }
    if (state) state.textContent = completed[step] ? '已通过' : (locked ? '等待上一步' : (spotifySetupBusy ? '检测中…' : '进行中'));
  });
  var input = document.getElementById('spotify-setup-client-id');
  if (input && !input.value && spotifyLoginStatus && spotifyLoginStatus.clientId) input.value = spotifyLoginStatus.clientId;
  var redirect = document.getElementById('spotify-setup-redirect-uri');
  if (redirect) redirect.textContent = spotifyLoginStatus && spotifyLoginStatus.redirectUri || SPOTIFY_REDIRECT_URI;
  var saveButton = document.getElementById('spotify-setup-save-client');
  var callbackButton = document.getElementById('spotify-setup-check-callback');
  var authButton = document.getElementById('spotify-setup-authorize');
  var diagnoseButton = document.getElementById('spotify-setup-diagnose');
  if (saveButton) saveButton.disabled = spotifySetupBusy || spotifyConfigBusy || spotifyOAuthBusy;
  if (callbackButton) callbackButton.disabled = !configReady || spotifySetupBusy || spotifyOAuthBusy;
  if (authButton) {
    authButton.disabled = !configReady || (!spotifySetupCallbackReady && !loggedIn) || spotifySetupBusy || spotifyOAuthBusy;
    authButton.textContent = spotifyOAuthBusy ? '等待浏览器授权…' : (loggedIn ? '重新授权 Spotify' : '打开浏览器并授权');
  }
  if (diagnoseButton) diagnoseButton.disabled = !loggedIn || spotifySetupBusy || spotifyOAuthBusy;
  renderSpotifySetupChecks();
}


async function saveSpotifySetupClientId() {
  if (spotifySetupBusy || spotifyConfigBusy || spotifyOAuthBusy) return;
  var input = document.getElementById('spotify-setup-client-id');
  var clientId = String(input && input.value || '').replace(/\s+/g, '').trim();
  if (!clientId) {
    setSpotifySetupOverall('请先粘贴 Dashboard 中的 Client ID。', 'fail');
    if (input) input.focus();
    return;
  }
  spotifyConfigBusy = true;
  spotifySetupBusy = true;
  setSpotifySetupOverall('正在保存并验证 Client ID…');
  renderSpotifySetupWizard();
  try {
    var info = await apiJson('/api/spotify/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId, redirectUri: SPOTIFY_REDIRECT_URI })
    });
    if (!info || info.ok === false || info.error) throw new Error(info && (info.message || info.error) || 'Client ID 保存失败');
    spotifyLoginStatus = normalizeSpotifyLoginStatus(info);
    spotifySetupCallbackReady = false;
    spotifySetupDiagnostics = null;
    setSpotifySetupOverall('Client ID 已通过格式验证。现在把回调地址保存到 Spotify Dashboard。', 'success');
  } catch (error) {
    setSpotifySetupOverall(error && error.message || 'Client ID 保存失败', 'fail');
  } finally {
    spotifyConfigBusy = false;
    spotifySetupBusy = false;
    updateLoginProviderUi();
  }
}


async function verifySpotifySetupCallback(silent) {
  if (spotifySetupBusy || spotifyOAuthBusy) return false;
  var api = window.desktopWindow;
  if (!api || typeof api.verifySpotifyMusicSetup !== 'function') {
    spotifySetupCallbackReady = false;
    setSpotifySetupOverall('当前不是可执行本机回调检测的 Mineradio 桌面环境。', 'fail');
    renderSpotifySetupWizard();
    return false;
  }
  spotifySetupBusy = true;
  if (!silent) setSpotifySetupOverall('正在检测本机回调地址与端口…');
  renderSpotifySetupWizard();
  try {
    var result = await api.verifySpotifyMusicSetup();
    spotifySetupCallbackReady = !!(result && result.ok && result.callbackReady);
    setSpotifySetupOverall(result && result.message || (spotifySetupCallbackReady ? '本机回调检测通过。' : '本机回调检测失败。'), spotifySetupCallbackReady ? 'success' : 'fail');
    return spotifySetupCallbackReady;
  } catch (error) {
    spotifySetupCallbackReady = false;
    setSpotifySetupOverall(error && error.message || '本机回调检测失败。', 'fail');
    return false;
  } finally {
    spotifySetupBusy = false;
    renderSpotifySetupWizard();
  }
}


async function runSpotifySetupDiagnostics(force) {
  if (spotifySetupBusy) return spotifySetupDiagnostics;
  spotifySetupBusy = true;
  setSpotifySetupOverall('正在验证账号资料、权限、喜欢歌曲和个人歌单…');
  renderSpotifySetupWizard();
  try {
    spotifySetupDiagnostics = await apiJson('/api/spotify/setup/diagnostics?t=' + Date.now());
    var ready = !!(spotifySetupDiagnostics && spotifySetupDiagnostics.ready);
    setSpotifySetupOverall(spotifySetupDiagnostics && spotifySetupDiagnostics.message || (ready ? 'Spotify 接口已全部接通。' : '仍有接口未通过。'), ready ? 'success' : 'fail');
    return spotifySetupDiagnostics;
  } catch (error) {
    spotifySetupDiagnostics = { ready: false, checks: [], message: error && error.message || 'Spotify 接口体检失败' };
    setSpotifySetupOverall(spotifySetupDiagnostics.message, 'fail');
    return spotifySetupDiagnostics;
  } finally {
    spotifySetupBusy = false;
    renderSpotifySetupWizard();
  }
}


function scheduleSpotifySetupAutoCheck() {
  if (loginProvider !== 'spotify') return;
  var key = [spotifyLoginStatus && spotifyLoginStatus.oauthConfigured ? 1 : 0, spotifyLoginStatus && spotifyLoginStatus.loggedIn ? 1 : 0].join(':');
  if (spotifySetupAutoCheckKey === key) return;
  spotifySetupAutoCheckKey = key;
  setTimeout(async function () {
    if (loginProvider !== 'spotify') return;
    if (loginProvider === 'spotify' && spotifyLoginStatus && spotifyLoginStatus.loggedIn) await runSpotifySetupDiagnostics(false);
  }, 80);
}

function openQishuiPublicSearch() {
  closeLoginModal();
  if (typeof setSearchMode === 'function') setSearchMode('qishui');
  var input = document.getElementById('search-input');
  if (input) {
    setTimeout(function () {
      try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (_) { } }
    }, 60);
  }
  showToast('汽水搜索已切换为匹配源');
}
'use strict';


function toggleQQCookiePanel() {
  if (loginProvider === 'spotify') return;
  setManualCookieOpenForProvider(loginProvider, !isManualCookieOpenForProvider(loginProvider));
  updateLoginProviderUi();
}

function openProviderWebLogin() {
  if (loginProvider === 'qq') return openQQWebLogin();
  if (loginProvider === 'kugou') return openKugouWebLogin();
  if (loginProvider === 'qishui') return openQishuiWebLogin();
  if (loginProvider === 'spotify') return openSpotifyWebLogin();
  return openNeteaseWebLogin();
}

async function openSpotifyWebLogin() {
  if (spotifyOAuthBusy) return;
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openSpotifyMusicLogin !== 'function') {
    setSpotifySetupOverall('当前环境不支持 Spotify 本地授权桥，请使用 Mineradio 桌面版。', 'fail');
    return;
  }
  if (!spotifyLoginStatus.oauthConfigured && !spotifyLoginStatus.tokenConfigured) {
    var latestStatus = await refreshSpotifyLoginStatus();
    if (!latestStatus.oauthConfigured && !latestStatus.tokenConfigured) {
      updateLoginProviderUi();
      setSpotifySetupOverall('先完成第一步：粘贴并保存 Spotify Client ID。', 'fail');
      return;
    }
  }
  if (!spotifySetupCallbackReady) {
    var callbackReady = await verifySpotifySetupCallback(false);
    if (!callbackReady) return;
  }
  spotifyOAuthBusy = true;
  updateLoginProviderUi();
  setSpotifySetupOverall('已打开系统浏览器，请在 Spotify 官方页面完成授权；Mineradio 正在等待回调。');
  var failText = '';
  try {
    var result = await api.openSpotifyMusicLogin();
    if (!result || !result.ok) {
      if (result && result.error === 'SPOTIFY_OAUTH_NOT_CONFIGURED') {
        throw new Error((result.message || '请先保存 Spotify Client ID') + (result.redirectUri ? (' / 回调地址: ' + result.redirectUri) : ''));
      }
      throw new Error((result && (result.message || result.error)) || 'Spotify 授权未完成');
    }
    setSpotifySetupOverall('授权已返回，正在验证账号资料和接口…');
    var info = await refreshSpotifyLoginStatus();
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || 'Spotify 登录态不可用');
    activeAccountProvider = 'spotify';
    markLoginWorkflowConnected('spotify');
    renderUserBtn();
    await refreshUserPlaylists(true);
    loadHomeDiscover(true);
    spotifyOAuthBusy = false;
    updateLoginProviderUi();
    await runSpotifySetupDiagnostics(true);
    showToast('Spotify 已连接: ' + (info.nickname || info.userId || ''));
  } catch (e) {
    failText = e && e.message ? e.message : 'Spotify 授权失败';
    setSpotifySetupOverall(failText, 'fail');
  } finally {
    spotifyOAuthBusy = false;
    updateLoginProviderUi();
    if (failText) setSpotifySetupOverall(failText, 'fail');
  }
}

async function submitSpotifyConfigLogin() {
  return saveSpotifySetupClientId();
}

async function openNeteaseWebLogin() {
  if (neteaseWebLoginBusy) return;
  var statusEl = document.getElementById('qr-status');
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openNeteaseMusicLogin !== 'function') {
    if (statusEl) { statusEl.textContent = '当前环境不支持官方网页登录，正在尝试旧二维码…'; statusEl.className = 'fail'; }
    return refreshQr();
  }

  neteaseWebLoginBusy = true;
  updateLoginProviderUi();
  if (statusEl) { statusEl.textContent = '已打开网易云窗口，请在官方页面扫码登录…'; statusEl.className = 'preview'; }
  try {
    var result = await api.openNeteaseMusicLogin();
    if (!result || !result.ok || !result.cookie) {
      throw new Error((result && (result.message || result.error)) || '网易云登录未完成');
    }
    if (statusEl) { statusEl.textContent = '正在同步网易云会话…'; statusEl.className = 'preview'; }
    var info = await apiJson('/api/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: result.cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || '网易云会话不可用');
    loginStatus = info;
    activeAccountProvider = 'netease';
    renderUserBtn();
    refreshUserPlaylists(true);
    loadHomeDiscover(true);
    if (statusEl) { statusEl.textContent = '网易云会话已保存'; statusEl.className = 'scan'; }
    offerLoginCookieExport('netease', info);
    setTimeout(function () {
      closeLoginModal();
      showToast('网易云已登录: ' + (info.nickname || info.userId || ''));
    }, 420);
  } catch (e) {
    neteaseWebLoginBusy = false;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : '网易云登录失败'; statusEl.className = 'fail'; }
  } finally {
    if (neteaseWebLoginBusy) {
      neteaseWebLoginBusy = false;
      updateLoginProviderUi();
    }
  }
}

async function openQQWebLogin() {
  if (qqWebLoginBusy) return;
  var statusEl = document.getElementById('qr-status');
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openQQMusicLogin !== 'function') {
    qqManualCookieOpen = true;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = '当前环境不支持自动网页登录，可先使用手动导入。'; statusEl.className = 'fail'; }
    return;
  }

  qqWebLoginBusy = true;
  updateLoginProviderUi();
  if (statusEl) { statusEl.textContent = '已打开 QQ 音乐窗口，请扫码并确认登录…'; statusEl.className = 'preview'; }
  try {
    var result = await api.openQQMusicLogin({
      forceReauth: !!(qqLoginStatus && qqLoginStatus.authorizationIncomplete && qqLoginStatus.playbackKeyReady === false)
    });
    if (!result || !result.ok || !result.cookie) {
      throw new Error((result && (result.message || result.error)) || 'QQ 登录未完成');
    }
    if (statusEl) { statusEl.textContent = '正在同步 QQ 音乐会话…'; statusEl.className = 'preview'; }
    var info = await apiJson('/api/qq/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: result.cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || 'QQ 会话不可用');
    qqLoginStatus = normalizeQQLoginStatus(info);
    auditProviderVipState('qq', qqLoginStatus);
    activeAccountProvider = 'qq';
    qqManualCookieOpen = false;
    renderUserBtn();
    refreshUserPlaylists(true);
    offerLoginCookieExport('qq', info);
    var qqPlaybackReady = !!info.playbackKeyReady && !result.partial;
    if (!qqPlaybackReady) {
      if (statusEl) { statusEl.textContent = 'QQ 账号态已同步，但播放授权未完成；请重新打开 QQ 音乐登录并等待进入播放器页后再关闭窗口。'; statusEl.className = 'preview'; }
      showToast('QQ 账号态已同步，播放授权未完成');
      return;
    }
    if (statusEl) { statusEl.textContent = qqPlaybackReady ? qqLoginStatusText(qqLoginStatus) : 'QQ 账号已同步，播放授权不完整，部分歌曲会自动换源'; statusEl.className = 'scan'; }
    setTimeout(function () {
      closeLoginModal();
      showToast((qqPlaybackReady ? 'QQ 音乐已登录: ' : 'QQ 账号已同步: ') + (info.nickname || info.userId || ''));
    }, 420);
  } catch (e) {
    qqWebLoginBusy = false;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : 'QQ 登录失败'; statusEl.className = 'fail'; }
  } finally {
    if (qqWebLoginBusy) {
      qqWebLoginBusy = false;
      updateLoginProviderUi();
    }
  }
}

async function openKugouWebLogin() {
  if (kugouWebLoginBusy) return;
  var statusEl = document.getElementById('qr-status');
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openKugouMusicLogin !== 'function') {
    kugouManualCookieOpen = true;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = '当前环境不支持自动网页登录，可先使用手动导入。'; statusEl.className = 'fail'; }
    return;
  }

  kugouWebLoginBusy = true;
  updateLoginProviderUi();
  if (statusEl) { statusEl.textContent = '已打开酷狗音乐窗口，请完成官方登录…'; statusEl.className = 'preview'; }
  try {
    var result = await api.openKugouMusicLogin({ forceReauth: true });
    if (!result || !result.ok || !result.cookie) {
      throw new Error((result && (result.message || result.error)) || '酷狗登录未完成');
    }
    if (statusEl) { statusEl.textContent = '正在同步酷狗音乐会话…'; statusEl.className = 'preview'; }
    var info = await apiJson('/api/kugou/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: result.cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || '酷狗会话不可用');
    kugouLoginStatus = normalizeKugouLoginStatus(info);
    activeAccountProvider = 'kugou';
    kugouManualCookieOpen = false;
    renderUserBtn();
    refreshUserPlaylists(true);
    offerLoginCookieExport('kugou', info);
    var ready = !!info.playbackKeyReady && !result.partial;
    if (statusEl) { statusEl.textContent = ready ? '酷狗音乐会话已保存' : '酷狗账号已同步，播放授权不完整，部分歌曲可能需要重登'; statusEl.className = 'scan'; }
    setTimeout(function () {
      closeLoginModal();
      showToast((ready ? '酷狗音乐已登录: ' : '酷狗账号已同步: ') + (info.nickname || info.userId || ''));
    }, 420);
  } catch (e) {
    kugouWebLoginBusy = false;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : '酷狗登录失败'; statusEl.className = 'fail'; }
  } finally {
    if (kugouWebLoginBusy) {
      kugouWebLoginBusy = false;
      updateLoginProviderUi();
    }
  }
}

async function openQishuiWebLogin() {
  if (qishuiTokenBusy || qishuiOAuthBusy) return;
  return refreshQr();
}

async function submitQQCookieLogin() {
  if (loginProvider === 'spotify') return submitSpotifyConfigLogin();
  if (loginProvider === 'qishui') return openQishuiWebLogin();
  if (loginProvider === 'netease') return submitNeteaseCookieLogin();
  var isKugou = loginProvider === 'kugou';
  if (isKugou ? kugouCookieBusy : qqCookieBusy) return;
  var input = document.getElementById('qq-cookie-input');
  var statusEl = document.getElementById('qr-status');
  var saveBtn = document.getElementById('qq-cookie-save-btn');
  var cookie = input ? input.value.trim() : '';
  if (!cookie) {
    if (statusEl) { statusEl.textContent = isKugou ? '先粘贴酷狗音乐 cookie' : '先粘贴 QQ 音乐 cookie'; statusEl.className = 'fail'; }
    return;
  }
  if (isKugou) kugouCookieBusy = true;
  else qqCookieBusy = true;
  if (saveBtn) saveBtn.classList.add('busy');
  if (statusEl) { statusEl.textContent = isKugou ? '正在保存酷狗会话…' : '正在保存 QQ 会话…'; statusEl.className = 'preview'; }
  try {
    var info = await apiJson(isKugou ? '/api/kugou/login/cookie' : '/api/qq/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || (isKugou ? '酷狗会话不可用' : 'QQ 会话不可用'));
    if (isKugou) kugouLoginStatus = normalizeKugouLoginStatus(info);
    else {
      qqLoginStatus = normalizeQQLoginStatus(info);
      auditProviderVipState('qq', qqLoginStatus);
    }
    activeAccountProvider = isKugou ? 'kugou' : 'qq';
    if (input) input.value = '';
    renderUserBtn();
    refreshUserPlaylists(true);
    var manualPlaybackReady = !!info.playbackKeyReady;
    if (statusEl) { statusEl.textContent = manualPlaybackReady ? (isKugou ? '酷狗音乐会话已保存' : qqLoginStatusText(qqLoginStatus)) : (isKugou ? '酷狗账号已同步，播放授权不完整，部分歌曲可能需要重登' : 'QQ 账号已同步，播放授权不完整，部分歌曲会自动换源'); statusEl.className = 'scan'; }
    setManualCookieOpenForProvider(activeAccountProvider, false);
    offerLoginCookieExport(activeAccountProvider, info);
    setTimeout(function () {
      closeLoginModal();
      showToast((manualPlaybackReady ? (isKugou ? '酷狗音乐已登录: ' : 'QQ 音乐已登录: ') : (isKugou ? '酷狗账号已同步: ' : 'QQ 账号已同步: ')) + (info.nickname || info.userId || ''));
    }, 420);
  } catch (e) {
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : (isKugou ? '酷狗会话保存失败' : 'QQ 会话保存失败'); statusEl.className = 'fail'; }
  } finally {
    if (isKugou) kugouCookieBusy = false;
    else qqCookieBusy = false;
    if (saveBtn) saveBtn.classList.remove('busy');
  }
}


async function submitNeteaseCookieLogin() {
  if (qqCookieBusy) return;
  var input = document.getElementById('qq-cookie-input');
  var statusEl = document.getElementById('qr-status');
  var saveBtn = document.getElementById('qq-cookie-save-btn');
  var cookie = input ? input.value.trim() : '';
  if (!cookie) {
    if (statusEl) { statusEl.textContent = '先粘贴网易云 MUSIC_U cookie'; statusEl.className = 'fail'; }
    return;
  }
  qqCookieBusy = true;
  if (saveBtn) saveBtn.classList.add('busy');
  if (statusEl) { statusEl.textContent = '正在保存网易云会话…'; statusEl.className = 'preview'; }
  try {
    var info = await apiJson('/api/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || '网易云会话不可用');
    loginStatus = info;
    activeAccountProvider = 'netease';
    neteaseManualCookieOpen = false;
    if (input) input.value = '';
    renderUserBtn();
    refreshUserPlaylists(true);
    loadHomeDiscover(true);
    if (statusEl) { statusEl.textContent = '网易云会话已保存'; statusEl.className = 'scan'; }
    offerLoginCookieExport('netease', info);
    setTimeout(function () {
      closeLoginModal();
      showToast('网易云已登录: ' + (info.nickname || info.userId || ''));
    }, 420);
  } catch (e) {
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : '网易云会话保存失败'; statusEl.className = 'fail'; }
  } finally {
    qqCookieBusy = false;
    if (saveBtn) saveBtn.classList.remove('busy');
    updateLoginProviderUi();
  }
}

async function checkQr() {
  if (!qrKey) return;
  try {
    var r = await apiJson('/api/login/qr/check?key=' + encodeURIComponent(qrKey));
    var $st = document.getElementById('qr-status');
    if (r.code === 800) { $st.textContent = '二维码已过期, 请刷新'; $st.className = 'fail'; stopQrPoll(); }
    else if (r.code === 801) { $st.textContent = '请在 App 中扫码'; $st.className = ''; }
    else if (r.code === 802) { $st.textContent = '已扫码, 请在手机确认…'; $st.className = 'scan'; }
    else if (r.code === 803 && (r.loggedIn || r.hasCookie)) {
      $st.textContent = r.pendingProfile ? '登录成功，正在同步账号资料…' : '登录成功！'; $st.className = 'scan';
      stopQrPoll();
      loginStatus = r.loggedIn ? r : Object.assign({}, r, { loggedIn: true, pendingProfile: true, nickname: r.nickname || '网易云用户' });
      activeAccountProvider = 'netease';
      renderUserBtn();
      setTimeout(async function () {
        var fresh = await refreshLoginStatus(true);
        if (!fresh || !fresh.loggedIn) {
          loginStatus = Object.assign({}, loginStatus, { loggedIn: true, pendingProfile: true });
          renderUserBtn();
          fresh = loginStatus;
        }
        closeLoginModal();
        offerLoginCookieExport('netease', fresh);
        showToast('欢迎 ' + (fresh && fresh.nickname ? fresh.nickname : ''));
      }, r.pendingProfile ? 1200 : 500);
    } else if (r.code === 803) {
      $st.textContent = '扫码已确认，但没有拿到登录凭证，请刷新二维码重试'; $st.className = 'fail';
      stopQrPoll();
    }
  } catch (e) { console.warn(e); }
}
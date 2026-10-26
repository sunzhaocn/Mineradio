'use strict';


function updateLoginProviderUi() {
  var meta = platformMeta(loginProvider);
  var isQQ = loginProvider === 'qq';
  var isKugou = loginProvider === 'kugou';
  var isQishui = loginProvider === 'qishui';
  var isNetease = loginProvider === 'netease';
  var isManualCookieProvider = isNetease || isQQ || isKugou;
  var title = document.getElementById('login-modal-title');
  var desc = document.getElementById('login-modal-desc');
  var shell = document.getElementById('qr-shell');
  var st = document.getElementById('qr-status');
  var refreshBtn = document.getElementById('refresh-qr-btn');
  var qqPanel = document.getElementById('qq-cookie-panel');
  var qqCookieToggle = document.getElementById('qq-cookie-toggle-btn');
  var qqCookieInput = document.getElementById('qq-cookie-input');
  var qqCookieNote = qqPanel ? qqPanel.querySelector('.qq-cookie-note') : null;
  var qqCard = document.getElementById('qq-web-login-card');
  var neteaseBtn = document.getElementById('login-provider-netease');
  var qqBtn = document.getElementById('login-provider-qq');
  var kugouBtn = document.getElementById('login-provider-kugou');
  var qishuiBtn = document.getElementById('login-provider-qishui');
  var qqCookieSaveBtn = document.getElementById('qq-cookie-save-btn');
  var canOpenNeteaseWeb = !!(window.desktopWindow && typeof window.desktopWindow.openNeteaseMusicLogin === 'function');
  var canUseQishuiQrLogin = true;
  var qishuiSearchReady = qishuiPublicSearchReady();
  var qishuiBusy = !!(qishuiTokenBusy || qishuiOAuthBusy);
  var isSpotify = loginProvider === 'spotify';
  var spotifyBtn = document.getElementById('login-provider-spotify');
  var loginDrawer = document.getElementById('login-auth-drawer');
  var loginModalPanel = document.querySelector('#login-modal .dual-login-modal');
  var spotifyWizard = document.getElementById('spotify-setup-wizard');
  var canOpenSpotifyOAuth = !!(window.desktopWindow && typeof window.desktopWindow.openSpotifyMusicLogin === 'function');
  var spotifyBusy = !!(spotifyConfigBusy || spotifyOAuthBusy);
  if (loginDrawer) loginDrawer.classList.toggle('spotify-mode', isSpotify);
  if (loginModalPanel) loginModalPanel.classList.toggle('spotify-setup-open', isSpotify);
  if (spotifyWizard) spotifyWizard.setAttribute('aria-hidden', isSpotify ? 'false' : 'true');
  updateLoginNodeGraphUi();
  if (isSpotify) {
    if (neteaseBtn) neteaseBtn.classList.toggle('active', false);
    if (qqBtn) qqBtn.classList.toggle('active', false);
    if (kugouBtn) kugouBtn.classList.toggle('active', false);
    if (qishuiBtn) qishuiBtn.classList.toggle('active', false);
    if (spotifyBtn) spotifyBtn.classList.toggle('active', true);
    if (title) title.textContent = '连接 Spotify';
    if (desc) desc.innerHTML = canOpenSpotifyOAuth
      ? '粘贴 <b>Spotify Client ID</b> 后保存并授权，用于同步 Premium/Free 状态、歌单和 Liked Songs；播放仍按匹配源自动换源。'
      : '当前环境不支持桌面授权桥；请在 Mineradio 桌面版中连接 Spotify。';
    if (shell) {
      shell.classList.add('web-login-preview');
      shell.classList.remove('qq-preview', 'netease-preview');
    }
    if (qqPanel) {
      qqPanel.classList.add('show', 'spotify-guide-panel');
    }
    if (qqCookieToggle) qqCookieToggle.classList.remove('show');
    if (qqCookieInput) qqCookieInput.placeholder = spotifyLoginStatus.oauthConfigured
      ? '已保存 Client ID；可粘贴新的 Client ID 覆盖'
      : '粘贴 Spotify Client ID';
    if (qqCookieNote) qqCookieNote.innerHTML =
      '<div class="spotify-guide-title">Spotify 玩家接入三步</div>' +
      '<div class="spotify-guide-steps">' +
        '<span>1. 打开网页，创建 App</span>' +
        '<span>2. 回调填 <code>' + SPOTIFY_REDIRECT_URI + '</code></span>' +
        '<span>3. 复制 Client ID，粘到这里</span>' +
      '</div>' +
      '<div class="spotify-guide-actions">' +
        '<button type="button" class="spotify-guide-link" onclick="openSpotifyDeveloperDashboard()">打开网页</button>' +
        '<button type="button" class="spotify-guide-link" onclick="copySpotifyRedirectUri()">复制回调</button>' +
        '<span>PKCE 不用填 Client Secret</span>' +
      '</div>';
    if (qqCookieSaveBtn) {
      qqCookieSaveBtn.disabled = spotifyBusy;
      qqCookieSaveBtn.textContent = spotifyConfigBusy ? '保存中…' : (spotifyOAuthBusy ? '等待授权…' : '保存并授权');
    }
    if (qqCard) {
      qqCard.style.display = '';
      qqCard.disabled = spotifyBusy || !canOpenSpotifyOAuth || !spotifyLoginStatus.oauthConfigured;
      var spCardMark = qqCard.querySelector('b');
      var spCardLabel = qqCard.querySelector('span');
      if (spCardMark) spCardMark.textContent = 'SP';
      if (spCardLabel) spCardLabel.textContent = spotifyOAuthBusy ? '等待 Spotify 授权' : (spotifyLoginStatus.oauthConfigured ? '打开 Spotify 授权' : '先保存 Client ID');
    }
    if (st) {
      st.className = 'preview';
      st.textContent = spotifyLoginStatusText();
    }
    if (refreshBtn) {
      refreshBtn.disabled = spotifyBusy || !canOpenSpotifyOAuth;
      refreshBtn.textContent = spotifyConfigBusy ? '保存中…' : (spotifyOAuthBusy ? '等待授权…' : (spotifyLoginStatus.oauthConfigured ? '连接 Spotify' : '保存并授权'));
      refreshBtn.onclick = spotifyLoginStatus.oauthConfigured ? openSpotifyWebLogin : submitSpotifyConfigLogin;
    }
    renderSpotifySetupWizard();
    scheduleSpotifySetupAutoCheck();
    updateLoginNodeGraphUi();
    return;
  }
  if (qqPanel) qqPanel.classList.remove('spotify-guide-panel');
  if (spotifyBtn) spotifyBtn.classList.toggle('active', false);
  if (neteaseBtn) neteaseBtn.classList.toggle('active', loginProvider === 'netease');
  if (qqBtn) qqBtn.classList.toggle('active', isQQ);
  if (kugouBtn) kugouBtn.classList.toggle('active', isKugou);
  if (qishuiBtn) qishuiBtn.classList.toggle('active', isQishui);
  if (title) title.textContent = isQishui ? '扫码登录汽水音乐' : ('扫码登录' + meta.label);
  if (desc) desc.innerHTML = isQQ
    ? '打开 <b>QQ 音乐官方网页登录窗口</b> 扫码，成功后会自动同步账号会话。'
    : (isKugou
      ? '打开 <b>酷狗音乐官方网页登录窗口</b> 登录，成功后会自动同步账号会话。'
    : (isQishui
      ? '使用已登录账号的 <b>抖音 App</b> 扫描官方二维码并确认，登录后可同步我的喜欢、歌单并按账号权益播放。'
    : (canOpenNeteaseWeb
      ? '打开 <b>网易云音乐官方网页登录窗口</b> 扫码，避开接口二维码风控；成功后会自动同步账号会话。'
      : '使用 <b>网易云音乐 App</b> 扫码，可同步歌单、红心与播客。')));
  var manualCookieOpen = isManualCookieOpenForProvider(loginProvider);
  if (shell) {
    var useWebPreview = isQQ || isKugou || (isNetease && (canOpenNeteaseWeb || manualCookieOpen));
    shell.classList.toggle('web-login-preview', useWebPreview);
    shell.classList.toggle('qq-preview', isQQ);
    shell.classList.toggle('netease-preview', isNetease && canOpenNeteaseWeb);
  }
  if (qqPanel) qqPanel.classList.toggle('show', isManualCookieProvider && manualCookieOpen);
  if (qqCookieToggle) {
    qqCookieToggle.classList.toggle('show', isManualCookieProvider);
    qqCookieToggle.textContent = manualCookieOpen ? '收起导入' : 'Cookie 导入';
  }
  if (qqCookieInput) qqCookieInput.placeholder = isKugou ? 'KuGoo=...; token=...; userid=...; kg_mid=...' : (isNetease ? 'MUSIC_U=...; __csrf=...' : 'uin=...; qqmusic_key=...; qm_keyst=...');
  if (qqCookieNote) qqCookieNote.textContent = isKugou ? '从 kugou.com 的登录会话导入。' : (isNetease ? '从 music.163.com 的登录会话导入。' : '从 y.qq.com 的登录会话导入。');
  if (qqCookieSaveBtn) qqCookieSaveBtn.textContent = '保存 Cookie';
  if (qqCard) {
    qqCard.style.display = '';
    qqCard.disabled = isQishui ? (qishuiBusy || !canUseQishuiQrLogin) : (isQQ ? !!qqWebLoginBusy : (isKugou ? !!kugouWebLoginBusy : !!neteaseWebLoginBusy));
    var cardMark = qqCard.querySelector('b');
    var cardLabel = qqCard.querySelector('span');
    if (cardMark) cardMark.textContent = isQQ ? 'QQ' : (isKugou ? 'KG' : (isQishui ? 'QS' : 'NE'));
    if (cardLabel) cardLabel.textContent = isQQ
      ? (qqWebLoginBusy ? '等待扫码确认' : (qqLoginStatus.loggedIn ? '重新打开官方窗口同步会员' : '打开官方扫码窗口'))
      : (isKugou ? (kugouWebLoginBusy ? '等待登录确认' : '打开官方登录窗口') : (isQishui ? (qishuiOAuthBusy ? '正在生成二维码' : '扫码登录汽水') : (neteaseWebLoginBusy ? '等待扫码确认' : '打开官方登录窗口')));
  }
  if (st) {
    st.className = isManualCookieProvider ? 'preview' : '';
    st.textContent = isQQ
      ? qqLoginStatusText(qqLoginStatus)
      : (isKugou
        ? (kugouLoginStatus.loggedIn ? ('已保存酷狗音乐会话 · ' + (kugouLoginStatus.nickname || '')) : '点击“登录”打开酷狗音乐官方窗口')
        : (isQishui
          ? qishuiLoginStatusText()
        : (canOpenNeteaseWeb ? '点击“网页登录”打开网易云官方窗口' : '正在生成二维码…')));
  }
  if (refreshBtn) {
    refreshBtn.disabled = isQishui ? (qishuiBusy || !canUseQishuiQrLogin) : (isQQ ? !!qqWebLoginBusy : (isKugou ? !!kugouWebLoginBusy : !!neteaseWebLoginBusy));
    var qqNeedsAuthRefresh = isQQ && qqLoginStatus.loggedIn && (
      qqLoginStatus.authorizationIncomplete ||
      qqLoginStatus.playbackKeyReady === false
    );
    var qqNeedsMembershipSync = isQQ && typeof qqMembershipNeedsSync === 'function' && qqMembershipNeedsSync(qqLoginStatus);
    refreshBtn.textContent = isQishui ? (qishuiOAuthBusy ? '生成中…' : '刷新二维码') : (isQQ ? (qqWebLoginBusy ? '等待扫码…' : (qqNeedsAuthRefresh ? '重新授权' : (qqNeedsMembershipSync ? '同步会员' : (qqLoginStatus.loggedIn ? '刷新状态' : '扫码登录')))) : (isKugou ? (kugouWebLoginBusy ? '等待登录…' : '登录') : (canOpenNeteaseWeb ? (neteaseWebLoginBusy ? '等待扫码…' : '网页登录') : '刷新二维码')));
    refreshBtn.onclick = isQishui ? openQishuiWebLogin : (isQQ ? (qqNeedsAuthRefresh ? openQQWebLogin : (qqLoginStatus.loggedIn ? refreshQr : openQQWebLogin)) : (isKugou ? openKugouWebLogin : (canOpenNeteaseWeb ? openNeteaseWebLogin : refreshQr)));
  }
  updateLoginNodeGraphUi();
}

async function refreshQr() {
  stopQrPoll();
  updateLoginProviderUi();
  var refreshProvider = loginProvider;
  var refreshSeq = ++loginRefreshRequestSeq;
  if (loginProvider === 'spotify') {
    qrKey = null;
    var spotifyStatus = document.getElementById('qr-status');
    var spotifyImg = document.getElementById('qr-img');
    if (spotifyImg) spotifyImg.src = '';
    var spotifyInfo = await refreshSpotifyLoginStatus();
    if (!isLoginRefreshCurrent(refreshProvider, refreshSeq)) return;
    updateLoginProviderUi();
    if (spotifyStatus) {
      spotifyStatus.textContent = spotifyLoginStatusText(spotifyInfo);
      spotifyStatus.className = 'preview';
    }
    return;
  }
  if (loginProvider === 'qishui') {
    qrKey = null;
    var qishuiStatus = document.getElementById('qr-status');
    var qishuiImg = document.getElementById('qr-img');
    if (qishuiImg) qishuiImg.src = '';
    qishuiOAuthBusy = true;
    updateLoginProviderUi();
    try {
      var qishuiQr = await apiJson('/api/qishui/login/qrcode?t=' + Date.now());
      if (!isLoginRefreshCurrent(refreshProvider, refreshSeq)) return;
      if (!qishuiQr || !qishuiQr.token || !qishuiQr.qrcode) {
        throw new Error((qishuiQr && (qishuiQr.message || qishuiQr.error)) || '生成汽水音乐二维码失败');
      }
      qrKey = qishuiQr.token;
      if (qishuiImg) {
        qishuiImg.src = qishuiQr.qrcode;
        qishuiImg.alt = '汽水音乐登录二维码';
      }
      if (qishuiStatus) {
        qishuiStatus.textContent = '请使用抖音 App 扫码并确认登录';
        qishuiStatus.className = '';
      }
      startQrPoll();
    } catch (e) {
      if (!isLoginRefreshCurrent(refreshProvider, refreshSeq)) return;
      if (qishuiStatus) {
        qishuiStatus.textContent = '出错: ' + (e && e.message ? e.message : e);
        qishuiStatus.className = 'fail';
      }
    } finally {
      qishuiOAuthBusy = false;
      if (isLoginRefreshCurrent(refreshProvider, refreshSeq)) updateLoginProviderUi();
      if (qishuiStatus && qrKey && isLoginRefreshCurrent(refreshProvider, refreshSeq)) {
        qishuiStatus.textContent = '请使用抖音 App 扫码并确认登录';
        qishuiStatus.className = '';
      }
    }
    return;
  }
  if (loginProvider === 'qq') {
    qrKey = null;
    var qqStatus = document.getElementById('qr-status');
    var qqImg = document.getElementById('qr-img');
    if (qqImg) qqImg.src = '';
    var info = await refreshQQVipStatusNow('login-panel');
    if (!isLoginRefreshCurrent(refreshProvider, refreshSeq)) return;
    if (qqStatus) {
      qqStatus.textContent = qqLoginStatusText(info);
      qqStatus.className = 'preview';
    }
    return;
  }
  if (loginProvider === 'kugou') {
    qrKey = null;
    var kugouStatus = document.getElementById('qr-status');
    var kugouImg = document.getElementById('qr-img');
    if (kugouImg) kugouImg.src = '';
    var kugouInfo = await refreshKugouLoginStatus();
    if (!isLoginRefreshCurrent(refreshProvider, refreshSeq)) return;
    if (kugouStatus) {
      kugouStatus.textContent = kugouInfo && kugouInfo.loggedIn ? ('已保存酷狗音乐会话 · ' + (kugouInfo.nickname || '')) : '点击“登录”打开酷狗音乐官方窗口';
      kugouStatus.className = 'preview';
    }
    return;
  }
  if (window.desktopWindow && typeof window.desktopWindow.openNeteaseMusicLogin === 'function') {
    qrKey = null;
    var neImg = document.getElementById('qr-img');
    var neStatus = document.getElementById('qr-status');
    if (neImg) neImg.src = '';
    if (neStatus) {
      neStatus.textContent = loginStatus.loggedIn ? ('已保存网易云会话 · ' + (loginStatus.nickname || '')) : '点击“网页登录”打开网易云官方窗口';
      neStatus.className = 'preview';
    }
    return;
  }
  try {
    var k = await apiJson('/api/login/qr/key');
    if (!isLoginRefreshCurrent(refreshProvider, refreshSeq)) return;
    if (!k.key) throw new Error('获取 key 失败');
    qrKey = k.key;
    var q = await apiJson('/api/login/qr/create?key=' + encodeURIComponent(qrKey));
    if (!isLoginRefreshCurrent(refreshProvider, refreshSeq)) return;
    if (!q.img) throw new Error('生成二维码失败');
    document.getElementById('qr-img').src = q.img;
    document.getElementById('qr-status').textContent = '请使用网易云音乐 App 扫码';
    startQrPoll();
  } catch (e) {
    if (!isLoginRefreshCurrent(refreshProvider, refreshSeq)) return;
    document.getElementById('qr-status').textContent = '出错: ' + e.message;
    document.getElementById('qr-status').className = 'fail';
  }
}

function startQrPoll() {
  if (qrPollTimer) {
    clearInterval(qrPollTimer);
    clearTimeout(qrPollTimer);
  }
  if (loginProvider === 'qishui') {
    var generation = qishuiQrPollGeneration;
    qrPollTimer = setTimeout(function () { pollQishuiQr(generation); }, 1200);
    return;
  }
  qrPollTimer = setInterval(checkQr, 2000);
}

function stopQrPoll() {
  if (qrPollTimer) {
    clearInterval(qrPollTimer);
    clearTimeout(qrPollTimer);
    qrPollTimer = null;
  }
  qishuiQrPollGeneration += 1;
  qishuiQrPollBusy = false;
}

function scheduleQishuiQrPoll(generation, delay) {
  if (generation !== qishuiQrPollGeneration || loginProvider !== 'qishui' || !qrKey) return;
  if (qrPollTimer) clearTimeout(qrPollTimer);
  qrPollTimer = setTimeout(function () { pollQishuiQr(generation); }, Math.max(1000, Number(delay) || 4500));
}

async function pollQishuiQr(generation) {
  if (generation !== qishuiQrPollGeneration || loginProvider !== 'qishui' || !qrKey || qishuiQrPollBusy) return;
  qishuiQrPollBusy = true;
  var statusEl = document.getElementById('qr-status');
  var nextDelay = 4500;
  try {
    var result = await apiJson('/api/qishui/login/check?token=' + encodeURIComponent(qrKey) + '&t=' + Date.now());
    if (generation !== qishuiQrPollGeneration || loginProvider !== 'qishui') return;
    if (result && result.loggedIn) {
      stopQrPoll();
      qishuiLoginStatus = normalizeQishuiLoginStatus(result);
      activeAccountProvider = 'qishui';
      markLoginWorkflowConnected('qishui');
      renderUserBtn();
      if (statusEl) {
        statusEl.textContent = '登录成功！';
        statusEl.className = 'scan';
      }
      await refreshUserPlaylists(true);
      loadHomeDiscover(true);
      setTimeout(function () {
        closeLoginModal();
        showToast('汽水音乐已登录: ' + (qishuiLoginStatus.nickname || qishuiLoginStatus.userId || ''));
      }, 450);
      return;
    }
    var code = Number(result && (result.errorCode || result.error_code) || 0);
    var qrStatus = String(result && result.status || 'waiting');
    if (code === 2 || qrStatus === 'expired' || qrStatus === 'reauth_required' || result && result.reauthRequired) {
      stopQrPoll();
      if (statusEl) {
        statusEl.textContent = result && result.reauthRequired ? '登录状态已失效，请刷新二维码后重新扫码' : '二维码已过期，请刷新';
        statusEl.className = 'fail';
      }
      return;
    }
    if (qrStatus === 'verifying') {
      nextDelay = 8000;
      if (statusEl) {
        statusEl.textContent = '扫码已确认，正在重新验证账号连接…';
        statusEl.className = 'preview';
      }
    } else if (code === 7 || qrStatus === 'rate_limited') {
      nextDelay = Number(result && result.retryAfterMs) || 60000;
      if (statusEl) {
        statusEl.textContent = '请求较频繁，稍后自动继续检查…';
        statusEl.className = 'preview';
      }
    } else if (qrStatus === 'mfa_cancelled') {
      stopQrPoll();
      if (statusEl) {
        statusEl.textContent = '二次验证已取消，请刷新二维码后重试';
        statusEl.className = 'fail';
      }
      return;
    } else if (statusEl) {
      statusEl.textContent = qrStatus === 'scanned' || qrStatus === '2'
        ? '已扫码，请在手机确认…'
        : '等待扫码确认…';
      statusEl.className = qrStatus === 'scanned' || qrStatus === '2' ? 'scan' : '';
    }
  } catch (e) {
    nextDelay = 8000;
    console.warn('Qishui QR check failed:', e);
    if (statusEl) {
      statusEl.textContent = '登录状态检查失败，正在重试…';
      statusEl.className = 'fail';
    }
  } finally {
    qishuiQrPollBusy = false;
    scheduleQishuiQrPoll(generation, nextDelay);
  }
}
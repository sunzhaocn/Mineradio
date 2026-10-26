'use strict';


async function refreshKugouLoginStatus() {
  var managed = refreshManagedLocalLoginStatus('kugou');
  if (managed) return managed;
  try {
    var info = await apiJson('/api/kugou/login/status?t=' + Date.now());
    managed = refreshManagedLocalLoginStatus('kugou');
    if (managed) return managed;
    if (info && info.error && !info.reauthRequired) throw new Error(info.error);
    var prevLogged = !!kugouLoginStatus.loggedIn;
    kugouLoginStatus = normalizeKugouLoginStatus(info);
    auditProviderVipState('kugou', kugouLoginStatus);
    if (!kugouLoginStatus.loggedIn) {
      if (prevLogged || kugouLoginWasLoggedIn) showToast(kugouLoginStatus.stale ? '酷狗音乐登录已失效' : '酷狗音乐已掉登录');
      kugouPlaylists = [];
      userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'kugou'; });
      playlistCatalogRevision += 1;
      homeDiscoverState.loaded = false;
    } else if (!userPlaylists.some(function (pl) { return pl && pl.provider === 'kugou'; })) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
    } else if (kugouLoginStatus.stale) {
      showToast('酷狗音乐登录状态可能已失效');
    }
    kugouLoginWasLoggedIn = !!kugouLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return kugouLoginStatus;
  } catch (e) {
    managed = refreshManagedLocalLoginStatus('kugou');
    if (managed) return managed;
    console.warn('Kugou login status failed:', e);
    kugouLoginStatus = normalizeKugouLoginStatus(kugouLoginStatus && kugouLoginStatus.loggedIn
      ? Object.assign({}, kugouLoginStatus, {
        stale: true, membershipStale: true, membershipVerified: false,
        playbackReady: false, playbackKeyReady: false, authorizationIncomplete: true
      }) : null);
    renderUserBtn();
    return kugouLoginStatus;
  }
}

function startKugouLoginStatusAutoRefresh() {
  if (kugouLoginAutoRefreshTimer) clearInterval(kugouLoginAutoRefreshTimer);
  kugouLoginAutoRefreshTimer = setInterval(function () {
    refreshKugouLoginStatus().catch(function (e) { console.warn('Kugou login auto refresh failed:', e); });
  }, 45000);
}


function normalizeQishuiLoginStatus(info) {
  var fallback = { provider: 'qishui', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: '汽水音乐', userId: '', avatar: '', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, stale: false, playbackKeyReady: false, playbackMode: 'recommend-match', searchReady: false, publicCatalog: false };
  var configured = !!(info && (info.configured || info.loggedIn));
  var loggedIn = !!(info && info.loggedIn === true && info.webSession === true);
  var webSession = !!(loggedIn && info.webSession);
  var capabilities = info && info.capabilities || {};
  var searchReady = !!(configured || capabilities.search || info && info.publicCatalog);
  return Object.assign({}, fallback, info || {}, {
    provider: 'qishui',
    loggedIn: loggedIn,
    configured: configured,
    oauthConfigured: !!(info && (info.oauthConfigured || (info.oauth && info.oauth.configured))),
    oauthMissing: info && Array.isArray(info.oauthMissing) ? info.oauthMissing : [],
    userId: info && (info.userId || info.openId || info.open_id || info.tokenSource || info.scope || '') || '',
    nickname: info && info.nickname ? info.nickname : (webSession ? '汽水音乐账号' : (configured ? '汽水开放平台' : fallback.nickname)),
    avatar: info && info.avatar || '',
    vipType: Number(info && (info.vipType || info.vip_type) || 0) || 0,
    vipLevel: info && (info.vipLevel || info.vip_level) || 'none',
    isVip: !!(info && info.isVip),
    isSvip: !!(info && info.isSvip),
    playbackKeyReady: !!(webSession && capabilities.playableUrl && info.playbackKeyReady !== false && !info.stale && !info.reauthRequired),
    playbackMode: info && info.playbackMode || 'recommend-match',
    searchReady: searchReady,
    webSession: webSession,
    cookieReady: !!(info && info.cookieReady),
    tokenConfigured: !!(info && info.tokenConfigured),
    publicCatalog: !!(!configured && searchReady),
    stale: !!(info && info.stale)
  });
}

async function refreshQishuiLoginStatus() {
  var managed = refreshManagedLocalLoginStatus('qishui');
  if (managed) return managed;
  try {
    var info = await apiJson('/api/qishui/status?t=' + Date.now());
    managed = refreshManagedLocalLoginStatus('qishui');
    if (managed) return managed;
    if (info && info.error && !info.reauthRequired) throw new Error(info.error);
    var prevLogged = !!qishuiLoginStatus.loggedIn;
    qishuiLoginStatus = normalizeQishuiLoginStatus(info);
    auditProviderVipState('qishui', qishuiLoginStatus);
    if (!qishuiLoginStatus.loggedIn) {
      if (prevLogged || qishuiLoginWasLoggedIn) showToast(qishuiLoginStatus.reauthRequired ? '汽水音乐登录已失效，请重新扫码' : '汽水音乐授权已清除');
      qishuiPlaylists = [];
      userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'qishui'; });
      playlistCatalogRevision += 1;
      homeDiscoverState.loaded = false;
    } else if (!userPlaylists.some(function (pl) { return pl && pl.provider === 'qishui'; })) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
    }
    qishuiLoginWasLoggedIn = !!qishuiLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return qishuiLoginStatus;
  } catch (e) {
    managed = refreshManagedLocalLoginStatus('qishui');
    if (managed) return managed;
    console.warn('Qishui login status failed:', e);
    qishuiLoginStatus = normalizeQishuiLoginStatus(qishuiLoginStatus && qishuiLoginStatus.loggedIn
      ? Object.assign({}, qishuiLoginStatus, {
        stale: true, membershipStale: true, playbackKeyReady: false
      }) : null);
    renderUserBtn();
    return qishuiLoginStatus;
  }
}

function startQishuiLoginStatusAutoRefresh() {
  if (qishuiLoginAutoRefreshTimer) clearInterval(qishuiLoginAutoRefreshTimer);
  qishuiLoginAutoRefreshTimer = setInterval(function () {
    refreshQishuiLoginStatus().catch(function (e) { console.warn('Qishui login auto refresh failed:', e); });
  }, 45000);
}


function normalizeSpotifyLoginStatus(info) {
  var fallback = { provider: 'spotify', loggedIn: false, configured: false, oauthConfigured: false, oauthMissing: [], preview: false, nickname: 'Spotify', userId: '', accountId: '', avatar: '', product: '', membershipKnown: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, stale: false, reauthRequired: false, playbackKeyReady: false, playbackMode: 'recommend-match', tokenConfigured: false, tokenFileExists: false, credentialsFileExists: false, localConfigMissing: false, searchReady: false };
  var loggedIn = !!(info && info.loggedIn);
  var product = String(info && info.product || '').toLowerCase();
  var isPremium = loggedIn && product === 'premium';
  var capabilities = info && info.capabilities || {};
  return Object.assign({}, fallback, info || {}, {
    provider: 'spotify',
    loggedIn: loggedIn,
    configured: !!(info && (info.configured || loggedIn)),
    oauthConfigured: !!(info && info.oauthConfigured),
    oauthMissing: info && Array.isArray(info.oauthMissing) ? info.oauthMissing : [],
    nickname: info && (info.nickname || info.displayName || info.display_name) || fallback.nickname,
    userId: info && (info.userId || info.id) || '',
    accountId: info && (info.accountId || info.account_id) || '',
    avatar: info && info.avatar || '',
    product: product,
    membershipKnown: !!(info && (info.membershipKnown || product)),
    vipType: isPremium ? 1 : 0,
    vipLevel: isPremium ? 'vip' : 'none',
    isVip: isPremium,
    isSvip: false,
    tokenConfigured: !!(info && info.tokenConfigured),
    tokenFileExists: !!(info && info.tokenFileExists),
    credentialsFileExists: !!(info && info.credentialsFileExists),
    localConfigMissing: !!(info && info.localConfigMissing),
    playbackKeyReady: loggedIn,
    playbackMode: 'recommend-match',
    searchReady: !!(capabilities.search || info && info.searchReady),
    stale: !!(info && info.stale),
    reauthRequired: !!(info && info.reauthRequired)
  });
}

async function refreshSpotifyLoginStatus() {
  try {
    var info = await apiJson('/api/spotify/status?t=' + Date.now());
    var prevLogged = !!spotifyLoginStatus.loggedIn;
    spotifyLoginStatus = normalizeSpotifyLoginStatus(info);
    auditProviderVipState('spotify', spotifyLoginStatus);
    if (!spotifyLoginStatus.loggedIn) {
      if (prevLogged || spotifyLoginWasLoggedIn) showToast(spotifyLoginStatus.stale ? 'Spotify 登录已失效' : 'Spotify 已退出');
      spotifyPlaylists = [];
      userPlaylists = userPlaylists.filter(function (pl) { return pl.provider !== 'spotify'; });
      playlistCatalogRevision += 1;
      homeDiscoverState.loaded = false;
    } else if (!userPlaylists.some(function (pl) { return pl && pl.provider === 'spotify'; })) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
    }
    spotifyLoginWasLoggedIn = !!spotifyLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return spotifyLoginStatus;
  } catch (e) {
    console.warn('Spotify login status failed:', e);
    spotifyLoginStatus = normalizeSpotifyLoginStatus(null);
    renderUserBtn();
    return spotifyLoginStatus;
  }
}

function startSpotifyLoginStatusAutoRefresh() {
  if (spotifyLoginAutoRefreshTimer) clearInterval(spotifyLoginAutoRefreshTimer);
  spotifyLoginAutoRefreshTimer = setInterval(function () {
    refreshSpotifyLoginStatus().catch(function (e) { console.warn('Spotify login auto refresh failed:', e); });
  }, 45000);
}


function renderUserBtn() {
  var btn = document.getElementById('user-btn');
  if (!btn) return;
  var topRight = document.getElementById('top-right');
  if (topRight) topRight.classList.remove('account-pill-stack');
  btn.classList.remove('multi-account', 'external-account-pills', 'logged-in');
  btn.classList.add('logged-out', 'login-eye-avatar');
  btn.title = '账号与登录接入';
  btn.innerHTML = typeof loginEasterEggEyeMarkup === 'function'
    ? loginEasterEggEyeMarkup(true) : '<span class="login-word">登录</span>';
  if (typeof updateAccountPillGlassDisplacementMap === 'function') {
    requestAnimationFrame(updateAccountPillGlassDisplacementMap);
  }
  bindTopAccountPillSorting();
  if (typeof updateLoginNodeGraphUi === 'function') {
    requestAnimationFrame(updateLoginNodeGraphUi);
  }
  updatePlaybackQualityUi();
}

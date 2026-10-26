'use strict';



// Each browser owns its credentials. The server only relays the credentials
// attached to a request and never acts as a shared account store.
(function installLocalAccountLogin() {
  if (!window.MINERADIO_LOCAL_WEB) return;
  var providers = ['netease', 'qq', 'kugou', 'qishui'];
  var labels = { netease: '网易云音乐', qq: 'QQ 音乐', kugou: '酷狗音乐', qishui: '汽水音乐' };
  var shortLabels = { netease: '网易云', qq: 'QQ 音乐', kugou: '酷狗', qishui: '汽水' };
  var accounts = {}, STORE = 'mineradio-local-accounts-v1';
  var profileRequests = {}, profileAttempts = {};
  var PROFILE_SCHEMA = 2;
  var currentProvider = 'netease', phoneMode = 'sms', sessionKey = '', sessionDeadline = 0;
  var sessionManual = false, sessionInteractive = false;
  function nativeAccountLogin(provider) { return !!window.__mineradioIOS && providers.indexOf(provider) >= 0; }
  var actionEpoch = 0, pollTimer = 0, smsTimer = 0, smsNextAt = 0;
  var opened = false, busy = false, reauth = false, loginMode = 'official', ui = null;
  function storageDescription() { return window.__mineradioIOS ? '登录信息保存在这台设备中。' : 'Cookie 保存在当前浏览器，每次请求自动携带。'; }
  var clientId = '';

  var health = {}, healthTimer = 0;
  providers.forEach(function (provider) {
    health[provider] = window.MineradioSessionHealth.create({
      cookie: function () { return localAccount(provider).cookie || ''; },
      request: async function (force) {
        var url = '/api/local/account-status?provider=' + provider + (force ? '&force=1' : '');
        var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 25000);
        try {
          var response = await fetch(url, { cache: 'no-store', credentials: 'same-origin',
            signal: controller.signal, headers: window.localMusicCredentials.headers(url) });
          if (!response.ok) throw new Error('account-check-unavailable');
          return await response.json();
        } finally { clearTimeout(timeout); }
      },
      changed: function () {
        fetchStatuses(false);
        if (opened && currentProvider === provider && !busy && !reauth) renderAccountHealth();
      }
    });
  });
  function refreshHealth() {
    if (!document.hidden) providers.forEach(function (provider) { health[provider].refresh(false); });
  }
  function startHealthRefresh() {
    if (!healthTimer) healthTimer = setInterval(refreshHealth, 45000);
  }
  window.startQQLoginStatusAutoRefresh = startHealthRefresh;
  window.startKugouLoginStatusAutoRefresh = startHealthRefresh;
  window.startQishuiLoginStatusAutoRefresh = startHealthRefresh;

  function loginClientId() {
    if (clientId) return clientId;
    try { clientId = localStorage.getItem('mineradio-login-client-v1') || ''; } catch (_) { }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(clientId)) {
      clientId = window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID().replace(/-/g, '')
        : Array.from({ length: 4 }, function () { return Math.random().toString(36).slice(2).padEnd(8, '0'); }).join('').slice(0, 40);
      try { localStorage.setItem('mineradio-login-client-v1', clientId); } catch (_) { }
    }
    return clientId;
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(className, text, handler) {
    var node = element('button', className, text);
    node.type = 'button';
    if (handler) node.addEventListener('click', handler);
    return node;
  }
  function normalizeProvider(provider) { return providers.indexOf(provider) >= 0 ? provider : (provider === 'qqmusic' ? 'qq' : 'netease'); }
  function cleanText(value) { return String(value == null ? '' : value); }
  function decodeProfileText(value) {
    value = cleanText(value);
    for (var round = 0; round < 3; round++) {
      var before = value;
      try { value = decodeURIComponent(value); } catch (_) {}
      value = value.replace(/(?:%u|\\u)([0-9a-f]{4})/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); });
      if (value === before) break;
    }
    return value;
  }
  function safeAvatar(value) {
    if (!value || /[<>"'`\u0000-\u001f]/.test(String(value))) return '';
    try {
      var url = new URL(String(value).trim().replace(/^\/\//, 'https://'));
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.port && !/^(80|443)$/.test(url.port))) return '';
      if (/(^|\.)(qlogo\.cn|qpic\.cn|qq\.com)$/.test(url.hostname)) { url.protocol = 'https:'; if (url.port === '80') url.port = ''; }
      return url.href;
    } catch (_) { return ''; }
  }
  function qqAccountUin(account, cookie) {
    // qqmusic_uin / account.id identify the music account, not necessarily QQ.
    var explicit = account.qqUin || account.qq_uin || account.uin || '';
    if (!explicit) {
      var match = /(?:^|;)\s*p_uin\s*=\s*["']?(o?\d+)/.exec(cookie || '');
      explicit = match ? match[1] : '';
    }
    explicit = String(explicit).replace(/^o/, '').replace(/^0+/, '');
    return /^[1-9]\d{4,15}$/.test(explicit) ? explicit : '';
  }
  function report(message, kind) {
    if (!ui) return;
    ui.message.textContent = message || '';
    ui.message.dataset.kind = kind || '';
  }
  function errorMessage(error) { return error && error.message ? error.message : '连接暂时失败，请稍后重试。'; }
  function readStore() {
    try {
      var value = JSON.parse(localStorage.getItem(STORE) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }
  function localAccount(provider) {
    var value = readStore()[normalizeProvider(provider)];
    return value && typeof value.cookie === 'string' && value.cookie ? value : {};
  }
  function writeAccount(provider, value) {
    var data = readStore();
    if (value) data[provider] = value;
    else delete data[provider];
    try { localStorage.setItem(STORE, JSON.stringify(data)); }
    catch (_) { throw new Error('浏览器无法保存 Cookie，请允许本地存储后重试。'); }
    if (typeof window.dispatchEvent === 'function' && typeof Event === 'function') window.dispatchEvent(new Event('mineradio:accounts-changed'));
  }
  function credentialsFor(url, provider) {
    try {
      var target = new URL(url, window.location.origin);
      if (target.origin !== window.location.origin || !target.pathname.startsWith('/api/') || target.pathname.startsWith('/api/local/auth/')) return {};
      provider = provider || target.searchParams.get('provider') || target.searchParams.get('platform');
      if (!provider) {
        var match = target.pathname.match(/^\/api\/(qq|kugou|qishui)\//);
        if (match) provider = match[1];
        else if (/^\/api\/(?:search|song|lyric|login|album|artist)\b/.test(target.pathname)) provider = 'netease';
        var chart = (target.searchParams.get('id') || '').match(/^chart:([^:]+):/);
        if (chart) provider = chart[1];
      }
      var map = {};
      if (provider && providers.indexOf(provider) < 0 && provider !== 'qqmusic') return map;
      (provider ? [normalizeProvider(provider)] : providers).forEach(function (key) {
        var entry = localAccount(key);
        if (entry.cookie) map[key === 'qq' ? 'qqmusic' : key] = Object.assign({ cookie: entry.cookie }, entry.session_config ? { session_config: entry.session_config } : {});
      });
      return map;
    } catch (_) { return {}; }
  }
  window.localMusicCredentials = {
    read: localAccount,
    observeAccountStatus: function (data) {
      providers.forEach(function (provider) {
        var status = data && (data.providers && data.providers[provider] || data.provider === provider && data);
        if (status) health[provider].observe(status);
      });
    },
    status: savedProviderStatus,
    refresh: function (provider) { return refreshProvider(normalizeProvider(provider)); },
    all: function () { return credentialsFor('/api/local/catalog'); },
    headers: function (url) {
      var values = credentialsFor(url);
      return Object.keys(values).length ? { 'X-Music-Credentials': JSON.stringify(values) } : {};
    },
    url: function (url, provider) {
      var values = credentialsFor(url, provider);
      if (!Object.keys(values).length) return url;
      var target = new URL(url, window.location.origin);
      target.searchParams.set('credentials', JSON.stringify(values));
      return target.pathname + target.search + target.hash;
    }
  };
  async function request(path, body) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, path === 'session' && body && body.provider === 'qishui' ? 95000 : 55000);
    var options = { credentials: 'same-origin', cache: 'no-store', signal: controller.signal };
    if (body) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(Object.assign({}, body, { client_id: loginClientId() }));
    }
    try {
      var response = await fetch('/api/local/auth/' + path, options);
      var data;
      try { data = await response.json(); } catch (_) { throw new Error('登录服务返回异常，请稍后重试。'); }
      if (!response.ok || data.error || (Number(data.code) >= 400 && !data.status)) {
        var failure = new Error(data.message || data.msg || '登录服务暂时不可用。');
        failure.result = data;
        throw failure;
      }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('请求超时，请确认当前状态后手动重试。');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function normalizedStatus(provider, info) {
    info = info || {};
    var account = info.account || {}, qqUin = provider === 'qq' ? qqAccountUin(Object.assign({}, account, info), info.cookie) : '';
    return {
      provider: provider, loggedIn: info.loggedIn === true,
      authState: info.authState || 'unknown', reauthRequired: !!info.reauthRequired, checkFailed: !!info.checkFailed,
      configured: info.configured === true, localAuthManaged: true,
      userId: cleanText(info.userId || info.id), nickname: decodeProfileText(info.nickname || info.name || labels[provider]),
      avatar: safeAvatar(info.avatarUrl || info.avatar || account.avatarUrl || account.avatar || account.headurl || account.headpic),
      qqUin: qqUin, preview: false,
      // Presence of a local Cookie never establishes membership privileges.
      membershipKnown: false, membershipVerified: false, vipType: 0,
      vipLevel: 'none', isVip: false, isSvip: false,
      playbackKeyReady: info.loggedIn === true, webSession: provider === 'qishui' && info.loggedIn === true
    };
  }
  function applyStatuses(data) {
    var source = data && data.platforms;
    if (!source || typeof source !== 'object') throw new Error('账号状态返回异常。');
    providers.forEach(function (provider) { accounts[provider] = normalizedStatus(provider, source[provider]); });
    loginStatus = accounts.netease;
    qqLoginStatus = accounts.qq;
    kugouLoginStatus = accounts.kugou;
    qishuiLoginStatus = accounts.qishui;
    loginStatusChecked = true;
    loginStatusCheckFailed = false;
    qqLoginWasLoggedIn = qqLoginStatus.loggedIn;
    kugouLoginWasLoggedIn = kugouLoginStatus.loggedIn;
    qishuiLoginWasLoggedIn = qishuiLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    renderTabs();
  }
  function fetchStatuses(force) {
    var source = {};
    providers.forEach(function (provider) {
      source[provider] = savedProviderStatus(provider);
    });
    applyStatuses({ platforms: source });
    providers.forEach(function (provider) {
      var saved = localAccount(provider), account = saved.account || {};
      if (saved.source === 'manual' && cookieHasIdentity(provider, saved.cookie) &&
          (saved.profileSchema !== PROFILE_SCHEMA || !safeAvatar(account.avatar || account.avatarUrl) || !(account.name || account.nickname)) &&
          (saved.profileSchema !== PROFILE_SCHEMA || !saved.profileFetchedAt || Date.now() - saved.profileFetchedAt > 30 * 60 * 1000)) {
        refreshCookieProfile(provider, false);
      }
    });
    return typeof force === 'string' ? health[normalizeProvider(force)].refresh(true).then(function () { return accounts; }) : Promise.resolve(accounts);
  }
  function savedProviderStatus(provider) {
    provider = normalizeProvider(provider);
    var saved = localAccount(provider), account = saved.account || {};
    var session = health[provider].status();
    return normalizedStatus(provider, Object.assign({ loggedIn: !!saved.cookie, configured: !!saved.cookie, userId: account.id,
      nickname: account.name || account.nickname || labels[provider], account: account,
      qqUin: provider === 'qq' ? qqAccountUin(account, saved.cookie) : '', avatar: account.avatar || account.avatarUrl }, session));
  }
  function cookieHasIdentity(provider, cookie) {
    if (!cookie) return false;
    var names = { netease: /(?:^|;)\s*MUSIC_U\s*=\s*[^;\s]+/,
      qq: /(?:^|;)\s*(?:qqmusic_key|qm_keyst|wxmusickey|p_skey)\s*=\s*[^;\s]+/,
      kugou: /(?:^|;)\s*(?:KuGoo|kugou|token|Token|t)\s*=\s*[^;\s]+/,
      qishui: /(?:^|;)\s*(?:sessionid|sessionid_ss|sid_tt|sid_guard)\s*=\s*[^;\s]+/ };
    return names[provider].test(cookie);
  }
  function refreshCookieProfile(provider, force) {
    var saved = localAccount(provider), cookie = saved.cookie;
    if (!cookieHasIdentity(provider, cookie)) return Promise.resolve(false);
    var pending = profileRequests[provider], previous = profileAttempts[provider];
    if (pending && pending.cookie === cookie) return pending.promise;
    if (!force && previous && previous.cookie === cookie && Date.now() - previous.at < 5 * 60 * 1000) return Promise.resolve(false);
    profileAttempts[provider] = { cookie: cookie, at: Date.now() };
    var entry = { cookie: cookie }, controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 25000);
    var url = '/api/local/profile?provider=' + encodeURIComponent(provider);
    entry.promise = (async function () {
      try {
        var response = await fetch(url, { credentials: 'same-origin', cache: 'no-store',
          signal: controller.signal, headers: window.localMusicCredentials.headers(url) });
        var data = await response.json();
        if (!response.ok || data.error || data.provider !== provider || !data.account) throw new Error('profile-unavailable');
        var current = localAccount(provider);
        if (current.cookie !== cookie) return false;
        var account = Object.assign({}, current.account || {}), incoming = data.account;
        ['id', 'name', 'qqUin'].forEach(function (key) { if (typeof incoming[key] === 'string' && incoming[key]) account[key] = key === 'name' ? decodeProfileText(incoming[key]) : incoming[key]; });
        var avatar = safeAvatar(incoming.avatar || incoming.avatarUrl);
        if (avatar) account.avatar = avatar;
        if (!(account.name || account.avatar)) throw new Error('profile-empty');
        writeAccount(provider, Object.assign({}, current, { account: account, profileFetchedAt: Date.now(), profileSchema: PROFILE_SCHEMA }));
        await fetchStatuses(false);
        if (opened && currentProvider === provider && !reauth && !busy) {
          renderProvider();
          report('Cookie 已保存在当前浏览器，昵称与头像已更新。', 'success');
        }
        return true;
      } catch (_) {
        // Profile lookup is optional: an offline service must not erase a saved login.
        if (localAccount(provider).cookie === cookie && opened && currentProvider === provider && !reauth && !busy) {
          report('Cookie 已保存，昵称或头像暂时无法读取，可稍后重试。');
        }
        return false;
      } finally {
        clearTimeout(timer);
        if (profileRequests[provider] === entry) delete profileRequests[provider];
      }
    })();
    profileRequests[provider] = entry;
    return entry.promise;
  }
  function refreshProvider(provider) {
    return fetchStatuses(false).then(async function () {
      if (!document.hidden) await health[provider].refresh(false);
      return accounts[provider] || normalizedStatus(provider);
    }, function () {
      return accounts[provider] || normalizedStatus(provider);
    });
  }
  // Install before startup bindings so their initial calls and later refresh
  // intervals cannot replace local login state with the former desktop bridge.
  refreshLoginStatus = function () { return refreshProvider('netease'); };
  refreshQQLoginStatus = function () { return refreshProvider('qq'); };
  refreshKugouLoginStatus = function () { return refreshProvider('kugou'); };
  refreshQishuiLoginStatus = function () { return refreshProvider('qishui'); };
  refreshQQVipStatusNow = function () { return refreshProvider('qq'); };
  var previousVipBadge = providerVipBadge;
  providerVipBadge = function (provider, status) {
    if (status && status.localAuthManaged && status.membershipKnown !== true) return '';
    return previousVipBadge.apply(this, arguments);
  };

  function stopPending() {
    if(window.mineradioQishuiVerification)mineradioQishuiVerification.stop();
    actionEpoch += 1;
    clearTimeout(pollTimer);
    pollTimer = 0;
    sessionKey = '';
    sessionDeadline = 0;
    sessionManual = false;
    sessionInteractive = false;
    busy = false;
    if (typeof stopQrPoll === 'function') stopQrPoll();
  }
  function clearFields() {
    if (!ui) return;
    ui.phone.value = '';
    ui.password.value = '';
    ui.captcha.value = '';
    ui.cookie.value = '';
    ui.deviceId.value = '';
    ui.installId.value = '';
    ui.savedCookie.value = '';
  }
  function isCurrent(epoch, provider) { return opened && actionEpoch === epoch && currentProvider === provider; }
  function updatePhoneValidation() {
    if (!ui) return;
    var domestic = ui.country.value.trim() === '86';
    ui.phone.pattern = domestic ? '[0-9]{11}' : '[0-9]{5,15}';
    ui.phone.maxLength = domestic ? 11 : 15;
    ui.phone.title = domestic ? '请输入 11 位手机号' : '请输入 5 至 15 位手机号';
  }
  function rememberSession(result) {
    sessionKey = result.key;
    sessionManual = result.manual_login === true;
    sessionInteractive = result.interactive_window === true;
    var until = Number(result.expires_at || 0);
    if (until && until < 100000000000) until *= 1000;
    sessionDeadline = until || (Date.now() + Math.min(600, Number(result.expires_in) || 600) * 1000);
  }
  function forgetExpired(result) {
    if (result && (result.status === 'expired' || result.status === 'cancelled')) { sessionKey = ''; sessionDeadline = 0; }
  }
  function setBusy(value) {
    busy = value;
    if (!ui) return;
    ui.submit.disabled = value;
    ui.generate.disabled = value;
    ui.logout.disabled = value;
    ui.relogin.disabled = value;
    ui.qqMethod.disabled = value;
    ui.cookieSubmit.disabled = value;
    ui.copyCookie.disabled = value;
    if (ui.officialOpen) ui.officialOpen.disabled = value;
    updateSmsButton();
  }
  function updateSmsButton() {
    if (!ui) return;
    var seconds = Math.max(0, Math.ceil((smsNextAt - Date.now()) / 1000));
    ui.send.disabled = busy || seconds > 0;
    ui.send.textContent = seconds > 0 ? (seconds + ' 秒后重发') : '获取验证码';
  }
  function renderTabs() {
    if (!ui) return;
    providers.forEach(function (provider) {
      var state = accounts[provider] || {};
      ui.tabs[provider].classList.toggle('active', provider === currentProvider);
      ui.tabs[provider].setAttribute('aria-selected', provider === currentProvider ? 'true' : 'false');
      ui.tabStatus[provider].textContent = state.reauthRequired ? '已失效' : state.configured && state.authState === 'unknown' ? (state.checkFailed ? '检测失败' : '待检测') : state.loggedIn ? '已登录' : (state.configured ? '已配置' : '未登录');
      ui.tabStatus[provider].classList.toggle('expired', !!state.reauthRequired);
      ui.tabStatus[provider].classList.toggle('online', !!state.loggedIn);
    });
  }
  function renderAccountHealth() {
    if (!ui) return;
    var account = accounts[currentProvider] || {};
    ui.accountHealth.classList.toggle('expired', !!account.reauthRequired);
    ui.accountHealth.textContent = account.reauthRequired ? '登录已失效' : account.checkFailed ? '暂时无法检测，请稍后重试' : account.authState === 'valid' ? '登录正常' : '登录状态待检测';
    if (localAccount(currentProvider).cookie && !reauth) {
      ui.description.textContent = account.reauthRequired ? '登录已失效，请点击重新登录。' : storageDescription();
      if (account.reauthRequired) report('账号已失效，需要重新登录。', 'error');
      else if (ui.message && ui.message.textContent === '账号已失效，需要重新登录。') report(account.checkFailed ? '暂时无法检测，请稍后重试。' : '登录正常', account.checkFailed ? '' : 'success');
    }
  }
  function renderProvider() {
    var provider = currentProvider, account = accounts[provider] || {};
    var isPhone = provider === 'netease' && !window.__mineradioIOS, loggedIn = !!account.loggedIn, manual = loginMode === 'cookie';
    var nativeLogin = nativeAccountLogin(provider);
    var showSaved = !!localAccount(provider).cookie && !reauth;
    ui.root.dataset.provider = provider;
    ui.title.textContent = showSaved ? labels[provider] : ('登录' + labels[provider]);
    ui.description.textContent = showSaved
      ? (account.reauthRequired ? '登录已失效，请点击重新登录。' : storageDescription())
      : (manual ? '粘贴当前平台的 Cookie，保存到当前浏览器。' : (nativeLogin ? '在平台官方窗口使用账号密码或验证码登录，授权后回到播放器。' : isPhone ? '使用手机号和短信验证码，或账号密码登录。' : '二维码会自动生成，请扫码并在手机上确认登录。'));
    ui.account.hidden = !showSaved;
    ui.accountActions.hidden = !showSaved;
    ui.profileRefresh.hidden = localAccount(provider).source !== 'manual';
    ui.login.hidden = showSaved;
    ui.savedCredentials.hidden = !showSaved;
    ui.savedCookie.value = showSaved ? (localAccount(provider).cookie || '') : '';
    ui.phoneForm.hidden = !isPhone || manual;
    ui.qrPanel.hidden = isPhone || manual || nativeLogin;
    ui.officialBlock.hidden = !window.__mineradioIOS || manual || showSaved;
    ui.modeCookie.hidden = !!window.__mineradioIOS;
    ui.savedCredentials.hidden = !!window.__mineradioIOS || !showSaved;
    ui.officialOpen.textContent = nativeLogin ? '账号密码 / 验证码登录' : '使用官方窗口登录或完成验证';
    ui.cookieForm.hidden = !manual;
    ui.modeOfficial.textContent = nativeLogin ? '账号登录' : isPhone ? '手机号登录' : '扫码登录';
    ui.modeOfficial.classList.toggle('active', !manual);
    ui.modeCookie.classList.toggle('active', manual);
    ui.modeOfficial.setAttribute('aria-pressed', String(!manual));
    ui.modeCookie.setAttribute('aria-pressed', String(manual));
    ui.qishuiFields.hidden = provider !== 'qishui';
    ui.cookieHint.textContent = {
      netease: '粘贴网易云 Cookie 请求头内容，将随网易云请求发送。',
      qq: '粘贴 QQ 音乐 Cookie 请求头内容，将随 QQ 音乐请求发送。',
      kugou: '粘贴酷狗音乐 Cookie 请求头内容，将随酷狗请求发送。',
      qishui: '粘贴汽水 Cookie；需要设备参数时可填写同一会话的 device_id 和 install_id。'
    }[provider];
    ui.qqMethodLabel.hidden = provider !== 'qq' || nativeLogin;
    ui.qqMethod.hidden = provider !== 'qq' || nativeLogin;
    ui.configured.hidden = !account.configured || showSaved;
    ui.checkLogin.hidden = false;
    ui.accountHealth.hidden = false;
    renderAccountHealth();
    ui.avatar.onerror = function () {
      var fallback = provider === 'qq' && account.qqUin ? providerAvatarSrc(provider, { qqUin: account.qqUin }) : '';
      if (fallback && ui.avatar.src !== new URL(fallback, window.location.origin).href) ui.avatar.src = fallback;
      else { ui.avatar.onerror = null; ui.avatar.src = providerAvatarSrc(provider, {}); }
    };
    ui.avatar.src = providerAvatarSrc(provider, account);
    ui.accountName.textContent = account.nickname || labels[provider];
    ui.accountId.textContent = account.userId ? ('ID · ' + account.userId) : (window.__mineradioIOS ? '本机已保存登录信息' : '本地已保存 Cookie');
    ui.logout.textContent = '退出' + shortLabels[provider];
    if (!sessionKey) {
      ui.qrImage.hidden = true;
      ui.qrImage.removeAttribute('src');
      ui.qrPlaceholder.hidden = false;
      ui.qrPlaceholder.textContent = '正在准备二维码…';
    }
    ui.generate.textContent = '重新生成二维码';
    ui.smsFields.hidden = phoneMode !== 'sms';
    ui.passwordFields.hidden = phoneMode !== 'password';
    ui.modeSms.classList.toggle('active', phoneMode === 'sms');
    ui.modePassword.classList.toggle('active', phoneMode === 'password');
    ui.captcha.required = phoneMode === 'sms';
    ui.password.required = phoneMode === 'password';
    renderTabs();
    setBusy(busy);
    if (!sessionKey && !busy) report(showSaved ? (account.reauthRequired ? '账号已失效，需要重新登录。' : account.checkFailed ? '网络或平台暂时不可用，尚未确认登录失效。' : window.__mineradioIOS ? '已使用本机保存的登录信息。' : '已使用本地 Cookie，可直接查看和复制。') : '', account.reauthRequired ? 'error' : '');
    autoGenerateQr();
  }
  function autoGenerateQr() {
    if (!nativeAccountLogin(currentProvider) && opened && currentProvider !== 'netease' && loginMode === 'official' &&
        (!localAccount(currentProvider).cookie || reauth) && !sessionKey && !busy) generateQr();
  }
  function switchProvider(provider) {
    stopPending();
    clearFields();
    currentProvider = normalizeProvider(provider);
    loginProvider = currentProvider;
    reauth = false;
    loginMode = 'official';
    renderProvider();
    health[currentProvider].refresh(false);
  }
  function changeLoginMode(mode) {
    if (loginMode === mode) return;
    stopPending();
    clearFields();
    loginMode = mode;
    if (mode === 'cookie') reauth = true;
    renderProvider();
    if (mode === 'cookie') ui.cookie.focus();
  }
  async function ensureSession(epoch, provider) {
    if (sessionKey && Date.now() < sessionDeadline) return sessionKey;
    sessionKey = '';
    sessionDeadline = 0;
    var result = await request('session', { provider: provider, method: provider === 'qq' ? ui.qqMethod.value : undefined });
    if (!isCurrent(epoch, provider)) return '';
    if (!result.key) throw new Error(result.message || result.msg || '未能创建登录会话，请重试。');
    rememberSession(result);
    return sessionKey;
  }
  async function openOfficialLogin() {
    if (busy || !opened || loginMode !== 'official') return;
    var provider = currentProvider, epoch = actionEpoch;
    if (!sessionKey || !sessionManual || Date.now() >= sessionDeadline) {
      stopPending(); epoch = actionEpoch;
    }
    setBusy(true);
    try {
      ui.password.value = ''; ui.captcha.value = '';
      if (!sessionKey) {
        var created = await request('session', {provider:provider,method:'official'});
        if (!isCurrent(epoch,provider)) return;
        if (!created.key || created.manual_login !== true || created.interactive_window !== true) throw new Error('官方登录窗口未就绪，请重试。');
        rememberSession(created);
      }
      await request('show', {provider:provider,key:sessionKey});
      if (!isCurrent(epoch,provider)) return;
      report('请在官方窗口输入账号、密码或验证码，完成后返回此处。');
      clearTimeout(pollTimer);
      pollTimer = setTimeout(function () { pollQr(epoch,provider); },3000);
    } catch(error) { if (isCurrent(epoch,provider)) report(errorMessage(error),'error'); }
    finally { if (isCurrent(epoch,provider)) setBusy(false); }
  }
  async function onAuthorized(result, epoch, provider) {
    if(window.mineradioQishuiVerification)mineradioQishuiVerification.stop();
    if (!isCurrent(epoch, provider)) return;
    if (!result.cookie) throw new Error('本次登录未返回 Cookie，请重新登录。');
    writeAccount(provider, { cookie: result.cookie, account: result.account || {}, source: 'authorized',
      ...(result.session_config ? { session_config: result.session_config } : {}) });
    clearFields();
    clearTimeout(pollTimer);
    sessionKey = '';
    sessionDeadline = 0;
    await fetchStatuses(provider);
    if (!isCurrent(epoch, provider)) return;
    reauth = false;
    activeAccountProvider = provider;
    renderProvider();
    renderUserBtn();
    if (typeof showToast === 'function') showToast(labels[provider] + '登录成功');
  }
  function isAuthorized(result) { return result && (result.authorized === true || result.status === 'authorized') && typeof result.cookie === 'string' && !!result.cookie; }
  async function sendSms() {
    if (busy || Date.now() < smsNextAt) return;
    updatePhoneValidation();
    if (!ui.phone.reportValidity() || !ui.country.reportValidity()) return;
    if (sessionManual) stopPending();
    var provider = currentProvider, epoch = actionEpoch;
    var phone = ui.phone.value.trim(), country = ui.country.value.trim();
    setBusy(true);
    report('正在请求短信验证码…');
    try {
      var key = await ensureSession(epoch, provider);
      if (!key || !isCurrent(epoch, provider)) return;
      // Begin the local cooldown at send time, including uncertain network failures.
      smsNextAt = Date.now() + 60000;
      var result = await request('sms', { provider: provider, key: key, phone: phone, countrycode: country });
      if (!isCurrent(epoch, provider)) return;
      forgetExpired(result);
      var sent = result.sms_sent === true || result.status === 'sms_sent';
      report(result.message || result.msg || (sent ? '验证码已发送，请查看手机短信。' : '短信发送尚未确认，请检查安全验证提示后手动重试。'), sent ? 'success' : 'error');
    } catch (error) {
      if (isCurrent(epoch, provider)) { forgetExpired(error.result); report(errorMessage(error), 'error'); }
    } finally { phone = ''; country = ''; if (isCurrent(epoch, provider)) setBusy(false); }
  }
  async function submitPhone(event) {
    event.preventDefault();
    updatePhoneValidation();
    if (busy || !ui.phoneForm.reportValidity()) return;
    if (sessionManual) stopPending();
    var provider = currentProvider, epoch = actionEpoch;
    var payload = { provider: provider, phone: ui.phone.value.trim(), countrycode: ui.country.value.trim() };
    if (phoneMode === 'password') payload.password = ui.password.value;
    else payload.captcha = ui.captcha.value.trim();
    ui.password.value = '';
    ui.captcha.value = '';
    setBusy(true);
    report('正在登录，请稍候…');
    try {
      var key = await ensureSession(epoch, provider);
      if (!key || !isCurrent(epoch, provider)) return;
      payload.key = key;
      var result = await request('login', payload);
      if (!isCurrent(epoch, provider)) return;
      forgetExpired(result);
      if (isAuthorized(result)) await onAuthorized(result, epoch, provider);
      else report(result.message || result.msg || '尚未完成登录，请检查填写内容或完成官方安全验证。', 'error');
    } catch (error) {
      if (isCurrent(epoch, provider)) { forgetExpired(error.result); report(errorMessage(error), 'error'); }
    } finally {
      delete payload.password;
      delete payload.captcha;
      delete payload.phone;
      if (isCurrent(epoch, provider)) setBusy(false);
    }
  }
  async function submitCookie(event) {
    event.preventDefault();
    if (busy || loginMode !== 'cookie' || !ui.cookieForm.reportValidity()) return;
    var cookie = ui.cookie.value.trim().replace(/^cookie:\s*/i, '').trim();
    if (!cookie) { report('请先输入当前平台的 Cookie。', 'error'); return; }
    if (/[\x00-\x1f\x7f-\uffff]/.test(cookie)) { report('请粘贴单行 Cookie 请求头内容。', 'error'); return; }
    stopPending();
    var provider = currentProvider, epoch = actionEpoch;
    var payload = { cookie: cookie, source: 'manual', account: {} };
    var saved = localAccount(provider);
    if (provider === 'kugou' && saved.cookie === cookie) {
      // Reapplying this session must not discard its QR identity and trigger
      // an unnecessary restore. Keep both token/device fields byte-for-byte.
      payload = Object.assign({}, saved, payload, { account: Object.assign({}, saved.account || {}) });
      if (payload.account.name && safeAvatar(payload.account.avatar)) {
        payload.profileSchema = PROFILE_SCHEMA;
        payload.profileFetchedAt = Date.now();
      }
    }
    if (provider === 'qishui') {
      var previous = localAccount(provider).session_config || {};
      var query = Object.assign({}, previous.query || {});
      if (ui.deviceId.value.trim()) query.device_id = ui.deviceId.value.trim();
      if (ui.installId.value.trim()) query.iid = ui.installId.value.trim();
      payload.session_config = { headers: { cookie: cookie }, query: query };
    }
    setBusy(true);
    report('正在保存到当前浏览器…');
    try {
      writeAccount(provider, payload);
      clearFields();
      await fetchStatuses(provider);
      if (!isCurrent(epoch, provider)) return;
      reauth = false;
      activeAccountProvider = provider;
      renderProvider();
      report('Cookie 已保存在当前浏览器，后续请求将自动携带。', 'success');
      if (typeof showToast === 'function') showToast(labels[provider] + ' Cookie 已保存');
    } catch (error) {
      if (isCurrent(epoch, provider)) report(errorMessage(error), 'error');
    } finally {
      cookie = '';
      if (isCurrent(epoch, provider)) setBusy(false);
    }
  }
  async function copyCookie() {
    var provider = currentProvider, epoch = actionEpoch, value = ui.savedCookie.value;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrent(epoch, provider)) report('Cookie 已复制。', 'success');
    } catch (_) {
      if (isCurrent(epoch, provider)) { ui.savedCookie.focus(); ui.savedCookie.select(); report('请复制已选中的 Cookie。'); }
    }
  }
  function qrImageSource(result) {
    var src = result.qr_image || result.qrImage || '';
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(src)) return src;
    if (src.charAt(0) === '/' && src.charAt(1) !== '/') return src;
    try { var url = new URL(src); if (url.protocol === 'https:') return url.href; } catch (_) { }
    return '';
  }
  async function pollQr(epoch, provider) {
    if (!isCurrent(epoch, provider) || !sessionKey) return;
    try {
      var result = await request('check', { provider: provider, key: sessionKey });
      if (!isCurrent(epoch, provider)) return;
      if (isAuthorized(result)) { await onAuthorized(result, epoch, provider); return; }
      if(provider==='qishui'&&result.remote_verification&&result.verification_required&&window.mineradioQishuiVerification){
        ui.qrPanel.hidden=true;
        mineradioQishuiVerification.open(ui.login,function(input){return request('verify',{provider:provider,key:sessionKey,...(input?{input:input}:{})});},function(){return isCurrent(epoch,provider)&&!!sessionKey;});
      }
      if (window.__mineradioIOS && provider === 'qishui' && result.interactive_window && result.verification_required) {
        sessionInteractive = true;
        ui.officialBlock.hidden = false;
        ui.officialOpen.textContent = '打开安全验证窗口';
      }
      var terminal = result.status === 'expired' || result.status === 'cancelled' || result.status === 'failed';
      report(result.message || result.msg || (result.status === 'scanned' ? '已扫码，请在手机上确认登录。' : '等待扫码…'), terminal ? 'error' : '');
      if (terminal) { sessionKey = ''; sessionDeadline = 0; sessionManual = false; sessionInteractive = false;
        if(window.mineradioQishuiVerification)mineradioQishuiVerification.stop();
        if (provider === 'qishui') ui.officialBlock.hidden = true;
        ui.generate.textContent = '重新生成二维码'; return; }
      pollTimer = setTimeout(function () { pollQr(epoch, provider); }, 3000);
    } catch (error) {
      if (!isCurrent(epoch, provider)) return;
      if(window.mineradioQishuiVerification)mineradioQishuiVerification.stop();
      report(errorMessage(error), 'error');
      sessionKey = '';
      sessionDeadline = 0; sessionManual = false; sessionInteractive = false;
      if (provider === 'qishui') ui.officialBlock.hidden = true;
      ui.generate.textContent = '重新生成二维码';
    }
  }
  async function generateQr() {
    if (busy || !opened || currentProvider === 'netease' || loginMode !== 'official') return;
    stopPending();
    var epoch = actionEpoch, provider = currentProvider;
    setBusy(true);
    ui.qrImage.hidden = true;
    ui.qrImage.removeAttribute('src');
    ui.qrPlaceholder.hidden = false;
    ui.qrPlaceholder.textContent = '正在生成二维码…';
    report('正在生成二维码…');
    try {
      var result = await request('session', { provider: provider, method: provider === 'qq' ? ui.qqMethod.value : undefined });
      if (!isCurrent(epoch, provider)) return;
      var image = qrImageSource(result);
      if (!result.key || !image) throw new Error(result.message || result.msg || '未能生成二维码，请重试。');
      rememberSession(result);
      ui.qrImage.src = image;
      ui.qrImage.hidden = false;
      ui.qrPlaceholder.hidden = true;
      ui.generate.textContent = '重新生成二维码';
      var scanner = provider === 'qq' ? ({ qq: 'QQ', wechat: '微信', mobile: 'QQ 音乐 App' }[ui.qqMethod.value] || 'QQ')
        : (provider === 'qishui' ? '汽水音乐 App' : '酷狗音乐 App');
      report('请使用' + scanner + '扫码，并在手机上确认。');
      pollTimer = setTimeout(function () { pollQr(epoch, provider); }, 3000);
    } catch (error) {
      if (isCurrent(epoch, provider)) { ui.qrPlaceholder.textContent = '二维码生成失败，可点击下方按钮重试'; report(errorMessage(error), 'error'); }
    } finally { if (isCurrent(epoch, provider)) setBusy(false); }
  }
  async function logoutCurrent() {
    if (busy) return;
    stopPending();
    clearFields();
    var provider = currentProvider, epoch = actionEpoch;
    setBusy(true);
    report('正在退出当前平台…');
    try {
      writeAccount(provider, null);
      await fetchStatuses(provider);
      if (!isCurrent(epoch, provider)) return;
      reauth = false;
      renderProvider();
      report('已清除当前浏览器的' + labels[provider] + ' Cookie。');
    } catch (error) { if (isCurrent(epoch, provider)) report(errorMessage(error), 'error'); }
    finally { if (isCurrent(epoch, provider)) { setBusy(false); autoGenerateQr(); } }
  }
  function changePhoneMode(mode) {
    if (phoneMode === mode) return;
    stopPending();
    clearFields();
    phoneMode = mode;
    renderProvider();
  }
  function makeInput(type, placeholder, autocomplete) {
    var input = element('input');
    input.type = type;
    input.placeholder = placeholder;
    input.autocomplete = autocomplete || 'off';
    return input;
  }
  function labeled(parent, label, input) {
    var wrapper = element('label', 'local-auth-label', label);
    parent.appendChild(wrapper);
    wrapper.appendChild(input);
  }
  function buildUi() {
    if (ui) return;
    var mask = document.getElementById('login-modal');
    var panel = mask.querySelector('.dual-login-modal');
    mask.classList.add('local-auth-modal');
    mask.classList.remove('login-easter-egg-locked');
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-labelledby', 'local-auth-title');
    // The upstream backdrop handler captured its close function before this
    // module loaded. Intercept the backdrop so it also cancels our own session.
    mask.addEventListener('click', function (event) {
      if (event.target === mask) { event.stopImmediatePropagation(); closeLoginModal(); }
    }, true);
    var head = panel.querySelector('.login-panel-head');
    head.querySelector('b').textContent = '账号与登录';
    head.querySelector('small').textContent = '连接你的音乐账号';
    head.querySelector('.login-panel-close').setAttribute('aria-label', '关闭登录窗口');
    var root = element('section', 'local-auth');
    var tabs = element('div', 'local-auth-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '音乐平台');
    ui = { mask: mask, root: root, tabs: {}, tabStatus: {} };
    providers.forEach(function (provider) {
      var tab = button('', '', function () { switchProvider(provider); });
      tab.setAttribute('role', 'tab');
      tab.dataset.localProvider = provider;
      tab.appendChild(element('b', '', shortLabels[provider]));
      var status = element('small', '', '未登录');
      tab.appendChild(status);
      tabs.appendChild(tab);
      ui.tabs[provider] = tab; ui.tabStatus[provider] = status;
    });
    root.appendChild(tabs);
    ui.title = element('h2'); ui.title.id = 'local-auth-title'; root.appendChild(ui.title);
    ui.description = element('p', 'local-auth-description'); root.appendChild(ui.description);
    ui.configured = element('p', 'local-auth-configured', 'Cookie 保存在当前浏览器。'); root.appendChild(ui.configured);
    ui.account = element('div', 'local-auth-account');
    ui.avatar = element('img'); ui.avatar.alt = ''; ui.avatar.referrerPolicy = 'no-referrer'; ui.account.appendChild(ui.avatar);
    var identity = element('div'); ui.accountName = element('b'); ui.accountId = element('small'); ui.accountHealth = element('small', 'local-auth-health'); identity.append(ui.accountName, ui.accountId, ui.accountHealth); ui.account.appendChild(identity); root.appendChild(ui.account);
    ui.accountActions = element('div', 'local-auth-account-actions');
    ui.relogin = button('', '重新登录', function () { stopPending(); clearFields(); reauth = true; renderProvider(); });
    ui.profileRefresh = button('', '刷新昵称与头像', async function () {
      var provider = currentProvider;
      ui.profileRefresh.disabled = true;
      report('正在读取昵称与头像…');
      try {
        var updated = await refreshCookieProfile(provider, true);
        if (!updated && currentProvider === provider && !busy) report('Cookie 已保存，昵称或头像暂时无法读取，可稍后重试。');
      } finally { ui.profileRefresh.disabled = false; }
    });
    ui.checkLogin = button('', '检测登录', async function () { ui.checkLogin.disabled = true; try { await health[currentProvider].refresh(true); } finally { ui.checkLogin.disabled = false; } });
    ui.logout = button('local-auth-logout', '退出当前平台', logoutCurrent); ui.accountActions.append(ui.relogin, ui.checkLogin, ui.profileRefresh, ui.logout); root.appendChild(ui.accountActions);
    ui.savedCredentials = element('div'); ui.savedCookie = element('textarea'); ui.savedCookie.rows = 4; ui.savedCookie.readOnly = true; ui.savedCookie.spellcheck = false; ui.savedCookie.setAttribute('aria-label', '已保存的 Cookie'); labeled(ui.savedCredentials, '当前平台 Cookie', ui.savedCookie);
    ui.copyCookie = button('local-auth-primary', '复制 Cookie', copyCookie); ui.savedCredentials.appendChild(ui.copyCookie); root.appendChild(ui.savedCredentials);
    ui.login = element('div'); root.appendChild(ui.login);
    var loginModes = element('div', 'local-auth-mode');
    ui.modeOfficial = button('', '手机号登录', function () { changeLoginMode('official'); });
    ui.modeCookie = button('', '手动输入 Cookie', function () { changeLoginMode('cookie'); });
    loginModes.append(ui.modeOfficial, ui.modeCookie); ui.login.appendChild(loginModes);
    ui.phoneForm = element('form'); ui.phoneForm.addEventListener('submit', submitPhone);
    var mode = element('div', 'local-auth-mode');
    ui.modeSms = button('', '短信验证码', function () { changePhoneMode('sms'); });
    ui.modePassword = button('', '账号密码', function () { changePhoneMode('password'); }); mode.append(ui.modeSms, ui.modePassword); ui.phoneForm.appendChild(mode);
    var phoneRow = element('div', 'local-auth-field');
    ui.country = makeInput('tel', '区号', 'tel-country-code'); ui.country.value = '86'; ui.country.className = 'local-auth-country'; ui.country.required = true; ui.country.pattern = '[1-9][0-9]{0,3}'; ui.country.maxLength = 4; ui.country.setAttribute('aria-label', '国家区号');
    ui.phone = makeInput('tel', '请输入手机号', 'tel-national'); ui.phone.required = true; ui.phone.pattern = '[0-9]{11}'; ui.phone.maxLength = 11; ui.phone.setAttribute('aria-label', '手机号'); ui.country.addEventListener('input', updatePhoneValidation); phoneRow.append(ui.country, ui.phone); labeled(ui.phoneForm, '手机号', phoneRow);
    ui.smsFields = element('div');
    var smsRow = element('div', 'local-auth-field'); ui.captcha = makeInput('text', '短信验证码', 'one-time-code'); ui.captcha.inputMode = 'numeric'; ui.captcha.pattern = '[0-9]{4,8}'; ui.captcha.maxLength = 8; ui.captcha.setAttribute('aria-label', '短信验证码'); ui.send = button('local-auth-send', '获取验证码', sendSms); smsRow.append(ui.captcha, ui.send); labeled(ui.smsFields, '验证码', smsRow); ui.phoneForm.appendChild(ui.smsFields);
    ui.passwordFields = element('div'); ui.password = makeInput('password', '请输入账号密码', 'current-password'); ui.password.maxLength = 256; ui.password.setAttribute('aria-label', '账号密码'); labeled(ui.passwordFields, '密码', ui.password); ui.phoneForm.appendChild(ui.passwordFields);
    ui.submit = element('button', 'local-auth-primary', '登录网易云音乐'); ui.submit.type = 'submit'; ui.phoneForm.appendChild(ui.submit); ui.login.appendChild(ui.phoneForm);
    ui.officialBlock = element('div');
    ui.officialOpen = button('local-auth-primary', '账号登录', openOfficialLogin);
    ui.officialOpen.id = 'local-auth-open-official';
    ui.officialBlock.appendChild(ui.officialOpen);
    ui.officialBlock.appendChild(element('p','local-auth-footnote','账号密码和安全验证码只在对应平台的官方窗口输入。'));
    ui.login.appendChild(ui.officialBlock);
    ui.qrPanel = element('div'); ui.qqMethodLabel = element('label', 'local-auth-label', '扫码方式'); ui.qqMethodLabel.htmlFor = 'local-auth-qq-method'; ui.qqMethod = element('select'); ui.qqMethod.id = 'local-auth-qq-method';
    [['qq', '使用 QQ 扫码'], ['wechat', '使用微信扫码'], ['mobile', '使用 QQ 音乐 App 扫码']].forEach(function (entry) { var option = element('option', '', entry[1]); option.value = entry[0]; ui.qqMethod.appendChild(option); });
    ui.qqMethod.addEventListener('change', function () { stopPending(); renderProvider(); }); ui.qrPanel.append(ui.qqMethodLabel, ui.qqMethod);
    var qr = element('div', 'local-auth-qr'); ui.qrImage = element('img'); ui.qrImage.alt = '本次登录二维码'; ui.qrImage.referrerPolicy = 'no-referrer'; ui.qrPlaceholder = element('div', 'local-auth-qr-placeholder', '正在准备二维码…'); ui.generate = button('local-auth-primary', '重新生成二维码', generateQr); qr.append(ui.qrImage, ui.qrPlaceholder, ui.generate); ui.qrPanel.appendChild(qr); ui.login.appendChild(ui.qrPanel);
    ui.cookieForm = element('form'); ui.cookieForm.autocomplete = 'off'; ui.cookieForm.addEventListener('submit', submitCookie);
    ui.cookie = element('textarea'); ui.cookie.id = 'local-auth-cookie'; ui.cookie.rows = 5; ui.cookie.required = true; ui.cookie.maxLength = 65536; ui.cookie.autocomplete = 'off'; ui.cookie.spellcheck = false; ui.cookie.placeholder = '例如：name=value; name2=value2'; ui.cookie.setAttribute('aria-label', '登录 Cookie'); labeled(ui.cookieForm, '登录 Cookie', ui.cookie);
    ui.cookieHint = element('p', 'local-auth-footnote'); ui.cookieForm.appendChild(ui.cookieHint);
    ui.qishuiFields = element('div'); ui.deviceId = makeInput('text', 'device_id（按需填写）'); ui.deviceId.maxLength = 128; ui.deviceId.setAttribute('aria-label', '设备 ID'); labeled(ui.qishuiFields, '设备 ID（device_id）', ui.deviceId);
    ui.installId = makeInput('text', 'install_id（可选）'); ui.installId.maxLength = 128; ui.installId.setAttribute('aria-label', '安装 ID'); labeled(ui.qishuiFields, '安装 ID（install_id，可选）', ui.installId); ui.cookieForm.appendChild(ui.qishuiFields);
    ui.cookieSubmit = element('button', 'local-auth-primary', '保存并应用 Cookie'); ui.cookieSubmit.type = 'submit'; ui.cookieForm.appendChild(ui.cookieSubmit); ui.cookieForm.appendChild(element('p', 'local-auth-footnote', 'Cookie 只保存在当前浏览器，读取昵称与头像时随请求发送到对应平台。')); ui.login.appendChild(ui.cookieForm);
    ui.message = element('p', 'local-auth-message'); ui.message.setAttribute('role', 'status'); ui.message.setAttribute('aria-live', 'polite'); root.appendChild(ui.message);
    root.appendChild(element('p', 'local-auth-footnote', window.__mineradioIOS ? '各平台账号分别保存在本机，切换平台互不影响。' : 'Cookie 随每次平台请求发送，切换平台互不影响。'));
    panel.appendChild(root);
    smsTimer = setInterval(updateSmsButton, 1000);
    document.addEventListener('keydown', function (event) {
      if (opened && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeLoginModal(); }
    }, true);
  }
  showLoginModal = function (options) {
    options = options || {};
    buildUi();
    opened = true;
    fetchStatuses(false);
    switchProvider(options.provider || loginProvider || 'netease');
    openGsapModal(ui.mask);
  };
  closeLoginModal = function () {
    opened = false;
    stopPending();
    clearFields();
    if (ui) { ui.qrImage.removeAttribute('src'); closeGsapModal(ui.mask); }
  };
  setLoginProvider = function (provider) { if (ui && opened) switchProvider(provider); else loginProvider = normalizeProvider(provider); };
  selectLoginProviderNode = function (provider) { if (ui && opened) switchProvider(provider); else showLoginModal({ provider: provider }); };
  logoutActiveAccount = function () { showLoginModal({ provider: activeAccountProvider }); };
  showUserModal = function () { showLoginModal({ provider: activeAccountProvider }); };
  // Avoid ever exposing the old desktop-only multi-account clear/reset action.
  logoutAllAccountsAndResetEasterEgg = function () { showLoginModal({ provider: activeAccountProvider }); };
  document.addEventListener('visibilitychange', refreshHealth);
  window.addEventListener('storage', function (event) {
    if (event.key !== STORE) return;
    stopPending(); clearFields(); fetchStatuses(false);
    if (opened) renderProvider();
  });
}());

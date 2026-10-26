'use strict';


function updateLoginProviderCapsuleStatus(provider, btn) {
  var st = platformStatus(provider) || {};
  var meta = platformMeta(provider);
  var handle = btn.querySelector('.login-provider-sort-handle');
  if (!handle) {
    handle = document.createElement('span');
    handle.className = 'login-provider-sort-handle';
    handle.innerHTML = '<i></i><i></i><i></i>';
    btn.insertBefore(handle, btn.firstChild);
  }
  handle.setAttribute('data-login-provider-sort', provider);
  handle.setAttribute('title', 'Drag to sort');
  handle.setAttribute('aria-label', 'Drag to sort');
  var logo = btn.querySelector('.provider-logo');
  if (logo) {
    if (st.loggedIn) {
      logo.classList.add('has-avatar');
      logo.innerHTML = '<img src="' + providerAvatarSrc(provider, st) + '" alt="">';
    } else {
      logo.classList.remove('has-avatar');
      logo.textContent = meta.short;
    }
  }
  var badge = btn.querySelector('.login-provider-state-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'login-provider-state-badge';
    btn.appendChild(badge);
  }
  var externalSwitch = btn.querySelector('.login-provider-external-switch');
  if (!externalSwitch) {
    externalSwitch = document.createElement('span');
    externalSwitch.className = 'login-provider-external-switch';
    btn.appendChild(externalSwitch);
  }
  externalSwitch.removeAttribute('aria-hidden');
  externalSwitch.setAttribute('role', 'switch');
  externalSwitch.setAttribute('tabindex', '0');
  externalSwitch.setAttribute('data-login-provider-external', provider);
  externalSwitch.setAttribute('aria-label', '展示到右上角账号胶囊');
  externalSwitch.setAttribute('aria-checked', isAccountProviderExternallyVisible(provider) ? 'true' : 'false');
  if (!externalSwitch.querySelector('.login-provider-external-label')) {
    externalSwitch.innerHTML = '<span class="login-provider-external-label">展示</span><i></i>';
  }
  if (!externalSwitch.__loginProviderExternalBound) {
    externalSwitch.__loginProviderExternalBound = true;
    externalSwitch.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
    });
    externalSwitch.addEventListener('click', function (e) {
      handleLoginProviderExternalSwitchEvent(e, externalSwitch.getAttribute('data-login-provider-external') || provider);
    });
    externalSwitch.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      handleLoginProviderExternalSwitchEvent(e, externalSwitch.getAttribute('data-login-provider-external') || provider);
    });
  }
  externalSwitch.title = isAccountProviderExternallyVisible(provider) ? '已在右上角展示，点击关闭' : '未在右上角展示，点击开启';
  var label = loginProviderVipLabel(provider, st);
  var level = providerVipLevel(provider, st);
  badge.textContent = label;
  badge.className = 'login-provider-state-badge ' + (st.loggedIn ? (level === 'none' ? 'normal' : level) : 'hidden');
}

function bindLoginWorkflowPointerEvents() {
  var graph = document.getElementById('login-node-graph');
  if (!graph || graph._workflowBound) return;
  graph._workflowBound = true;
  graph.addEventListener('pointerdown', function (e) {
    var sortHandle = e.target && e.target.closest ? e.target.closest('[data-login-provider-sort]') : null;
    if (sortHandle && graph.contains(sortHandle)) {
      var sortNode = sortHandle.closest('.login-node-providers [data-login-provider]');
      var sortProvider = sortNode && sortNode.getAttribute('data-login-provider') || sortHandle.getAttribute('data-login-provider-sort') || '';
      if (!sortProvider) return;
      sortProvider = normalizeLoginProviderKey(sortProvider);
      if (sortProvider !== loginProvider) setLoginProvider(sortProvider, true);
      loginProviderPointer = {
        provider: sortProvider,
        node: sortNode,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false
      };
      if (sortNode) sortNode.classList.add('sorting');
      graph.classList.add('sorting-provider');
      loginProviderClickSuppressed = true;
      try { graph.setPointerCapture(e.pointerId); } catch (_) { }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    var port = e.target && e.target.closest ? e.target.closest('.flow-port.out') : null;
    if (!port || !graph.contains(port)) return;
    var providerNode = port.closest('.login-node-providers [data-login-provider]');
    var provider = port.getAttribute('data-login-provider-output') || (providerNode && providerNode.getAttribute('data-login-provider')) || '';
    if (!provider) return;
    if (provider !== loginProvider) setLoginProvider(provider, true);
    loginProviderClickSuppressed = true;
    startLoginWorkflowPointerDrag(graph, { provider: provider, port: port }, e);
    try { graph.setPointerCapture(e.pointerId); } catch (_) { }
    e.preventDefault();
    e.stopPropagation();
  });
  graph.addEventListener('pointermove', function (e) {
    if (!loginProviderPointer && !loginWorkflowDrag) return;
    e.preventDefault();
    if (loginProviderPointer) {
      var dx = e.clientX - loginProviderPointer.startX;
      var dy = e.clientY - loginProviderPointer.startY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (!loginProviderPointer.dragging && dist < 5) return;
      loginProviderPointer.dragging = true;
      if (loginProviderPointer.node) loginProviderPointer.node.classList.add('sorting');
      graph.classList.add('sorting-provider');
      loginProviderClickSuppressed = true;
      var beforeProvider = beforeLoginProviderForPointer(e.clientY);
      if (beforeProvider !== loginProviderPointer.provider && shouldMoveLoginProviderBefore(loginProviderPointer.provider, beforeProvider)) {
        moveAccountProviderBefore(loginProviderPointer.provider, beforeProvider);
        updateLoginProviderUi();
      }
      return;
    }
    if (!loginWorkflowDrag) return;
    var point = workflowPointFromEvent(e, graph);
    graph.classList.toggle('drop-ready', loginWorkflowNearMr(point, graph));
    renderLoginWorkflowEdges(point);
  });
  graph.addEventListener('pointerup', finishLoginProviderPointer);
  graph.addEventListener('pointercancel', function (e) {
    if (loginProviderPointer && loginProviderPointer.node) loginProviderPointer.node.classList.remove('sorting');
    loginProviderPointer = null;
    loginWorkflowDrag = null;
    graph.classList.remove('dragging-line', 'drop-ready', 'sorting-provider');
    try { graph.releasePointerCapture(e.pointerId); } catch (_) { }
    scheduleLoginWorkflowEdges('pointer-cancel');
  });
  if (!bindLoginWorkflowPointerEvents._resizeBound) {
    bindLoginWorkflowPointerEvents._resizeBound = true;
    window.addEventListener('resize', function () { scheduleLoginWorkflowEdges('resize'); });
    window.addEventListener('orientationchange', function () { scheduleLoginWorkflowEdges('orientation'); });
  }
}

function updateLoginNodeGraphUi() {
  var graph = document.getElementById('login-node-graph');
  if (graph) graph.setAttribute('data-provider', loginProvider);
  syncAccountProviderOrderUi();
  var connected = syncLoginWorkflowConnectionsFromStatus();
  loginWorkflowProviderOrder().forEach(function (provider) {
    var btn = document.getElementById('login-provider-' + provider);
    if (!btn) return;
    updateLoginProviderCapsuleStatus(provider, btn);
    btn.classList.toggle('active', provider === loginProvider);
    btn.classList.toggle('external-on', isAccountProviderExternallyVisible(provider));
    btn.classList.toggle('connected', connected.indexOf(provider) >= 0);
    btn.classList.toggle('pending', loginWorkflowPendingProvider === provider && connected.indexOf(provider) < 0);
  });
  var official = document.getElementById('login-mode-official');
  var cookie = document.getElementById('login-mode-cookie');
  var officialText = loginProviderOfficialModeText(loginProvider);
  if (official) {
    var title = official.querySelector('b');
    var sub = official.querySelector('small');
    if (title) title.textContent = officialText.title;
    if (sub) sub.textContent = officialText.sub;
    official.disabled = false;
    official.classList.toggle('active', !isManualCookieOpenForProvider(loginProvider));
  }
  if (cookie) {
    var cookieTitle = cookie.querySelector('b');
    var cookieSub = cookie.querySelector('small');
    if (cookieTitle) cookieTitle.textContent = 'Cookie';
    if (cookieSub) cookieSub.textContent = loginProviderSupportsCookieMode(loginProvider) ? '连接后打开手动导入' : '该平台不支持 Cookie 导入';
    cookie.disabled = !loginProviderSupportsCookieMode(loginProvider);
    cookie.classList.toggle('active', isManualCookieOpenForProvider(loginProvider));
  }
  var copy = graph && graph.querySelector('.login-node-copy');
  if (copy) {
    var meta = platformMeta(loginProvider);
    var copySub = copy.querySelector('small');
    var connectedCount = connected.length;
    if (copySub) copySub.textContent = hasLoginWorkflowConnection(loginProvider)
      ? ((meta && meta.label || loginProvider) + ' 已接入 / 共 ' + connectedCount + ' 个接口')
      : (loginWorkflowPendingProvider === loginProvider
        ? ((meta && meta.label || loginProvider) + ' 待登录确认')
        : (connectedCount ? ('已接入 ' + connectedCount + ' 个接口，拖入当前接口可继续添加') : '把左侧接口拖入这里'));
  }
  scheduleLoginWorkflowEdges('node-ui');
}

function connectLoginProvider(provider) {
  selectLoginProviderNode(provider);
}

function selectLoginMode(mode) {
  if (mode === 'cookie' && !loginProviderSupportsCookieMode(loginProvider)) {
    showToast(loginProvider === 'qishui' ? '汽水音乐仅使用官方扫码登录' : 'Spotify 使用官方 OAuth 登录');
    return;
  }
  setManualCookieOpenForProvider(loginProvider, mode === 'cookie');
  updateLoginProviderUi();
  setLoginAuthDrawerOpen(hasLoginWorkflowConnection(loginProvider) || loginWorkflowPendingProvider === loginProvider);
}

function startSelectedLoginConnection() {
  if (!hasLoginWorkflowConnection(loginProvider) && loginWorkflowPendingProvider !== loginProvider) {
    showToast('先把左侧接口拖到 MR 接入口');
    return;
  }
  setLoginAuthDrawerOpen(true);
  connectLoginMode(loginWorkflowActiveMode());
}

function connectLoginMode(mode) {
  setLoginAuthDrawerOpen(true);
  markLoginNodeConnecting();
  if (loginProvider === 'spotify') {
    setManualCookieOpenForProvider('spotify', false);
    updateLoginProviderUi();
    scheduleSpotifySetupAutoCheck();
    return;
  }
  if (mode === 'cookie') {
    if (!loginProviderSupportsCookieMode(loginProvider)) {
      showToast(loginProvider === 'qishui' ? '汽水音乐仅使用官方扫码登录' : 'Spotify 使用官方 OAuth 登录');
      return;
    }
    setManualCookieOpenForProvider(loginProvider, true);
    updateLoginProviderUi();
    var input = document.getElementById('qq-cookie-input');
    if (input) setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }, 80);
    return;
  }
  setManualCookieOpenForProvider(loginProvider, false);
  updateLoginProviderUi();
  setTimeout(openProviderWebLogin, 120);
}

function providerCookieExportLabel(provider) {
  provider = normalizeLoginProviderKey(provider);
  var meta = platformMeta(provider);
  return meta && meta.label || (provider === 'spotify' ? 'Spotify' : provider);
}

function offerLoginCookieExport(provider, info) {
  provider = normalizeLoginProviderKey(provider);
  if (!hasPlatformLogin(provider) && !(info && info.loggedIn)) return;
  markLoginWorkflowConnected(provider);
  updateLoginNodeGraphUi();
  pendingCookieExportProvider = provider;
  var label = providerCookieExportLabel(provider);
  var prompt = document.getElementById('cookie-export-prompt');
  var title = document.getElementById('cookie-export-title');
  var desc = document.getElementById('cookie-export-desc');
  if (title) title.textContent = '是否导出 ' + label + ' 登录 cookie 到桌面？';
  if (desc) desc.textContent = '文件名会保存为“' + label + '_登录cookie.txt”，用于备份当前平台登录态。';
  if (prompt) prompt.classList.add('show');
}

function dismissCookieExportPrompt() {
  pendingCookieExportProvider = '';
  var prompt = document.getElementById('cookie-export-prompt');
  if (prompt) prompt.classList.remove('show');
}

async function confirmCookieExportPrompt() {
  var provider = pendingCookieExportProvider;
  dismissCookieExportPrompt();
  if (!provider) return;
  var api = window.desktopWindow;
  if (!api || typeof api.exportLoginCookie !== 'function') {
    showToast('桌面版才支持导出登录 cookie');
    return;
  }
  try {
    var result = await api.exportLoginCookie(provider);
    if (result && result.ok) showToast('登录 cookie 已导出到桌面');
    else showToast((result && (result.message || result.error)) || '没有可导出的登录 cookie');
  } catch (e) {
    showToast('导出登录 cookie 失败');
  }
}


async function showLoginModal(opts) {
  opts = opts || {};
  loginProvider = opts.provider ? normalizeLoginProviderKey(opts.provider) : 'netease';
  var modal = document.getElementById('login-modal');
  if (typeof setLoginEasterEggMode === 'function' &&
      (!loginEasterEggState || !loginEasterEggState.ready || !loginEasterEggState.unlocked)) {
    setLoginEasterEggMode(true);
  }
  openGsapModal(modal);
  var unlocked = typeof prepareLoginEasterEggGate === 'function'
    ? await prepareLoginEasterEggGate()
    : true;
  if (!unlocked) return;
  resumeLoginModalAfterGate();
}

function resumeLoginModalAfterGate() {
  bindLoginWorkflowPointerEvents();
  setLoginAuthDrawerOpen(false);
  updateLoginProviderUi();
  scheduleLoginWorkflowEdges('open');
}

function closeLoginModal() {
  stopQrPoll();
  setLoginAuthDrawerOpen(false);
  closeGsapModal(document.getElementById('login-modal'));
}

function setLoginProvider(provider, silent) {
  loginProvider = normalizeLoginProviderKey(provider);
  loginRefreshRequestSeq += 1;
  updateLoginProviderUi();
  if (!silent && document.getElementById('login-modal').classList.contains('show')) refreshQr();
}

function qishuiPublicSearchReady() {
  return !!(qishuiLoginStatus && (qishuiLoginStatus.searchReady || qishuiLoginStatus.publicCatalog));
}

function qishuiLoginStatusText(info) {
  info = info || qishuiLoginStatus || {};
  if (info.reauthRequired) return '汽水音乐登录已失效，请使用抖音 App 重新扫码';
  if (info.stale) return '汽水音乐连接暂时不可用，账号与会员状态待同步';
  if (info.webSession) return '汽水音乐已登录 · 可同步我的喜欢、歌单并按账号权益播放';
  return '请使用抖音 App 扫描二维码并确认登录';
}

function spotifyLoginStatusText(info) {
  info = info || spotifyLoginStatus || {};
  if (info.loggedIn) return 'Spotify 已连接 / ' + (info.product === 'premium' ? 'Premium' : (info.product ? String(info.product).toUpperCase() : '方案未知')) + ' / 可同步歌单和 Liked Songs';
  if (info.reauthRequired) return 'Spotify 长期授权已到期，请重新连接官方 OAuth';
  if (info.stale) return 'Spotify 登录已过期，请重新连接官方 OAuth';
  if (info.localConfigMissing) return 'Spotify 未连接：粘贴 Spotify Client ID 后点击“保存并授权”';
  if (info.oauthConfigured) return 'Spotify Client ID 已保存，点击“连接 Spotify”打开官方授权窗口';
  if (info.configured || info.searchReady) return 'Spotify 搜索已可用；登录后可同步会员状态、歌单和红心歌单';
  var missing = info.oauthMissing && info.oauthMissing.length ? (' 缺少: ' + info.oauthMissing.join(', ')) : '';
  return '粘贴 Spotify Client ID，并在 Spotify Developer Dashboard 登记回调地址 http://127.0.0.1:43879/callback' + missing;
}
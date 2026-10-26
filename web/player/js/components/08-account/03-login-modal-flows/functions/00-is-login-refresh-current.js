'use strict';



function isLoginRefreshCurrent(provider, seq) {
  return loginProvider === provider && loginRefreshRequestSeq === seq;
}


function normalizeLoginProviderKey(provider) {
  return provider === 'qq' ? 'qq' : (provider === 'kugou' ? 'kugou' : (provider === 'qishui' ? 'qishui' : 'netease'));
}

function loginProviderSupportsCookieMode(provider) {
  provider = normalizeLoginProviderKey(provider);
  return provider !== 'spotify' && provider !== 'qishui';
}

function loginProviderOfficialModeText(provider) {
  provider = normalizeLoginProviderKey(provider);
  if (provider === 'spotify') return { title: 'OAuth', sub: '弹出 Spotify 授权窗口' };
  if (provider === 'qishui') return { title: '扫码', sub: '使用抖音 App 官方授权' };
  if (provider === 'kugou') return { title: '官网', sub: '弹出酷狗官方窗口' };
  return { title: '扫码', sub: '连接后弹出官方窗口' };
}

function setManualCookieOpenForProvider(provider, open) {
  provider = normalizeLoginProviderKey(provider);
  if (provider === 'netease') neteaseManualCookieOpen = !!open;
  else if (provider === 'qq') qqManualCookieOpen = !!open;
  else if (provider === 'kugou') kugouManualCookieOpen = !!open;
  else if (provider === 'qishui') qishuiManualCookieOpen = false;
}

function isManualCookieOpenForProvider(provider) {
  provider = normalizeLoginProviderKey(provider);
  if (provider === 'netease') return !!neteaseManualCookieOpen;
  if (provider === 'qq') return !!qqManualCookieOpen;
  if (provider === 'kugou') return !!kugouManualCookieOpen;
  if (provider === 'qishui') return false;
  return false;
}

function readLoginWorkflowConnections() {
  try { localStorage.removeItem(LOGIN_WORKFLOW_CONNECTION_STORE_KEY); } catch (e) { }
  return [];
}

function saveLoginWorkflowConnections(list) {
  try { localStorage.removeItem(LOGIN_WORKFLOW_CONNECTION_STORE_KEY); } catch (e) { }
}

function providerHasLiveLogin(provider) {
  provider = normalizeLoginProviderKey(provider);
  if (loginWorkflowVerifiedSession && loginWorkflowVerifiedSession[provider]) return true;
  try { return typeof hasPlatformLogin === 'function' && hasPlatformLogin(provider); } catch (e) { return false; }
}

function loginWorkflowConnectedProviders() {
  return loginWorkflowProviderOrder().filter(providerHasLiveLogin);
}

function loginWorkflowProviderOrder() {
  try { return accountProviderOrder(); } catch (e) { return LOGIN_WORKFLOW_PROVIDERS.slice(); }
}

function syncLoginWorkflowConnectionsFromStatus() {
  saveLoginWorkflowConnections([]);
  return loginWorkflowConnectedProviders();
}

function hasLoginWorkflowConnection(provider) {
  provider = normalizeLoginProviderKey(provider);
  return loginWorkflowConnectedProviders().indexOf(provider) >= 0;
}

function markLoginWorkflowConnected(provider) {
  provider = normalizeLoginProviderKey(provider);
  loginWorkflowVerifiedSession[provider] = true;
  if (!isAccountProviderExternallyVisible(provider)) {
    var list = accountProviderVisibleList();
    list.push(provider);
    saveAccountProviderVisibleList(list);
  }
}

function setLoginAuthDrawerOpen(open) {
  var drawer = document.getElementById('login-auth-drawer');
  var modal = document.querySelector('#login-modal .dual-login-modal');
  if (modal) modal.classList.toggle('login-details-open', !!open);
  if (drawer) drawer.classList.toggle('show', !!open);
  if (!open) {
    loginWorkflowPendingProvider = '';
    try { stopQrPoll(); } catch (e) { }
  }
}

function markLoginNodeConnecting() {
  var graph = document.getElementById('login-node-graph');
  if (!graph) return;
  graph.classList.remove('connecting');
  void graph.offsetWidth;
  graph.classList.add('connecting');
  setTimeout(function () { graph.classList.remove('connecting'); }, 980);
}

function loginWorkflowActiveMode() {
  return isManualCookieOpenForProvider(loginProvider) ? 'cookie' : 'official';
}

function workflowPointForPort(port, root) {
  if (!port || !root) return null;
  var portRect = port.getBoundingClientRect();
  var rootRect = root.getBoundingClientRect();
  return {
    x: portRect.left + portRect.width / 2 - rootRect.left,
    y: portRect.top + portRect.height / 2 - rootRect.top
  };
}

function workflowPointFromEvent(e, root) {
  if (!e || !root) return null;
  var rootRect = root.getBoundingClientRect();
  return { x: e.clientX - rootRect.left, y: e.clientY - rootRect.top };
}

function workflowPointDistance(a, b) {
  if (!a || !b) return Infinity;
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function loginWorkflowMrTargetPoint(graph) {
  if (!graph) return null;
  return workflowPointForPort(graph.querySelector('[data-login-mr-target="mr"]'), graph);
}

function loginWorkflowSnapPoint(point, graph) {
  var mr = loginWorkflowMrTargetPoint(graph);
  if (point && mr && workflowPointDistance(point, mr) <= 92) return mr;
  return point;
}

function loginWorkflowNearMr(point, graph) {
  var mr = loginWorkflowMrTargetPoint(graph);
  return !!(point && mr && workflowPointDistance(point, mr) <= 108);
}

function workflowBezierPath(a, b) {
  var gap = Math.abs(b.x - a.x);
  var dx = Math.max(18, Math.min(86, gap * 0.55));
  return 'M ' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) +
    ' C ' + (a.x + dx).toFixed(1) + ' ' + a.y.toFixed(1) +
    ', ' + (b.x - dx).toFixed(1) + ' ' + b.y.toFixed(1) +
    ', ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1);
}

function appendWorkflowPath(svg, from, to, className) {
  if (!svg || !from || !to) return;
  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', workflowBezierPath(from, to));
  path.setAttribute('class', className || 'workflow-link');
  svg.appendChild(path);
}

function clearWorkflowSvg(svg) {
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function renderLoginWorkflowEdges(tempPoint) {
  var graph = document.getElementById('login-node-graph');
  var svg = document.getElementById('login-workflow-svg');
  if (!graph || !svg) return;
  var w = Math.max(1, graph.clientWidth || 1);
  var h = Math.max(1, graph.clientHeight || 1);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  clearWorkflowSvg(svg);
  var mrIn = graph.querySelector('[data-login-mr-target="mr"]');
  loginWorkflowConnectedProviders().forEach(function (provider) {
    var providerOut = graph.querySelector('[data-login-provider-output="' + provider + '"]');
    appendWorkflowPath(svg, workflowPointForPort(providerOut, graph), workflowPointForPort(mrIn, graph), 'workflow-link active' + (provider === loginProvider ? ' selected' : ''));
  });
  if (loginWorkflowPendingProvider && !providerHasLiveLogin(loginWorkflowPendingProvider)) {
    var pendingOut = graph.querySelector('[data-login-provider-output="' + loginWorkflowPendingProvider + '"]');
    appendWorkflowPath(svg, workflowPointForPort(pendingOut, graph), workflowPointForPort(mrIn, graph), 'workflow-link pending');
  }
  if (loginWorkflowDrag && tempPoint) {
    appendWorkflowPath(svg, workflowPointForPort(loginWorkflowDrag.port, graph), loginWorkflowSnapPoint(tempPoint, graph), 'workflow-link temp');
  }
}

function scheduleLoginWorkflowEdges(reason) {
  if (loginWorkflowEdgeRenderFrame) cancelAnimationFrame(loginWorkflowEdgeRenderFrame);
  loginWorkflowEdgeRenderFrame = requestAnimationFrame(function () {
    loginWorkflowEdgeRenderFrame = 0;
    renderLoginWorkflowEdges();
  });
  loginWorkflowEdgeRenderTimers.forEach(function (timer) { clearTimeout(timer); });
  loginWorkflowEdgeRenderTimers = [];
  [70, 170, 340, 560].forEach(function (delay) {
    loginWorkflowEdgeRenderTimers.push(setTimeout(function () {
      renderLoginWorkflowEdges();
    }, delay));
  });
}

function selectLoginProviderNode(provider) {
  if (loginProviderClickSuppressed) {
    loginProviderClickSuppressed = false;
    return;
  }
  provider = normalizeLoginProviderKey(provider);
  setLoginProvider(provider, true);
  setLoginAuthDrawerOpen(hasLoginWorkflowConnection(provider) || loginWorkflowPendingProvider === provider);
  updateLoginProviderUi();
}

function connectLoginProviderToMr(provider) {
  provider = normalizeLoginProviderKey(provider);
  if (provider !== loginProvider) setLoginProvider(provider, true);
  loginWorkflowPendingProvider = provider;
  setLoginAuthDrawerOpen(true);
  markLoginNodeConnecting();
  updateLoginProviderUi();
  connectLoginMode(loginWorkflowActiveMode());
}

function finishLoginWorkflowDrag(e) {
  var graph = document.getElementById('login-node-graph');
  if (!graph || !loginWorkflowDrag) return;
  var drag = loginWorkflowDrag;
  var target = document.elementFromPoint(e.clientX, e.clientY);
  var port = target && target.closest ? target.closest('.flow-port.in') : null;
  var mrNode = target && target.closest ? target.closest('[data-login-node="mr"]') : null;
  var eventPoint = workflowPointFromEvent(e, graph);
  var nearMr = loginWorkflowNearMr(eventPoint, graph);
  if ((port && graph.contains(port)) || (mrNode && graph.contains(mrNode)) || nearMr) {
    var mrTarget = port && port.getAttribute('data-login-mr-target');
    if (drag.source === 'provider' && (mrTarget || mrNode || nearMr)) {
      connectLoginProviderToMr(drag.provider);
    }
  }
  loginWorkflowDrag = null;
  graph.classList.remove('dragging-line', 'drop-ready');
  try { graph.releasePointerCapture(e.pointerId); } catch (_) { }
  scheduleLoginWorkflowEdges('wire-finish');
}

function beforeLoginProviderForPointer(y) {
  var parent = document.getElementById('login-platform-tabs');
  if (!parent) return '';
  var nodes = Array.prototype.slice.call(parent.querySelectorAll('[data-login-provider]'));
  for (var i = 0; i < nodes.length; i += 1) {
    var rect = nodes[i].getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return nodes[i].getAttribute('data-login-provider') || '';
  }
  return '';
}

function startLoginWorkflowPointerDrag(graph, state, e) {
  loginWorkflowDrag = {
    port: state.port,
    source: 'provider',
    provider: state.provider
  };
  graph.classList.add('dragging-line');
  renderLoginWorkflowEdges(workflowPointFromEvent(e, graph));
}

function accountProviderOrderAfterMove(provider, beforeProvider) {
  provider = normalizeLoginProviderKey(provider);
  beforeProvider = beforeProvider ? normalizeLoginProviderKey(beforeProvider) : '';
  var order = accountProviderOrder().filter(function (item) { return item !== provider; });
  var index = beforeProvider ? order.indexOf(beforeProvider) : -1;
  if (index < 0) order.push(provider);
  else order.splice(index, 0, provider);
  return order;
}

function shouldMoveLoginProviderBefore(provider, beforeProvider) {
  var current = accountProviderOrder();
  var next = accountProviderOrderAfterMove(provider, beforeProvider);
  return current.join('|') !== next.join('|');
}

function finishLoginProviderPointer(e) {
  var graph = document.getElementById('login-node-graph');
  if (loginWorkflowDrag) {
    finishLoginWorkflowDrag(e);
    loginProviderClickSuppressed = true;
    setTimeout(function () { loginProviderClickSuppressed = false; }, 120);
    return;
  }
  var state = loginProviderPointer;
  loginProviderPointer = null;
  if (graph) graph.classList.remove('sorting-provider');
  if (!state) return;
  if (state.node) state.node.classList.remove('sorting');
  try { if (graph) graph.releasePointerCapture(e.pointerId); } catch (_) { }
  loginProviderClickSuppressed = true;
  setTimeout(function () { loginProviderClickSuppressed = false; }, 120);
  scheduleLoginWorkflowEdges('sort-finish');
}

function loginProviderVipLabel(provider, status) {
  if (!status || !status.loggedIn) return '';
  var level = providerVipLevel(provider, status);
  return level === 'svip' ? 'SVIP' : (level === 'vip' ? 'VIP' : '普通');
}

function handleLoginProviderExternalSwitchEvent(e, provider) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  provider = normalizeLoginProviderKey(provider);
  toggleAccountProviderExternal(provider);
  updateLoginProviderUi();
  scheduleLoginWorkflowEdges('external-switch');
}
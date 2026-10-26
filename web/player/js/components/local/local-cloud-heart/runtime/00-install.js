'use strict';

(function installCloudHeart() {
  if (!window.MINERADIO_LOCAL_WEB || !window.webMusicLibrary) return;
  var labels = { netease: '网易云', qq: 'QQ 音乐', kugou: '酷狗', qishui: '汽水音乐' };
  var providers = ['netease', 'qq', 'kugou', 'qishui'];
  var symbols = { netease: '云', qq: 'Q', kugou: 'K', qishui: '汽' };
  var hoverTimer = 0, scanTimer = 0, currentTimer = 0;
  var menu = null, menuSong = null, menuMode = 'add', menuToken = 0, menuEntry = null, busy = false, anchor = null;
  var heartSelector = '#heart-btn,button[onclick*="toggleLike"],button[data-web-heart-source]';
  async function request(url, body) {
    var headers = window.localMusicCredentials && window.localMusicCredentials.headers ? window.localMusicCredentials.headers(url) : {};
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 90000);
    try {
      var response = await fetch(url, { method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal: controller.signal });
      var data = await response.json(); if (!response.ok) throw new Error(data.message || '平台收藏服务暂不可用'); return data;
    } finally { clearTimeout(timer); }
  }
  var cloud = window.createWebCloudHeartStore({ request: request, labels: labels, sameSong: window.webFavoriteTools.sameSong,
    configured: function (p) { return !!(window.localMusicCredentials && window.localMusicCredentials.read && window.localMusicCredentials.read(p).cookie); },
    match: function (song, p) { return findControlSourceMatchResult(song, p); }, onChange: scheduleScan });
  window.webCloudHeart = cloud;
  var press = window.createWebHeartPressController({
    setTimeout: function (callback, delay) { return window.setTimeout(callback, delay); },
    clearTimeout: function (timer) { window.clearTimeout(timer); }, now: Date.now,
    onLongPress: function (el, song) { open(song, el, 'add'); } });
  function node(tag, className, text) { var el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el; }
  function button(text, handler, className) { var el = node('button', className, text); el.type = 'button'; el.onclick = handler; return el; }
  function heart(target) { return target && target.closest ? target.closest(heartSelector) : null; }
  function songFor(el) {
    if (!el) return null;
    if (el.id === 'heart-btn') return currentCoverSong();
    if (el.hasAttribute('data-like-index')) return playlist[Number(el.getAttribute('data-like-index'))];
    if (el.getAttribute('data-web-heart-source') === 'detail') return playlistPanelDetailState.tracks[Number(el.getAttribute('data-web-heart-index'))];
    var action = el.getAttribute('onclick') || '', hit = action.match(/toggleLike(QueueIndex|SearchResult)\((\d+)\)/);
    if (hit) return (hit[1] === 'QueueIndex' ? playQueue : playlist)[Number(hit[2])];
    return null;
  }
  function scheduleScan() { if (scanTimer) return; scanTimer = setTimeout(function () { scanTimer = 0; scan(); }, 65); }
  function scan() {
    document.querySelectorAll(heartSelector).forEach(function (el) {
      var song = songFor(el); if (!song) return;
      var title = (isSongLiked(song) ? '单击取消本机喜欢' : '单击加入本机喜欢') + '；长按选择平台歌单';
      if (el.title !== title) el.title = title;
      var confirmed = cloud.confirmedProviders(song), sig = cloud.key(song) + '|' + confirmed.join(',');
      var badges = el.nextElementSibling && el.nextElementSibling.classList.contains('web-heart-badges') ? el.nextElementSibling : null;
      if (!badges) { badges = node('span', 'web-heart-badges'); el.insertAdjacentElement('afterend', badges); }
      if (badges.dataset.signature === sig) return;
      badges.dataset.signature = sig; badges.replaceChildren();
      confirmed.forEach(function (p) { var badge = node('span', 'web-heart-logo ' + p, symbols[p]); badge.title = '已收藏到' + labels[p]; badge.setAttribute('aria-label', badge.title); badges.append(badge); });
    });
  }
  function ensureMenu() {
    if (menu) return menu;
    menu = node('div', 'web-cloud-heart-mask'); menu.hidden = true;
    menu.addEventListener('click', function (event) { if (event.target === menu) close(); });
    menu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key !== 'Tab') return;
      var focusable = Array.from(menu.querySelectorAll('button:not([disabled])')).filter(function (el) { return el.getClientRects().length; });
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
    });
    document.body.append(menu); return menu;
  }
  function close() { menuToken += 1; if (menu) menu.hidden = true; menuSong = null; menuEntry = null; busy = false; if (anchor && anchor.isConnected) anchor.focus({ preventScroll: true }); }
  function editableRows() {
    return window.webMusicLibrary.state.playlists.filter(function (row) {
      return row.canAdd === true || (row.canAdd == null && row.editable === true);
    });
  }
  function membershipRows() { return (menuEntry && menuEntry.data.playlists || []).filter(function (row) { return row.canRemove !== false && row.editable !== false; }); }
  function render(message) {
    if (!menu || menu.hidden || !menuSong) return;
    var restoreFocus = menu.contains(document.activeElement);
    var panel = node('section', 'web-cloud-heart-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'web-cloud-heart-heading');
    var head = node('header', 'web-cloud-heart-head'), copy = node('div');
    var title = node('h3', '', menuSong.name || '当前歌曲'); title.id = 'web-cloud-heart-heading';
    copy.append(title, node('p', '', menuSong.artist || '')); head.append(copy, button('×', close, 'web-cloud-heart-close')); panel.append(head);
    var tabs = node('div', 'web-cloud-heart-tabs');
    [['add', '收藏到平台歌单'], ['remove', '从平台歌单移除']].forEach(function (entry) {
      var tab = button(entry[1], function () { if (!busy) changeMode(entry[0]); }); tab.classList.toggle('active', menuMode === entry[0]); tab.setAttribute('aria-pressed', String(menuMode === entry[0])); tabs.append(tab);
    }); panel.append(tabs);
    panel.append(node('p', 'web-cloud-heart-note', '单击爱心只修改本机喜欢；在这里选择歌单会同步至对应平台。'));
    var status = node('p', 'web-cloud-heart-status', message || (busy ? '正在同步，请稍候…' : menuEntry ? '请选择一个平台歌单' : '正在匹配同曲音源并查询平台收藏…')); status.setAttribute('role', 'status'); panel.append(status);
    var list = node('div', 'web-cloud-heart-list');
    if (menuEntry) {
      var rows = menuMode === 'remove' ? membershipRows() : editableRows();
      providers.forEach(function (p) {
        var platformRows = rows.filter(function (row) { return row.provider === p; });
        var providerState = menuEntry.data.providers && menuEntry.data.providers[p] || {};
        var candidate = menuEntry.candidates[p];
        if (!platformRows.length && !providerState.configured && !candidate) return;
        list.append(node('h4', '', labels[p]));
        if (!providerState.ok && providerState.message) list.append(node('p', 'web-cloud-heart-error', providerState.message));
        if (!candidate && menuMode === 'add') { list.append(node('p', 'web-cloud-heart-empty', '没有找到歌名、完整歌手与版本都匹配的音源')); return; }
        if (!platformRows.length) list.append(node('p', 'web-cloud-heart-empty', menuMode === 'remove' ? '未发现包含此曲的可编辑歌单' : '暂无可写入的自建歌单或喜欢歌单'));
        platformRows.forEach(function (row) {
          var found = membershipRows().some(function (existing) { return existing.provider === p && String(existing.id) === String(row.id); });
          var choice = button('', function () { runMutation(row); }, 'web-cloud-heart-choice');
          choice.disabled = busy || (menuMode === 'add' && found);
          var text = node('span'); text.append(node('strong', '', row.name || '未命名歌单'), node('small', '', menuMode === 'remove' ? '已确认包含此曲 · 点击移除' : found ? '此歌单已收藏' : '点击同步收藏'));
          choice.append(node('span', 'web-heart-logo ' + p, symbols[p]), text, node('span', 'web-cloud-heart-choice-mark', menuMode === 'remove' ? '−' : found ? '✓' : '+')); list.append(choice);
        });
      });
      if (!rows.length && menuMode === 'add') list.append(node('p', 'web-cloud-heart-empty', '登录平台后，可选择已创建的歌单或喜欢歌单。'));
      if (menuEntry.data.partial) list.append(node('p', 'web-cloud-heart-error', '部分平台查询失败；未知状态不会显示为已收藏。'));
    }
    panel.append(list); menu.replaceChildren(panel);
    if (restoreFocus) { var focus = menu.querySelector('button'); if (focus) focus.focus({ preventScroll: true }); }
  }
  async function changeMode(mode) {
    if (!menuSong) return;
    menuMode = mode;
    if (mode === 'add') { render(); return; }
    var token = menuToken; render('正在确认包含此曲的平台歌单…');
    try {
      var entry = await cloud.membership(menuSong, true);
      if (token !== menuToken) return;
      menuEntry = entry;
      if (!membershipRows().length && !entry.data.partial) { close(); return; }
      render();
    } catch (error) { if (token === menuToken) render(error.message || '查询失败，请重试'); }
  }
  async function open(song, el, mode) {
    if (!song) return;
    ensureMenu(); menuToken += 1; var token = menuToken;
    var selectedSong = cloneSong(song);
    menuSong = selectedSong; menuMode = mode || 'add'; menuEntry = null; anchor = el; menu.hidden = false; busy = false; render();
    var first = menu.querySelector('button'); if (first) first.focus({ preventScroll: true });
    try {
      await window.webMusicLibrary.loadCatalog(false);
      if (token !== menuToken) return;
      var entry = await cloud.membership(selectedSong, true);
      if (token !== menuToken) return;
      menuEntry = entry;
      if (menuMode === 'remove' && !membershipRows().length && !entry.data.partial) { close(); return; }
      render();
    } catch (error) { if (token === menuToken) render(error.message || '平台收藏状态查询失败'); }
  }
  async function runMutation(row) {
    if (busy || !menuSong) return;
    var song = menuSong, token = menuToken, operation = menuMode;
    busy = true; render();
    try {
      var result = await cloud.mutate(song, row, operation);
      if (token !== menuToken) return;
      if (result.noop) { close(); return; }
      busy = false; menuEntry = cloud.peek(song);
      showToast(result.message || (operation === 'add' ? '已同步到' : '已从平台歌单移除') + labels[row.provider]);
      render(operation === 'add' ? '已同步收藏，可继续选择其他歌单' : '已从所选歌单移除');
      // Refresh counts through a read only catalog request; keep the just
      // confirmed membership entry and the open chooser intact.
      await window.webMusicLibrary.loadCatalog(true);
    } catch (error) { if (token === menuToken) { busy = false; render(error.message || '平台同步失败，请重试'); } }
  }
  function cancelPress() { press.cancel(); }
  document.addEventListener('pointerdown', function (event) {
    var el = heart(event.target), song = songFor(el); if (!el || !song || event.button !== 0) return;
    press.down(el, cloneSong(song), event.clientX, event.clientY);
  }, true);
  document.addEventListener('pointermove', function (event) { press.move(event.clientX, event.clientY); }, true);
  document.addEventListener('pointerup', cancelPress, true);
  document.addEventListener('pointercancel', cancelPress, true);
  document.addEventListener('click', function (event) {
    var el = heart(event.target);
    if (el && press.consumeClick(el)) { event.preventDefault(); event.stopImmediatePropagation(); }
    if (el) scheduleScan();
  }, true);
  document.addEventListener('contextmenu', function (event) {
    var el = heart(event.target), song = songFor(el); if (!song) return;
    event.preventDefault(); event.stopPropagation();
    if (press.isSuppressed(el)) return;
    cancelPress(); open(song, el, 'add');
  }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    var el = heart(event.target), song = songFor(el); if (!song) return;
    event.preventDefault(); event.stopPropagation(); open(song, el, 'add');
  }, true);
  document.addEventListener('pointerover', function (event) {
    var el = heart(event.target), song = songFor(el); if (!song) return;
    clearTimeout(hoverTimer); hoverTimer = setTimeout(function () { cloud.membership(song, false).catch(function () {}); }, 450);
  }, true);
  document.addEventListener('pointerout', function (event) { if (heart(event.target)) clearTimeout(hoverTimer); }, true);
  document.addEventListener('focusin', function (event) { var song = songFor(heart(event.target)); if (song) cloud.membership(song, false).catch(function () {}); }, true);
  var originalLikeButtons = updateLikeButtons;
  updateLikeButtons = function (song) {
    var result = originalLikeButtons.apply(this, arguments); scheduleScan(); clearTimeout(currentTimer);
    song = song || currentCoverSong();
    if (song) currentTimer = setTimeout(function () { cloud.membership(song, false).catch(function () {}); }, 800);
    return result;
  };
  var originalLocalLike = toggleLikeSong;
  toggleLikeSong = async function () { var result = await originalLocalLike.apply(this, arguments); scheduleScan(); return result; };
  window.addEventListener('mineradio:accounts-changed', function () { cloud.clear(); close(); });
  window.addEventListener('storage', function (event) { if (event.key === 'mineradio-local-accounts-v1') { cloud.clear(); close(); } });
  if (window.MutationObserver) new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  cloud.open = open; cloud.close = close; cloud.songFor = songFor;
  scheduleScan();
}());

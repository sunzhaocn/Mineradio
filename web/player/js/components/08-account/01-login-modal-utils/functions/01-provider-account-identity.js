'use strict';


function providerAccountIdentity(provider, status) {
  status = status || platformStatus(provider) || {};
  var meta = platformMeta(provider) || {};
  var accountIds = [status.userId, status.uid, status.uin, status.openId, status.open_id, status.id]
    .map(function (value) { return String(value == null ? '' : value).trim(); })
    .filter(Boolean);
  var profile = status.profile && typeof status.profile === 'object' ? status.profile : {};
  var candidates = [
    status.nickname,
    status.nickName,
    status.nick_name,
    status.displayName,
    status.display_name,
    status.userName,
    status.user_name,
    status.username,
    status.publicName,
    status.public_name,
    status.name,
    profile.nickname,
    profile.nickName,
    profile.nick_name,
    profile.displayName,
    profile.display_name,
    profile.userName,
    profile.user_name,
    profile.username,
    profile.publicName,
    profile.public_name,
    profile.name
  ];
  var syntheticPrefixes = [meta.label, meta.short, provider, 'QQ 音乐', 'QQ', '酷狗音乐', '酷狗', '汽水音乐', '网易云音乐', '网易云', 'Spotify']
    .map(function (value) { return String(value || '').replace(/[\s·:_-]+/g, '').toLowerCase(); })
    .filter(Boolean);
  for (var i = 0; i < candidates.length; i += 1) {
    var nickname = String(candidates[i] == null ? '' : candidates[i]).replace(/\s+/g, ' ').trim();
    if (!nickname || accountIds.indexOf(nickname) !== -1 || /^\d{5,}$/.test(nickname)) continue;
    var compactNickname = nickname.replace(/[\s·:_-]+/g, '').toLowerCase();
    var synthetic = accountIds.some(function (accountId) {
      var compactId = String(accountId || '').replace(/[\s·:_-]+/g, '').toLowerCase();
      return compactId && syntheticPrefixes.some(function (prefix) { return compactNickname === prefix + compactId; });
    });
    if (synthetic) continue;
    return nickname;
  }
  return String(meta.label || provider || '账号');
}

function renderTopAccountPill(provider, opts) {
  opts = opts || {};
  var st = platformStatus(provider);
  var loggedIn = !!(st && st.loggedIn);
  if (!loggedIn && !opts.force) return '';
  var meta = platformMeta(provider);
  st = st || {};
  var displayName = loggedIn ? ((provider === 'qq' && st.preview) ? '待接入' : providerAccountIdentity(provider, st)) : meta.label;
  var vipTag = providerVipBadge(provider, st, '', true);
  return '<span class="top-account-pill ' + (loggedIn ? 'online' : 'offline') + '" data-account-provider="' + escHtml(provider) + '">' +
    '<img src="' + providerAvatarSrc(provider, st) + '" alt="">' +
    '<span class="top-account-name">' + escHtml(displayName) + '</span>' +
    vipTag +
    '</span>';
}

function bindTopAccountPillSorting() {
  var btn = document.getElementById('user-btn');
  if (!btn || btn.__accountPillSortBound) return;
  btn.__accountPillSortBound = true;
  btn.addEventListener('pointerdown', function (e) {
    var pill = e.target && e.target.closest ? e.target.closest('.top-account-pill[data-account-provider]') : null;
    if (!pill || !btn.contains(pill)) return;
    topAccountPillDrag = {
      provider: normalizeAccountProviderKey(pill.getAttribute('data-account-provider') || ''),
      startX: e.clientX,
      startY: e.clientY,
      dragging: false
    };
    try { btn.setPointerCapture(e.pointerId); } catch (_) { }
  });
  btn.addEventListener('pointermove', function (e) {
    if (!topAccountPillDrag) return;
    var dx = e.clientX - topAccountPillDrag.startX;
    var dy = e.clientY - topAccountPillDrag.startY;
    if (!topAccountPillDrag.dragging && Math.sqrt(dx * dx + dy * dy) < 7) return;
    topAccountPillDrag.dragging = true;
    topAccountPillClickSuppressed = true;
    btn.classList.add('pill-sorting');
    var pills = Array.prototype.slice.call(btn.querySelectorAll('.top-account-pill[data-account-provider]'));
    var beforeProvider = '';
    for (var i = 0; i < pills.length; i += 1) {
      var rect = pills[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        beforeProvider = pills[i].getAttribute('data-account-provider') || '';
        break;
      }
    }
    if (beforeProvider === topAccountPillDrag.provider) return;
    moveAccountProviderBefore(topAccountPillDrag.provider, beforeProvider);
    e.preventDefault();
  });
  function finish(e) {
    if (!topAccountPillDrag) return;
    var provider = topAccountPillDrag.provider;
    var dragged = topAccountPillDrag.dragging;
    topAccountPillDrag = null;
    btn.classList.remove('pill-sorting');
    try { btn.releasePointerCapture(e.pointerId); } catch (_) { }
    if (!dragged && provider) loginProvider = provider;
    if (dragged) setTimeout(function () { topAccountPillClickSuppressed = false; }, 120);
  }
  btn.addEventListener('pointerup', finish);
  btn.addEventListener('pointercancel', finish);
}
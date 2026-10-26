'use strict';



function playbackProviderLabel(song) {
  var provider = songProviderKey(song);
  if (provider === 'qq') return 'QQ 音乐';
  if (provider === 'kugou') return '酷狗音乐';
  if (provider === 'qishui') return '汽水音乐';
  if (provider === 'spotify') return 'Spotify';
  return '网易云';
}

function playbackLoginProvider(song) {
  return normalizePlaybackProvider(songProviderKey(song));
}

function playbackRestrictionRawCategory(song, data) {
  data = data || {};
  var restriction = data.restriction || {};
  return data.reason || data.category || data.errorCategory || restriction.category || restriction.reason || '';
}

function playbackRestrictionLooksVipLocked(song, data) {
  data = data || {};
  var restriction = data.restriction || {};
  if (typeof songRequiresVip === 'function' && songRequiresVip(Object.assign({}, song || {}, data || {}))) return true;
  if (data.trial || data.needVip || data.need_vip || data.vipRequired || data.onlyVipPlayable || data.only_vip_playable) return true;
  var text = [
    data.error,
    data.message,
    data.reason,
    data.category,
    restriction.category,
    restriction.reason,
    restriction.message,
    data.rawMessage,
    restriction.rawMessage
  ].map(function (value) { return String(value || '').toLowerCase(); }).join(' ');
  return /vip_required|paid_required|trial_only|need_vip|only_vip|member|vip|会员|付费|购买|数字专辑|专辑/.test(text);
}

function playbackRestrictionMissingPlaybackKey(data) {
  data = data || {};
  var restriction = data.restriction || {};
  return !!(data.missingPlaybackKey || restriction.missingPlaybackKey);
}

function playbackRestrictionCategory(song, data) {
  var category = playbackRestrictionRawCategory(song, data);
  var provider = playbackLoginProvider(song);
  var status = platformStatus(provider) || {};
  var mergedStatus = Object.assign({}, status, data || {}, data && data.restriction || {});
  var loggedIn = !!(status.loggedIn || data && data.loggedIn);
  var vipLevel = typeof providerVipLevel === 'function' ? providerVipLevel(provider, mergedStatus) : 'none';
  var membershipUnknown = !!(
    provider === 'qq'
    && loggedIn
    && (
      status.membershipKnown === false
      || status.membershipStale
      || status.authorizationIncomplete
      || status.vipSyncState === 'unknown'
    )
  );
  var vipLocked = playbackRestrictionLooksVipLocked(song, data);
  if (vipLocked && !playbackRestrictionMissingPlaybackKey(data)) {
    if (category === 'login_required' && loggedIn && vipLevel === 'none' && !membershipUnknown) return 'vip_required';
    if (!category || category === 'url_unavailable' || category === 'copyright_unavailable') {
      if (loggedIn && vipLevel === 'none' && !membershipUnknown) return 'vip_required';
    }
  }
  if (!category && data && data.error && /401|403|login_required|auth|cookie|credential|unauthorized|forbidden/i.test(String(data.error))) return loggedIn && vipLocked ? 'vip_required' : 'login_required';
  if (!category && data && data.error && /vip|member|paid|trial|会员|付费|购买/i.test(String(data.error))) return loggedIn ? 'vip_required' : 'login_required';
  return category || 'url_unavailable';
}

function playbackProviderMembershipText(provider, data) {
  var status = platformStatus(provider) || {};
  var mergedStatus = Object.assign({}, status, data || {}, data && data.restriction || {});
  var level = typeof providerVipLevel === 'function' ? providerVipLevel(provider, mergedStatus) : 'none';
  if (level === 'svip') return 'SVIP';
  if (level === 'vip') return provider === 'spotify' ? 'Premium' : 'VIP';
  if (
    provider === 'qq'
    && status.loggedIn
    && (
      status.membershipKnown === false
      || status.membershipStale
      || status.authorizationIncomplete
      || status.vipSyncState === 'unknown'
    )
  ) return '会员待同步';
  return '普通账号';
}

function playbackRestrictionNotice(song, data) {
  data = data || {};
  var restriction = data.restriction || {};
  var category = playbackRestrictionCategory(song, data);
  var provider = playbackProviderLabel(song);
  var providerKey = playbackLoginProvider(song);
  var status = platformStatus(providerKey) || {};
  var loggedIn = !!(status.loggedIn || data.loggedIn);
  var membershipPending = !!(
    providerKey === 'qq'
    && loggedIn
    && (
      status.membershipKnown === false
      || status.membershipStale
      || status.authorizationIncomplete
      || status.vipSyncState === 'unknown'
    )
  );
  var membership = playbackProviderMembershipText(providerKey, data);
  var message = data.message || restriction.message || '';
  if (category === 'vip_required' || category === 'paid_required' || category === 'trial_only') {
    var needText = category === 'paid_required' ? '购买、数字专辑或更高权限' : (category === 'trial_only' ? '完整播放权限' : '会员权限');
    var title = membershipPending ? 'QQ 会员状态待同步' : (loggedIn ? '当前平台没有会员状态' : '当前平台未登录会员');
    var body = message || (provider + ' 已识别为会员/付费曲目，当前状态是 ' + membership + '，缺少' + needText + '。');
    if (loggedIn && body.indexOf('当前状态') < 0) body += ' 当前状态是 ' + membership + '。';
    return { category: category, title: title, body: body + ' 可以登录会员账号、降低音质或切换到其它音源。', action: 'upgrade', toast: title };
  }
  if (category === 'login_required') {
    if (loggedIn && playbackRestrictionMissingPlaybackKey(data)) {
      return {
        category: category,
        title: '平台播放授权未完成',
        body: message || (provider + ' 已登录，但还缺少播放授权，请重新打开官方登录窗口完成授权。'),
        action: 'login',
        toast: '播放授权未完成'
      };
    }
    return {
      category: category,
      title: '当前平台未登录',
      body: (message || (provider + ' 需要登录后才能获取播放地址。')) + ' 正在打开对应登录入口。',
      action: 'login',
      toast: '当前平台未登录'
    };
  }
  if (category === 'provider_limited') {
    return {
      category: category,
      title: '平台仅作为匹配源',
      body: message || (provider + ' 当前只提供搜索/匹配信息，播放会自动寻找其它可播版本。'),
      action: 'switch_source',
      toast: '正在自动换源'
    };
  }
  if (category === 'copyright_unavailable') {
    return {
      category: category,
      title: '当前平台版权不可播',
      body: (message || (provider + ' 当前版权暂不可播。')) + ' 可以换一个平台版本。',
      action: 'switch_source',
      toast: '版权不可播'
    };
  }
  return {
    category: category,
    title: '当前平台没有可用音源',
    body: (message || (provider + ' 没有返回可播放地址。')) + ' 可能是版权、地区、会员或网络限制，可以换源或稍后重试。',
    action: 'switch_source',
    toast: '当前平台没有可用音源'
  };
}

function playbackRestrictionMessage(song, data) {
  var notice = playbackRestrictionNotice(song, data);
  return notice.body || notice.title;
  data = data || {};
  var restriction = data.restriction || {};
  var category = data.reason || restriction.category || '';
  var provider = playbackProviderLabel(song);
  var message = data.message || restriction.message || '';
  if (!message) {
    if (category === 'login_required') message = provider + '需要登录后再尝试播放';
    else if (category === 'vip_required') message = provider + '歌曲需要会员权限';
    else if (category === 'paid_required') message = provider + '歌曲需要购买或更高权限';
    else if (category === 'trial_only') message = provider + '仅返回试听片段';
    else if (category === 'copyright_unavailable') message = provider + '版权暂不可播';
    else if (category === 'provider_limited') message = provider + '当前只作为匹配源，正在寻找其它可播版本';
    else message = provider + '没有返回可播放地址';
  }
  if (category === 'login_required') return message + ' · 正在打开登录';
  if (category === 'provider_limited') return message + ' · 可以自动换源';
  if (category === 'copyright_unavailable' || category === 'url_unavailable') return message + ' · 可以试试另一个平台版本';
  return message;
}

function qqPlaybackRetryQualities(requestedQuality, resolvedLevel) {
  requestedQuality = normalizePlaybackQualityForProvider(requestedQuality || getProviderPlaybackQuality('qq'), 'qq');
  resolvedLevel = String(resolvedLevel || '').toLowerCase();
  var pool = [];
  if (requestedQuality === 'jymaster' || requestedQuality === 'hires' || requestedQuality === 'lossless' || resolvedLevel === 'hires' || resolvedLevel === 'lossless') {
    pool = ['exhigh', 'standard'];
  } else if (requestedQuality === 'exhigh' || resolvedLevel === 'exhigh') {
    pool = ['standard'];
  }
  return pool.filter(function (q) { return q !== requestedQuality; });
}

async function retryQQPlaybackWithCompatibleQuality(song, idx, token, opts, data, requestedQuality) {
  opts = opts || {};
  if (playbackRestrictionCategory(song, data) === 'login_required' || playbackRestrictionMissingPlaybackKey(data)) return false;
  var tried = Array.isArray(opts.qqQualityTried) ? opts.qqQualityTried.slice() : [];
  [requestedQuality, data && data.level].forEach(function (q) {
    q = normalizePlaybackQuality(q || '');
    if (q && tried.indexOf(q) < 0) tried.push(q);
  });
  var candidates = qqPlaybackRetryQualities(requestedQuality, data && data.level).filter(function (q) { return tried.indexOf(q) < 0; });
  if (!candidates.length || token !== trackSwitchToken) return false;
  var nextQuality = candidates[0];
  var resolvedQuality = normalizePlaybackQuality(data && data.level);
  markPlaybackQualityRuntimeCap(song, 'qq', nextQuality, 'qq-url-unavailable');
  if (!opts.startupAutoplay) showSourceFallbackNotice('QQ 音质自动兼容', '当前音质启动失败，正在切到 ' + playbackQualityLabel(nextQuality, 'qq') + '。');
  var retryResumeAt = opts.resumeAt;
  if (retryResumeAt == null && opts.startupAutoplay && pendingPlaybackResumeAt > 0) retryResumeAt = pendingPlaybackResumeAt;
  var retryStarted = await playQueueAt(idx, Object.assign({}, opts, {
    qualityOverride: nextQuality,
    qqQualityTried: tried,
    resumeAt: retryResumeAt,
  }));
  return retryStarted === true;
}

function closeSourceFallbackNotice() {
  var notice = document.getElementById('source-fallback-notice');
  if (sourceFallbackNoticeTimer) { clearTimeout(sourceFallbackNoticeTimer); sourceFallbackNoticeTimer = null; }
  if (notice) notice.classList.remove('show');
  var stack = document.getElementById('source-fallback-stack');
  if (stack) Array.prototype.slice.call(stack.children || []).forEach(removeSourceFallbackCard);
}

function ensureSourceFallbackStack() {
  var stack = document.getElementById('source-fallback-stack');
  if (stack) return stack;
  stack = document.createElement('div');
  stack.id = 'source-fallback-stack';
  stack.setAttribute('aria-live', 'polite');
  document.body.appendChild(stack);
  return stack;
}

function removeSourceFallbackCard(card) {
  if (!card) return;
  card.classList.add('leaving');
  setTimeout(function () {
    if (card.parentNode) card.parentNode.removeChild(card);
  }, 260);
}

function showSourceFallbackNotice(title, body) {
  var stack = ensureSourceFallbackStack();
  if (stack) {
    var card = document.createElement('div');
    card.className = 'source-fallback-card';
    var head = document.createElement('div');
    head.className = 'source-fallback-head';
    var titleElNew = document.createElement('div');
    titleElNew.className = 'source-fallback-title';
    titleElNew.textContent = title || '自动换源';
    var close = document.createElement('button');
    close.className = 'source-fallback-close';
    close.type = 'button';
    close.textContent = '×';
    close.onclick = function () { removeSourceFallbackCard(card); };
    var bodyElNew = document.createElement('div');
    bodyElNew.className = 'source-fallback-body';
    bodyElNew.textContent = body || '';
    head.appendChild(titleElNew);
    head.appendChild(close);
    card.appendChild(head);
    card.appendChild(bodyElNew);
    stack.insertBefore(card, stack.firstChild || null);
    while (stack.children.length > 4) removeSourceFallbackCard(stack.lastElementChild);
    requestAnimationFrame(function () { card.classList.add('show'); });
    setTimeout(function () { removeSourceFallbackCard(card); }, 5600);
    return;
  }
  var notice = document.getElementById('source-fallback-notice');
  var titleEl = document.getElementById('source-fallback-title');
  var bodyEl = document.getElementById('source-fallback-body');
  if (!notice || !titleEl || !bodyEl) return;
  titleEl.textContent = title || '自动换源';
  bodyEl.textContent = body || '';
  notice.classList.add('show');
  if (sourceFallbackNoticeTimer) clearTimeout(sourceFallbackNoticeTimer);
  sourceFallbackNoticeTimer = setTimeout(closeSourceFallbackNotice, 5000);
}

function normalizeMatchText(text) {
  return String(text || '').toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s·・\-—_.,，。:：'"“”‘’/\\|]+/g, '');
}

function artistNameParts(song) {
  var parts = [];
  if (song && Array.isArray(song.artists)) {
    song.artists.forEach(function (a) { if (a && a.name) parts.push(a.name); });
  }
  if (song && song.artist) {
    String(song.artist).split(/\s*\/\s*|\s*,\s*|、|&| feat\.? | ft\.? /i).forEach(function (name) {
      if (name && name.trim()) parts.push(name.trim());
    });
  }
  return parts.map(normalizeMatchText).filter(Boolean);
}

function isSameTitleArtist(source, candidate) {
  if (!source || !candidate) return false;
  if (normalizeMatchText(source.name || source.title) !== normalizeMatchText(candidate.name || candidate.title)) return false;
  var a = artistNameParts(source);
  var b = artistNameParts(candidate);
  if (!a.length || !b.length) return false;
  return a.some(function (name) { return b.indexOf(name) >= 0; });
}


function sourceFallbackRecoveryContentKey(song) {
  if (!song) return '';
  var title = normalizeMatchText(song.name || song.title || '');
  var artists = artistNameParts(song).sort().join(',');
  if (title && artists) return title + '|' + artists;
  return sourceFallbackSongKey(song);
}

function sourceFallbackRecoveryFromOptions(opts) {
  if (!opts) return null;
  return opts.sourceFallbackRecovery
    || (opts.playbackOpts && opts.playbackOpts.sourceFallbackRecovery)
    || null;
}

function sourceFallbackRecoveryIdentityActive(recovery) {
  return !!(
    recovery
    && activeSourceFallbackRecovery === recovery
    && !recovery.terminal
    && !recovery.cancelled
    && !recovery.completed
  );
}

function sourceFallbackRecoveryRemainingMs(recovery) {
  if (!sourceFallbackRecoveryIdentityActive(recovery)) return 0;
  return Math.max(0, Number(recovery.deadlineAt) - Date.now());
}

function sourceFallbackRecoveryCanContinue(recovery) {
  return sourceFallbackRecoveryRemainingMs(recovery) > 0;
}

function cancelSourceFallbackRecovery(reason) {
  var recovery = activeSourceFallbackRecovery;
  if (!recovery || recovery.terminal || recovery.completed) return false;
  recovery.cancelled = true;
  recovery.cancelReason = String(reason || 'superseded');
  activeSourceFallbackRecovery = null;
  return true;
}

function completeSourceFallbackRecovery(recovery) {
  if (!recovery || recovery.terminal || recovery.cancelled) return false;
  recovery.completed = true;
  if (activeSourceFallbackRecovery === recovery) activeSourceFallbackRecovery = null;
  return true;
}

function beginSourceFallbackPlaybackInvocation(opts) {
  var recovery = sourceFallbackRecoveryFromOptions(opts);
  if (!recovery) {
    cancelSourceFallbackRecovery('new-root-playback');
    return true;
  }
  return sourceFallbackRecoveryCanContinue(recovery);
}
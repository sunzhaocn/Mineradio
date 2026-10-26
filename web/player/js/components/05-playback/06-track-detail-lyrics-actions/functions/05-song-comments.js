'use strict';

// Dialog state belongs to one native song and one dialog generation. Async work
// must never update a subsequently opened song, source or sort.
var songCommentContext = null;
var songDetailPlaybackKey = '';
var songDetailOpen = false;

function detailCommentsConfig(song) {
  if (!song || song.type === 'local' || song.localUrl) return null;
  var p = songProviderKey(song), id = '', mid = '';
  if (p === 'netease') id = song.id || '';
  else if (p === 'qq') {
    id = song.qqId || (/^\d+$/.test(String(song.id || '')) ? song.id : '') || song.songId || '';
    mid = song.mid || song.songmid || (!/^\d+$/.test(String(song.id || '')) ? song.id : '');
  } else if (p === 'kugou') id = song.hash || song.audioHash || song.id || '';
  else if (p === 'qishui') id = song.providerSongId || song.trackId || song.id || '';
  else return null;
  if (!id && !mid) return null;
  var endpoint = '/api' + (p === 'netease' ? '' : '/' + p) + '/song/comments';
  var nativeMediaType = p === 'qishui' ? String(song.nativeMediaType || song.native_media_type || 'track') : '';
  if (nativeMediaType !== 'ugc_clip' && p === 'qishui') nativeMediaType = 'track';
  return {provider: p, id: String(id), mid: String(mid), nativeMediaType: nativeMediaType, key: p + ':' + (mid || id) + ':' + nativeMediaType,
    title: songSourceLabel(song) + '评论', endpoint: endpoint,
    readUrl: endpoint + '?id=' + encodeURIComponent(id) + '&mid=' + encodeURIComponent(mid) + '&limit=20' +
      (p==='kugou' ? '&albumAudioId='+encodeURIComponent(song.albumAudioId || song.album_audio_id || song.mixSongId || song.mixsongid || '') : '') +
      (nativeMediaType ? '&nativeMediaType=' + nativeMediaType : ''),
    writeUrl: endpoint + '?id=' + encodeURIComponent(id) + '&mid=' + encodeURIComponent(mid), canWrite: false};
}

function songDetailNativeKey(song) {
  var config = detailCommentsConfig(song);
  return config ? config.key : String(song && (song.localKey || song.id || song.name) || '');
}

function commentTimeLabel(ms) {
  var t = Number(ms);
  return t > 0 && isFinite(t) ? new Date(t).toLocaleDateString('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'}) : '';
}

function commentMediaUrl(value) {
  var url = String(value || '').trim();
  if (/^https:\/\/[^\s<>"'`]+$/i.test(url)) return url;
  // Raster-only inline image support; no SVG, HTML, arbitrary data schemes.
  if (url.length <= 88000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(url)) return url;
  if (/^\/api\/[A-Za-z0-9/_-]+\?[^\s<>"'`]*$/.test(url)) return url;
  return '';
}

function commentEsc(value) {
  return escHtml(String(value == null ? '' : value)).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;');
}

function commentTextHtml(value) {
  var emojis = {'大哭':'😭','流泪':'😢','爱心':'❤️','心碎':'💔','憨笑':'😁','可爱':'😊','亲亲':'😘','色':'😍','大笑':'😄',
    '呲牙':'😃','微笑':'🙂','开心':'😄','开心果':'😄','偷笑':'🤭','嘻嘻':'🤭','害羞':'☺️','惊恐':'😱','惊讶':'😮',
    '发怒':'😠','怒':'😠','奸笑':'😏','鬼脸':'😜','吐舌':'😛','汗':'😓','流汗':'😓','晕':'😵','生病':'🤒',
    '痛苦':'😣','哀伤':'😔','撇嘴':'😒','哼哼':'😤','鄙视':'😒','强':'👍','赞':'👍','弱':'👎','握手':'🤝',
    '抱拳':'🙏','拜':'🙏','拜托':'🙏','钟情':'💕','牵手':'🤝','礼物':'🎁','鲜花':'🌹','玫瑰':'🌹','音乐':'🎵',
    '狗':'🐶','猫':'🐱','猪':'🐷','吐':'🤮','便便':'💩','星星':'⭐','太阳':'☀️','月亮':'🌙','咖啡':'☕','蛋糕':'🎂'};
  return String(value || '').split(/(\[[^\[\]\r\n]{1,16}\])/g).map(function (part) {
    var label = part.slice(1, -1), emoji = part.charAt(0) === '[' && emojis[label];
    return emoji ? '<span class="comment-unicode-emoji" role="img" title="' + commentEsc(part) + '" aria-label="' + commentEsc(part) + '">' + emoji + '</span>' : commentEsc(part);
  }).join('');
}

function commentImageHtml(value, alt, inline, preview) {
  var url = commentMediaUrl(value);
  var label = alt || (inline ? '平台表情' : '评论图片');
  if (!url) return '<span class="comment-media-missing">' + commentEsc(label) + '（图片不可用）</span>';
  var img = '<img loading="lazy" referrerpolicy="no-referrer" class="' + (inline ? 'comment-platform-emoji' : 'comment-picture') + '" src="' + commentEsc(url) + '" alt="' + commentEsc(label) + '" onerror="commentImageFailed(this)">';
  return '<button type="button" class="comment-image-button' + (inline ? ' inline' : '') + '" data-image-url="' + commentEsc(commentMediaUrl(preview) || url) + '" data-image-alt="' + commentEsc(label) + '" onclick="previewCommentImage(this)" aria-label="查看' + commentEsc(label) + '">' + img + '</button>';
}

function commentEncodedEmojiHtml(marker) {
  var fallback = '<span class="comment-media-missing" aria-label="表情暂不可用">[表情]</span>';
  var attribute = /\bj\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(marker);
  if (!attribute) return fallback;
  var encoded = String(attribute[1] == null ? attribute[2] : attribute[1]);
  if (encoded.length > 64000) return fallback;
  // Only decode the attribute's data. The platform marker is never interpreted
  // as HTML, and any recovered text still passes through the normal escaper.
  encoded = encoded.replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&apos;|&#39;|&#x27;/gi, "'").replace(/&amp;/gi, '&');
  try {
    for (var pass = 0; pass < 2 && /^\s*%(?:7b|5b|25)/i.test(encoded); pass++) encoded = decodeURIComponent(encoded);
    var payload = JSON.parse(encoded);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fallback;
    var emoji = payload.emoji && typeof payload.emoji === 'object' && !Array.isArray(payload.emoji) ? payload.emoji : {};
    var text = typeof payload.text === 'string' ? payload.text : '';
    if (!text && typeof emoji.text === 'string') text = emoji.text;
    if (!text && typeof emoji.name === 'string') text = emoji.name;
    var candidates = [emoji, emoji.image, emoji.img, emoji.pic, payload.image, payload];
    var imageUrl = '';
    for (var i = 0; i < candidates.length && !imageUrl; i++) {
      var item = candidates[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      var fields = ['url', 'imageUrl', 'image_url', 'picUrl', 'pic_url', 'src'];
      for (var j = 0; j < fields.length && !imageUrl; j++) imageUrl = commentMediaUrl(item[fields[j]]);
      if (!imageUrl && typeof item.pic === 'string') imageUrl = commentMediaUrl(item.pic);
      var urls = item.url_list || item.urlList;
      if (!imageUrl && Array.isArray(urls)) {
        for (var k = 0; k < Math.min(4, urls.length) && !imageUrl; k++) imageUrl = commentMediaUrl(urls[k]);
      }
    }
    if (imageUrl) return commentImageHtml(imageUrl, text || '平台表情', true);
    return text ? commentTextHtml(text) : fallback;
  } catch (e) { return fallback; }
}

function commentRichTextHtml(value) {
  var text = String(value == null ? '' : value), html = '', offset = 0;
  var markers = /<\/?c0m_cvt\b(?:(?:[^"'<>]|"[^"]*"|'[^']*')*\/?\s*>|[^<>\r\n]*(?:>|$))/gi;
  var match;
  while ((match = markers.exec(text))) {
    html += commentTextHtml(text.slice(offset, match.index));
    if (!/^<\//.test(match[0])) html += commentEncodedEmojiHtml(match[0]);
    offset = markers.lastIndex;
  }
  html += commentTextHtml(text.slice(offset));
  return html;
}

function commentBodyHtml(c) {
  var parts = Array.isArray(c.segments) && c.segments.length ? c.segments : [{type: 'text', text: c.content || ''}];
  var html = parts.map(function (s) {
    if (!s) return '';
    if (s.type === 'emoji' || s.type === 'image') return commentImageHtml(s.url, s.alt, s.type === 'emoji');
    return commentRichTextHtml(s.text || '');
  }).join('');
  var pictures = Array.isArray(c.pictures) ? c.pictures : [];
  if (pictures.length) html += '<div class="comment-pictures">' + pictures.slice(0, 9).map(function (p) {
    return commentImageHtml(p.thumbnailUrl || p.url, p.alt, false, p.url);
  }).join('') + '</div>';
  return html;
}

function commentBadgesHtml(user) {
  return (Array.isArray(user.badges) ? user.badges : []).slice(0, 8).map(function (b) {
    var icon = commentMediaUrl(b.iconUrl), label = String(b.label || '').trim();
    if (!label && !icon) return '';
    return '<span class="comment-badge' + (/vip|会员/i.test(String(b.type || '') + label) ? ' vip' : '') + '" title="' + commentEsc(label) + '">' +
      (icon ? '<img src="' + commentEsc(icon) + '" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.hidden=true">' : '') + commentEsc(label) + '</span>';
  }).join('');
}

function renderDetailComments(comments) {
  var context = songCommentContext;
  if (!comments || !comments.length) return '<div class="detail-empty">暂无评论</div>';
  return '<div class="detail-scroll comment-list">' + comments.map(function (c, index) {
    var user = c.user || {}, avatar = commentMediaUrl(user.avatarUrl || user.avatar);
    var pending = context && context.pending[c.id];
    var canLike = !!(context && context.capabilities.like && c.canLike !== false && c.id);
    var replies = (Array.isArray(c.replies) ? c.replies : []).slice(0, 5);
    return '<article class="comment-item">' +
      (avatar ? '<img class="comment-avatar" src="' + commentEsc(avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility=\'hidden\'">' : '<div class="comment-avatar comment-avatar-placeholder" aria-hidden="true">' + commentEsc((user.nickname || '乐').slice(0, 1)) + '</div>') +
      '<div class="comment-main"><div class="comment-author"><span class="comment-nickname">' + commentEsc(user.nickname || '音乐用户') + '</span>' + commentBadgesHtml(user) + '</div>' +
      '<div class="comment-text">' + commentBodyHtml(c) + '</div>' +
      (replies.length ? '<div class="comment-replies">' + replies.map(function (r) { return '<div class="comment-reply"><span class="comment-reply-name">' + commentEsc(r.user && r.user.nickname || '音乐用户') + '：</span>' + commentBodyHtml(r) + '</div>'; }).join('') + '</div>' : '') +
      '<div class="comment-footer"><span class="comment-date">' + commentEsc(commentTimeLabel(c.time)) + (c.location ? ' · ' + commentEsc(c.location) : '') + (c.replyCount ? ' · ' + commentEsc(c.replyCount) + ' 条回复' : '') + '</span>' +
      '<button type="button" class="comment-like' + (c.liked ? ' on' : '') + '" aria-label="' + (c.liked ? '取消点赞' : '点赞评论') + '" aria-pressed="' + (!!c.liked) + '" ' + (!canLike || pending ? 'disabled ' : '') +
      'onclick="toggleDetailCommentLike(' + index + ')" title="' + (canLike ? '点赞同步到' + commentEsc(context.config.title.replace('评论', '')) : '平台暂不支持评论点赞') + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11H3V10h4Zm3 11h8.1a2 2 0 0 0 1.96-1.6l1.4-7A2 2 0 0 0 19.5 10H14l.8-4.1A2.4 2.4 0 0 0 12.5 3L7 10v11h3Z"/></svg><span>' + (pending ? '…' : commentEsc(Math.max(0, Number(c.likedCount) || 0))) + '</span></button></div>' +
      (context && context.likeErrors[c.id] ? '<div class="comment-inline-error" role="status">' + commentEsc(context.likeErrors[c.id]) + '</div>' : '') +
      '</div></article>';
  }).join('') + '</div>';
}

function renderDetailCommentComposer(config) {
  if (!config || !config.canWrite) return '';
  return '<div class="detail-comment-compose"><input id="detail-comment-input" type="text" maxlength="280" autocomplete="off" placeholder="写下你的评论"><button id="detail-comment-submit" type="button" onclick="submitDetailComment()">发送</button></div>';
}

function renderSongCommentsState() {
  var c = songCommentContext, target = document.getElementById('song-comments');
  if (!target || !c || c.seq !== trackDetailSeq) return;
  var sorts = c.capabilities.sorts || ['hot', 'new'];
  var tabs = sorts.indexOf('hot') >= 0 || sorts.indexOf('new') >= 0 ? '<div class="comment-sort" role="group" aria-label="评论排序">' + ['hot', 'new'].filter(function (s) { return sorts.indexOf(s) >= 0; }).map(function (s) {
    return '<button type="button" class="' + (c.sort === s ? 'on' : '') + '" aria-pressed="' + (c.sort === s) + '" onclick="changeDetailCommentSort(\'' + s + '\')">' + (s === 'hot' ? '热评' : '最新') + '</button>';
  }).join('') + '</div>' : '<span class="comment-platform-sort">平台排序</span>';
  var html = '<div class="comment-toolbar">' + tabs + '<span class="comment-total">' + (c.total == null ? '' : commentEsc(c.total) + ' 条') + '</span></div>';
  if (c.message) html += '<div class="comment-platform-note">' + commentEsc(c.message) + '</div>';
  html += renderDetailCommentComposer(c.config);
  if (c.comments.length) html += renderDetailComments(c.comments);
  else if (!c.loading && !c.error) html += '<div class="detail-empty">' + (c.capabilities.read === false ? '当前平台评论暂不可用' : '暂无评论') + '</div>';
  if (c.loading) html += '<div class="detail-loading" role="status">正在载入评论…</div>';
  if (c.error) html += '<div class="comment-load-error" role="status">' + commentEsc(c.error) + '</div>';
  if (!c.loading && (c.hasMore || c.error)) html += '<button type="button" class="detail-action-toggle comment-load-more" onclick="loadMoreDetailComments()">' + (c.error ? '重试加载' : '加载更多评论') + '</button>';
  target.innerHTML = html;
  bindTrackDetailScrollers();
}

function detailCommentContextCurrent(c) {
  return !!c && c === songCommentContext && c.seq === trackDetailSeq && songDetailOpen;
}

function loadDetailComments(song, seq, sort) {
  var config = detailCommentsConfig(song);
  songCommentContext = {config: config, song: song, seq: seq, sort: sort || 'hot', comments: [], pending: Object.create(null), likeErrors: Object.create(null),
    capabilities: {read: !!config, like: false, write: false}, loading: false, error: '', hasMore: false, cursor: '', total: null, message: ''};
  if (!config) { renderSongCommentsState(); return Promise.resolve(); }
  return loadMoreDetailComments();
}

async function loadMoreDetailComments() {
  var c = songCommentContext;
  if (!detailCommentContextCurrent(c) || c.loading || !c.config) return;
  c.loading = true; c.error = ''; renderSongCommentsState();
  var cursor = c.cursor;
  try {
    var url=c.config.readUrl + '&sort=' + encodeURIComponent(c.sort) + '&cursor=' + encodeURIComponent(cursor);
    var r = await (typeof requestTrackDetailJson==='function'
      ? requestTrackDetailJson(url,{timeoutMs:10000}) : apiJson(url,{timeoutMs:10000}));
    if (!detailCommentContextCurrent(c)) return;
    if (!r || r.ok === false || r.error || !Array.isArray(r.comments)) throw new Error(r && r.message || '评论加载失败，请重试');
    if (r.provider && r.provider !== c.config.provider) throw new Error('平台返回的评论来源不匹配，请重试');
    if (r.hasMore && (!r.nextCursor || String(r.nextCursor) === cursor)) throw new Error('评论分页未前进，请重试');
    var seen = new Set(c.comments.map(function (row) { return String(row.id); }));
    r.comments.forEach(function (row) { if (row && (!row.id || !seen.has(String(row.id)))) { c.comments.push(row); if (row.id) seen.add(String(row.id)); } });
    c.cursor = String(r.nextCursor || ''); c.hasMore = !!r.hasMore; c.total = r.total;
    c.capabilities = r.capabilities || {read: true, like: false, write: false};
    c.sort = r.sort || c.sort; c.message = r.message || ''; c.config.canWrite = c.capabilities.write === true;
  } catch (error) {
    if (detailCommentContextCurrent(c)) c.error = String(error.message || '评论加载失败，请重试');
  } finally {
    if (detailCommentContextCurrent(c)) { c.loading = false; renderSongCommentsState(); }
  }
}

function changeDetailCommentSort(sort) {
  var c = songCommentContext;
  if (!detailCommentContextCurrent(c) || c.sort === sort || ['hot', 'new'].indexOf(sort) < 0 || (c.capabilities.sorts && c.capabilities.sorts.indexOf(sort) < 0)) return;
  loadDetailComments(c.song, c.seq, sort);
}

async function toggleDetailCommentLike(index) {
  var c = songCommentContext, row = c && c.comments[index];
  if (!detailCommentContextCurrent(c) || !row || !row.id || !c.capabilities.like || row.canLike === false || c.pending[row.id]) return;
  if (typeof isSongAccountLoggedIn === 'function' && !isSongAccountLoggedIn(c.config.provider)) {
    showToast('登录' + songSourceLabel(c.song) + '后即可点赞评论');
    if (typeof showLoginModal === 'function') showLoginModal({provider: c.config.provider});
    return;
  }
  var previous = {liked: !!row.liked, count: Math.max(0, Number(row.likedCount) || 0)}, desired = !previous.liked;
  c.pending[row.id] = true; delete c.likeErrors[row.id]; row.liked = desired; row.likedCount = Math.max(0, previous.count + (desired ? 1 : -1)); renderSongCommentsState();
  try {
    var r = await apiJson(c.config.endpoint + '/like', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({songId: c.config.id || c.config.mid, mid: c.config.mid, nativeMediaType: c.config.nativeMediaType || undefined, commentId: String(row.id), liked: desired,
        requestId: 'comment-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)}), timeoutMs: 20000});
    if (!detailCommentContextCurrent(c)) return;
    if (!r || r.ok === false || r.error || r.success === false) throw new Error(r && r.message || '点赞失败，请重试');
    row.liked = typeof r.liked === 'boolean' ? r.liked : desired;
    row.likedCount = r.likedCount != null ? Math.max(0, Number(r.likedCount) || 0) : Math.max(0, previous.count + (row.liked === previous.liked ? 0 : row.liked ? 1 : -1));
  } catch (error) {
    if (detailCommentContextCurrent(c)) { row.liked = previous.liked; row.likedCount = previous.count; c.likeErrors[row.id] = String(error.message || '点赞失败，请重试'); }
  } finally {
    delete c.pending[row.id]; if (detailCommentContextCurrent(c)) renderSongCommentsState();
  }
}

function commentImageFailed(img) {
  if (!img || !img.parentNode) return;
  var label = document.createElement('span'); label.className = 'comment-media-missing'; label.textContent = img.alt + '（加载失败）';
  img.parentNode.replaceChild(label, img);
}

function previewCommentImage(button) {
  var url = commentMediaUrl(button && button.getAttribute('data-image-url'));
  if (!url) return;
  closeCommentImagePreview();
  var overlay = document.createElement('div'); overlay.id = 'comment-image-preview'; overlay.className = 'comment-image-preview';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '评论图片预览');
  var close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.className = 'comment-preview-close'; close.onclick = closeCommentImagePreview;
  var img = document.createElement('img'); img.src = url; img.alt = button.getAttribute('data-image-alt') || '评论图片'; img.referrerPolicy = 'no-referrer'; img.onerror = function () { commentImageFailed(img); };
  overlay.appendChild(img); overlay.appendChild(close); overlay.onclick = function (event) { if (event.target === overlay) closeCommentImagePreview(); };
  overlay.onkeydown = function (event) { if (event.key === 'Escape') closeCommentImagePreview(); if (event.key === 'Tab') { event.preventDefault(); close.focus(); } };
  document.body.appendChild(overlay); close.focus(); previewCommentImage.trigger = button;
}

function closeCommentImagePreview() {
  var overlay = document.getElementById('comment-image-preview'); if (overlay) overlay.remove();
  var trigger = previewCommentImage.trigger; if (trigger && trigger.isConnected && trigger.focus) trigger.focus(); previewCommentImage.trigger = null;
}

async function loadSongDetailLyricPanel(song, seq, force) {
  var status = document.getElementById('song-detail-lyric-source'), panel = document.getElementById('song-detail-lyrics');
  if (!panel || typeof loadTrackDetailLyrics !== 'function') return;
  panel.innerHTML = '<div class="detail-loading">正在载入歌词…</div>';
  var info = await loadTrackDetailLyrics(song, {force: !!force});
  if (!songDetailOpen || seq !== trackDetailSeq) return;
  status = document.getElementById('song-detail-lyric-source'); panel = document.getElementById('song-detail-lyrics');
  if (!panel) return;
  var stateLabel = {ready: '原词', custom: '自定义', instrumental: '纯音乐', unavailable: '暂无歌词', error: '获取失败'}[info.status] || '暂无歌词';
  if (status) status.textContent = (info.sourceLabel || songSourceLabel(song)) + ' · ' + stateLabel;
  var lines = Array.isArray(info.lines) ? info.lines : [];
  panel.innerHTML = lines.length ? '<details class="song-detail-lyric-fold"><summary>查看歌词 <span>' + lines.length + ' 行</span></summary><div class="song-detail-lyric-lines">' + lines.map(function (line) {
    return '<p>' + commentEsc(line.text) + (line.translation ? '<small>' + commentEsc(line.translation) + '</small>' : '') + '</p>';
  }).join('') + '</div></details>' : info.status==='error'
    ? '<div class="song-detail-lyric-message">' + commentEsc(info.message || '歌词加载失败') + '</div>' : '';
  if (info.status === 'error') panel.innerHTML += '<button type="button" class="detail-action-toggle" onclick="retrySongDetailLyrics()">重试歌词</button>';
}

function retrySongDetailLyrics() { if (songDetailOpen && detailCommentSong) loadSongDetailLyricPanel(detailCommentSong, trackDetailSeq, true); }

function syncOpenTrackDetailSong() {
  if (!songDetailOpen) return;
  var song = currentCoverSong(), key = songDetailNativeKey(song);
  if (song && key && key !== songDetailPlaybackKey) openTrackDetailModal('song', song);
}

function refreshSongDetailAccount() {
  if (songDetailOpen && detailCommentSong) openTrackDetailModal('song', detailCommentSong);
}

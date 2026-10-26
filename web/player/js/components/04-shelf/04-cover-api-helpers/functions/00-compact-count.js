'use strict';

function compactCount(n) {
  n = Number(n) || 0;
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

function drawCanvasHeart(ctx, cx, cy, size, color) {
  var s = (size || 20) / 28;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 10.2);
  ctx.bezierCurveTo(-8.9, 2.6, -13.8, -1.9, -13.8, -7.4);
  ctx.bezierCurveTo(-13.8, -12.0, -10.3, -15.2, -5.9, -15.2);
  ctx.bezierCurveTo(-3.2, -15.2, -1.1, -13.9, 0, -11.9);
  ctx.bezierCurveTo(1.1, -13.9, 3.2, -15.2, 5.9, -15.2);
  ctx.bezierCurveTo(10.3, -15.2, 13.8, -12.0, 13.8, -7.4);
  ctx.bezierCurveTo(13.8, -1.9, 8.9, 2.6, 0, 10.2);
  ctx.closePath();
  ctx.fillStyle = color || '#ff7a90';
  ctx.fill();
  ctx.restore();
}

function requestPlaylistCover(url, cb) {
  if (!url) { if (cb) cb(null); return; }
  var rec = playlistCoverCache[url];
  if (rec && rec.loaded) { if (cb) setTimeout(function () { cb(rec.img); }, 0); return; }
  if (rec && rec.loading) { if (cb) rec.waiters.push(cb); return; }
  if (rec && rec.failed && Date.now() < rec.retryAt) { if (cb) setTimeout(function () { cb(null); }, 0); return; }
  rec = playlistCoverCache[url] = { loaded: false, loading: true, waiters: cb ? [cb] : [], img: null, failed: false };
  var img = new Image();
  if (!isInlineCoverSrc(url)) img.crossOrigin = 'anonymous';
  img.onload = function () {
    rec.loaded = true; rec.loading = false; rec.img = img;
    rec.waiters.splice(0).forEach(function (fn) { setTimeout(function () { fn(img); }, 0); });
  };
  img.onerror = function () {
    rec.loading = false; rec.failed = true; rec.retryAt = Date.now() + 4000;
    rec.waiters.splice(0).forEach(function (fn) { setTimeout(function () { fn(null); }, 0); });
  };
  var src = /^\/assets\/platforms\/[a-z]+\.png$/.test(url) ? url : coverProxySrc(url);
  if (!src) {
    rec.loading = false; rec.failed = true; rec.retryAt = Date.now() + 4000;
    rec.waiters.splice(0).forEach(function (fn) { setTimeout(function () { fn(null); }, 0); });
    return;
  }
  img.src = src;
}

function shelfCoverFallbackSrc(item) {
  var provider = String(item && (item.provider || item.source) || '');
  var id = String(item && (item.playlistId || item.id) || '');
  var chart = /(?:^|:)chart:(netease|qqmusic|qq|kugou|qishui):/.exec(id);
  if (chart) provider = chart[1];
  if (provider === 'qqmusic') provider = 'qq';
  return ['netease', 'qq', 'kugou', 'qishui'].indexOf(provider) >= 0 ? '/assets/platforms/' + provider + '.png' : '';
}

function shelfCoverMayRequest(rec) {
  return !rec || !rec.loaded && (!rec.failed || !rec.retryAt || Date.now() >= rec.retryAt);
}

// Canvas cards are recycled while scrolling. Subscribe each new card/row to
// an in-flight image and redraw its CURRENT item, never the old captured one.
function requestShelfTargetCover(target, url, redraw) {
  if (!url || target.pendingCoverUrl === url) return;
  target.pendingCoverUrl = url;
  requestPlaylistCover(url, function () {
    if (target.pendingCoverUrl !== url) return;
    target.pendingCoverUrl = '';
    if (!target.mesh || !target.mesh.parent) return;
    target.drawKey = '';
    redraw();
  });
}

function drawShelfCoverPlaceholder(ctx, x, y, size) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '600 ' + Math.round(size * 0.45) + 'px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('♫', x + size / 2, y + size / 2);
  ctx.restore();
}

// ============================================================
//  3D 卡片交互 - PSP 风格
//   - 滚轮: 滚动 center 卡 (一级或二级)
//   - 点击 center 卡: 打开内容框 (歌单) 或 播放 (队列)
//   - 点击两侧卡: 滚到那张
//   - ESC: 关闭内容框

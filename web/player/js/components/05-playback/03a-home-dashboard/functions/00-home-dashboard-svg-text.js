'use strict';



function homeDashboardSvgText(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


function homeDashboardCoverInitials(text) {
  var raw = String(text || '音乐').replace(/\s+/g, '').trim();
  var chars = Array.from(raw || '音乐');
  return chars.slice(0, Math.min(2, chars.length)).join('');
}


function homeDashboardGeneratedCover(title, label, tone) {
  var palettes = {
    search: ['#9db8cf', '#f8f4ee', '#00f5d4'],
    playlist: ['#9db8cf', '#00f5d4', '#2442ff'],
    library: ['#00f5d4', '#f8f4ee', '#2442ff'],
    mix: ['#f8f4ee', '#00f5d4', '#2442ff'],
  };
  var palette = palettes[tone] || palettes.playlist;
  var letters = homeDashboardSvgText(homeDashboardCoverInitials(title || label));
  var sub = homeDashboardSvgText(String(label || 'MINERADIO').toUpperCase().slice(0, 14));
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' + palette[0] + '"/><stop offset=".52" stop-color="' + palette[1] + '"/>' +
    '<stop offset="1" stop-color="' + palette[2] + '"/></linearGradient>' +
    '<radialGradient id="r" cx="34%" cy="24%" r="72%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/>' +
    '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="320" height="320" rx="54" fill="#080a10"/>' +
    '<rect width="320" height="320" rx="54" fill="url(#g)" opacity=".84"/>' +
    '<circle cx="242" cy="66" r="98" fill="url(#r)"/>' +
    '<circle cx="112" cy="214" r="84" fill="#05060a" opacity=".34"/>' +
    '<circle cx="112" cy="214" r="52" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="2"/>' +
    '<circle cx="112" cy="214" r="22" fill="#fff" opacity=".18"/>' +
    '<path d="M222 118v98c0 19-16 34-39 34-20 0-35-11-35-27 0-17 16-29 38-29 7 0 14 1 20 4v-90l72-18v30z" fill="#fff" opacity=".32"/>' +
    '<text x="28" y="72" fill="#fff" opacity=".72" font-size="18" font-family="Arial,Microsoft YaHei,sans-serif" font-weight="800" letter-spacing="2">' + sub + '</text>' +
    '<text x="28" y="148" fill="#fff" font-size="58" font-family="Arial,Microsoft YaHei,sans-serif" font-weight="900">' + letters + '</text>' +
    '<rect x="0" y="0" width="320" height="320" rx="54" fill="none" stroke="#fff" stroke-opacity=".20"/>' +
    '</svg>';
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}


function homeDashboardReadReviews() {
  try {
    var saved = JSON.parse(localStorage.getItem('mineradio-daily-review-quotes-v1') || '[]');
    if (Array.isArray(saved) && saved.length) {
      var normalized = saved.map(function (item) {
        if (typeof item === 'string') return { text: item.trim(), source: '我的热评' };
        return {
          text: String(item && item.text || '').trim(),
          source: String(item && item.source || '我的热评').trim(),
        };
      }).filter(function (item) { return item.text; });
      if (normalized.length) return normalized;
    }
  } catch (_error) { }
  return HOME_DASHBOARD_REVIEW_DEFAULTS.slice();
}


function homeDashboardDayNumber() {
  var now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86400000);
}


function homeDashboardSelectedReview() {
  var reviews = homeDashboardReadReviews();
  if (!reviews.length) return { text: '让今天的声音，从你喜欢的地方开始。', source: 'Mineradio' };
  var index = ((homeDashboardDayNumber() + homeDashboardReviewOffset) % reviews.length + reviews.length) % reviews.length;
  return reviews[index];
}


function homeDashboardUpdateClock() {
  var time = document.getElementById('daily-review-time');
  var date = document.getElementById('daily-review-date');
  if (!time || !date) return;
  var now = new Date();
  time.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  date.textContent = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}


function homeDashboardNotify(message) {
  if (typeof showToast === 'function') showToast(message);
  else console.info('[HomeDashboard]', message);
}


function homeDashboardOpenVideoDb() {
  if (homeDashboardVideoDbPromise) return homeDashboardVideoDbPromise;
  homeDashboardVideoDbPromise = new Promise(function (resolve, reject) {
    if (!window.indexedDB) {
      reject(new Error('INDEXEDDB_UNAVAILABLE'));
      return;
    }
    var request = window.indexedDB.open(HOME_DASHBOARD_VIDEO_DB_NAME, 1);
    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains(HOME_DASHBOARD_VIDEO_STORE)) {
        db.createObjectStore(HOME_DASHBOARD_VIDEO_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () {
      homeDashboardVideoDbPromise = null;
      reject(request.error || new Error('HOME_VIDEO_DB_OPEN_FAILED'));
    };
  });
  return homeDashboardVideoDbPromise;
}


async function homeDashboardPutVideoBlob(blob, meta) {
  var db = await homeDashboardOpenVideoDb();
  return new Promise(function (resolve, reject) {
    var transaction = db.transaction(HOME_DASHBOARD_VIDEO_STORE, 'readwrite');
    transaction.objectStore(HOME_DASHBOARD_VIDEO_STORE).put({
      id: HOME_DASHBOARD_VIDEO_BLOB_ID,
      blob: blob,
      meta: meta,
    });
    transaction.oncomplete = function () { resolve(); };
    transaction.onerror = function () { reject(transaction.error || new Error('HOME_VIDEO_SAVE_FAILED')); };
    transaction.onabort = function () { reject(transaction.error || new Error('HOME_VIDEO_SAVE_ABORTED')); };
  });
}


async function homeDashboardGetVideoBlob() {
  var db = await homeDashboardOpenVideoDb();
  return new Promise(function (resolve, reject) {
    var transaction = db.transaction(HOME_DASHBOARD_VIDEO_STORE, 'readonly');
    var request = transaction.objectStore(HOME_DASHBOARD_VIDEO_STORE).get(HOME_DASHBOARD_VIDEO_BLOB_ID);
    request.onsuccess = function () { resolve(request.result || null); };
    request.onerror = function () { reject(request.error || new Error('HOME_VIDEO_READ_FAILED')); };
  });
}


async function homeDashboardDeleteVideoBlob() {
  var db = await homeDashboardOpenVideoDb();
  return new Promise(function (resolve, reject) {
    var transaction = db.transaction(HOME_DASHBOARD_VIDEO_STORE, 'readwrite');
    transaction.objectStore(HOME_DASHBOARD_VIDEO_STORE).delete(HOME_DASHBOARD_VIDEO_BLOB_ID);
    transaction.oncomplete = function () { resolve(); };
    transaction.onerror = function () { reject(transaction.error || new Error('HOME_VIDEO_DELETE_FAILED')); };
    transaction.onabort = function () { reject(transaction.error || new Error('HOME_VIDEO_DELETE_ABORTED')); };
  });
}


function homeDashboardReadVideoMeta() {
  try {
    var meta = JSON.parse(localStorage.getItem(HOME_DASHBOARD_VIDEO_META_KEY) || 'null');
    if (!meta || meta.version !== 1 || !/\.mp4$/i.test(String(meta.name || ''))) return null;
    if (meta.type && String(meta.type).toLowerCase() !== 'video/mp4') return null;
    return meta;
  } catch (_error) {
    return null;
  }
}


function homeDashboardIsMp4File(file) {
  if (!file || !/\.mp4$/i.test(String(file.name || ''))) return false;
  var type = String(file.type || '').toLowerCase();
  return !type || type === 'video/mp4';
}


function homeDashboardVideoShouldPlay() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return false;
  return !document.hidden
    && typeof emptyHomeActive !== 'undefined'
    && !!emptyHomeActive
    && !!document.body
    && document.body.classList.contains('empty-home-active');
}


function homeDashboardReleaseVideoSource(removeElement) {
  homeDashboardVideoLoadToken += 1;
  var video = document.querySelector('#empty-home .home-dashboard-video');
  if (video) {
    try { video.pause(); } catch (_error) { }
    try {
      video.removeAttribute('src');
      video.load();
    } catch (_error) { }
    if (removeElement !== false && video.parentNode) video.parentNode.removeChild(video);
  }
  if (homeDashboardVideoObjectUrl) {
    try { URL.revokeObjectURL(homeDashboardVideoObjectUrl); } catch (_error) { }
    homeDashboardVideoObjectUrl = '';
  }
}


async function homeDashboardAttachVideo() {
  var meta = homeDashboardReadVideoMeta();
  if (!meta || !homeDashboardVideoShouldPlay() || homeDashboardVideoDecodeFailed) {
    homeDashboardReleaseVideoSource(true);
    return;
  }
  var card = document.querySelector('#empty-home .daily-review-card');
  if (!card) return;
  var currentVideo = card.querySelector('.home-dashboard-video');
  if (currentVideo && homeDashboardVideoObjectUrl) {
    currentVideo.play().catch(function () { });
    return;
  }
  if (homeDashboardVideoAttachBusy) return;

  homeDashboardVideoAttachBusy = true;
  homeDashboardReleaseVideoSource(true);
  var token = homeDashboardVideoLoadToken;
  var shouldRetry = false;
  try {
    var record = await homeDashboardGetVideoBlob();
    if (token !== homeDashboardVideoLoadToken || !homeDashboardVideoShouldPlay()) {
      shouldRetry = homeDashboardVideoShouldPlay();
      return;
    }
    var blob = record && record.blob;
    if (!blob) {
      localStorage.removeItem(HOME_DASHBOARD_VIDEO_META_KEY);
      homeDashboardRenderVideoActions();
      return;
    }
    var objectUrl = URL.createObjectURL(blob);
    if (token !== homeDashboardVideoLoadToken || !homeDashboardVideoShouldPlay()) {
      URL.revokeObjectURL(objectUrl);
      shouldRetry = homeDashboardVideoShouldPlay();
      return;
    }
    var video = document.createElement('video');
    video.className = 'home-dashboard-video';
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'metadata';
    video.src = objectUrl;
    video.addEventListener('error', function () {
      if (token !== homeDashboardVideoLoadToken || !video.getAttribute('src')) return;
      homeDashboardVideoDecodeFailed = true;
      homeDashboardReleaseVideoSource(true);
      homeDashboardNotify('这个 MP4 无法解码，请换成 H.264 编码的 MP4');
    }, { once: true });
    homeDashboardVideoObjectUrl = objectUrl;
    card.insertBefore(video, card.firstChild);
    video.play().catch(function () { });
  } catch (error) {
    console.warn('[HomeDashboardVideo]', error);
    homeDashboardReleaseVideoSource(true);
    homeDashboardNotify('主页 MP4 读取失败，请重新选择');
  } finally {
    homeDashboardVideoAttachBusy = false;
    if (shouldRetry && !homeDashboardVideoDecodeFailed) {
      setTimeout(function () { homeDashboardUpdateVideoPower(); }, 0);
    }
  }
}


function homeDashboardRenderVideoActions() {
  var hasVideo = !!homeDashboardReadVideoMeta();
  var choose = document.getElementById('home-dashboard-video-choose');
  var clear = document.getElementById('home-dashboard-video-clear');
  if (choose) choose.textContent = hasVideo ? '更换 MP4' : '选择 MP4';
  if (clear) clear.hidden = !hasVideo;
}


function homeDashboardUpdateVideoPower() {
  if (!homeDashboardVideoShouldPlay() || !homeDashboardReadVideoMeta()) {
    homeDashboardReleaseVideoSource(true);
    return;
  }
  var video = document.querySelector('#empty-home .home-dashboard-video');
  if (video && homeDashboardVideoObjectUrl) video.play().catch(function () { });
  else homeDashboardAttachVideo();
}


function openHomeDashboardVideoPicker() {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  var input = document.getElementById('home-dashboard-video-input');
  if (input) input.click();
}


async function handleHomeDashboardVideoFile(file) {
  if (!homeDashboardIsMp4File(file)) {
    homeDashboardNotify('这里只能选择 .mp4 文件');
    return;
  }
  if (Number(file.size) > HOME_DASHBOARD_VIDEO_MAX_BYTES) {
    homeDashboardNotify('MP4 不能超过 300 MB');
    return;
  }
  var meta = {
    version: 1,
    name: String(file.name || 'home.mp4'),
    type: 'video/mp4',
    size: Number(file.size) || 0,
    savedAt: Date.now(),
  };
  try {
    await homeDashboardPutVideoBlob(file, meta);
    localStorage.setItem(HOME_DASHBOARD_VIDEO_META_KEY, JSON.stringify(meta));
    homeDashboardVideoDecodeFailed = false;
    homeDashboardReleaseVideoSource(true);
    homeDashboardRenderVideoActions();
    homeDashboardUpdateVideoPower();
    homeDashboardNotify('主页 MP4 已保存');
  } catch (error) {
    console.warn('[HomeDashboardVideoSave]', error);
    homeDashboardNotify('主页 MP4 保存失败');
  }
}


async function clearHomeDashboardVideo() {
  localStorage.removeItem(HOME_DASHBOARD_VIDEO_META_KEY);
  homeDashboardVideoDecodeFailed = false;
  homeDashboardReleaseVideoSource(true);
  homeDashboardRenderVideoActions();
  try {
    await homeDashboardDeleteVideoBlob();
  } catch (error) {
    console.warn('[HomeDashboardVideoDelete]', error);
  }
  homeDashboardNotify('已恢复主页默认动画');
}


function bindHomeDashboardVideoControls() {
  if (homeDashboardVideoControlsBound) return;
  homeDashboardVideoControlsBound = true;
  var input = document.getElementById('home-dashboard-video-input');
  if (input) {
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (file) handleHomeDashboardVideoFile(file);
    });
  }
  if (window.MutationObserver && document.body) {
    homeDashboardVideoPowerObserver = new MutationObserver(function () {
      homeDashboardUpdateVideoPower();
    });
    homeDashboardVideoPowerObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('pagehide', function () { homeDashboardReleaseVideoSource(true); });
}

'use strict';

// ============================================================
async function apiJson(url, opts) {
  opts = opts || {};
  if (typeof navigator !== 'undefined' && navigator.onLine === false &&
      /^\/api\/(?:(?:qq|kugou|qishui)\/)?(?:search|song\/|lyric|discover\/|download|recommendations)/.test(String(url))) {
    throw new Error('当前已离线，请从本地音乐播放已保存的歌曲');
  }
  var timeoutMs = Number(opts.timeoutMs) || 0;
  var fetchOpts = Object.assign({}, opts);
  if (window.MINERADIO_LOCAL_WEB && window.localMusicCredentials) {
    fetchOpts.headers = Object.assign({}, fetchOpts.headers || {}, window.localMusicCredentials.headers(url));
    fetchOpts.credentials = 'omit';
    fetchOpts.cache = 'no-store';
  }
  delete fetchOpts.timeoutMs;
  var timer = null;
  var parentSignal = fetchOpts.signal;
  var controller = window.AbortController && (parentSignal || timeoutMs > 0)
    ? new window.AbortController() : null;
  if (controller) fetchOpts.signal = controller.signal;
  var rejectAbort = null;
  var aborted = false;
  var abortError = null;
  var finished = false;
  var hasDeadline = timeoutMs > 0 && Number.isFinite(timeoutMs);
  var abortPromise = parentSignal || hasDeadline ? new Promise(function (_resolve, reject) {
    rejectAbort = reject;
  }) : null;
  function abortRequest(message) {
    if (finished || aborted) return;
    aborted = true;
    abortError = new Error(message || '请求已取消');
    abortError.name = 'AbortError';
    if (controller) controller.abort();
    if (rejectAbort) rejectAbort(abortError);
  }
  function onParentAbort() { abortRequest('请求已取消'); }
  if (parentSignal && typeof parentSignal.addEventListener === 'function') {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  if (parentSignal && parentSignal.aborted) onParentAbort();
  if (hasDeadline && !aborted) timer = setTimeout(function () { abortRequest('请求超时，请重试'); }, timeoutMs);
  try {
    // The deadline covers JSON decoding too. The explicit race also releases
    // callers when a bridge/mock fails to reject its fetch promise on abort.
    var request = Promise.resolve().then(function () {
      if (aborted) throw abortError;
      return fetch(url, fetchOpts);
    }).then(function (res) { return res.json(); });
    return await (abortPromise ? Promise.race([request, abortPromise]) : request);
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === 'function') {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function normalizePlaybackQuality(value) {
  value = String(value || '').toLowerCase();
  if (value === 'jymaster' || value === 'master' || value === 'svip') return 'jymaster';
  if (value === 'hires' || value === 'hi-res' || value === 'highres' || value === 'highest') return 'hires';
  if (value === 'lossless' || value === 'flac' || value === 'sq') return 'lossless';
  if (value === 'exhigh' || value === 'high' || value === '320k' || value === 'hq') return 'exhigh';
  if (value === 'standard' || value === 'normal' || value === 'std') return 'standard';
  return 'hires';
}

function normalizePlaybackProvider(provider) {
  if (provider === 'qq') return 'qq';
  if (provider === 'kugou') return 'kugou';
  if (provider === 'qishui') return 'qishui';
  if (provider === 'spotify') return 'spotify';
  return 'netease';
}

function normalizePlaybackQualityForProvider(value, provider) {
  provider = normalizePlaybackProvider(provider);
  var q = normalizePlaybackQuality(value);
  if (provider === 'qq' && q === 'jymaster') return 'hires';
  return q;
}

function playbackQualityOptions(provider) {
  provider = normalizePlaybackProvider(provider);
  return PLAYBACK_QUALITY_OPTIONS[provider] || PLAYBACK_QUALITY_OPTIONS.netease;
}

function currentPlaybackQualityProvider() {
  var song = Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
  return normalizePlaybackProvider(songProviderKey(song));
}

function getProviderPlaybackQuality(provider) {
  provider = normalizePlaybackProvider(provider);
  var prefs = playbackQualityPrefs || {};
  return normalizePlaybackQualityForProvider(prefs[provider] || PLAYBACK_QUALITY_DEFAULTS[provider], provider);
}

function setProviderPlaybackQuality(provider, value) {
  provider = normalizePlaybackProvider(provider);
  if (!playbackQualityPrefs || typeof playbackQualityPrefs !== 'object') playbackQualityPrefs = {};
  playbackQualityPrefs[provider] = normalizePlaybackQualityForProvider(value, provider);
  playbackQuality = playbackQualityPrefs[provider];
  savePlaybackQualityPreference();
}

function getPlaybackQualityForSong(song) {
  var provider = normalizePlaybackProvider(songProviderKey(song));
  return getProviderPlaybackQuality(provider);
}

function playbackQualityLabel(value, provider) {
  provider = normalizePlaybackProvider(provider || currentPlaybackQualityProvider());
  value = normalizePlaybackQualityForProvider(value, provider);
  if (provider === 'spotify') return 'Spotify 匹配源';
  if (provider === 'qishui') return '汽水音质';
  if (provider === 'qq') {
    if (value === 'hires') return 'Hi-Res FLAC';
    if (value === 'lossless') return '无损 FLAC';
    if (value === 'exhigh') return '320k MP3';
    if (value === 'standard') return '128k MP3';
    return '无损 FLAC';
  }
  if (provider === 'kugou') {
    if (value === 'hires') return '酷狗 Hi-Res';
    if (value === 'lossless') return '酷狗无损';
    if (value === 'exhigh') return '酷狗 320k';
    if (value === 'standard') return '酷狗 128k';
    return '酷狗无损';
  }
  if (value === 'jymaster') return '超清母带';
  if (value === 'hires') return '高清臻音';
  if (value === 'lossless') return '无损';
  if (value === 'exhigh') return '极高';
  if (value === 'standard') return '标准';
  return '高清臻音';
}

function playbackQualityShortLabel(value, provider) {
  provider = normalizePlaybackProvider(provider || currentPlaybackQualityProvider());
  value = normalizePlaybackQualityForProvider(value, provider);
  if (provider === 'spotify') return 'SP';
  if (provider === 'qishui') return 'QS';
  if (provider === 'qq') {
    if (value === 'hires') return 'QQ Hires';
    if (value === 'lossless') return 'QQ SQ';
    if (value === 'exhigh') return 'QQ 320';
    if (value === 'standard') return 'QQ 128';
    return 'QQ SQ';
  }
  if (provider === 'kugou') {
    if (value === 'hires') return 'KG Hires';
    if (value === 'lossless') return 'KG SQ';
    if (value === 'exhigh') return 'KG 320';
    if (value === 'standard') return 'KG 128';
    return 'KG SQ';
  }
  if (value === 'jymaster') return '母带';
  if (value === 'hires') return '臻音';
  if (value === 'lossless') return 'SQ';
  if (value === 'exhigh') return 'HQ';
  if (value === 'standard') return 'STD';
  return '臻音';
}

function playbackQualityRank(value, provider) {
  value = normalizePlaybackQualityForProvider(value, provider);
  if (value === 'jymaster') return 5;
  if (value === 'hires') return 4;
  if (value === 'lossless') return 3;
  if (value === 'exhigh') return 2;
  if (value === 'standard') return 1;
  return 4;
}

function playbackQualityWasDowngraded(requested, resolved, provider) {
  return playbackQualityRank(resolved, provider) < playbackQualityRank(requested, provider);
}

function playbackQualityTrackKey(song, provider) {
  provider = normalizePlaybackProvider(provider || songProviderKey(song));
  song = song || {};
  var id = song.id || song.mid || song.songmid || song.hash || song.fileHash || song.audioHash || song.providerSongId || '';
  var media = song.mediaMid || song.media_mid || song.albumAudioId || song.album_audio_id || song.mixSongId || '';
  if (!id) id = [song.name || song.title || '', song.artist || '', song.album || ''].join('|');
  return provider + ':' + String(id || '').trim() + ':' + String(media || '').trim();
}

function playbackQualityRuntimeCapForSong(song, provider) {
  if (!song) return null;
  var key = playbackQualityTrackKey(song, provider);
  return key && playbackQualityRuntimeCaps ? playbackQualityRuntimeCaps[key] || null : null;
}

function playbackQualityCapValue(song, provider) {
  var cap = playbackQualityRuntimeCapForSong(song, provider);
  return cap && cap.ceiling ? normalizePlaybackQualityForProvider(cap.ceiling, provider) : '';
}

function playbackQualityAboveCap(value, provider, capValue) {
  if (!capValue) return false;
  capValue = normalizePlaybackQualityForProvider(capValue, provider);
  return playbackQualityRank(value, provider) > playbackQualityRank(capValue, provider);
}

function effectivePlaybackQualityForSong(song, provider, requested) {
  provider = normalizePlaybackProvider(provider || songProviderKey(song));
  var q = normalizePlaybackQualityForProvider(requested || getProviderPlaybackQuality(provider), provider);
  var cap = playbackQualityCapValue(song, provider);
  return playbackQualityAboveCap(q, provider, cap) ? cap : q;
}

function markPlaybackQualityRuntimeCap(song, provider, ceiling, reason) {
  provider = normalizePlaybackProvider(provider || songProviderKey(song));
  if (!song || !ceiling) return false;
  ceiling = normalizePlaybackQualityForProvider(ceiling, provider);
  var key = playbackQualityTrackKey(song, provider);
  if (!key) return false;
  var prev = playbackQualityRuntimeCaps && playbackQualityRuntimeCaps[key];
  if (prev && playbackQualityRank(prev.ceiling, provider) <= playbackQualityRank(ceiling, provider)) return false;
  playbackQualityRuntimeCaps[key] = {
    provider: provider,
    ceiling: ceiling,
    reason: reason || '',
    at: Date.now()
  };
  updatePlaybackQualityUi();
  return true;
}

function playbackBitrateLabel(br) {
  br = Number(br) || 0;
  if (!br) return '';
  if (br >= 1000000) return (br / 1000000).toFixed(br >= 2000000 ? 1 : 2).replace(/\.0+$/, '') + ' Mbps';
  return Math.round(br / 1000) + ' kbps';
}

function playbackResolvedQualityText(data, provider) {
  data = data || {};
  provider = normalizePlaybackProvider(provider || data.provider || currentPlaybackQualityProvider());
  var label = provider === 'qq' && data.quality
    ? String(data.quality)
    : playbackQualityLabel(data.level || getProviderPlaybackQuality(provider), provider);
  var br = playbackBitrateLabel(data.br);
  return br ? (label + ' · ' + br) : label;
}

function readPlaybackQualityPreference() {
  var fallback = {
    netease: PLAYBACK_QUALITY_DEFAULTS.netease,
    qq: PLAYBACK_QUALITY_DEFAULTS.qq,
    kugou: PLAYBACK_QUALITY_DEFAULTS.kugou,
    qishui: PLAYBACK_QUALITY_DEFAULTS.qishui,
    spotify: PLAYBACK_QUALITY_DEFAULTS.spotify
  };
  try {
    var raw = localStorage.getItem(PLAYBACK_QUALITY_STORE_KEY) || '';
    if (!raw) return fallback;
    if (raw.trim().charAt(0) !== '{') {
      var legacy = normalizePlaybackQuality(raw);
      return {
        netease: normalizePlaybackQualityForProvider(legacy, 'netease'),
        qq: normalizePlaybackQualityForProvider(legacy, 'qq'),
        kugou: normalizePlaybackQualityForProvider(legacy, 'kugou'),
        qishui: normalizePlaybackQualityForProvider(fallback.qishui, 'qishui'),
        spotify: normalizePlaybackQualityForProvider(fallback.spotify, 'spotify')
      };
    }
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      netease: normalizePlaybackQualityForProvider(parsed.netease || fallback.netease, 'netease'),
      qq: normalizePlaybackQualityForProvider(parsed.qq || fallback.qq, 'qq'),
      kugou: normalizePlaybackQualityForProvider(parsed.kugou || fallback.kugou || 'lossless', 'kugou'),
      qishui: normalizePlaybackQualityForProvider(parsed.qishui || fallback.qishui || 'standard', 'qishui'),
      spotify: normalizePlaybackQualityForProvider(parsed.spotify || fallback.spotify || 'standard', 'spotify')
    };
  } catch (e) {
    return fallback;
  }
}

function savePlaybackQualityPreference() {
  try { localStorage.setItem(PLAYBACK_QUALITY_STORE_KEY, JSON.stringify(playbackQualityPrefs || {})); } catch (e) { }
}

function updatePlaybackQualityUi() {
  var provider = currentPlaybackQualityProvider();
  var currentSong = Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
  var currentQuality = getProviderPlaybackQuality(provider);
  var runtimeCapQuality = playbackQualityCapValue(currentSong, provider);
  var effectiveQuality = effectivePlaybackQualityForSong(currentSong, provider, currentQuality);
  playbackQuality = currentQuality;
  var label = document.getElementById('quality-btn-label');
  var btn = document.getElementById('quality-btn');
  var list = document.getElementById('quality-option-list');
  var canUseSvip = provider === 'netease' && hasProviderSvip('netease', loginStatus);
  var displayQuality = provider === 'netease' && effectiveQuality === 'jymaster' && !canUseSvip ? 'hires' : effectiveQuality;
  if (label) label.textContent = playbackQualityShortLabel(displayQuality, provider);
  var qualityProviderTitle = provider === 'spotify' ? 'Spotify 匹配源: ' : (provider === 'qishui' ? '汽水音质: ' : (provider === 'qq' ? 'QQ 音质: ' : (provider === 'kugou' ? '酷狗音质: ' : '网易云音质: ')));
  if (btn) btn.title = qualityProviderTitle + playbackQualityLabel(displayQuality, provider) +
    (provider === 'netease' && currentQuality === 'jymaster' && !canUseSvip ? ' · 超清母带需网易云 SVIP' : '');
  if (btn && runtimeCapQuality) btn.title += ' | 当前歌曲最高: ' + playbackQualityLabel(runtimeCapQuality, provider);
  if (list) {
    list.innerHTML = playbackQualityOptions(provider).map(function (item) {
      var capLocked = playbackQualityAboveCap(item.key, provider, runtimeCapQuality);
      var locked = !!(item.svip && !canUseSvip) || capLocked;
      return '<button class="quality-option' + (item.svip ? ' svip-only' : '') + (capLocked ? ' cap-locked' : '') + (locked ? ' locked' : '') + '" data-quality="' + item.key + '" data-svip="' + (item.svip ? '1' : '0') + '" ' + (locked ? 'disabled ' : '') + 'onclick="setPlaybackQuality(\'' + item.key + '\')"><span>' + escHtml(item.title) + '</span><small>' + escHtml(capLocked ? ('当前最高 ' + playbackQualityLabel(runtimeCapQuality, provider)) : item.sub) + '</small></button>';
    }).join('');
  }
  document.querySelectorAll('.quality-option').forEach(function (option) {
    var q = normalizePlaybackQualityForProvider(option.dataset.quality, provider);
    var capLocked = playbackQualityAboveCap(q, provider, runtimeCapQuality);
    var locked = (option.dataset.svip === '1' && !canUseSvip) || capLocked;
    option.classList.toggle('active', q === displayQuality);
    option.classList.toggle('locked', locked);
    option.classList.toggle('cap-locked', capLocked);
    option.disabled = locked;
    if (capLocked) option.title = '当前歌曲最高: ' + playbackQualityLabel(runtimeCapQuality, provider);
    option.title = locked ? '需要网易云 SVIP 账号' : playbackQualityLabel(q, provider);
  });
  if (runtimeCapQuality) {
    document.querySelectorAll('.quality-option.cap-locked').forEach(function (option) {
      option.title = '当前歌曲最高: ' + playbackQualityLabel(runtimeCapQuality, provider);
    });
  }
}

function setPlaybackQuality(value) {
  var provider = currentPlaybackQualityProvider();
  var currentSong = Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
  var next = normalizePlaybackQualityForProvider(value, provider);
  var cap = playbackQualityCapValue(currentSong, provider);
  if (playbackQualityAboveCap(next, provider, cap)) {
    showSourceFallbackNotice('音质已锁定上限', '当前歌曲最高可播 ' + playbackQualityLabel(cap, provider) + '，更高档位已禁用。');
    updatePlaybackQualityUi();
    return;
  }
  if (provider === 'netease' && next === 'jymaster' && !hasProviderSvip('netease', loginStatus)) {
    showToast(hasPlatformLogin('netease') ? '超清母带需要网易云 SVIP' : '登录网易云 SVIP 后可用超清母带');
    if (!hasPlatformLogin('netease')) openProviderLogin('netease');
    return;
  }
  setProviderPlaybackQuality(provider, next);
  updatePlaybackQualityUi();
  var wrap = document.getElementById('quality-control');
  if (wrap) wrap.classList.remove('open');
  applyPlaybackQualityToCurrentTrack(next, provider);
}

function canReloadCurrentTrackForQuality() {
  if (currentIdx < 0 || currentIdx >= playQueue.length) return false;
  if (!audio || !audio.src || audio.paused || audio.ended) return false;
  var song = playQueue[currentIdx];
  if (!song || song.type === 'local' || song.source === 'local') return false;
  return songProviderKey(song) === 'netease' || songProviderKey(song) === 'qq' || songProviderKey(song) === 'kugou';
}

function applyPlaybackQualityToCurrentTrack(nextQuality, provider) {
  var song = currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
  provider = normalizePlaybackProvider(provider || songProviderKey(song));
  var label = playbackQualityLabel(nextQuality || getProviderPlaybackQuality(provider), provider);
  if (!canReloadCurrentTrackForQuality()) {
    showToast('音质偏好: ' + label + ' · 下次播放生效');
    return;
  }
  var resumeAt = audio && isFinite(audio.currentTime) ? audio.currentTime : 0;
  showToast('正在切换音质: ' + label);
  Promise.resolve(playQueueAt(currentIdx, {
    qualityOverride: nextQuality || getProviderPlaybackQuality(provider),
    qualitySwitch: true,
    resumeAt: resumeAt,
    preserveHomeState: true,
  })).catch(function (e) {
    console.warn('[QualitySwitch]', e);
    showToast('音质切换失败，已保留偏好');
  }).finally(forcePlaybackControlsInteractive);
}

function toggleQualityPanel(e) {
  if (e) e.stopPropagation();
  var wrap = document.getElementById('quality-control');
  if (wrap) {
    wrap.classList.toggle('open');
  }
}

function bindQualityControl() {
  var wrap = document.getElementById('quality-control');
  if (wrap) {
    wrap.addEventListener('mouseenter', function () { wrap.classList.add('open'); });
    wrap.addEventListener('mouseleave', function () { setTimeout(function () { if (!wrap.matches(':hover')) wrap.classList.remove('open'); }, 260); });
  }
  document.addEventListener('click', function (e) {
    if (wrap && !wrap.contains(e.target)) wrap.classList.remove('open');
  });
  updatePlaybackQualityUi();
}

function audioRoutePointForPort(port, root) {
  if (!port || !root) return null;
  var portRect = port.getBoundingClientRect();
  var rootRect = root.getBoundingClientRect();
  return {
    x: portRect.left + portRect.width / 2 - rootRect.left,
    y: portRect.top + portRect.height / 2 - rootRect.top
  };
}

function audioRoutePointFromEvent(e, root) {
  if (!e || !root) return null;
  var rootRect = root.getBoundingClientRect();
  return { x: e.clientX - rootRect.left, y: e.clientY - rootRect.top };
}

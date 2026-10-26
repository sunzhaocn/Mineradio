'use strict';

function playbackResolutionRuntime() {
  if (!playbackResolutionRuntime.state) playbackResolutionRuntime.state = { active: null };
  return playbackResolutionRuntime.state;
}

function beginPlaybackResolution(token, index, opts) {
  var state = playbackResolutionRuntime();
  var previous = state.active;
  var parent = previous && opts && opts.playbackResolutionOwner === previous ? previous : null;
  if (previous) {
    // Internal quality/provider/queue recovery continues the same caller's
    // operation. A fresh user choice cancels that whole recovery chain.
    if (parent) { if (previous.controller) previous.controller.abort(); }
    else previous.cancel();
  }
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var settleCancellation;
  var owner = { token: token, index: index, parent: parent, controller: controller, signal: controller && controller.signal,
    cancelled: new Promise(function (resolve) { settleCancellation = resolve; }) };
  owner.cancel = function () {
    var current = owner;
    while (current && !current.wasCancelled) {
      current.wasCancelled = true;
      if (current.controller) current.controller.abort();
      current.settleCancellation(false);
      current = current.parent;
    }
    if (typeof setPlaybackLoadingNotice === 'function') setPlaybackLoadingNotice(false, owner.token, 'cancelled');
  };
  owner.settleCancellation = settleCancellation;
  state.active = owner;
  if (typeof queueNavigationRuntime === 'function') {
    var navigation = queueNavigationRuntime();
    navigation.serial++;
    navigation.pending = null;
  }
  try {
    if (typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new window.CustomEvent('mineradio:playback-intent', { detail: {
        token: token, index: index, songKey: typeof queueItemKey === 'function' ? queueItemKey(playQueue[index]) : '',
        manual: !!(opts && opts.manual)
      } }));
    }
  } catch (_) {}
  if (typeof setPlaybackLoadingNotice === 'function') setPlaybackLoadingNotice(!(opts && opts.startPaused), token, 'preparing');
  return owner;
}

function finishPlaybackResolution(owner) {
  var state = playbackResolutionRuntime();
  if (state.active === owner) {
    state.active = null;
    if (typeof settlePlaybackLoadingNotice === 'function') settlePlaybackLoadingNotice(owner.token);
  }
}

function shouldCoalesceManualPlayback(index, opts, optionsOmitted) {
  opts = opts || {};
  if (!optionsOmitted && opts.manual !== true) return false;
  if (opts.startupAutoplay || opts.autoRepeat || opts.qualitySwitch || opts.sourceSwitch || opts.resumeRecovery ||
      opts.albumGaplessHandoff || opts.nextTrackPreloadHandoff || opts.cuefieldAutoMix || opts.fallbackDepth ||
      opts.sourceFallbackRecovery || opts.playbackResolutionOwner || opts.preResolvedPlaybackData || opts.preloadedAudio) return false;
  var entry = typeof nextTrackPreloadRuntime === 'function' ? nextTrackPreloadRuntime().entry : null;
  // A ready handoff already has its source and audio buffer. Keep that path
  // immediate and let consumeNextTrackPreload validate its full ownership.
  return !(entry && entry.index === index && entry.status === 'prepared' && entry.media && !entry.media.error);
}

function waitForManualPlaybackQuietWindow(owner) {
  if (!owner || owner.wasCancelled) return Promise.resolve(false);
  var timer;
  var quiet = new Promise(function (resolve) { timer = setTimeout(function () { resolve(true); }, 120); });
  return Promise.race([quiet, owner.cancelled]).finally(function () { if (timer) clearTimeout(timer); });
}

function showPendingManualPlaybackSelection(song, opts) {
  song = song || {};
  [['thumb-title', song.name || song.title || ''], ['control-title-text', song.name || song.title || ''],
    ['thumb-artist', song.artist || ''], ['control-artist', song.artist || '']].forEach(function (entry) {
    var element = document.getElementById(entry[0]);
    if (element) element.textContent = entry[1];
  });
  setPlayIcon(!(opts && opts.startPaused));
}

function releaseMediaForManualNavigation() {
  pauseCurrentAudioForTrackSwitch();
  if (!audio) return;
  // pause() alone keeps the abandoned URL downloading. Explicitly release
  // that connection before the next selected source is requested.
  try {
    audio.autoplay = false;
    audio.removeAttribute('src');
    audio.__mineradioQueueItemKey = '';
    audio.__mineradioTrackSwitchToken = 0;
    audio.load();
  } catch (_) {}
}

function pauseCurrentAudioForTrackSwitch() {
  playToggleBusy = false;
  if (!audio) return;
  try {
    audioFadeSerial++;
    clearAudioFadeTimers();
    audio.onended = null;
    audio.pause();
  } catch (e) { }
  playing = false;
  setPlayIcon(false);
  syncPlaybackStateFromAudioEvent('track-switch');
}


function syncPlaybackStateFromAudioEvent(reason) {
  if (typeof updatePlaybackResumePauseMarker === 'function') updatePlaybackResumePauseMarker(reason);
  var isPlaying = !!(audio && audio.src && !audio.paused && !audio.ended);
  playing = isPlaying;
  setPlayIcon(isPlaying);
  if (!isPlaying) hideLoading();
  if (reason === 'play' || reason === 'playing') {
    switchPlaybackVisualToEmily();
    if (typeof markStageLyricsPlaybackResume === 'function') markStageLyricsPlaybackResume(reason);
  }
  forcePlaybackControlsInteractive();
}


function isPlaybackRecursionError(err) {
  var msg = String((err && err.message) || err || '');
  return err instanceof RangeError || /maximum call stack size exceeded/i.test(msg);
}

function isPlaybackActionRequiredError(err) {
  var text = String(err && (err.name + ' ' + err.message) || err || '');
  return /NotAllowedError|user gesture|autoplay|NotFoundError|setSinkId|output device|audio output/i.test(text);
}


function safePlaybackStep(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[PlaybackSetupStep]', label, err);
    return null;
  }
}


function playbackFailureNoticeFromError(err) {
  if (typeof playbackRestrictionNotice !== 'function') return null;
  var msg = String(err && err.message ? err.message : (err || '')).trim();
  if (!msg) return null;
  var lower = msg.toLowerCase();
  var category = '';
  if (/vip_required|paid_required|trial_only|need_vip|only_vip|member|vip|会员|付费|购买/.test(lower + msg)) category = 'vip_required';
  else if (/401|403|login_required|auth|cookie|credential|unauthorized|forbidden/.test(lower)) category = 'login_required';
  else if (/copyright|not playable|unavailable/.test(lower)) category = 'copyright_unavailable';
  else if (/url.*empty|no url|no supported source/.test(lower)) category = 'url_unavailable';
  if (!category) return null;
  var song = playQueue && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
  return playbackRestrictionNotice(song, { reason: category, message: msg });
}


function playbackFailureToastText(err) {
  var contextualNotice = playbackFailureNoticeFromError(err);
  if (contextualNotice) return contextualNotice.title + '：' + contextualNotice.body;
  if (isPlaybackRecursionError(err)) return '播放准备异常，已保持播放器可操作';
  var msg = String(err && err.message ? err.message : (err || '')).trim();
  var lower = msg.toLowerCase();
  if (/notallowederror|play\(\) failed|user gesture|autoplay/.test(lower)) return '播放失败：浏览器拦截了自动播放，请点一次播放按钮';
  if (/notsupportederror|no supported source|decode|media_err_decode/.test(lower)) return '播放失败：音频格式或解码失败，建议换源或降低音质';
  if (/notfounderror|setSinkId|sink|output device|audio output/.test(lower)) return '播放失败：当前输出设备不可用，请切回系统默认输出';
  if (/aborterror|aborted|interrupted/.test(lower)) return '播放已被新的切歌操作中断';
  if (/network|failed to fetch|timeout|econnreset|etimedout|err_connection|http 5|502|503|504/.test(lower)) return '播放失败：音频网络请求超时或服务端不可用';
  if (/401|403|login_required|auth|cookie|credential|unauthorized|forbidden/.test(lower)) return '播放失败：平台登录态或播放授权失效，请重新登录对应接口';
  if (/vip_required|paid_required|trial_only|need_vip|only_vip|member/.test(lower)) return '播放失败：歌曲需要 VIP、购买或更高权限';
  if (/copyright|unavailable|not playable|url.*empty|no url/.test(lower)) return '播放失败：平台没有返回可播放地址，建议换源';
  return '播放失败：' + (msg || '未知原因，请尝试换源或重新登录');
}

function scheduleAudioResumePosition(media, seconds, token, alreadyLoaded) {
  seconds = Math.max(0, Number(seconds) || 0);
  if (!media || seconds < 0.35) return;
  var applied = false;
  function applyResume() {
    if (applied || token !== trackSwitchToken || !media) return;
    var duration = Number(media.duration) || 0;
    var target = duration > 0 ? Math.min(seconds, Math.max(0, duration - 0.45)) : seconds;
    try {
      media.currentTime = target;
      applied = true;
      if (typeof syncBeatMapPlaybackCursor === 'function') syncBeatMapPlaybackCursor(target, true);
      if (typeof syncPodcastDjMapCursor === 'function') syncPodcastDjMapCursor(target, true);
      updatePlaybackProgressUi();
    } catch (e) { }
  }
  media.addEventListener('loadedmetadata', applyResume, { once: true });
  media.addEventListener('canplay', applyResume, { once: true });
  // 新 src 设置后紧接着会调用 load()。复用旧元素时，这里立即 seek 虽然可能成功，
  // 随后的 load() 却会把进度清零；只能等新资源的元数据到达后再认为恢复完成。
  // 已预加载的无缝衔接资源没有新的 load()，因此允许它立即恢复。
  setTimeout(function () { if (media.readyState >= 1) applyResume(); }, 520);
  if (alreadyLoaded) applyResume();
}

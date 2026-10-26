'use strict';


async function tryAutoPlaybackFallback(song, data, idx, token, opts) {
  opts = opts || {};
  if (opts.fallbackDepth > 0) {
    if (opts.fallbackOriginalSong && opts.fallbackCandidateSong) {
      restoreSourceFallbackQueueItem(idx, opts.fallbackOriginalSong, opts.fallbackCandidateSong, token);
    }
    return false;
  }
  if (!song || song.type === 'local' || song.type === 'podcast' || song.source === 'podcast') return null;
  var category = playbackRestrictionCategory(song, data);
  var fromLabel = playbackProviderLabel(song);
  var alternateProviders = alternatePlaybackProviders(song);
  var recovery = ensureSourceFallbackRecovery(opts, song, idx, token);
  if (!recovery) return false;
  opts = Object.assign({}, opts, { sourceFallbackRecovery: recovery });
  var skipPlaybackOpts = sourceFallbackQueuePlaybackOptions(opts, recovery);
  skipPlaybackOpts.startupAutoplay = true;
  var skipOpts = {
    silent: !!recovery.silent,
    playbackOpts: skipPlaybackOpts,
    sourceFallbackRecovery: recovery
  };
  if (!sourceFallbackRecoveryCanContinue(recovery)) {
    return await skipFailedQueueItem(idx, token, '当前歌曲取源超时，正在寻找下一首可播放歌曲。', skipOpts);
  }
  if (!alternateProviders.length) {
    return await skipFailedQueueItem(idx, token, '当前歌曲没有可用音源，正在寻找下一首可播放歌曲。', skipOpts);
  }
  if (!opts.startupAutoplay) {
    showSourceFallbackNotice('正在自动换源', fromLabel + ' 当前不可播，正在检查 ' + alternateProviders.map(sourceFallbackProviderTitle).join('、') + ' 的同名同歌手版本。');
  }
  for (var providerIndex = 0; providerIndex < alternateProviders.length; providerIndex++) {
    var alternateProvider = alternateProviders[providerIndex];
    if (!beginSourceFallbackProviderAttempt(recovery, song, alternateProvider)) {
      if (!sourceFallbackRecoveryCanContinue(recovery)) {
        return await skipFailedQueueItem(idx, token, '当前歌曲取源超时，正在寻找下一首可播放歌曲。', skipOpts);
      }
      continue;
    }
    var targetLabel = sourceFallbackProviderTitle(alternateProvider);
    try {
      var alternate = await searchAlternatePlatformSong(song, alternateProvider, recovery);
      if (token !== trackSwitchToken) return false;
      if (!sourceFallbackRecoveryCanContinue(recovery)) {
        return await skipFailedQueueItem(idx, token, '当前歌曲取源超时，正在寻找下一首可播放歌曲。', skipOpts);
      }
      if (!alternate) continue;
      var alternateData = typeof resolveAlbumGaplessPlaybackData === 'function'
        ? await awaitSourceFallbackBudget(resolveAlbumGaplessPlaybackData(alternate), recovery)
        : null;
      if (token !== trackSwitchToken) return false;
      if (alternateData === sourceFallbackBudgetTimeoutResult || !sourceFallbackRecoveryCanContinue(recovery)) {
        return await skipFailedQueueItem(idx, token, '当前歌曲取源超时，正在寻找下一首可播放歌曲。', skipOpts);
      }
      if (!alternateData || !alternateData.url) continue;
      var originalSong = playQueue[idx];
      alternate.autoFallbackFrom = songProviderKey(song);
      var committedCandidate = hydrateCustomCover(alternate);
      playQueue[idx] = committedCandidate;
      safeRenderQueuePanel('source-fallback-provisional', { scrollCurrent: miniQueueOpen });
      safeShelfRebuild('source-fallback-provisional');
      var fallbackPlaybackOpts = {
        fallbackDepth: 1,
        startupAutoplay: !!opts.startupAutoplay,
        preserveHomeState: !!opts.preserveHomeState,
        suppressPlayFailureNotice: true,
        preResolvedPlaybackData: alternateData,
        fallbackOriginalSong: originalSong,
        fallbackCandidateSong: committedCandidate,
        sourceFallbackRecovery: recovery,
        qqQualityTried: ['hires', 'lossless', 'exhigh', 'standard']
      };
      if (opts.resumeAt != null) fallbackPlaybackOpts.resumeAt = opts.resumeAt;
      var fallbackPromise = playQueueAt(idx, fallbackPlaybackOpts);
      var fallbackToken = trackSwitchToken;
      var fallbackStarted = await fallbackPromise;
      // 同一恢复中的低音质重试也会生成新 token；只取消用户新发起的播放。
      if (!sourceFallbackRecoveryIdentityActive(recovery)) return fallbackStarted === true && recovery.completed && !recovery.cancelled;
      if (currentIdx !== idx) return false;
      fallbackToken = trackSwitchToken;
      if (fallbackStarted === true) {
        completeSourceFallbackRecovery(recovery);
        if (!opts.startupAutoplay) showSourceFallbackNotice('已自动切换音源', (song.name || '当前歌曲') + ' 已从 ' + fromLabel + ' 切到 ' + targetLabel + '。');
        return true;
      }
      restoreSourceFallbackQueueItem(idx, originalSong, committedCandidate, fallbackToken);
      token = fallbackToken;
      if (!sourceFallbackRecoveryCanContinue(recovery)) {
        return await skipFailedQueueItem(idx, token, '当前歌曲取源超时，正在寻找下一首可播放歌曲。', skipOpts);
      }
    } catch (e) {
      if (!sourceFallbackRecoveryIdentityActive(recovery) || currentIdx !== idx) return false;
      token = trackSwitchToken;
      if (!sourceFallbackRecoveryCanContinue(recovery)) {
        return await skipFailedQueueItem(idx, token, '当前歌曲取源超时，正在寻找下一首可播放歌曲。', skipOpts);
      }
      console.warn('[SourceFallback]', alternateProvider, e && (e.message || e));
    }
  }
  return await skipFailedQueueItem(idx, token, '四个平台均未找到可播放版本，正在寻找下一首可播放歌曲。', skipOpts);
}

function handlePlaybackUnavailable(song, data) {
  hideLoading();
  if (typeof setPlaybackLoadingNotice === 'function') setPlaybackLoadingNotice(false, trackSwitchToken, 'terminal');
  forcePlaybackControlsInteractive();
  var provider = playbackLoginProvider(song);
  var notice = playbackRestrictionNotice(song, data);
  var category = notice.category;
  showToast(notice.toast || notice.title || playbackRestrictionMessage(song, data));
  showSourceFallbackNotice(notice.title, notice.body);
  if (category === 'login_required') {
    setTimeout(function () {
      var modal = document.getElementById('login-modal');
      if (!modal || modal.classList.contains('show')) return;
      openProviderLogin(provider);
    }, 520);
  }
}

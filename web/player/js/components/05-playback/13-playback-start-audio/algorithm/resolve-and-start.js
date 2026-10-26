'use strict';

function playbackResolutionRequestOptions(state, timeoutMs) {
  var options = { timeoutMs: timeoutMs, priority: 'high' };
  if (state.resolutionOwner && state.resolutionOwner.signal) options.signal = state.resolutionOwner.signal;
  return options;
}

function playbackTrialAccountStatus(provider, data) {
  data = data || {};
  var localCredentials = window.MINERADIO_LOCAL_WEB && window.localMusicCredentials;
  var localStatus = localCredentials && typeof localCredentials.status === 'function'
    ? localCredentials.status(provider) : null;
  var current = provider === 'qq' ? (typeof qqLoginStatus !== 'undefined' ? qqLoginStatus : {})
    : provider === 'kugou' ? (typeof kugouLoginStatus !== 'undefined' ? kugouLoginStatus : {})
      : provider === 'qishui' ? (typeof qishuiLoginStatus !== 'undefined' ? qishuiLoginStatus : {})
        : provider === 'spotify' ? (typeof spotifyLoginStatus !== 'undefined' ? spotifyLoginStatus : {})
          : (typeof loginStatus !== 'undefined' ? loginStatus : {});
  // Local login is owned by this client. Missing/legacy song fields cannot
  // log the account out, and old preloaded song data cannot log it back in.
  var loggedIn = localStatus ? localStatus.loggedIn === true
    : (typeof data.loggedIn === 'boolean' ? data.loggedIn : current.loggedIn === true);
  var membership = data.membershipVerified === true || data.membershipKnown === true ? data : current;
  var membershipKnown = loggedIn && (membership.membershipVerified === true || membership.membershipKnown === true);
  return {
    loggedIn: loggedIn && data.reauthRequired !== true,
    reauthRequired: data.reauthRequired === true,
    membershipKnown: membershipKnown,
    vipLevel: membershipKnown ? (membership.vipLevel || membership.vip_level || 'none') : 'none'
  };
}

function playbackTrialMessage(status) {
  if (status.reauthRequired) return '当前登录授权需要更新 · 仅播放试听片段';
  if (!status.loggedIn) return '当前未登录 · 仅播放试听片段';
  if (status.membershipKnown && status.vipLevel === 'svip') return '当前账号仅获试听权限 · 此歌曲可能需要单曲、专辑购买或更高权限';
  if (status.membershipKnown && status.vipLevel === 'vip') return '当前账号仅获试听权限 · 请检查 SVIP、购买或歌曲授权';
  return '当前账号仅获试听权限 · 请检查会员、购买或歌曲授权';
}

async function playQueueAtResolveAndStart(_invocationState) {
try {
      _invocationState.markPlayPhase('source-url');
      _invocationState.playbackProvider = normalizePlaybackProvider(songProviderKey(_invocationState.song));
      _invocationState.isQQPlayback = _invocationState.playbackProvider === 'qq';
      _invocationState.isKugouPlayback = _invocationState.playbackProvider === 'kugou';
      _invocationState.isQishuiPlayback = _invocationState.playbackProvider === 'qishui';
      _invocationState.isSpotifyPlayback = _invocationState.playbackProvider === 'spotify';
      _invocationState.requestedQuality = normalizePlaybackQualityForProvider(_invocationState.opts.qualityOverride || getProviderPlaybackQuality(_invocationState.playbackProvider), _invocationState.playbackProvider);
      if (_invocationState.playbackProvider === 'netease' && _invocationState.requestedQuality === 'jymaster' && !hasProviderSvip('netease', loginStatus)) _invocationState.requestedQuality = 'hires';
      _invocationState.runtimeQualityCap = playbackQualityCapValue(_invocationState.song, _invocationState.playbackProvider);
      if (playbackQualityAboveCap(_invocationState.requestedQuality, _invocationState.playbackProvider, _invocationState.runtimeQualityCap)) {
        _invocationState.requestedQuality = _invocationState.runtimeQualityCap;
      }
      _invocationState.qualityParam = '&quality=' + encodeURIComponent(_invocationState.requestedQuality);
      var radioCachedData = window.webPersonalRadio && typeof window.webPersonalRadio.cachedPlaybackData === 'function'
        ? window.webPersonalRadio.cachedPlaybackData(_invocationState.song, _invocationState.opts) : null;
      
      if (_invocationState.albumGaplessHandoff) {
        _invocationState.data = _invocationState.opts.preloadedData;
      } else if (_invocationState.opts.preResolvedPlaybackData && _invocationState.opts.preResolvedPlaybackData.url) {
        _invocationState.data = _invocationState.opts.preResolvedPlaybackData;
      } else if (radioCachedData && radioCachedData.url) {
        _invocationState.data = radioCachedData;
      } else if (_invocationState.isQQPlayback) {
        _invocationState.data = await apiJson('/api/qq/song/url?mid=' + encodeURIComponent(_invocationState.song.mid || _invocationState.song.songmid || _invocationState.song.id || '') + '&mediaMid=' + encodeURIComponent(_invocationState.song.mediaMid || _invocationState.song.media_mid || '') + qqPlaybackEvidenceQuery(_invocationState.song) + _invocationState.qualityParam, playbackResolutionRequestOptions(_invocationState, 15000));
      } else if (_invocationState.isKugouPlayback) {
        _invocationState.data = await apiJson('/api/kugou/song/url?hash=' + encodeURIComponent(_invocationState.song.hash || _invocationState.song.fileHash || _invocationState.song.audioHash || _invocationState.song.id || '') +
          '&albumId=' + encodeURIComponent(_invocationState.song.albumId || _invocationState.song.album_id || '') +
          '&albumAudioId=' + encodeURIComponent(_invocationState.song.albumAudioId || _invocationState.song.album_audio_id || _invocationState.song.mixSongId || '') +
          '&mixSongId=' + encodeURIComponent(_invocationState.song.mixSongId || '') +
          '&hqHash=' + encodeURIComponent(_invocationState.song.hqHash || _invocationState.song.hq_hash || '') +
          '&sqHash=' + encodeURIComponent(_invocationState.song.sqHash || _invocationState.song.sq_hash || '') +
          '&resHash=' + encodeURIComponent(_invocationState.song.resHash || _invocationState.song.res_hash || '') +
          '&vipRequired=' + encodeURIComponent(_invocationState.song.vipRequired || _invocationState.song.needVip || _invocationState.song.onlyVipPlayable || _invocationState.song.only_vip_playable ? '1' : '') +
          '&privilege=' + encodeURIComponent(_invocationState.song.privilege || _invocationState.song.Privilege || _invocationState.song.mediaPrivilege || _invocationState.song.media_privilege || '') +
          '&fee=' + encodeURIComponent(_invocationState.song.fee || _invocationState.song.Fee || '') +
          _invocationState.qualityParam, playbackResolutionRequestOptions(_invocationState, 20000));
      } else if (_invocationState.isQishuiPlayback) {
        _invocationState.data = await apiJson('/api/qishui/song/url?id=' + encodeURIComponent(_invocationState.song.id || _invocationState.song.providerSongId || '') + qqPlaybackEvidenceQuery(_invocationState.song) + _invocationState.qualityParam, playbackResolutionRequestOptions(_invocationState, 15000));
      } else if (_invocationState.isSpotifyPlayback) {
        _invocationState.data = await apiJson('/api/spotify/song/url?id=' + encodeURIComponent(_invocationState.song.id || _invocationState.song.providerSongId || _invocationState.song.spotifyId || '') +
          '&spotifyId=' + encodeURIComponent(_invocationState.song.spotifyId || '') +
          '&uri=' + encodeURIComponent(_invocationState.song.spotifyUri || _invocationState.song.uri || '') +
          _invocationState.qualityParam, playbackResolutionRequestOptions(_invocationState, 9000));
      } else {
        _invocationState.data = await apiJson('/api/song/url?id=' + encodeURIComponent(_invocationState.song.id || '') + neteasePlaybackMatchQuery(_invocationState.song) + _invocationState.qualityParam, playbackResolutionRequestOptions(_invocationState, 14000));
      }
      if (_invocationState.token !== trackSwitchToken || (_invocationState.resolutionOwner && _invocationState.resolutionOwner.wasCancelled)) return false;
      if ((!_invocationState.data || !_invocationState.data.url) && typeof window.resolvePlaybackDataWithQualityFallback === 'function') {
        var lowerQualityData = await window.resolvePlaybackDataWithQualityFallback(_invocationState.song, {
          data: _invocationState.data,
          signal: _invocationState.resolutionOwner && _invocationState.resolutionOwner.signal,
          requestedQuality: _invocationState.requestedQuality,
          isCurrent: function () { return _invocationState.token === trackSwitchToken && !(_invocationState.resolutionOwner && _invocationState.resolutionOwner.wasCancelled); }
        });
        if (_invocationState.token !== trackSwitchToken || (_invocationState.resolutionOwner && _invocationState.resolutionOwner.wasCancelled)) return false;
        if (lowerQualityData) _invocationState.data = lowerQualityData;
      }
      if (
        typeof sourceFallbackRecoveryFromOptions === 'function'
        && sourceFallbackRecoveryFromOptions(_invocationState.opts)
        && !sourceFallbackRecoveryCanContinue(sourceFallbackRecoveryFromOptions(_invocationState.opts))
      ) {
        return settleExpiredSourceFallbackPlayback(_invocationState.idx, _invocationState.token, _invocationState.opts);
      }
      if (_invocationState.data) {
        ['albumId','albumMid','album','qqId'].forEach(function(field) {
          if (!_invocationState.song[field] && _invocationState.data[field]) _invocationState.song[field]=_invocationState.data[field];
        });
        if (window.MINERADIO_LOCAL_WEB && _invocationState.data.albumAudioId && !_invocationState.song.albumAudioId) {
          _invocationState.song.albumAudioId=String(_invocationState.data.albumAudioId);
        }
        // 本机 API 可在解析播放地址时补回酷狗搜索结果缺失的封面。
        if (window.MINERADIO_LOCAL_WEB && _invocationState.data.cover && !_invocationState.song.cover) {
          _invocationState.song.cover = _invocationState.data.cover;
          if (!getCustomCoverForSong(_invocationState.song)) {
            loadCoverFromUrl(coverUrlWithSize(_invocationState.song.cover, 400), {trackToken: _invocationState.token, deferHeavy: true});
          }
        }
        _invocationState.song.resolvedPlaybackProvider = _invocationState.playbackProvider;
        // 只有播放解析的结果能更新实际档位，单纯打开音质菜单不会改写正在播放的标识。
        if (window.MINERADIO_LOCAL_WEB) _invocationState.song.nativePlaybackQuality = _invocationState.data.url ? _invocationState.data.nativeQuality || '' : '';
        _invocationState.song.playbackLevel = _invocationState.data.url ? _invocationState.data.level || '' : '';
        if (!_invocationState.data.sourceMatch) _invocationState.song.playbackSource = _invocationState.data.source || _invocationState.data.provider || _invocationState.song.playbackSource || '';
        if (_invocationState.playbackProvider === 'netease' && !_invocationState.data.sourceMatch) clearNeteaseSourceMatchMetadata(_invocationState.song);
        _invocationState.song.trial = !!(_invocationState.song.trial || _invocationState.data.trial);
        _invocationState.song.vipRequired = !!(
          _invocationState.song.vipRequired ||
          _invocationState.data.trial ||
          _invocationState.data.needVip ||
          _invocationState.data.need_vip ||
          _invocationState.data.vipRequired ||
          _invocationState.data.onlyVipPlayable ||
          _invocationState.data.only_vip_playable ||
          (_invocationState.data.restriction && /vip_required|paid_required|trial_only|need_vip|only_vip/i.test(String(_invocationState.data.restriction.category || _invocationState.data.restriction.reason || _invocationState.data.restriction.message || ''))) ||
          /vip_required|paid_required|trial_only|need_vip|only_vip/i.test(String(_invocationState.data.category || _invocationState.data.reason || _invocationState.data.error || _invocationState.data.message || '')) ||
          (typeof songRequiresVip === 'function' && songRequiresVip(Object.assign({}, _invocationState.song, _invocationState.data)))
        );
        if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(_invocationState.song);
        if (_invocationState.isKugouPlayback && typeof applyKugouPlaybackStatusEvidence === 'function') applyKugouPlaybackStatusEvidence(_invocationState.data);
        if (_invocationState.isQQPlayback && typeof applyQQPlaybackStatusEvidence === 'function') applyQQPlaybackStatusEvidence(_invocationState.data, _invocationState.song);
      }
      _invocationState.retryPlaybackOpts = Object.assign({}, _invocationState.opts, { resumeAt: _invocationState.opts.resumeAt != null ? _invocationState.opts.resumeAt : _invocationState.restoreResumeAt });
      if (!_invocationState.data || !_invocationState.data.url) {
        // 手动换源由调用方负责恢复原来可播的版本和暂停状态。
        if (_invocationState.opts.sourceSwitch) { hideLoading();forcePlaybackControlsInteractive();return false; }
        _invocationState.fallbackResult = await tryAutoPlaybackFallback(_invocationState.song, _invocationState.data, _invocationState.idx, _invocationState.token, _invocationState.retryPlaybackOpts);
        if (_invocationState.fallbackResult !== null) return _invocationState.fallbackResult === true;
        if (_invocationState.opts.startupAutoplay) {
          markQueueItemPlaybackFailed(_invocationState.idx);
          return false;
        }
        handlePlaybackUnavailable(_invocationState.song, _invocationState.data);
        return false;
      }
      _invocationState.resolvedQualityText = playbackResolvedQualityText(_invocationState.data, _invocationState.playbackProvider);
      _invocationState.qualityDowngraded = !!(_invocationState.data && _invocationState.data.level && playbackQualityWasDowngraded(_invocationState.requestedQuality, _invocationState.data.level, _invocationState.playbackProvider));
      if (_invocationState.data && _invocationState.data.qualityFallback) _invocationState.qualityDowngraded = true;
      if (_invocationState.qualityDowngraded) markPlaybackQualityRuntimeCap(_invocationState.song, _invocationState.playbackProvider, _invocationState.data.level, 'resolved-lower');
      if (!_invocationState.opts.startupAutoplay && !_invocationState.isQQPlayback && _invocationState.qualityDowngraded) {
        showSourceFallbackNotice((_invocationState.isKugouPlayback ? '酷狗' : (_invocationState.isQishuiPlayback ? '汽水' : '网易云')) + '音质自动降级', '请求 ' + playbackQualityLabel(_invocationState.requestedQuality, _invocationState.playbackProvider) + '，实际播放 ' + _invocationState.resolvedQualityText + '。');
      } else if (!_invocationState.opts.startupAutoplay && _invocationState.opts.qualitySwitch) {
        showSourceFallbackNotice('音质已切换', '实际播放: ' + _invocationState.resolvedQualityText + '。');
      }
      if (_invocationState.data.trial) {
        _invocationState.trialAccountStatus = playbackTrialAccountStatus(_invocationState.playbackProvider, _invocationState.data);
        _invocationState.txt = playbackTrialMessage(_invocationState.trialAccountStatus);
        document.getElementById('trial-text').textContent = _invocationState.txt;
        _invocationState.trialLoginBtn = document.getElementById('trial-login-btn');
        if (_invocationState.trialLoginBtn) {
          _invocationState.trialLoginBtn.style.display = _invocationState.trialAccountStatus.loggedIn ? 'none' : '';
          _invocationState.trialLoginBtn.onclick = function () { openProviderLogin(_invocationState.playbackProvider); };
        }
        document.getElementById('trial-banner').classList.add('show');
      }
      _invocationState.markPlayPhase('audio-element');
      _invocationState.proxyAudioUrl = _invocationState.opts.preloadedProxyAudioUrl || '/api/audio?url=' + encodeURIComponent(_invocationState.data.url);
      if (window.localMusicCredentials) _invocationState.proxyAudioUrl = window.localMusicCredentials.url(_invocationState.proxyAudioUrl, _invocationState.playbackProvider);
      if (window.mineradioMediaCache && !_invocationState.albumGaplessHandoff && !_invocationState.opts.nextTrackPreloadHandoff) {
        _invocationState.proxyAudioUrl = await mineradioMediaCache.audioSource(_invocationState.song, _invocationState.proxyAudioUrl,
          String(_invocationState.data.nativeQuality || _invocationState.data.level || _invocationState.requestedQuality),
          _invocationState.resolutionOwner && _invocationState.resolutionOwner.signal);
        if (_invocationState.token !== trackSwitchToken || currentIdx !== _invocationState.idx
          || _invocationState.resolutionOwner && _invocationState.resolutionOwner.wasCancelled) return false;
      }
      if (_invocationState.albumGaplessHandoff) {
        audioFadeSerial++;
        clearAudioFadeTimers();
        if (_invocationState.albumGaplessPreviousAudio) _invocationState.albumGaplessPreviousAudio.onended = null;
        audio = _invocationState.opts.preloadedAudio;
        if (_invocationState.opts.cuefieldAutoMix && typeof claimCuefieldPreparedAudioForPlayback === 'function') {
          claimCuefieldPreparedAudioForPlayback(audio);
        }
        _invocationState.preparedGraphGain = _invocationState.opts.cuefieldAutoMix && audio.__mineradioPreparedAudioGraph && audio.__mineradioPreparedAudioGraph.gainNode
          ? Number(audio.__mineradioPreparedAudioGraph.gainNode.gain.value)
          : NaN;
        _invocationState.albumGaplessAdoptedGain = _invocationState.albumGaplessMixed
          ? clampRange(isFinite(_invocationState.preparedGraphGain) ? _invocationState.preparedGraphGain : (Number(audio.volume) || 0), 0, 1)
          : audioSilentFloor();
        audio.crossOrigin = 'anonymous';
        audio.autoplay = !_invocationState.opts.startPaused;
        audio.preload = 'auto';
        if (!audio.src) audio.src = _invocationState.proxyAudioUrl;
        if (!_invocationState.albumGaplessMixed) audio.volume = 0;
        else audio.muted = false;
      } else if (_invocationState.opts.nextTrackPreloadHandoff && _invocationState.opts.preloadedAudio) {
        audioFadeSerial++;
        clearAudioFadeTimers();
        if (audio) { audio.onended = null;audio.pause(); }
        audio = _invocationState.opts.preloadedAudio;
        audio.crossOrigin = 'anonymous';
        audio.muted = false;
      } else if (!audio) {
        audio = new Audio();
        audio.crossOrigin = 'anonymous';
      } else {
        audioFadeSerial++;
        clearAudioFadeTimers();
        audio.pause();
      }
      resetPlaybackAudioGraphForSourceSwitch(_invocationState.albumGaplessHandoff ? 'album-gapless-handoff' : 'track-switch');
      audio.autoplay = !_invocationState.opts.startPaused;
      audio.preload = 'auto';
      syncActiveAudioRepeatMode(audio);
      // resetPlaybackAudioGraphForSourceSwitch may deliberately replace a
      // capture-backed element before a new src is assigned. Capture the
      // expected media only after that lifetime reset so playAudio never holds
      // a stale, already-paused element reference.
      _invocationState.playbackMedia = audio;
      audio.__mineradioPlaybackStarted = false;
      bindPlaybackProgressEvents(audio);
      if (_invocationState.albumGaplessHandoff) setAudioOutputGainImmediate(_invocationState.albumGaplessMixed ? _invocationState.albumGaplessAdoptedGain : audioSilentFloor());
      else applyVolumeToAudio();
      await applyAudioOutputDevice(_invocationState.playbackMedia);
      if (!_invocationState.playbackInvocationStillCurrent(_invocationState.playbackMedia)) {
        _invocationState.disposeStalePlaybackInvocationMedia(_invocationState.playbackMedia);
        return false;
      }
      if (
        typeof sourceFallbackRecoveryFromOptions === 'function'
        && sourceFallbackRecoveryFromOptions(_invocationState.opts)
        && !sourceFallbackRecoveryCanContinue(sourceFallbackRecoveryFromOptions(_invocationState.opts))
      ) {
        return settleExpiredSourceFallbackPlayback(_invocationState.idx, _invocationState.token, _invocationState.opts);
      }
      if (!_invocationState.albumGaplessHandoff && !_invocationState.opts.nextTrackPreloadHandoff) audio.src = _invocationState.proxyAudioUrl;
      audio.__mineradioQueueItemKey = queueItemKey(_invocationState.song);
      audio.__mineradioTrackSwitchToken = _invocationState.token;
      updatePlaybackProgressUi();
      audio.onended = function () {
        if (_invocationState.token !== trackSwitchToken) return;
        if (this && this.__mineradioCuefieldEndedRecoveryToken === _invocationState.token) return;
        if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting) {
          if (typeof noteCuefieldAutoMixOutgoingEnded === 'function') noteCuefieldAutoMixOutgoingEnded(this, _invocationState.token, currentIdx);
          return;
        }
        if (restartSingleRepeatMedia(this, _invocationState.token, currentIdx, 'online-ended')) return;
        finalizeListenSession(true);
        if (playAlbumGaplessNextOnEnded(_invocationState.token)) return;
        if (playMode === 'single') setTimeout(function () { playQueueAt(currentIdx, { autoRepeat: true, suppressPlayFailureNotice: true }); }, 0);
        else setTimeout(nextTrack, 0);
      };
      scheduleAudioResumePosition(audio, _invocationState.opts.resumeAt != null ? _invocationState.opts.resumeAt : _invocationState.restoreResumeAt, _invocationState.token, _invocationState.albumGaplessHandoff || _invocationState.opts.nextTrackPreloadHandoff);
      if (_invocationState.restoreResumeAt > 0) pendingPlaybackResumeAt = 0;
      if (!_invocationState.albumGaplessHandoff && !_invocationState.opts.nextTrackPreloadHandoff) audio.load();
      _invocationState.markPlayPhase(_invocationState.qualitySwitch ? 'visual-prep-skip' : 'visual-prep');
      if (_invocationState.qualitySwitch) {
        if (typeof markStageLyricsPlaybackResume === 'function') markStageLyricsPlaybackResume('quality-switch-audio-ready');
      } else try {
        // 重置 beatmap 状态
        currentBeatMap = null;
        beatMapNextIdx = 0;
        resetAudioVisualState({ preserveEnvelope: _invocationState.albumGaplessMixed });
        resetBeatCameraSync(audio && isFinite(audio.currentTime) ? audio.currentTime : 0, { preserveMomentum: _invocationState.albumGaplessMixed });
        cancelBeatAnalysisTimer();
        beatMapToken++;
        _invocationState.bmTok = beatMapToken;
        if (_invocationState.podcastDjMode) {
          // 播客走独立 DJ 离线锁拍系统, 不写入普通歌曲 beatMap.
          djBeatMapToken++;
          cancelDjBeatAnalysisTimer();
          resetDjBeatMapState();
          currentBeatMap = null;
          beatMapNextIdx = 0;
          _invocationState.djTok = djBeatMapToken;
          _invocationState.djKey = djSongKey(_invocationState.song);
          if (djBeatMapCache[_invocationState.djKey]) {
            currentDjBeatMap = djBeatMapCache[_invocationState.djKey];
            applyPodcastDjProfileFromMap(currentDjBeatMap);
            syncPodcastDjMapCursor(audio ? audio.currentTime : 0, true);
            hideBeatChip();
            notifyDesktopLyricsBeatMapReady();
            console.log('podcast DJ beatmap 缓存命中:', currentDjBeatMap.cameraBeats.length, '个主拍');
          } else {
            showBeatChip('DJ 离线锁拍准备中…');
            _invocationState.djDurationSec = Math.max(0, Number(_invocationState.song.duration) || 0);
            if (_invocationState.djDurationSec > 10000) _invocationState.djDurationSec /= 1000;
            schedulePodcastDjAnalysis(_invocationState.djKey, _invocationState.data.url, _invocationState.djTok, _invocationState.djDurationSec);
          }
          maybeAnnounceDjMode();
        } else if (_invocationState.bmKey && beatMapCache[_invocationState.bmKey]) {
          // 如果缓存有, 直接用
          currentBeatMap = beatMapCache[_invocationState.bmKey];
          applyCinemaProfileFromBeatMap(currentBeatMap);
          syncBeatMapPlaybackCursor(audio ? audio.currentTime : 0, _invocationState.albumGaplessMixed);
          notifyDesktopLyricsBeatMapReady();
          console.log('beatmap 缓存命中:', currentBeatMap.kicks.length, '个鼓点');
          scheduleQueueBeatPrefetch(_invocationState.idx, 2600);
        } else {
          _invocationState.diskBeatMap = _invocationState.bmKey ? await readBeatDiskCache(_invocationState.bmKey) : null;
          if (!_invocationState.playbackInvocationStillCurrent(_invocationState.playbackMedia)) {
            _invocationState.disposeStalePlaybackInvocationMedia(_invocationState.playbackMedia);
            return false;
          }
          if (_invocationState.diskBeatMap) {
            currentBeatMap = _invocationState.diskBeatMap;
            applyCinemaProfileFromBeatMap(currentBeatMap);
            syncBeatMapPlaybackCursor(audio ? audio.currentTime : 0, _invocationState.albumGaplessMixed);
            notifyDesktopLyricsBeatMapReady();
            console.log('beatmap D盘缓存命中:', currentBeatMap.kicks.length, '个鼓点');
            scheduleQueueBeatPrefetch(_invocationState.idx, 2600);
          } else {
            // 后台延迟分析, 避免新歌刚开始播放时抢占解码和渲染资源
            scheduleBeatAnalysis(_invocationState.bmKey || _invocationState.song.id, _invocationState.proxyAudioUrl, _invocationState.bmTok, _invocationState.song);
          }
        }
      } catch (visualErr) {
        if (_invocationState.token !== trackSwitchToken) return false;
        console.warn('[PlaybackVisualPrep]', _invocationState.song && _invocationState.song.name, visualErr);
        currentBeatMap = null;
        beatMapNextIdx = 0;
        safePlaybackStep('visual-prep-hide-chip', hideBeatChip);
      }
      _invocationState.markPlayPhase('audio-start');
      if (!_invocationState.playbackInvocationStillCurrent(_invocationState.playbackMedia)) return false;
      
      if (_invocationState.opts.startPaused) {
        // 暂停中换源只准备新媒体与进度，不调用 play()，避免用户未点播放便突然出声。
        _invocationState.playbackMedia.pause();
        playing = false;
        setPlayIcon(false);
        hideLoading();
        _invocationState.playbackStarted = true;
      } else {
        _invocationState.playbackStarted = await playAudio({ manual: !!_invocationState.opts.manual, silent: _invocationState.isQQPlayback || !!_invocationState.opts.startupAutoplay || !_invocationState.opts.manual, startupAutoplay: !!_invocationState.opts.startupAutoplay, trackSwitch: true, resumeRecovery: !!_invocationState.opts.resumeRecovery, fade: _invocationState.albumGaplessHandoff ? false : _invocationState.opts.fade, preserveGain: _invocationState.albumGaplessMixed, expectedMedia: _invocationState.playbackMedia, expectedToken: _invocationState.token,
          isPlayingRequested: function () { return !_invocationState.opts.startPaused; } });
      }
      if (!_invocationState.playbackInvocationStillCurrent(_invocationState.playbackMedia)) return false;
      if (_invocationState.opts.startPaused) {
        _invocationState.playbackMedia.autoplay = false;
        _invocationState.playbackMedia.pause();
        playing = false; setPlayIcon(false); hideLoading();
        _invocationState.playbackStarted = true;
      }
      if (
        typeof sourceFallbackRecoveryFromOptions === 'function'
        && sourceFallbackRecoveryFromOptions(_invocationState.opts)
        && !sourceFallbackRecoveryCanContinue(sourceFallbackRecoveryFromOptions(_invocationState.opts))
      ) {
        return settleExpiredSourceFallbackPlayback(_invocationState.idx, _invocationState.token, _invocationState.opts);
      }
      if (!_invocationState.playbackStarted) {
        // 自动播放权限和输出设备故障需要用户处理，不能据此将整条队列判为无源。
        if (isPlaybackActionRequiredError(_invocationState.playbackMedia && _invocationState.playbackMedia.__mineradioLastPlayError)) {
          hideLoading();forcePlaybackControlsInteractive();
          showToast(playbackFailureToastText(_invocationState.playbackMedia.__mineradioLastPlayError));
          return false;
        }
        if (_invocationState.opts.sourceSwitch) return false;
        if (window.webQualityHelpers && typeof window.webQualityHelpers.retryPlayback === 'function') {
          _invocationState.nativeRetry = await window.webQualityHelpers.retryPlayback(_invocationState.song, _invocationState.data, _invocationState.idx, _invocationState.token, _invocationState.retryPlaybackOpts);
          if (_invocationState.nativeRetry !== null) return _invocationState.nativeRetry === true;
        }
        if (_invocationState.playbackProvider === 'netease' && _invocationState.data && _invocationState.data.sourceMatch) {
          _invocationState.sameSourceRetry = await retryNeteaseSourceMatchPlayback(_invocationState.song, _invocationState.data, _invocationState.idx, _invocationState.token, _invocationState.retryPlaybackOpts, _invocationState.requestedQuality);
          if (_invocationState.sameSourceRetry !== null) return _invocationState.sameSourceRetry === true;
          _invocationState.matchedPlaybackFallback = await tryAutoPlaybackFallback(_invocationState.song, Object.assign({}, _invocationState.data, { url: null, reason: 'media_start_failed' }), _invocationState.idx, _invocationState.token, _invocationState.retryPlaybackOpts);
          if (_invocationState.matchedPlaybackFallback !== null) return _invocationState.matchedPlaybackFallback === true;
        }
        if (_invocationState.isQQPlayback && !window.MINERADIO_LOCAL_WEB) {
          _invocationState.qqRetryStarted = await retryQQPlaybackWithCompatibleQuality(_invocationState.song, _invocationState.idx, _invocationState.token, _invocationState.retryPlaybackOpts, _invocationState.data, _invocationState.requestedQuality);
          if (_invocationState.token !== trackSwitchToken) return _invocationState.qqRetryStarted === true;
          if (_invocationState.qqRetryStarted) return true;
        }
        _invocationState.mediaFailureRecovery = typeof sourceFallbackRecoveryFromOptions === 'function'
          ? sourceFallbackRecoveryFromOptions(_invocationState.retryPlaybackOpts)
          : null;
        {
          _invocationState.mediaFailureFallback = await tryAutoPlaybackFallback(
            _invocationState.song,
            Object.assign({}, _invocationState.data || {}, { url: null, reason: 'media_start_failed' }),
            _invocationState.idx,
            _invocationState.token,
            _invocationState.retryPlaybackOpts
          );
          if (_invocationState.mediaFailureFallback !== null) return _invocationState.mediaFailureFallback === true;
          if (_invocationState.mediaFailureRecovery) {
            return await skipFailedQueueItem(
              _invocationState.idx,
              _invocationState.token,
              '当前歌曲无法启动播放，正在尝试队列里的下一首。',
              sourceFallbackRecoveryFailureOptions(_invocationState.retryPlaybackOpts)
            );
          }
        }
        forcePlaybackControlsInteractive();
        if (_invocationState.opts.startupAutoplay && !_invocationState.mediaFailureRecovery) {
          return false;
        }
        if (!_invocationState.opts.suppressPlayFailureNotice) {
          if (_invocationState.opts.manual) {
            showToast('播放启动失败，请重新选择歌曲');
          } else {
            showSourceFallbackNotice('歌曲已载入', '点击播放器中间的播放按钮继续播放。');
          }
        }
        return false;
      }
      forcePlaybackControlsInteractive();
      if (_invocationState.playbackProvider === 'netease' && _invocationState.data && _invocationState.data.sourceMatch) {
        applyNeteaseSourceMatchMetadata(_invocationState.song, _invocationState.data);
        if (typeof updateControlTrackInfo === 'function') updateControlTrackInfo(_invocationState.song);
      }
      if (!_invocationState.opts.startupAutoplay && !_invocationState.opts.qualitySwitch && _invocationState.data && _invocationState.data.sourceMatch && !_invocationState.song.neteaseSourceMatchNotified && typeof showSourceFallbackNotice === 'function') {
        _invocationState.song.neteaseSourceMatchNotified = true;
        showSourceFallbackNotice('网易云已匹配可播音源', '已在网易云内切换到同一首歌的可播版本；歌词、封面、专辑和队列仍保持原曲。');
      }
      if (_invocationState.albumGaplessHandoff && _invocationState.albumGaplessMixed && typeof rampAudioOutputGain === 'function') {
        rampAudioOutputGain(targetVolume, ALBUM_GAPLESS_ADOPT_SLEW_MS);
      }
      if (_invocationState.albumGaplessHandoff && _invocationState.albumGaplessPreviousAudio && _invocationState.albumGaplessPreviousAudio !== audio) {
        setTimeout(function () {
          try {
            _invocationState.albumGaplessPreviousAudio.pause();
            _invocationState.albumGaplessPreviousAudio.removeAttribute('src');
            _invocationState.albumGaplessPreviousAudio.load();
          } catch (e) { }
        }, 220);
      }
      _invocationState.markPlayPhase('session-begin');
      safePlaybackStep('listen-session-begin', function () { if (!_invocationState.opts.startPaused) beginListenSession(_invocationState.song, _invocationState.playbackContext); });
      _invocationState.markPlayPhase('lyrics-fetch');
      if (_invocationState.song.type === 'podcast') {
        if (typeof cancelPendingTrackFallbackLyrics === 'function') cancelPendingTrackFallbackLyrics();
        safePlaybackStep('podcast-lyrics', function () {
          var podcastLyricLines = withLyricFallback([]);
          setOriginalLyricsState(podcastLyricLines, false, 'fallback');
          applyPreferredLyricsForCurrent(true);
        });
      } else if (!_invocationState.qualitySwitch) {
        if (!_invocationState.earlyLyricFetchStarted) fetchLyric(_invocationState.song, _invocationState.token);
      } else {
        if (typeof cancelPendingTrackFallbackLyrics === 'function') cancelPendingTrackFallbackLyrics();
        if (typeof markStageLyricsPlaybackResume === 'function') markStageLyricsPlaybackResume('quality-switch-lyrics-kept');
      }
      if (!_invocationState.qualitySwitch) {
        safeRenderQueuePanel('play-queue-at');
        scheduleShelfRebuild('play-queue-at', true);
        if (typeof scheduleQueueLyricPrefetch === 'function') scheduleQueueLyricPrefetch(_invocationState.idx, 2400);
      }
      if (!_invocationState.qualitySwitch && typeof scheduleCuefieldAutoMixPrepare === 'function') {
        _invocationState.cuefieldPrepareDelay = typeof cuefieldAutoMixPostSwitchDelay === 'function'
          ? cuefieldAutoMixPostSwitchDelay(!!_invocationState.opts.cuefieldAutoMix)
          : 4200;
        scheduleCuefieldAutoMixPrepare(_invocationState.token, _invocationState.idx, _invocationState.cuefieldPrepareDelay);
      }
      scheduleAlbumGaplessPreloadForCurrent(_invocationState.token, _invocationState.albumGaplessHandoff ? 'album-gapless-handoff-started' : 'track-started');
      safePlaybackStep('shelf-preview-suppress-end', suppressShelfPreviewForPlaybackSwitch);
      if (typeof completeSourceFallbackRecovery === 'function') {
        completeSourceFallbackRecovery(sourceFallbackRecoveryFromOptions(_invocationState.opts));
      }
      return true;
    } catch (err) {
      if (_invocationState.resolutionOwner && _invocationState.resolutionOwner.wasCancelled) return false;
      if (_invocationState.token !== trackSwitchToken) return false;
      console.error('Play failed:', { phase: _invocationState.playPhase, error: err }, err);
      hideLoading();
      forcePlaybackControlsInteractive();
      if (_invocationState.opts.sourceSwitch) return false;
      _invocationState.catchRecovery = typeof sourceFallbackRecoveryFromOptions === 'function'
        ? sourceFallbackRecoveryFromOptions(_invocationState.opts)
        : null;
      if (_invocationState.catchRecovery && _invocationState.opts.fallbackDepth > 0) return false;
      if (!isPlaybackRecursionError(err) && !isPlaybackActionRequiredError(err)) {
        _invocationState.errorFallback = await tryAutoPlaybackFallback(_invocationState.song, { url: null, error: String(err && err.message || err) }, _invocationState.idx, _invocationState.token, _invocationState.opts);
        if (_invocationState.errorFallback !== null) return _invocationState.errorFallback === true;
        return await skipFailedQueueItem(
          _invocationState.idx,
          _invocationState.token,
          '当前歌曲加载失败，正在尝试队列里的下一首。',
          _invocationState.catchRecovery ? sourceFallbackRecoveryFailureOptions(_invocationState.opts) : { playbackOpts: _invocationState.opts }
        );
      }
      if (_invocationState.opts.suppressPlayFailureNotice) return false;
      _invocationState.failText = playbackFailureToastText(err);
      showToast(_invocationState.failText);
      if (typeof showSourceFallbackNotice === 'function') showSourceFallbackNotice('播放失败', _invocationState.failText);
      return false;
    }
}

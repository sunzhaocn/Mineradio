'use strict';



function startAlbumGaplessMix(preload, reason, remaining) {
  if (!preload || !preload.media || preload.mixStarted || preload.mixPending || albumGaplessState.handoff) return false;
  if (!albumGaplessQueueCanAdvance(currentIdx)) return false;
  if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting) return false;
  var outgoingMedia = audio;
  var outgoingToken = trackSwitchToken;
  var outgoingIndex = currentIdx;
  preload.mixPending = true;
  preload.releaseReason = reason || 'crossmix';
  if ((reason === 'boundary-crossmix-reset' || reason === 'tail-silence-fast-crossmix' || reason === 'tail-direct-silence-crossmix') && preload.prerollStarted) {
    try {
      preload.media.pause();
      preload.media.currentTime = 0;
    } catch (e) { }
    preload.prerollPlaying = false;
  }
  try {
    preload.media.muted = false;
    preload.media.volume = 0;
    var playResult = preload.media.play();
  } catch (err) {
    preload.mixPending = false;
    preload.prerollFailed = true;
    console.warn('[AlbumGapless] crossmix start failed:', err);
    return false;
  }
  Promise.resolve(playResult).then(function () {
    var stillCurrent = albumGaplessState.preload === preload
      && outgoingToken === trackSwitchToken
      && outgoingIndex === currentIdx
      && outgoingMedia === audio
      && albumGaplessQueueCanAdvance(currentIdx)
      && queueItemKey(playQueue[preload.index]) === preload.key;
    if (!stillCurrent) {
      if (albumGaplessState.preload === preload) clearAlbumGaplessPreload('album-gapless-mix-stale');
      else disposeAlbumGaplessPreload(preload);
      return false;
    }
    preload.mixPending = false;
    preload.mixStarted = true;
    preload.mixStartedAt = performance.now();
    preload.transitionToken = outgoingToken;
    preload.transitionIndex = outgoingIndex;
    preload.previousAudio = outgoingMedia || null;
    preload.previousAudioOnEnded = preload.previousAudio ? preload.previousAudio.onended : null;
    if (preload.previousAudio) preload.previousAudio.onended = null;
    var mixMs = Math.round(ALBUM_GAPLESS_MIX_SECONDS * 1000);
    if (isFinite(remaining) && remaining > 0) {
      mixMs = Math.min(mixMs, Math.max(ALBUM_GAPLESS_MIN_MIX_MS, Math.round(remaining * 1000 + 80)));
    }
    preload.mixDurationMs = mixMs;
    return runAlbumGaplessBalancedCrossfade(preload, mixMs);
  }).then(function (completed) {
    if (!completed) {
      if (albumGaplessState.preload === preload) restoreAlbumGaplessOutgoingIfCurrent(preload, 120);
      if (albumGaplessState.preload === preload) clearAlbumGaplessPreload('album-gapless-mix-cancelled');
      else disposeAlbumGaplessPreload(preload);
      return;
    }
    if (albumGaplessState.preload !== preload || !preload.fadeCompleted) return;
    preload.handoffTimer = setTimeout(function () {
      preload.handoffTimer = 0;
      if (albumGaplessState.preload === preload && preload.fadeCompleted) {
        startAlbumGaplessHandoff(preload, preload.releaseReason || reason || 'crossmix');
      }
    }, Math.max(24, ALBUM_GAPLESS_BIND_AFTER_MIX_MS));
  }).catch(function (err) {
    preload.mixPending = false;
    preload.mixStarted = false;
    preload.prerollFailed = true;
    console.warn('[AlbumGapless] crossmix play failed:', err);
    if (albumGaplessState.preload === preload) restoreAlbumGaplessOutgoingIfCurrent(preload, 120);
    if (albumGaplessState.preload === preload) clearAlbumGaplessPreload('album-gapless-mix-play-failed');
    else disposeAlbumGaplessPreload(preload);
  });
  return true;
}


function setAlbumGaplessPlaybackContext(enabled, context, opts) {
  opts = opts || {};
  var albumKey = context ? String(context.albumKey || '') : '';
  if (opts.userToggle && albumKey) {
    albumGaplessState.disabledAlbumKey = enabled ? '' : albumKey;
  }
  albumGaplessState.enabled = !!enabled;
  albumGaplessState.context = context || null;
  albumGaplessState.albumKey = enabled && context ? albumKey : '';
  if (!albumGaplessState.enabled || !albumGaplessState.albumKey) {
    albumGaplessState.enabled = false;
    if (albumGaplessState.preload && albumGaplessState.preload.mixStarted) {
      restoreAlbumGaplessOutgoingIfCurrent(albumGaplessState.preload, 120);
    }
    clearAlbumGaplessPreload('album-gapless-disabled');
    return false;
  }
  scheduleAlbumGaplessPreloadForCurrent(trackSwitchToken, 'context-enabled');
  return true;
}


function albumGaplessQueueCanAdvance(idx) {
  if (!albumGaplessState || !albumGaplessState.enabled || !albumGaplessState.albumKey) return false;
  if (Number(albumGaplessState.fallbackToken) === Number(trackSwitchToken)) return false;
  if (playMode === 'single') return false;
  if (idx < 0 || idx + 1 >= playQueue.length) return false;
  var currentKey = albumGaplessSongKey(playQueue[idx]);
  var nextKey = albumGaplessSongKey(playQueue[idx + 1]);
  return currentKey === albumGaplessState.albumKey && nextKey === albumGaplessState.albumKey;
}


function qqPlaybackEvidenceQuery(song) {
  song = song || {};
  var vipRequired = !!(song.vipRequired || song.needVip || song.need_vip || song.onlyVipPlayable || song.only_vip_playable);
  if (!vipRequired && typeof songRequiresVip === 'function') {
    try { vipRequired = songRequiresVip(song); } catch (e) { vipRequired = false; }
  }
  return '&vipRequired=' + encodeURIComponent(vipRequired ? '1' : '') +
    '&needVip=' + encodeURIComponent(song.needVip || song.need_vip ? '1' : '') +
    '&onlyVipPlayable=' + encodeURIComponent(song.onlyVipPlayable || song.only_vip_playable ? '1' : '') +
    '&privilege=' + encodeURIComponent(song.privilege || song.Privilege || song.mediaPrivilege || song.media_privilege || '') +
    '&fee=' + encodeURIComponent(song.fee || song.Fee || '');
}


function neteasePlaybackMatchQuery(song, opts) {
  song = song || {};
  opts = opts || {};
  var excludeIds = Array.isArray(opts.excludeIds)
    ? opts.excludeIds.join(',')
    : String(opts.excludeIds || '');
  var artistId = song.artistId || song.artist_id || '';
  if (!artistId && Array.isArray(song.artists) && song.artists[0]) artistId = song.artists[0].id || '';
  if (!artistId && Array.isArray(song.ar) && song.ar[0]) artistId = song.ar[0].id || '';
  var artistRecords = Array.isArray(song.artists) && song.artists.length ? song.artists : (Array.isArray(song.ar) ? song.ar : []);
  var artistIds = artistRecords.map(function (artist) { return artist && artist.id || ''; }).filter(Boolean);
  var artistNames = artistRecords.map(function (artist) { return artist && artist.name || ''; }).filter(Boolean);
  if (!artistIds.length && artistId) artistIds = [artistId];
  if (!artistNames.length && (song.artist || song.artistName)) artistNames = [song.artist || song.artistName];
  var albumName = song.album || song.albumName || '';
  if (albumName && typeof albumName === 'object') albumName = albumName.name || '';
  return '&name=' + encodeURIComponent(song.name || song.title || '') +
    '&artist=' + encodeURIComponent(song.artist || song.artistName || '') +
    '&artistId=' + encodeURIComponent(artistId) +
    '&artistIds=' + encodeURIComponent(artistIds.join(',')) +
    '&artistNames=' + encodeURIComponent(artistNames.join('\u001f')) +
    '&album=' + encodeURIComponent(albumName) +
    '&duration=' + encodeURIComponent(song.durationMs || song.dt || song.duration || 0) +
    '&excludeIds=' + encodeURIComponent(excludeIds) +
    '&skipDirect=' + (opts.skipDirect ? '1' : '');
}


function clearNeteaseSourceMatchMetadata(song) {
  if (!song) return song;
  song.neteaseSourceMatched = false;
  song.resolvedNeteaseId = '';
  song.neteaseSourceMatchKind = '';
  song.neteaseSourceMatchScore = 0;
  song.neteaseSourceMatchAlbum = '';
  song.neteaseSourceMatchNotified = false;
  return song;
}


function applyNeteaseSourceMatchMetadata(song, data) {
  if (!song || !data || !data.sourceMatch) return song;
  song.neteaseSourceMatched = true;
  song.resolvedNeteaseId = data.resolvedNeteaseId || data.resolvedSongId || song.resolvedNeteaseId || '';
  song.neteaseSourceMatchKind = data.matchKind || 'netease_same_track_metadata';
  song.neteaseSourceMatchScore = Number(data.matchScore || 0) || 0;
  song.neteaseSourceMatchAlbum = data.matchedSong && data.matchedSong.album || '';
  song.playbackSource = data.source || 'netease-same-track';
  return song;
}


function neteaseSourceMatchTriedIds(data) {
  var tried = Array.isArray(data && data.sourceMatchTriedIds) ? data.sourceMatchTriedIds.slice() : [];
  var resolved = data && (data.resolvedNeteaseId || data.resolvedSongId);
  if (resolved && tried.map(String).indexOf(String(resolved)) < 0) tried.push(String(resolved));
  return tried.filter(Boolean).slice(0, 4);
}


async function retryNeteaseSourceMatchPlayback(song, data, idx, token, opts, requestedQuality) {
  if (!song || !data || !data.sourceMatch) return null;
  opts = opts || {};
  var sourceRecovery = typeof sourceFallbackRecoveryFromOptions === 'function'
    ? sourceFallbackRecoveryFromOptions(opts)
    : null;
  if (sourceRecovery && !sourceFallbackRecoveryCanContinue(sourceRecovery)) return null;
  var retryDepth = Math.max(0, Number(opts.neteaseSourceMatchRetryDepth) || 0);
  var triedIds = neteaseSourceMatchTriedIds(data);
  if (retryDepth >= 3 || triedIds.length >= 4) return null;
  var nextData = null;
  try {
    var nextDataPromise = apiJson(
      '/api/song/url?id=' + encodeURIComponent(song.id || '') +
      neteasePlaybackMatchQuery(song, { excludeIds: triedIds, skipDirect: true }) +
      '&quality=' + encodeURIComponent(requestedQuality),
      Object.assign({ timeoutMs: 10000 }, opts.playbackResolutionOwner && opts.playbackResolutionOwner.signal
        ? { signal: opts.playbackResolutionOwner.signal } : {})
    );
    nextData = sourceRecovery
      ? await awaitSourceFallbackBudget(nextDataPromise, sourceRecovery)
      : await nextDataPromise;
  } catch (err) {
    console.warn('[NeteaseSourceMatch] next candidate lookup failed:', err);
    return token === trackSwitchToken ? null : false;
  }
  if (token !== trackSwitchToken) return false;
  if (sourceRecovery && (nextData === sourceFallbackBudgetTimeoutResult || !sourceFallbackRecoveryCanContinue(sourceRecovery))) return null;
  if (!nextData || !nextData.url || !nextData.sourceMatch) return null;
  var retryOpts = Object.assign({}, opts, {
    albumGaplessHandoff: false,
    albumGaplessMixed: false,
    preloadedAudio: null,
    preloadedData: null,
    preloadedProxyAudioUrl: '',
    preResolvedPlaybackData: nextData,
    neteaseSourceMatchRetryDepth: retryDepth + 1,
    qualityOverride: requestedQuality,
    suppressPlayFailureNotice: true,
  });
  var retryPromise = playQueueAt(idx, retryOpts);
  var retryToken = trackSwitchToken;
  var retryStarted = await retryPromise;
  if (retryToken !== trackSwitchToken) return false;
  return retryStarted === true;
}


async function resolveAlbumGaplessPlaybackData(song, opts) {
  opts = opts || {};
  if (opts.signal && opts.signal.aborted || opts.isCurrent && !opts.isCurrent()) return null;
  var data = await requestAlbumGaplessPlaybackData(song, opts);
  if ((!data || !data.url) && song && !song.localUrl
    && typeof window.resolvePlaybackDataWithQualityFallback === 'function') {
    var provider = normalizePlaybackProvider(songProviderKey(song));
    return await window.resolvePlaybackDataWithQualityFallback(song, {
      data: data,
      signal: opts.signal,
      isCurrent: opts.isCurrent,
      requestedQuality: getProviderPlaybackQuality(provider)
    }) || data;
  }
  return data;
}


async function requestAlbumGaplessPlaybackData(song, opts) {
  opts = opts || {};
  function requestOptions(timeoutMs) { return Object.assign({ timeoutMs: timeoutMs }, opts.signal ? { signal: opts.signal } : {}, opts.background ? { priority: 'low' } : {}); }
  if (!song || song.type === 'local' || song.source === 'local' || song.localUrl) return null;
  var playbackProvider = normalizePlaybackProvider(songProviderKey(song));
  var requestedQuality = normalizePlaybackQualityForProvider(getProviderPlaybackQuality(playbackProvider), playbackProvider);
  if (playbackProvider === 'netease' && requestedQuality === 'jymaster' && !hasProviderSvip('netease', loginStatus)) requestedQuality = 'hires';
  var runtimeQualityCap = playbackQualityCapValue(song, playbackProvider);
  if (playbackQualityAboveCap(requestedQuality, playbackProvider, runtimeQualityCap)) requestedQuality = runtimeQualityCap;
  var qualityParam = '&quality=' + encodeURIComponent(requestedQuality);
  if (playbackProvider === 'qq') {
    return apiJson('/api/qq/song/url?mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '') + '&mediaMid=' + encodeURIComponent(song.mediaMid || song.media_mid || '') + qqPlaybackEvidenceQuery(song) + qualityParam, requestOptions(15000));
  }
  if (playbackProvider === 'kugou') {
    return apiJson('/api/kugou/song/url?hash=' + encodeURIComponent(song.hash || song.fileHash || song.audioHash || song.id || '') +
      '&albumId=' + encodeURIComponent(song.albumId || song.album_id || '') +
      '&albumAudioId=' + encodeURIComponent(song.albumAudioId || song.album_audio_id || song.mixSongId || '') +
      '&mixSongId=' + encodeURIComponent(song.mixSongId || '') +
      '&hqHash=' + encodeURIComponent(song.hqHash || song.hq_hash || '') +
      '&sqHash=' + encodeURIComponent(song.sqHash || song.sq_hash || '') +
      '&resHash=' + encodeURIComponent(song.resHash || song.res_hash || '') +
      '&vipRequired=' + encodeURIComponent(song.vipRequired || song.needVip || song.onlyVipPlayable || song.only_vip_playable ? '1' : '') +
      '&privilege=' + encodeURIComponent(song.privilege || song.Privilege || song.mediaPrivilege || song.media_privilege || '') +
      '&fee=' + encodeURIComponent(song.fee || song.Fee || '') +
      qualityParam, requestOptions(20000));
  }
  if (playbackProvider === 'qishui') {
    return apiJson('/api/qishui/song/url?id=' + encodeURIComponent(song.id || song.providerSongId || '') + qqPlaybackEvidenceQuery(song) + qualityParam, requestOptions(15000));
  }
  if (playbackProvider === 'spotify') {
    return apiJson('/api/spotify/song/url?id=' + encodeURIComponent(song.id || song.providerSongId || song.spotifyId || '') +
      '&spotifyId=' + encodeURIComponent(song.spotifyId || '') +
      '&uri=' + encodeURIComponent(song.spotifyUri || song.uri || '') +
      qualityParam, requestOptions(9000));
  }
  return apiJson('/api/song/url?id=' + encodeURIComponent(song.id || '') + neteasePlaybackMatchQuery(song) + qualityParam, requestOptions(14000));
}


function consumeAlbumGaplessPreload(preload) {
  if (albumGaplessState.monitorTimer) {
    clearInterval(albumGaplessState.monitorTimer);
    albumGaplessState.monitorTimer = 0;
  }
  if (albumGaplessState.preload === preload) albumGaplessState.preload = null;
}


function startAlbumGaplessHandoff(preload, reason) {
  if (!preload || albumGaplessState.handoff) return false;
  if (
    !albumGaplessQueueCanAdvance(currentIdx)
    || preload.index !== currentIdx + 1
    || preload.token !== trackSwitchToken
    || queueItemKey(playQueue[preload.index]) !== preload.key
  ) {
    if (albumGaplessState.preload === preload) {
      restoreAlbumGaplessOutgoingIfCurrent(preload, 120);
      clearAlbumGaplessPreload('album-gapless-handoff-invalid');
    } else {
      disposeAlbumGaplessPreload(preload);
    }
    return false;
  }
  preload.releaseReason = reason || 'boundary';
  albumGaplessState.handoff = true;
  consumeAlbumGaplessPreload(preload);
  var handoffSourceToken = trackSwitchToken;
  var handoffPreviousAudio = preload.previousAudio || audio;
  function scheduleAlbumGaplessNormalFallback() {
    var expectedFailedToken = handoffSourceToken + 1;
    if (
      trackSwitchToken !== expectedFailedToken
      || currentIdx !== preload.index
      || (audio !== preload.media && audio !== handoffPreviousAudio)
    ) return false;
    var fallbackOwnerMedia = audio;
    if (fallbackOwnerMedia === preload.media) {
      try {
        preload.media.pause();
        preload.media.removeAttribute('src');
        preload.media.load();
      } catch (e) { }
      if (handoffPreviousAudio && handoffPreviousAudio !== fallbackOwnerMedia) {
        try {
          handoffPreviousAudio.pause();
          handoffPreviousAudio.removeAttribute('src');
          handoffPreviousAudio.load();
        } catch (e2) { }
      }
    } else {
      disposeAlbumGaplessPreload(preload);
    }
    setTimeout(function () {
      if (
        trackSwitchToken === expectedFailedToken
        && currentIdx === preload.index
        && audio === fallbackOwnerMedia
      ) {
        playQueueAt(preload.index, { skipShuffleOrder: true, suppressPlayFailureNotice: true, preserveHomeState: true });
      }
    }, 0);
    return true;
  }
  if (preload.song) {
    preload.song.__albumGaplessKey = albumGaplessState.albumKey;
    playQueue[preload.index] = hydrateCustomCover(preload.song);
  }
  Promise.resolve(playQueueAt(preload.index, {
    skipShuffleOrder: true,
    suppressPlayFailureNotice: true,
    preserveHomeState: true,
    albumGaplessHandoff: true,
    albumGaplessMixed: !!preload.mixStarted,
    albumGaplessReleaseReason: preload.releaseReason || reason || '',
    preloadedAudio: preload.media,
    preloadedData: preload.data,
    preloadedProxyAudioUrl: preload.proxyAudioUrl,
  })).then(function (success) {
    var adopted = success === true
      && audio === preload.media
      && currentIdx === preload.index
      && preload.media.src
      && !preload.media.paused
      && !preload.media.ended;
    if (adopted) return true;
    if (!scheduleAlbumGaplessNormalFallback() && audio !== preload.media) disposeAlbumGaplessPreload(preload);
    return false;
  }).catch(function (err) {
    console.warn('[AlbumGapless] handoff failed:', err);
    if (!scheduleAlbumGaplessNormalFallback() && audio !== preload.media) disposeAlbumGaplessPreload(preload);
  }).finally(function () {
    albumGaplessState.handoff = false;
  });
  return true;
}

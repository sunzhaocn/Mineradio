'use strict';


function controlSourceProviders() {
  return [
    { key: 'netease', label: 'NE', title: '网易云' },
    { key: 'qq', label: 'QQ', title: 'QQ音乐' },
    { key: 'kugou', label: 'KG', title: '酷狗' },
    { key: 'qishui', label: 'QS', title: '汽水' },
    { key: 'spotify', label: 'SP', title: 'Spotify' }
  ];
}

function controlSourceProviderTitle(provider) {
  var item = controlSourceProviders().filter(function (p) { return p.key === provider; })[0];
  return item ? item.title : provider;
}

function controlSourceSearchUrl(provider, query) {
  if (provider === 'qq') return '/api/qq/search?keywords=' + encodeURIComponent(query) + '&limit=8';
  if (provider === 'kugou') return '/api/kugou/search?keywords=' + encodeURIComponent(query) + '&limit=8';
  if (provider === 'qishui') return '/api/qishui/search?keywords=' + encodeURIComponent(query) + '&limit=8';
  if (provider === 'spotify') return '/api/spotify/search?keywords=' + encodeURIComponent(query) + '&limit=8';
  return '/api/search?keywords=' + encodeURIComponent(query) + '&limit=10';
}

function ensureControlSourceSwitcher() {
  var el = document.getElementById('control-source-switcher');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'control-source-switcher';
  el.className = 'control-source-switcher';
  el.setAttribute('role', 'menu');
  el.addEventListener('click', function (e) { e.stopPropagation(); });
  document.body.appendChild(el);
  return el;
}

function currentControlSong() {
  return Array.isArray(playQueue) && currentIdx >= 0 && currentIdx < playQueue.length ? playQueue[currentIdx] : null;
}

function controlSourceSwitchQuery(song) {
  song = song || {};
  var artist = String(song.artist || '').split(/\s*\/\s*|\s*,\s*|\s*&\s*/)[0] || '';
  return [song.name || song.title || '', artist].filter(Boolean).join(' ').trim();
}

function controlSourcePositionSwitcher(anchor) {
  var el = ensureControlSourceSwitcher();
  anchor = anchor || controlSourceSwitcherState.anchor;
  if (!anchor || !anchor.getBoundingClientRect) return;
  var rect = anchor.getBoundingClientRect();
  var width = Math.min(276, window.innerWidth - 24);
  var left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
  el.style.width = width + 'px';
  el.style.left = left + 'px';
  el.style.bottom = Math.max(18, window.innerHeight - rect.top + 10) + 'px';
}

function closeControlSourceSwitcher() {
  var el = document.getElementById('control-source-switcher');
  controlSourceSwitcherState.open = false;
  controlSourceSwitcherState.loading = false;
  controlSourceSwitcherState.anchor = null;
  if (el) el.classList.remove('show', 'loading');
}

function controlSourceMatchSong(entry) {
  if (!entry) return null;
  if (entry.song) return entry.song;
  return entry.name ? entry : null;
}

function controlSourceMatchIssue(entry) {
  return entry && entry.issue ? entry.issue : 'no_source';
}

function renderControlSourceSwitcher(matches) {
  var el = ensureControlSourceSwitcher();
  var song = currentControlSong();
  var current = songProviderKey(song);
  matches = matches || {};
  el.classList.toggle('loading', !!controlSourceSwitcherState.loading);
  el.innerHTML =
    '<div class="control-source-switcher-head"><span>切换音源</span><small>' + (controlSourceSwitcherState.loading ? '正在匹配' : '保留当前进度') + '</small></div>' +
    '<div class="control-source-options">' +
    controlSourceProviders().map(function (provider) {
      var entry = matches[provider.key];
      var match = controlSourceMatchSong(entry);
      var issue = controlSourceMatchIssue(entry);
      var active = provider.key === current;
      var ready = active || !!match;
      var providerLimited = !!(match && provider.key === 'spotify' && match.playable === false);
      var cleanStatus = active ? '当前' : (providerLimited ? '匹配源' : (match ? '可切换' : (controlSourceSwitcherState.loading ? '检测中' : controlSourceIssueLabel(issue))));
      var title = active ? '当前音源' : (providerLimited ? (provider.title + ': 播放将自动换源') : (match ? ('切换到 ' + provider.title) : (provider.title + ': ' + controlSourceIssueLabel(issue))));
      var status = active ? '当前' : (providerLimited ? '匹配源' : (match ? '可切换' : (controlSourceSwitcherState.loading ? '检测中' : '无匹配')));
      return '<button type="button" class="control-source-option' + (active ? ' active' : '') + (!ready ? ' disabled' : '') + '" data-source-provider="' + provider.key + '" title="' + escHtml(title) + '" ' + (!ready ? 'disabled ' : '') + 'onclick="switchCurrentSongSource(\'' + provider.key + '\')">' +
        '<span class="tag-source ' + provider.key + '">' + provider.label + '</span>' +
        '<span class="control-source-option-title">' + provider.title + '</span>' +
        '<small>' + cleanStatus + '</small>' +
        '</button>';
    }).join('') +
    '</div>';
  controlSourcePositionSwitcher();
}

async function findControlSourceMatchResult(song, provider) {
  // 聚合搜索去重后保留了每个平台的完整记录；直接复用可避免重新搜索漏掉汽水等音源。
  // 仍核对歌名、完整歌手和版本，旧缓存中的其它录音不会被当作当前歌曲。
  var known = searchSongSources(song).filter(function (candidate) {
    return songProviderKey(candidate) === provider && !sourceCandidateRejectReason(song, candidate, provider);
  });
  if (known.length) return { song: cloneSong(known[0]), issue: '' };
  var query = controlSourceSwitchQuery(song);
  if (!query) return { song: null, issue: 'no_source' };
  var data = await apiJson(controlSourceSearchUrl(provider, query), { timeoutMs: 6000 });
  var list = data && (data.songs || data.result || []);
  if (!Array.isArray(list) || !list.length) return { song: null, issue: 'no_source' };
  var best = null;
  var bestScore = -Infinity;
  var bestIssue = 'no_source';
  for (var i = 0; i < list.length; i++) {
    var candidate = list[i];
    var issue = sourceCandidateRejectReason(song, candidate, provider);
    if (issue) {
      if (bestIssue === 'no_source' || issue === 'blocked_artist' || issue === 'artist_extra' || issue === 'artist_mismatch') bestIssue = issue;
      continue;
    }
    var score = typeof scoreSongSearchResult === 'function' ? scoreSongSearchResult(candidate, query, i) : 0;
    if (typeof isSameTitleArtist === 'function' && isSameTitleArtist(song, candidate)) score += 120;
    if (candidate && candidate.playable === false) score -= 18;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best && bestScore >= 24 ? { song: cloneSong(best), issue: '' } : { song: null, issue: bestIssue };
}

async function findControlSourceMatch(song, provider) {
  var strictResult = await findControlSourceMatchResult(song, provider);
  return strictResult && strictResult.song ? strictResult.song : null;
}

async function loadControlSourceMatches(song, requestId) {
  var matches = {};
  var providers = controlSourceProviders();
  await Promise.all(providers.map(async function (provider) {
    if (songProviderKey(song) === provider.key) {
      matches[provider.key] = { song: song, issue: '' };
      return;
    }
    try {
      matches[provider.key] = await findControlSourceMatchResult(song, provider.key);
    } catch (err) {
      console.warn('[SourceSwitchSearch]', provider.key, err);
      matches[provider.key] = { song: null, issue: 'no_source' };
    }
  }));
  if (requestId !== controlSourceSwitcherState.requestId || !controlSourceSwitcherState.open) return;
  controlSourceSwitcherState.loading = false;
  renderControlSourceSwitcher(matches);
  controlSourceSwitcherState.matches = matches;
}

function toggleControlSourceSwitcher(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  var song = currentControlSong();
  if (!song || song.type === 'local' || song.source === 'local' || song.localUrl || song.type === 'podcast') {
    showToast('当前歌曲不支持切换音源');
    return;
  }
  var anchor = e && e.currentTarget ? e.currentTarget : null;
  var el = ensureControlSourceSwitcher();
  if (controlSourceSwitcherState.open && controlSourceSwitcherState.anchor === anchor) {
    closeControlSourceSwitcher();
    return;
  }
  controlSourceSwitcherState.open = true;
  controlSourceSwitcherState.loading = true;
  controlSourceSwitcherState.anchor = anchor;
  controlSourceSwitcherState.requestId++;
  controlSourceSwitcherState.matches = {};
  renderControlSourceSwitcher({ [songProviderKey(song)]: { song: song, issue: '' } });
  controlSourcePositionSwitcher(anchor);
  el.classList.add('show');
  loadControlSourceMatches(song, controlSourceSwitcherState.requestId);
}

async function switchCurrentSongSource(provider) {
  provider = normalizePlaybackProvider(provider);
  var song = currentControlSong();
  if (!song) return;
  var switchQueue = playQueue;
  var switchIndex = currentIdx;
  var currentProvider = songProviderKey(song);
  var previousSong = cloneSong(song);
  if (provider === currentProvider) {
    closeControlSourceSwitcher();
    return;
  }
  var requestId = ++controlSourceSwitcherState.requestId;
  var replacement = null;
  var resumeAt = 0;
  var startPaused = false;
  var ownedPlaybackToken = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : null;
  function stillOwnsSwitch() {
    // 搜索/解析期间用户可能已切歌或再次换源；旧请求不能改回新歌曲的队列和界面。
    return (ownedPlaybackToken == null || ownedPlaybackToken === trackSwitchToken) &&
      requestId === controlSourceSwitcherState.requestId && playQueue === switchQueue &&
      currentIdx === switchIndex && playQueue[switchIndex] === (replacement || song);
  }
  function startOwnedPlayback(options) {
    // playQueueAt 在第一次 await 前同步生成新 token；记录属于本次换源的那一次调用。
    // 用户“下一首再返回”时即便队列对象与索引一样，token 也能识别新的播放任务。
    try { return playQueueAt(switchIndex, options); }
    finally { ownedPlaybackToken = typeof trackSwitchToken !== 'undefined' ? trackSwitchToken : null; }
  }
  async function restorePreviousSource() {
    if (!replacement || !stillOwnsSwitch()) return false;
    playQueue[switchIndex] = hydrateCustomCover(previousSong);
    replacement = playQueue[switchIndex];
    safeRenderQueuePanel('manual-source-switch-restore', { scrollCurrent: miniQueueOpen });
    updateControlTrackInfo(replacement);
    // 真正的播放入口通常以 false 表示失败，且新 src 可能已经覆盖旧媒体。
    // 重新准备旧源，恢复保存的秒数与暂停状态，不能只把文字改回旧平台。
    return await startOwnedPlayback({
      manual: true, resumeAt: resumeAt, startPaused: startPaused,
      preserveHomeState: true, sourceSwitch: true, skipShuffleOrder: true,
      suppressPlayFailureNotice: true
    }) === true;
  }
  controlSourceSwitcherState.loading = true;
  renderControlSourceSwitcher(controlSourceSwitcherState.matches || {});
  try {
    var entry = controlSourceSwitcherState.matches && controlSourceSwitcherState.matches[provider];
    var match = controlSourceMatchSong(entry);
    var issue = controlSourceMatchIssue(entry);
    // 菜单可能在异步匹配期间已切到另一首歌，不能直接使用旧歌曲的缓存候选。
    if (match && (songProviderKey(match) !== provider || sourceCandidateRejectReason(song, match, provider))) match = null;
    if (!match) {
      var lookup = await findControlSourceMatchResult(song, provider);
      match = lookup && lookup.song ? lookup.song : null;
      issue = lookup && lookup.issue ? lookup.issue : issue;
      if (stillOwnsSwitch() && controlSourceSwitcherState.matches) controlSourceSwitcherState.matches[provider] = lookup || { song: null, issue: issue || 'no_source' };
    }
    if (!stillOwnsSwitch()) return false;
    if (!match) {
      showSourceFallbackNotice('该平台无正版音源', controlSourceProviderTitle(provider) + ': ' + controlSourceIssueLabel(issue));
      controlSourceSwitcherState.loading = false;
      renderControlSourceSwitcher(controlSourceSwitcherState.matches || {});
      return false;
    }
    // 在替换队列与刷新界面之前读取媒体状态，防止新记录/旧时长把当前进度重置。
    resumeAt = currentResumeSeconds(0);
    startPaused = typeof audio !== 'undefined' && audio ? !!(audio.paused || audio.ended) :
      (typeof playing !== 'undefined' && !playing);
    // 换源只改变当前播放记录，已经发现的四平台候选继续跟随歌曲，方便再次切换。
    match = mergeSearchSongSources(match, song);
    match.manualSourceSwitchFrom = currentProvider;
    match.manualSourceSwitchAt = Date.now();
    replacement = hydrateCustomCover(match);
    playQueue[switchIndex] = replacement;
    closeControlSourceSwitcher();
    safeRenderQueuePanel('manual-source-switch', { scrollCurrent: miniQueueOpen });
    updateControlTrackInfo(playQueue[currentIdx]);
    showSourceFallbackNotice('正在切换音源', (song.name || '当前歌曲') + ' -> ' + controlSourceProviderTitle(provider));
    var started = await startOwnedPlayback({
      manual: true,
      resumeAt: resumeAt,
      startPaused: startPaused,
      preserveHomeState: true,
      sourceSwitch: true,
      skipShuffleOrder: true
    });
    if (!stillOwnsSwitch()) return false;
    if (started !== true) {
      var restored = await restorePreviousSource();
      if (stillOwnsSwitch()) showSourceFallbackNotice('音源切换失败', restored ? '已恢复原音源和进度。' : '已保留原音源和队列，请点击播放重试。');
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[SourceSwitch]', provider, err);
    if (!stillOwnsSwitch()) return false;
    var restoredAfterError = false;
    try { restoredAfterError = await restorePreviousSource(); } catch (restoreErr) {
      console.warn('[SourceSwitchRestore]', restoreErr);
    }
    if (stillOwnsSwitch()) showSourceFallbackNotice('音源切换失败', restoredAfterError ? '已恢复原音源和进度。' : '已保留原音源和队列，请点击播放重试。');
    return false;
  } finally {
    if (requestId === controlSourceSwitcherState.requestId) controlSourceSwitcherState.loading = false;
    forcePlaybackControlsInteractive();
  }
}

function songRequiresVip(song) {
  song = song || {};
  if (song.fee === 1 || song.vip === true || song.isVip === true || song.isVIP === true) return true;
  if (song.vipRequired === true || song.needVip === true || song.need_vip === true || song.onlyVipPlayable === true || song.only_vip_playable === true) return true;
  if (song.trial === true || song.preview === true) return true;
  var labelInfo = song.label_info || song.labelInfo || {};
  if (labelInfo.only_vip_playable === true || labelInfo.onlyVipPlayable === true || labelInfo.vip === true) return true;
  var restriction = song.restriction || {};
  var text = [
    song.category,
    song.reason,
    song.error,
    song.message,
    restriction.category,
    restriction.reason,
    restriction.error,
    restriction.message,
  ].join(' ');
  return /vip_required|paid_required|trial_only|need_vip|only_vip|vip/i.test(text);
}

function songVipTagHtml(song) {
  return songRequiresVip(song) ? '<span class="tag-vip">VIP</span>' : '';
}

function searchResultMetaText(song) {
  var bits = [];
  if (song.artist) bits.push(song.artist);
  if (song.album) bits.push(song.album);
  if (!window.MINERADIO_LOCAL_WEB && songProviderKey(song) === 'qq' && !song.playable) bits.push('QQ 播放需会话/授权');
  if (!window.MINERADIO_LOCAL_WEB && songProviderKey(song) === 'kugou' && !song.playable) bits.push('酷狗播放需会话/授权');
  if (songProviderKey(song) === 'spotify' && !song.playable) bits.push('Spotify 匹配源，播放会自动换源');
  return bits.join('  ·  ') || songSourceLabel(song);
}

function searchResultMetaHtml(song, index) {
  song = song || {};
  var artist = String(song.artist || '').trim();
  var bits = [];
  if (song.album) bits.push(song.album);
  if (!window.MINERADIO_LOCAL_WEB && songProviderKey(song) === 'qq' && !song.playable) bits.push('QQ 播放需会话/授权');
  if (!window.MINERADIO_LOCAL_WEB && songProviderKey(song) === 'kugou' && !song.playable) bits.push('酷狗播放需会话/授权');
  if (songProviderKey(song) === 'spotify' && !song.playable) bits.push('Spotify 匹配源，播放会自动换源');
  var tail = bits.length ? (' · ' + escHtml(bits.join('  ·  '))) : '';
  if (!artist) return escHtml(searchResultMetaText(song));
  return '<button class="search-artist-link" type="button" onclick="event.stopPropagation();openSearchResultArtist(' + index + ')">' + escHtml(artist) + '</button>' + tail;
}

function openSearchResultArtist(index) {
  var song = playlist && playlist[index];
  if (!song) return;
  openArtistDetailForSong(song);
}

function searchIntentPrefersQQ(q) {
  q = String(q || '').toLowerCase();
  return /(^|\s)qq($|\s)|qq音乐|qq音樂/.test(q);
}

function searchProviderStatus(provider) {
  if (typeof platformStatus === 'function') return platformStatus(provider);
  if (provider === 'spotify') return spotifyLoginStatus;
  if (provider === 'qishui') return qishuiLoginStatus;
  if (provider === 'kugou') return kugouLoginStatus;
  if (provider === 'qq') return qqLoginStatus;
  return loginStatus;
}

function searchProviderIsLoggedIn(provider) {
  var st = searchProviderStatus(provider);
  return !!(st && st.loggedIn);
}
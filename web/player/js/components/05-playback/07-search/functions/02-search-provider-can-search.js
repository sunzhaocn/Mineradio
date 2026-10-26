'use strict';


function searchProviderCanSearch(provider) {
  var st = searchProviderStatus(provider) || {};
  var capabilities = st.capabilities || {};
  if (st.searchReady === true || st.publicCatalog === true || capabilities.search === true) return true;
  if (provider === 'spotify') return !!(st.loggedIn && !st.reauthRequired);
  // These providers expose public catalogue metadata search. Login still controls
  // private recommendations, collections and playback rights, not discovery.
  return provider === 'netease' || provider === 'qq' || provider === 'kugou' || provider === 'qishui';
}

function searchModeProvider(mode) {
  return mode === 'netease' || mode === 'qq' || mode === 'kugou' || mode === 'qishui' ? mode : '';
}

function activeSearchProvidersForMode(mode) {
  var specific = searchModeProvider(mode);
  if (specific) return searchProviderCanSearch(specific) ? [specific] : [];
  return MUSIC_SEARCH_PROVIDER_ORDER.filter(searchProviderCanSearch);
}

function searchProviderLoginNotice(mode) {
  var specific = searchModeProvider(mode);
  if (specific) {
    var meta = typeof platformMeta === 'function' ? platformMeta(specific) : { label: specific };
    return (meta.label || specific) + ' 搜索能力暂未就绪，请先完成该平台连接';
  }
  return '当前没有可用的音乐目录搜索源';
}

function searchProviderUrl(provider, q, limit, offset) {
  var suffix = '&limit=' + limit + '&offset=' + Math.max(0, Number(offset) || 0);
  if (provider === 'qq') return '/api/qq/search?keywords=' + encodeURIComponent(q) + suffix;
  if (provider === 'kugou') return '/api/kugou/search?keywords=' + encodeURIComponent(q) + suffix;
  if (provider === 'qishui') return '/api/qishui/search?keywords=' + encodeURIComponent(q) + suffix;
  if (provider === 'spotify') return '/api/spotify/search?keywords=' + encodeURIComponent(q) + suffix;
  return '/api/search?keywords=' + encodeURIComponent(q) + suffix;
}

function simpleSearchNorm(text) {
  return String(text || '').toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s·・,，。.!！?？'"“”‘’|\-_/]+/g, '');
}

function searchQueryTokens(text) {
  var source = String(text || '');
  var raw = source.normalize ? source.normalize('NFKC').toLowerCase() : source.toLowerCase();
  return raw.split(/[\s·・，。,.!?！？"“”‘’()（）【】\[\]\-_/]+/).map(function (token) {
    return simpleSearchNorm(token);
  }).filter(function (token, index, all) {
    if (!token || /^(qq|网易云|网易云音乐|酷狗|酷狗音乐|汽水|汽水音乐|spotify)$/.test(token)) return false;
    return all.indexOf(token) === index;
  });
}

function searchVersionSignature(text) {
  var source = String(text || '');
  var raw = source.normalize ? source.normalize('NFKC').toLowerCase() : source.toLowerCase();
  var signatures = [];
  [
    ['live', /\blive\b|现场|演唱会/],
    ['remix', /\bremix\b|\bmix\b|混音|重混|dj版|dj\s+version/],
    ['acoustic', /\bacoustic\b|不插电|木吉他版/],
    ['instrumental', /\binstrumental\b|伴奏|纯音乐/],
    ['cover', /\bcover\b|翻唱|致敬版/],
    ['demo', /\bdemo\b|试听版/],
    ['sped', /sped\s*up|加速版|变速版/],
    ['slowed', /slowed|慢速版/]
  ].forEach(function (entry) {
    if (entry[1].test(raw)) signatures.push(entry[0]);
  });
  return signatures.sort().join('+');
}

function searchTokenCoverage(tokens, song) {
  var name = simpleSearchNorm(song && song.name);
  var artist = simpleSearchNorm(song && song.artist);
  var album = simpleSearchNorm(song && song.album);
  var matched = 0;
  var titleMatched = 0;
  var artistMatched = 0;
  (tokens || []).forEach(function (token) {
    var hitTitle = !!(token && name.indexOf(token) >= 0);
    var hitArtist = !!(token && artist.indexOf(token) >= 0);
    var hitAlbum = !!(token && album.indexOf(token) >= 0);
    if (hitTitle || hitArtist || hitAlbum) matched++;
    if (hitTitle) titleMatched++;
    if (hitArtist) artistMatched++;
  });
  return { total: (tokens || []).length, matched: matched, titleMatched: titleMatched, artistMatched: artistMatched };
}

function searchMentionsKnownArtist(q, artist) {
  var rawQ = String(q || '').toLowerCase();
  var rawArtist = String(artist || '').toLowerCase();
  if (!rawArtist) return false;
  if (/周杰伦|周杰倫|jay\s*chou/.test(rawQ) && /周杰伦|周杰倫|jay\s*chou/.test(rawArtist)) return true;
  var nq = simpleSearchNorm(q);
  var na = simpleSearchNorm(artist);
  return !!(na && na.length >= 2 && nq.indexOf(na) >= 0);
}

function searchLooksLikeDerivative(text) {
  return /(翻唱|cover|伴奏|instrumental|remix|片段|demo|女声|男声|karaoke|完整版\s*cover|抖音版|dj版|合唱版|改编版|赵露思版|超燃|硬曲|剪辑|二创|氛围|浴室|节奏版|进行曲|加速版|慢速版|变速|串烧|tribute|made\s*famous\s*by)/i.test(String(text || ''));
}

function searchIdentityText(value) {
  var raw = String(value == null ? '' : value);
  return (raw.normalize ? raw.normalize('NFKC') : raw).toLowerCase().trim();
}

function searchIdentityCompact(value) {
  return searchIdentityText(value).replace(/[\p{P}\p{Z}\s]+/gu, '');
}

function searchIdentityTitle(song) {
  // “无损/原唱”是平台说明；其它括号仍是歌曲身份的一部分，例如粤语、现场场次和伴奏。
  var title = searchIdentityText(song && (song.name || song.title));
  return searchIdentityCompact(title.replace(/[([]([^()[\]]*)[)\]]/g, function (all, part) {
    return /^(?:原唱|原唱版|原版|original|无损|flac|hi[ -]?res|\d+\s*k(?:bps)?)$/i.test(part.trim()) ? '' : all;
  }));
}

function sourceSwitchArtistParts(song) {
  var parts = [];
  function add(value) {
    if (value && typeof value === 'object') value = value.name;
    if (!value) return;
    searchIdentityText(value).split(/\s*(?:\/|,|，|、|&|;|；|\bfeat\.?\s+|\bft\.?\s+)\s*/i).forEach(function (name) {
      var normalized = searchIdentityCompact(name);
      if (normalized && !/^(?:未知|未知歌手|佚名|群星|unknown|unknownartist|variousartists)$/.test(normalized) && parts.indexOf(normalized) < 0) parts.push(normalized);
    });
  }
  (song && Array.isArray(song.artists) ? song.artists : []).forEach(add);
  (song && Array.isArray(song.singers) ? song.singers : []).forEach(add);
  add(song && (song.artist || song.author || song.singer));
  return parts.sort();
}

function sourceCandidateRejectReason(source, candidate, provider) {
  if (!source || !candidate) return 'no_source';
  var sourceTitle = searchIdentityTitle(source);
  var candidateTitle = searchIdentityTitle(candidate);
  if (!sourceTitle || !candidateTitle || sourceTitle !== candidateTitle) return 'title_mismatch';
  var sourceParts = sourceSwitchArtistParts(source);
  var candidateParts = sourceSwitchArtistParts(candidate);
  if (!sourceParts.length || !candidateParts.length || sourceParts.join('|') !== candidateParts.join('|')) return 'artist_mismatch';
  if (searchIdentityCompact(source.version || source.versionName || source.version_name) !== searchIdentityCompact(candidate.version || candidate.versionName || candidate.version_name)) return 'version_mismatch';
  return '';
}

function controlSourceIssueLabel(issue) {
  if (issue === 'blocked_artist' || issue === 'derivative') return '翻唱禁用';
  if (issue === 'artist_mismatch' || issue === 'artist_extra') return '非原唱版本';
  return '无正版音源';
}

function canonicalOriginalArtistsForSearch(q, song) {
  var qNorm = simpleSearchNorm(q);
  var titleNorm = simpleSearchNorm(song && song.name);
  var joined = qNorm + ' ' + titleNorm;
  var artists = [];
  SEARCH_ORIGINAL_ARTIST_HINTS.forEach(function (rule) {
    var matched = (rule.titles || []).some(function (title) {
      var nt = simpleSearchNorm(title);
      var titleMatches = !!(titleNorm && (titleNorm === nt || titleNorm.indexOf(nt) >= 0));
      return !!(nt && (qNorm.indexOf(nt) >= 0 || titleMatches));
    });
    if (matched) {
      (rule.artists || []).forEach(function (artist) {
        if (artists.indexOf(artist) < 0) artists.push(artist);
      });
    }
  });
  return artists;
}

function songArtistMatchesAny(song, artists) {
  var songArtist = simpleSearchNorm(song && song.artist);
  if (!songArtist || !artists || !artists.length) return false;
  return artists.some(function (artist) {
    var na = simpleSearchNorm(artist);
    return !!(na && (songArtist.indexOf(na) >= 0 || na.indexOf(songArtist) >= 0));
  });
}

function searchLooksLikeSameTitleCover(song, nq, name, album, raw, originalArtistMatch, sourceIndex) {
  if (!song || !nq || !name || originalArtistMatch) return false;
  var sameTitle = name === nq || nq.indexOf(name) >= 0 || name.indexOf(nq) === 0;
  if (!sameTitle) return false;
  var selfTitledSingle = !!(album && (album === name || album === nq || album.indexOf(name) >= 0 || name.indexOf(album) >= 0));
  return selfTitledSingle || searchLooksLikeDerivative(raw) || (sourceIndex || 0) > 0;
}

function searchPopularityScore(song, sourceIndex) {
  var hot = Number(song && (song.popularity || song.hot || song.heat || song.hotScore || song.score || song.playCount || song.playcount || song.listenCount || song.rankScore || 0));
  var score = 0;
  if (isFinite(hot) && hot > 0) {
    score += hot <= 100 ? Math.min(12, hot / 8) : Math.min(14, Math.log(hot + 1) * 1.2);
  }
  // Every provider maps a missing rank differently (often to zero), so the
  // actual response position is the only comparable, stable tie-breaker.
  score += Math.max(0, 12 - Math.max(0, Number(sourceIndex) || 0) * 0.55);
  return score;
}

function searchCanonicalSongKey(song) {
  var title = searchIdentityTitle(song);
  var artists = sourceSwitchArtistParts(song);
  if (!title || !artists.length) return '';
  // 专辑名称可能含 Live，但其中仍有录音室歌曲；只使用曲目本身的明确版本。
  var version = searchIdentityCompact(song && (song.version || song.versionName || song.version_name));
  return title + '|' + artists.join('/') + '|' + version;
}

function searchSongSourceKey(song) {
  var provider = songProviderKey(song);
  var id = song && (song.mid || song.songmid || song.hash || song.providerSongId || song.id);
  return provider + ':' + (id ? String(id) : (searchCanonicalSongKey(song) || searchIdentityText(song && (song.name || song.title)) + '|' + searchIdentityText(song && (song.artist || song.author))));
}

function searchSongSources(song) {
  var seen = {};
  return [song].concat(song && Array.isArray(song._webSearchSources) ? song._webSearchSources : []).filter(function (source) {
    if (!source || typeof source !== 'object') return false;
    var key = searchSongSourceKey(source);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).map(function (source) {
    var clean = Object.assign({}, source);
    delete clean._webSearchSources;
    return clean;
  });
}

function mergeSearchSongSources(preferred, other) {
  var merged = Object.assign({}, preferred);
  var key = searchCanonicalSongKey(preferred);
  var seen = {};
  merged._webSearchSources = searchSongSources(preferred).concat(searchSongSources(other)).filter(function (source) {
    if (searchCanonicalSongKey(source) !== key) return false;
    var sourceKey = searchSongSourceKey(source);
    if (seen[sourceKey]) return false;
    seen[sourceKey] = true;
    return true;
  });
  return merged;
}

function scoreSongSearchResult(song, q, sourceIndex) {
  var nq = simpleSearchNorm(q);
  var name = simpleSearchNorm(song && song.name);
  var artist = simpleSearchNorm(song && song.artist);
  var album = simpleSearchNorm(song && song.album);
  var raw = String(((song && song.name) || '') + ' ' + ((song && song.artist) || '') + ' ' + ((song && song.album) || '')).toLowerCase();
  var tokens = searchQueryTokens(q);
  var coverage = searchTokenCoverage(tokens, song);
  var queryVersion = searchVersionSignature(q);
  var songVersion = searchVersionSignature(raw);
  var artistMentioned = searchMentionsKnownArtist(q, song && song.artist);
  var score = 0;
  if (name === nq) score += 170;
  else if (name && nq && nq.indexOf(name) >= 0) score += 112;
  else if (name && nq && name.indexOf(nq) === 0) score += 82;
  else if (name && nq && name.indexOf(nq) >= 0) score += 58;
  if (artistMentioned || (artist && nq && nq.indexOf(artist) >= 0)) score += 88;
  else if (artist && nq && artist.indexOf(nq) >= 0) score += 32;
  if (album && nq && (album === nq || nq.indexOf(album) >= 0)) score += 12;
  if (coverage.total) {
    score += coverage.titleMatched * 34 + coverage.artistMatched * 26;
    if (coverage.matched === coverage.total) score += 54;
    else score -= (coverage.total - coverage.matched) * 46;
  }
  if (queryVersion) {
    score += songVersion === queryVersion ? 64 : -72;
  } else if (songVersion) {
    score -= 46;
  } else if (searchLooksLikeDerivative(raw)) {
    score -= 34;
  }
  score += searchPopularityScore(song, sourceIndex);
  if (song && song.playable === false) score -= 6;
  return score;
}

function mergeSongSearchResults(neteaseSongs, qqSongs, kugouSongs, qishuiSongs, spotifySongs, limit, q) {
  var out = [];
  var providerSeen = {};
  var canonicalSeen = {};
  function push(song, sourceIndex) {
    if (!song || !song.name) return;
    var key = searchSongSourceKey(song);
    if (providerSeen[key] != null) {
      var providerIndex = providerSeen[key];
      out[providerIndex] = mergeSearchSongSources(out[providerIndex], song);
      return;
    }
    song._searchScore = scoreSongSearchResult(song, q, sourceIndex);
    var canonicalKey = searchCanonicalSongKey(song);
    if (canonicalKey && canonicalSeen[canonicalKey] != null) {
      var existingIndex = canonicalSeen[canonicalKey];
      providerSeen[key] = existingIndex;
      var previous = out[existingIndex];
      out[existingIndex] = (song._searchScore || 0) > (previous._searchScore || 0)
        ? mergeSearchSongSources(song, previous) : mergeSearchSongSources(previous, song);
      return;
    }
    providerSeen[key] = out.length;
    if (canonicalKey) canonicalSeen[canonicalKey] = out.length;
    out.push(song);
  }
  (neteaseSongs || []).forEach(function (song, i) { push(song, i); });
  (qqSongs || []).forEach(function (song, i) { push(song, i); });
  (kugouSongs || []).forEach(function (song, i) { push(song, i); });
  (qishuiSongs || []).forEach(function (song, i) { push(song, i); });
  (spotifySongs || []).forEach(function (song, i) { push(song, i); });
  out.sort(function (a, b) { return (b._searchScore || 0) - (a._searchScore || 0); });
  return out.slice(0, limit);
}

function searchProviderPagesHaveMore(providerPages) {
  return Object.keys(providerPages || {}).some(function (provider) {
    return !!(providerPages[provider] && providerPages[provider].hasMore);
  });
}

function mergeUniqueSearchSongPools(existing, incoming) {
  var out = [];
  var providerSeen = {};
  var canonicalSeen = {};
  function push(song) {
    if (!song || !song.name) return;
    var providerKey = searchSongSourceKey(song);
    var canonicalKey = searchCanonicalSongKey(song);
    if (providerSeen[providerKey] != null) {
      var providerIndex = providerSeen[providerKey];
      out[providerIndex] = mergeSearchSongSources(out[providerIndex], song);
      return;
    }
    if (canonicalKey && canonicalSeen[canonicalKey] != null) {
      var existingIndex = canonicalSeen[canonicalKey];
      providerSeen[providerKey] = existingIndex;
      out[existingIndex] = mergeSearchSongSources(out[existingIndex], song);
      return;
    }
    if (out.length >= MUSIC_SEARCH_MAX_RESULTS) return;
    providerSeen[providerKey] = out.length;
    if (canonicalKey) canonicalSeen[canonicalKey] = out.length;
    out.push(song);
  }
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return out;
}
'use strict';

// Pure ranking helpers: no storage, network requests or playback side effects.
(function (host) {
  var DAY = 86400000;
  function text(value) {
    if (value && typeof value === 'object') value = value.name || value.title || '';
    var result = String(value == null ? '' : value);
    return (result.normalize ? result.normalize('NFKC') : result).trim().toLowerCase();
  }
  function compact(value) { return text(value).replace(/[\s\p{P}\p{S}]/gu, ''); }
  function validName(value) { return value && !/^(?:未知|未知歌手|未知歌曲|佚名|群星|unknown|unknownartist|variousartists|undefined|null)$/.test(compact(value)); }
  function provider(song) {
    var aliases = { song: 'netease', music: 'netease', netease: 'netease', wy: 'netease', '网易云': 'netease', '网易云音乐': 'netease', qq: 'qq', qqmusic: 'qq', 'qq音乐': 'qq', kugou: 'kugou', kg: 'kugou', '酷狗': 'kugou', '酷狗音乐': 'kugou', qishui: 'qishui', qs: 'qishui', '汽水': 'qishui', '汽水音乐': 'qishui', local: 'local', file: 'local', spotify: 'spotify' };
    if (song && (song.localKey || song.localPath || song.localFileId || song.type === 'local')) return 'local';
    var values = [song && song.sourceKey, song && song.provider, song && song.source, song && song.resolvedPlaybackProvider, song && song.type];
    for (var i = 0; i < values.length; i++) if (aliases[text(values[i])]) return aliases[text(values[i])];
    var match = text(song && song.key).match(/^(netease|qqmusic|qq|kugou|qishui|local|spotify):/);
    return match ? aliases[match[1]] : song && (song.mid || song.songmid) ? 'qq' : 'netease';
  }
  function key(song) {
    if (!song || typeof song !== 'object') return '';
    var p = provider(song), id;
    if (p === 'qq') id = song.mid || song.songmid || song.id || song.providerSongId;
    else if (p === 'kugou') id = song.hash || song.fileHash || song.audioHash || song.id || song.mixSongId;
    else if (p === 'local') id = song.localKey || song.localFileId || song.localPath || song.id;
    else id = song.id || song.providerSongId || song.mixSongId || song.spotifyId;
    if (id == null || id === '') {
      var stored = String(song.key || '');
      if (/^(?:netease|qqmusic|qq|kugou|qishui|local|spotify):/.test(stored)) id = stored.slice(stored.indexOf(':') + 1);
    }
    if (id == null || id === '') return '';
    return p + ':' + (p === 'kugou' ? text(id) : String(id).trim());
  }
  function artistNames(song) {
    var names = [];
    function add(value) {
      if (value && typeof value === 'object') value = value.name || value.artistName;
      if (!value) return;
      String(value).split(/\s*(?:\/|,|，|、|&|;|；|\bfeat\.?\s+|\bft\.?\s+)\s*/i).forEach(function (name) {
        name = String(name).trim();
        if (validName(name) && !names.some(function (existing) { return compact(existing) === compact(name); })) names.push(name);
      });
    }
    (Array.isArray(song && song.artists) ? song.artists : []).forEach(add);
    (Array.isArray(song && song.singers) ? song.singers : []).forEach(add);
    add(song && (song.artist || song.author || song.singer));
    return names;
  }
  function canonical(song) {
    var title = compact(song && (song.name || song.title));
    var names = artistNames(song).map(compact).sort();
    return validName(title) && names.length ? 'track:' + title + '|' + names.join('&') : '';
  }
  function list(value) { return Array.isArray(value) ? value : []; }
  function chartTags(song, metadata) {
    var tags = [];
    function add(value) {
      var label = typeof value === 'object' && value ? value.name || value.label : value;
      var normalized = compact(label);
      if (validName(normalized) && tags.indexOf(normalized) < 0) tags.push(normalized);
    }
    list(song && song.tags).forEach(add); list(song && song.genres).forEach(add);
    var sourceKey = key(song), charts = metadata && metadata.song_charts || {};
    list(charts[sourceKey]).forEach(add);
    if (sourceKey.indexOf('qq:') === 0) list(charts[sourceKey.replace(/^qq:/, 'qqmusic:')]).forEach(add);
    if (sourceKey.indexOf('kugou:') === 0) list(charts['kugou:' + sourceKey.slice(6).toUpperCase()]).forEach(add);
    var artistCharts = metadata && metadata.artist_charts || {};
    artistNames(song).forEach(function (name) {
      list(artistCharts[name] || artistCharts[text(name)] || artistCharts[compact(name)]).forEach(add);
    });
    return tags;
  }
  function time(value) { var n = Number(value); if (!Number.isFinite(n)) n = Date.parse(value); return Number.isFinite(n) && n > 0 ? (n < 100000000000 ? n * 1000 : n) : 0; }
  function decay(value, now) { var stamp = time(value); return stamp ? Math.pow(0.5, Math.max(0, now - stamp) / (45 * DAY)) : 0.65; }
  function number(value) { return Math.max(0, Number(value) || 0); }
  function profile(input) {
    input = input || {};
    var now = time(input.now) || Date.now(), metadata = input.metadata || {};
    var taste = { artistWeights: Object.create(null), artistLabels: Object.create(null), tagWeights: Object.create(null), songWeights: Object.create(null), blockedKeys: [], favoriteKeys: [], favoriteTracks: [], seeds: [], metadata: metadata, summary: '探索新音乐', hasPreferences: false };
    var seedWeights = Object.create(null), favoriteSeen = new Set();
    function learn(song, weight, seedWeight) {
      if (!song || weight === 0) return;
      var names = artistNames(song), k = key(song), c = canonical(song);
      names.forEach(function (name) {
        var normalized = compact(name);
        taste.artistLabels[normalized] = name;
        taste.artistWeights[normalized] = (taste.artistWeights[normalized] || 0) + weight / Math.sqrt(names.length);
        if (weight > 0) seedWeights[name] = (seedWeights[name] || 0) + (seedWeight || weight);
      });
      chartTags(song, metadata).filter(distinctiveTag).forEach(function (tag) { taste.tagWeights[tag] = (taste.tagWeights[tag] || 0) + weight; });
      if (k) taste.songWeights[k] = (taste.songWeights[k] || 0) + weight;
      if (c) taste.songWeights[c] = (taste.songWeights[c] || 0) + weight;
    }
    list(input.favorites).forEach(function (song) {
      if (!song || typeof song !== 'object') return;
      var identity = canonical(song) || key(song);
      if (!identity || favoriteSeen.has(identity)) return;
      favoriteSeen.add(identity);
      var k = key(song), c = canonical(song);
      if (k) taste.favoriteKeys.push(k); if (c) taste.favoriteTracks.push(c);
      learn(song, 5, 6);
      if (!artistNames(song).length && validName(song.name || song.title)) seedWeights[String(song.name || song.title)] = 2;
    });
    list(input.history).forEach(function (record) {
      if (!record || typeof record !== 'object') return;
      var song = record.song || record.listenSnapshot || record;
      var listened = number(record.listenMs || record.listenedMs || song.listenMs);
      if (!listened) listened = number(record.listenSeconds || record.listenedSeconds) * 1000;
      var duration = number(record.durationMs || song.durationMs);
      if (!duration) { duration = number(song.duration); if (duration <= 10000) duration *= 1000; }
      var completed = record.completed === true || number(record.completed) > 0;
      var ratio = duration ? Math.min(1, listened / duration) : Math.min(1, listened / 180000);
      var quality = completed ? 3.5 : listened >= 45000 || ratio >= 0.5 ? 0.7 + ratio * 2 : listened > 0 && listened < 15000 ? -0.6 : 0;
      learn(song, quality * decay(record.playedAt || record.lastPlayedAt || record.updatedAt, now));
    });
    var artists = input.artists || {};
    (Array.isArray(artists) ? artists : Object.keys(artists).map(function (name) { return Object.assign({ name: name }, artists[name]); })).forEach(function (record) {
      if (!record || !validName(record.name)) return;
      var listened = number(record.listenMs), plays = number(record.plays);
      var value = Math.min(8, Math.log1p(listened / 180000) * 1.8 + Math.log1p(plays) * 0.25) * decay(record.lastPlayedAt || record.updatedAt, now);
      if (value > 0) learn({ artist: record.name }, value);
    });
    var feedback = input.feedback || {};
    Object.keys(feedback).forEach(function (storedKey) {
      var record = feedback[storedKey];
      if (!record || typeof record !== 'object') return;
      var song = record.song || record, k = key(song), c = canonical(song);
      var negative = number(record.skips || record.skipCount) * 2 + (record.disliked || record.blocked || record.type === 'dislike' ? 8 : 0);
      if (negative) {
        var penalty = negative * decay(record.updatedAt || record.playedAt, now);
        learn(song, -penalty);
        var alias = String(storedKey).replace(/^qqmusic:/, 'qq:');
        taste.songWeights[alias] = (taste.songWeights[alias] || 0) - penalty * 2;
        if (negative >= 4) [alias, k, c].filter(Boolean).forEach(function (id) { taste.blockedKeys.push(id); });
      }
    });
    var preferred = Object.keys(taste.artistWeights).filter(function (name) { return taste.artistWeights[name] > 0.3; }).sort(function (a, b) { return taste.artistWeights[b] - taste.artistWeights[a]; });
    taste.hasPreferences = preferred.length > 0 || Object.keys(taste.tagWeights).some(function (tag) { return taste.tagWeights[tag] > 0.3; });
    taste.seeds = Object.keys(seedWeights).filter(function (name) { return !taste.artistWeights[compact(name)] || taste.artistWeights[compact(name)] > 0; }).sort(function (a, b) { return seedWeights[b] - seedWeights[a]; }).slice(0, 6);
    if (preferred.length) taste.summary = '偏爱 ' + preferred.slice(0, 3).map(function (name) { return taste.artistLabels[name]; }).join('、');
    return taste;
  }
  function distinctiveTag(value) {
    var tag = compact(value);
    if (!validName(tag)) return false;
    // A popularity label alone says nothing about taste. A qualified chart such
    // as DJ热歌榜 still carries an explicit style/region signal worth retaining.
    var popularity = /(?:热歌|飙升|新歌|人气|热度|热门|畅销|销量|流行指数|trending|viral|popular|newreleases|top\d+|hot(?:songs|tracks|100))/.test(tag);
    return !popularity || /(?:dj|acg|rnb|hiphop|kpop|jpop|ost|电音|电子|舞曲|摇滚|民谣|爵士|古典|说唱|嘻哈|蓝调|乡村|国风|古风|二次元|动漫|纯音乐|轻音乐|器乐|钢琴|影视|韩语|日语|欧美|华语|粤语|英语|闽南语|拉丁|法语)/.test(tag);
  }
  function seeds(taste) {
    var original = list(taste && taste.seeds).slice(0, 6);
    if (!taste || !taste.hasPreferences) return original;
    var metadata = taste.metadata && taste.metadata.artist_charts || {};
    var artists = Object.create(null), prevalence = Object.create(null), known = Object.create(null);
    original.forEach(function (name) { known[compact(name)] = true; });
    Object.keys(taste.artistWeights || {}).forEach(function (name) { known[compact(name)] = true; });
    Object.keys(metadata).forEach(function (name) {
      if (!validName(name)) return;
      var normalized = compact(name), row = artists[normalized];
      if (!row) row = artists[normalized] = { name: String(name).trim(), tags: [] };
      list(metadata[name]).forEach(function (label) {
        if (!distinctiveTag(label)) return;
        var tag = compact(label);
        if (row.tags.indexOf(tag) < 0) row.tags.push(tag);
      });
    });
    var rows = Object.keys(artists).map(function (name) { return artists[name]; });
    rows.forEach(function (row) { row.tags.forEach(function (tag) { prevalence[tag] = (prevalence[tag] || 0) + 1; }); });
    var related = rows.filter(function (row) { return !known[compact(row.name)]; }).map(function (row) {
      var score = row.tags.reduce(function (sum, tag) {
        var affinity = Math.max(0, Number((taste.tagWeights || {})[tag]) || 0);
        // Discount widely shared labels so a narrow style can beat a broad region.
        return sum + Math.log1p(affinity) * Math.log1p(rows.length / prevalence[tag]);
      }, 0) / Math.sqrt(Math.max(1, row.tags.length));
      return { name: row.name, score: score };
    }).filter(function (row) { return row.score > 0; }).sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); }).slice(0, 3);
    if (!related.length) return original;
    var result = [], index = 0;
    while (result.length < 6 && (index < original.length || index < related.length)) {
      if (index < original.length) result.push(original[index]);
      if (result.length < 6 && index < related.length) result.push(related[index].name);
      index++;
    }
    return result;
  }
  function asSet(value) { return new Set(value && typeof value.forEach === 'function' ? Array.from(value).map(function (item) { return String(item).replace(/^qqmusic:/, 'qq:'); }) : []); }
  function noise(value, seed) {
    var h = 2166136261, str = String(seed == null ? 0 : seed) + '|' + value;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }
  function rank(candidates, taste, options) {
    taste = taste || profile({}); options = options || {};
    var excluded = asSet(options.excludeKeys), recent = asSet(options.recentKeys), blocked = asSet(taste.blockedKeys);
    var favorites = asSet(taste.favoriteKeys), favoriteTracks = asSet(taste.favoriteTracks);
    var unique = new Set(), rows = [], limit = Math.max(0, Math.min(100, options.limit == null ? 12 : number(options.limit)));
    list(candidates).forEach(function (song) {
      if (!song || typeof song !== 'object' || provider(song) === 'local') return;
      var k = key(song), c = canonical(song), names = artistNames(song), title = song.name || song.title;
      if (!k || !validName(title) || unique.has(k) || c && unique.has(c)) return;
      if ([k, c].filter(Boolean).some(function (id) { return excluded.has(id) || recent.has(id) || blocked.has(id) || favorites.has(id) || favoriteTracks.has(id); })) return;
      unique.add(k); if (c) unique.add(c);
      var bestArtist = '', artistWeight = 0;
      names.forEach(function (name) { var weight = (taste.artistWeights || {})[compact(name)] || 0; if (weight > artistWeight) { artistWeight = weight; bestArtist = name; } });
      var tags = chartTags(song, taste.metadata).filter(distinctiveTag), tagWeight = tags.reduce(function (sum, tag) { return sum + ((taste.tagWeights || {})[tag] || 0); }, 0);
      var negativeArtists = names.reduce(function (sum, name) { return sum + Math.min(0, (taste.artistWeights || {})[compact(name)] || 0); }, 0);
      var personal = Math.min(7, Math.log1p(artistWeight) * 2.3) + Math.min(5, Math.max(0, Math.log1p(Math.max(0, tagWeight)) * 1.7));
      var repeat = ((taste.songWeights || {})[k] || (taste.songWeights || {})[c] || 0);
      var score = 1 + personal + negativeArtists * 0.6 + Math.min(0, repeat) * 2 + noise(k, options.seed) * 1.6;
      // A shared chart/tag is the useful signal for unfamiliar artists, rather than
      // pretending every discovery result is already a match for this listener.
      var reason = artistWeight > 0.3 ? '因为你喜欢 ' + bestArtist : tagWeight > 0.3 ? '与你常听的音乐风格相近' : '探索新音乐';
      rows.push({ song: song, key: k, artists: names.map(compact), score: score, reason: reason });
    });
    var result = [], counts = Object.create(null), lastArtists = [];
    while (rows.length && result.length < limit) {
      var best = 0, bestScore = -Infinity;
      rows.forEach(function (row, index) {
        var repetition = row.artists.reduce(function (max, name) { return Math.max(max, counts[name] || 0); }, 0);
        var adjacent = row.artists.some(function (name) { return lastArtists.indexOf(name) >= 0; });
        var adjusted = row.score - repetition * 3.5 - (adjacent ? 3 : 0);
        if (adjusted > bestScore) { bestScore = adjusted; best = index; }
      });
      var row = rows.splice(best, 1)[0];
      result.push(Object.assign({}, row.song, { personalRadioReason: row.reason }));
      row.artists.forEach(function (name) { counts[name] = (counts[name] || 0) + 1; });
      lastArtists = row.artists;
    }
    return result;
  }
  host.webPersonalRadioEngine = { key: key, profile: profile, rank: rank, seeds: seeds, canonical: canonical };
})(typeof window !== 'undefined' ? window : globalThis);

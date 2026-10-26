'use strict';

/* 本地红心的同曲识别。平台 ID 只标识一个音源，歌名、完整歌手和版本才用于跨平台匹配。
 * 独立于搜索排序：不截取合作歌手，不从专辑名猜 Live，不把翻唱/语言/伴奏版本混在一起。
 * 旧收藏去重保留首条的播放资料，并把其它平台的原记录存进 _webFavoriteSources。
 */
(function () {
  'use strict';
  function text(value) {
    var result=String(value == null ? '' : value);
    return (result.normalize ? result.normalize('NFKC') : result).toLowerCase().trim();
  }
  function compact(value) { return text(value).replace(/[\p{P}\p{Z}\s]+/gu,''); }
  function title(song) {
    // 只去掉明确的音质/原唱说明；粤语、现场地点、年份等有意义的括号内容继续参与识别。
    return compact(text(song.name || song.title).replace(/[([]([^()[\]]*)[)\]]/g,function(all,part) {
      return /^(?:原唱|原唱版|原版|original|无损|flac|hi[ -]?res|\d+\s*k(?:bps)?)$/i.test(part.trim()) ? '' : all;
    }));
  }
  function artists(song) {
    var names=[];
    function add(value) {
      if (value && typeof value==='object') value=value.name;
      if (value) names.push.apply(names,text(value).split(/\s*(?:\/|,|，|、|&|;|；|\bfeat\.?\s+|\bft\.?\s+)\s*/i));
    }
    (Array.isArray(song.artists) ? song.artists : []).forEach(add);
    (Array.isArray(song.singers) ? song.singers : []).forEach(add);
    add(song.artist || song.author || song.singer);
    return Array.from(new Set(names.map(compact).filter(function(name) {
      return name && !/^(?:未知|未知歌手|佚名|群星|unknown|unknownartist|variousartists)$/.test(name);
    }))).sort();
  }
  function sourceKey(song) {
    var p=text(song.provider || song.source || 'netease');
    if (p==='qqmusic') p='qq';
    var id=song.mid || song.songmid || song.hash || song.providerSongId || song.id;
    return id ? p+':'+(p==='kugou' ? text(id) : String(id)) : '';
  }
  function singleMatch(a,b) {
    var aSource=sourceKey(a),bSource=sourceKey(b);
    if (aSource && aSource===bSource) return true;
    var aTitle=title(a),bTitle=title(b),aArtists=artists(a),bArtists=artists(b);
    if (!aTitle || aTitle!==bTitle || !aArtists.length || !bArtists.length || aArtists.join('|')!==bArtists.join('|')) return false;
    var aVersion=compact(a.version || a.versionName || a.version_name);
    var bVersion=compact(b.version || b.versionName || b.version_name);
    if (aVersion && bVersion && aVersion!==bVersion) return false;
    // 同一首歌在不同平台可能有不同剪辑时长；只有明确版本说明才区分，不靠时长猜版本。
    return true;
  }
  function clean(song) {
    var result=Object.assign({},song);delete result._webFavoriteSources;return result;
  }
  function sources(song) {
    if (!song || typeof song!=='object') return [];
    var seen=new Set();
    return [song].concat(Array.isArray(song._webFavoriteSources) ? song._webFavoriteSources : [])
      .filter(function(item) { return item && typeof item==='object'; }).map(clean).filter(function(item) {
        var key=sourceKey(item) || JSON.stringify(item);
        if (seen.has(key)) return false;seen.add(key);return true;
      });
  }
  function sameSong(a,b) {
    if (!a || !b) return false;
    return sources(a).some(function(left) { return sources(b).some(function(right) { return singleMatch(left,right); }); });
  }
  function deduplicate(rows) {
    var result=[];
    (rows || []).forEach(function(song) {
      if (!song || typeof song!=='object') return;
      var index=result.findIndex(function(item) { return sameSong(item,song); });
      if (index<0) { result.push(Object.assign({},clean(song),{_webFavoriteSources:sources(song)}));return; }
      var merged=sources(result[index]);
      sources(song).forEach(function(item) {
        var key=sourceKey(item);
        if (!merged.some(function(existing) { return key ? sourceKey(existing)===key : JSON.stringify(existing)===JSON.stringify(item); })) merged.push(item);
      });
      result[index]._webFavoriteSources=merged;
    });
    return result;
  }
  window.webFavoriteTools={sameSong:sameSong,deduplicate:deduplicate,sources:sources};
}());

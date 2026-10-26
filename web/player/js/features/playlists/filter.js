'use strict';
(function () {
  var state = { key: '', query: '', provider: '', tag: '' }, timer;
  function reset(detail) { if (detail.key !== state.key) state = { key: detail.key, query: '', provider: '', tag: '' }; }
  function labels(song) {
    var values = [];
    ['genre','genres','tags','language','lang'].forEach(function (field) {
      var list = Array.isArray(song[field]) ? song[field] : song[field] ? [song[field]] : [];
      list.forEach(function (item) { var value = typeof item === 'object' ? item.name || item.label : item; if (value) values.push(String(value)); });
    });
    return values;
  }
  function provider(song) { return song.type === 'local' || song.localFileId || song.localKey ? 'local' : typeof songProviderKey === 'function' ? songProviderKey(song) : song.provider || song.source || ''; }
  function rows(detail) {
    reset(detail);
    var query = state.query.toLocaleLowerCase();
    return (detail.tracks || []).map(function (song, index) { return { song: song, index: index }; }).filter(function (item) {
      return (!state.provider || provider(item.song) === state.provider)
        && (!state.tag || (state.tag === '__unknown' ? !labels(item.song).length : labels(item.song).indexOf(state.tag) >= 0))
        && (!query || [item.song.name, item.song.title, item.song.artist, item.song.album].concat(labels(item.song)).join(' ').toLocaleLowerCase().includes(query));
    });
  }
  function markup(detail) {
    reset(detail);
    var tags = new Set(), providers = new Set();
    (detail.tracks || []).forEach(function (song) { providers.add(provider(song)); labels(song).forEach(function (label) { tags.add(label); }); });
    var names = { netease: '网易云', qq: 'QQ 音乐', kugou: '酷狗', qishui: '汽水', local: '本地' };
    function options(values, selected, titles) { return Array.from(values).sort().map(function (value) { return '<option value="' + escHtml(value) + '"' + (value === selected ? ' selected' : '') + '>' + escHtml(titles && titles[value] || value) + '</option>'; }).join(''); }
    return '<div class="playlist-filter"><input data-playlist-filter="query" placeholder="筛选歌名、歌手或类型" aria-label="筛选歌单歌曲" value="' + escHtml(state.query) + '">' +
      '<select data-playlist-filter="provider" aria-label="筛选音源平台"><option value="">全部平台</option>' + options(providers, state.provider, names) + '</select>' +
      '<select data-playlist-filter="tag" aria-label="筛选歌曲类型"><option value="">全部类型</option><option value="__unknown"' + (state.tag === '__unknown' ? ' selected' : '') + '>未标注类型</option>' + options(tags, state.tag) + '</select>' +
      '<small>' + rows(detail).length + '/' + (detail.tracks || []).length + ' 首' + (detail.hasMore ? ' · 已载入范围，继续滚动加载' : '') + '</small></div>';
  }
  function changed(e) {
    var field = e.target.dataset && e.target.dataset.playlistFilter;
    if (!field || !window.playlistPanelDetailState) return;
    var detail = playlistPanelDetailState; reset(detail); state[field] = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(function () {
      var focused = document.activeElement === e.target, position = e.target.selectionStart;
      detail.scrollTop = 0; renderPlaylistPanelDetailRows();
      if (focused) {
        var next = document.querySelector('[data-playlist-filter="' + field + '"]');
        if (next) { next.focus({ preventScroll: true }); if (field === 'query') next.setSelectionRange(position, position); }
      }
    }, field === 'query' ? 160 : 0);
  }
  document.addEventListener('input', changed);
  document.addEventListener('change', changed);
  document.addEventListener('click', function (e) { if (e.target.closest('.playlist-filter')) e.stopPropagation(); });
  window.mineradioPlaylistFilter = { rows: rows, markup: markup, active: function (detail) { reset(detail); return !!(state.query || state.provider || state.tag); } };
})();

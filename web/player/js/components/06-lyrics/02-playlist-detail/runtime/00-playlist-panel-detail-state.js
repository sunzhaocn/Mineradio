'use strict';

var playlistPanelDetailState = { key: '', loading: false, loadingMore: false, playlist: null, tracks: [], token: 0, total: 0, nextOffset: 0, hasMore: false, scrollTop: 0, controller: null, warmTimer: 0, renderLimit: PLAYLIST_DETAIL_INITIAL_RENDER, error: '', message: '' };

var PLAYLIST_REORDER_STORE_KEY = 'mineradio-playlist-reorder-v1';

var playlistPanelVirtualCache = { revision: -1, detailKey: '', detailSig: '', entries: [], offsets: [0], totalHeight: 0, raf: 0 };

document.getElementById('pl-list').addEventListener('click', function (e) {
  var loadMore = e.target && e.target.closest ? e.target.closest('[data-pl-load-more]') : null;
  if (loadMore) {
    e.preventDefault();
    e.stopPropagation();
    growPlaylistPanelRenderLimit();
    return;
  }
  var detailLoadMore = e.target && e.target.closest ? e.target.closest('[data-pl-detail-load-more]') : null;
  if (detailLoadMore) {
    e.preventDefault();
    e.stopPropagation();
    growPlaylistPanelDetailRenderLimit();
    return;
  }
  var detailTop = e.target && e.target.closest ? e.target.closest('[data-pl-detail-top]') : null;
  if (detailTop) {
    e.preventDefault();
    e.stopPropagation();
    scrollPlaylistPanelToTop();
    return;
  }
  var playDetail = e.target && e.target.closest ? e.target.closest('[data-pl-detail-play]') : null;
  if (playDetail) {
    e.preventDefault();
    e.stopPropagation();
    playPlaylistPanelDetail();
    return;
  }
  var collection = e.target && e.target.closest ? e.target.closest('[data-pl-detail-collection]') : null;
  if (collection) {
    e.preventDefault();
    e.stopPropagation();
    togglePlaylistPanelCollection(collection.getAttribute('data-pl-detail-collection') === '1');
    return;
  }
  var rename = e.target && e.target.closest ? e.target.closest('[data-pl-detail-rename]') : null;
  if (rename) {
    e.preventDefault();
    e.stopPropagation();
    if (playlistPanelDetailState.playlist) renameBuiltInPlaylist(playlistPanelDetailState.playlist.id, playlistPanelDetailState.playlist.name);
    return;
  }
  var removePlaylist = e.target && e.target.closest ? e.target.closest('[data-pl-detail-delete]') : null;
  if (removePlaylist) {
    e.preventDefault();
    e.stopPropagation();
    if (playlistPanelDetailState.playlist) deleteBuiltInPlaylist(playlistPanelDetailState.playlist.id, playlistPanelDetailState.playlist.name);
    return;
  }
  var removeTrack = e.target && e.target.closest ? e.target.closest('[data-pl-detail-remove]') : null;
  if (removeTrack) {
    e.preventDefault();
    e.stopPropagation();
    var detailParts = String(playlistPanelDetailState.key || '').split(':');
    if (normalizePlaylistProvider(detailParts[0]) === 'mineradio') removeTrackFromBuiltInPlaylist(detailParts.slice(1).join(':'), Number(removeTrack.getAttribute('data-pl-detail-remove')));
    return;
  }
  var artist = e.target && e.target.closest ? e.target.closest('[data-pl-detail-artist]') : null;
  if (artist) {
    e.preventDefault();
    e.stopPropagation();
    openPlaylistPanelDetailArtist(Number(artist.getAttribute('data-pl-detail-artist')));
    return;
  }
  var row = e.target && e.target.closest ? e.target.closest('[data-pl-detail-row]') : null;
  if (row) {
    e.preventDefault();
    e.stopPropagation();
    playPlaylistPanelDetailTrack(Number(row.getAttribute('data-pl-detail-row')));
    return;
  }
  var card = e.target && e.target.closest ? e.target.closest('.pl-card') : null;
  if (!card) return;
  var provider = card.getAttribute('data-playlist-provider') || 'netease';
  var pid = card.getAttribute('data-playlist-id') || '';
  openPlaylistPanelDetail(provider, pid, card.getAttribute('data-playlist-title') || '');
});

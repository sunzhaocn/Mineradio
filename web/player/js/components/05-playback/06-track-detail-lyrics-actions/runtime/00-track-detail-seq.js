'use strict';


var trackDetailSeq = 0;

var detailArtistSongs = [];
var detailArtistContext = null;

var detailAlbumSongs = [];

var detailAlbumContext = null;

var detailAlbumGaplessEnabled = true;

var detailAlbumGaplessUserTouched = false;

var detailAlbumCollectionState = Object.create(null);

var detailCommentSong = null;

var detailCommentSubmitBusy = false;

var QISHUI_LIKE_ACCOUNT_ACTIONS_ENABLED = true;

var QISHUI_PLAYLIST_WRITE_ACTIONS_ENABLED = true;

var SONG_ACCOUNT_ACTION_ADAPTERS = {
  netease: {
    provider: 'netease',
    label: '网易云音乐',
    like: true,
    collect: true,
    createPlaylist: true,
    likeCheckUrl: '/api/song/like/check',
    likeCheckParam: 'ids',
    likeUrl: '/api/song/like',
    playlistAddUrl: '/api/playlist/add-song',
    playlistCreateUrl: '/api/playlist/create',
    playlistTracksUrl: '/api/playlist/tracks'
  },
  kugou: {
    provider: 'kugou',
    label: '酷狗音乐',
    like: true,
    collect: true,
    createPlaylist: false,
    likeCheckUrl: '/api/kugou/song/like/check',
    likeCheckParam: 'hashes',
    likeUrl: '/api/kugou/song/like',
    playlistAddUrl: '/api/kugou/playlist/add-song',
    playlistCreateUrl: '',
    playlistTracksUrl: '/api/kugou/playlist/tracks'
  },
  spotify: {
    provider: 'spotify',
    label: 'Spotify',
    like: true,
    collect: true,
    createPlaylist: true,
    likeCheckUrl: '/api/spotify/song/like/check',
    likeCheckParam: 'ids',
    likeUrl: '/api/spotify/song/like',
    playlistAddUrl: '/api/spotify/playlist/add-song',
    playlistCreateUrl: '/api/spotify/playlist/create',
    playlistTracksUrl: '/api/spotify/playlist/tracks'
  },
  qishui: {
    provider: 'qishui',
    label: '汽水音乐',
    like: QISHUI_LIKE_ACCOUNT_ACTIONS_ENABLED,
    collect: QISHUI_PLAYLIST_WRITE_ACTIONS_ENABLED,
    createPlaylist: false,
    likeCheckUrl: QISHUI_LIKE_ACCOUNT_ACTIONS_ENABLED ? '/api/qishui/song/like/check' : '',
    likeCheckParam: 'ids',
    likeUrl: QISHUI_LIKE_ACCOUNT_ACTIONS_ENABLED ? '/api/qishui/song/like' : '',
    playlistAddUrl: QISHUI_PLAYLIST_WRITE_ACTIONS_ENABLED ? '/api/qishui/playlist/add-song' : '',
    playlistCreateUrl: '',
    playlistTracksUrl: '/api/qishui/playlist/tracks'
  },
  qq: {
    provider: 'qq',
    label: 'QQ 音乐',
    like: false,
    collect: false,
    createPlaylist: false,
    readOnly: true
  }
};

// ============================================================
//  搜索

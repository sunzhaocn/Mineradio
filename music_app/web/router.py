"""网页 JSON 路由；分别调用歌曲、榜单、下载与登录服务。"""
from music_app.core import request_credentials
from . import authbridge as _web_authbridge
from . import albums as _web_albums
from . import artists as _web_artists
from . import auth_data as _web_auth_data
from . import charts as _web_charts
from . import comments as _web_comments
from . import client as _web_client
from . import constants as _web_constants
from . import downloads as _web_downloads
from . import library as _web_library
from . import qualities as _web_qualities
from . import songs as _web_songs
from . import state as _web_state
from . import client_assets as _web_client_assets


def dispatch(path, q):
    if path == '/api/mv':
        from .mv import resolve
        return resolve(q)
    if path in _web_comments.ROUTES:
        return _web_comments.read(_web_comments.ROUTES[path], q)
    if path in _web_artists.ROUTES:
        return _web_artists.detail(_web_artists.ROUTES[path], q)
    if path in _web_albums.ROUTES:
        return _web_albums.detail(_web_albums.ROUTES[path], q)
    if _web_library.is_private_route(path):
        return _web_library.dispatch(path, q)
    if path == '/api/download/qualities':
        return _web_downloads.download_qualities(q)
    provider = next((p for p in ('qq', 'kugou', 'qishui') if path.startswith('/api/' + p + '/')), 'netease')
    key = q.get('mid') or q.get('hash') or q.get('id', '')
    if path.endswith('/search'):
        limit = max(1, min(50, int(q.get('limit', 20))))
        offset = max(0, int(q.get('offset', 0)))
        data = _web_client.upstream('/search', platform=_web_constants.PROVIDERS[provider], keyword=q.get('keywords', ''),
                        size=limit, page=offset // limit + 1, simple=1)
        songs = [_web_songs.song_row(s, provider) for s in data.get('songs', [])]
        result = dict(songs=songs, provider=provider, limit=limit, offset=offset,
                    nextOffset=offset + len(songs), hasMore=data.get('has_more', len(songs) >= limit), total=data.get('total'))
        if provider == 'qishui':
            result.update({name: data[name] for name in (
                'scope', 'sourceScope', 'publicSearch', 'publicPlayback', 'message') if name in data})
        return result
    if path.endswith('/qualities') or path.endswith('/song/url') or path.endswith('/song/detail'):
        quality = q.get('quality') or q.get('level') or 'auto'
        allow_quality_fallback = path.endswith('/song/url') and str(q.get('allowQualityFallback', '')).lower() in ('1', 'true')
        if path.endswith('/song/url'):
            data = _web_songs.detail(provider, key, _web_qualities.normalize_quality(provider, quality),
                playback_only=True, allow_quality_fallback=allow_quality_fallback)
        else:
            data = _web_songs.detail(provider, key)
        options = _web_qualities.quality_rows(data, provider, key)
        requested_native = _web_qualities.normalize_quality(provider, quality)
        if path.endswith('/song/url') and requested_native not in ('auto', 'best', '') and not any(
                item['key'] == requested_native for item in options):
            options += _web_qualities.quality_rows({'qualities': [dict(key=requested_native,
                available=False, source_available=None)]}, provider, key)
        selected = _web_qualities.select_quality(provider, quality, options, allow_fallback=allow_quality_fallback)
        with _web_state.LOCK:
            scope = request_credentials.fingerprint(provider)
            label_key = (provider, key, scope) if scope else (provider, key)
            labels = dict(_web_state.SONG_LABELS.get(label_key, {}))
        labels.update({k: data[k] for k in ('vipRequired', 'paid', 'qualityVip', 'isOriginal', 'badges') if k in data})
        encrypted = bool(selected and selected['encrypted'])
        playable = bool(selected and selected['available'])
        message = ('汽水音源已加密，当前网页暂不能直接播放；可以查看歌词和音质信息' if encrypted and not playable else
                   '当前歌曲没有所选音质或该音质暂不可用' if not playable else '')
        source_fields = {}
        if provider == 'qishui':
            source_fields = _web_songs.qishui_playback_fields(data, selected)
            message = source_fields.pop('message', '') or message
        native = selected['key'] if selected else ''
        # level 供原作显示；nativeQuality 保留精确档位，手动切换按原生 key 发送。
        legacy = ({'flac': 'lossless', 'sq': 'lossless', '320': 'exhigh', '128': 'standard', 'aac': 'aac'}.get(native, native))
        result = dict(url=selected['url'] if playable else '', provider=provider, level=legacy,
                    nativeQuality=native, quality=native, requestedQuality=quality, qualities=options,
                    qualitiesComplete=not path.endswith('/song/url'),
                    br=(selected.get('bitrate') or 0) * 1000 if selected else None,
                    duration=data.get('duration_s', 0), title=data.get('title'), author=data.get('author'),
                    albumId=str(data.get('album_id') or ''), albumMid=str(data.get('album_mid') or ''),
                    album=data.get('album') or '', songId=str(data.get('song_id') or data.get('id') or key),
                    qqId=str(data.get('song_id') or '') if provider == 'qq' else '',
                    albumAudioId=str(data.get('album_audio_id') or data.get('mixsongid') or '') if provider == 'kugou' else '',
                    trial='试听' in (selected.get('kind', '') if selected else ''), cover=data.get('cover'),
                    encrypted=encrypted, decryption_supported=bool(selected and selected['decryption_supported']),
                    playable=playable, message=message,
                    reason='encrypted_media' if encrypted and not playable else 'quality_unavailable' if not playable else '',
                    qualityFallback=bool(playable and quality not in ('auto', 'best')
                                         and native != _web_qualities.normalize_quality(provider, quality)),
                    localExactQuality=quality not in ('auto', 'best') and not allow_quality_fallback, **labels)
        if provider == 'qishui':
            result.update(source_fields)
            result['trial'] = bool(source_fields.get('isPreview') or result['trial'])
        return result
    if path.endswith('/lyric'):
        if provider == 'kugou':
            from .lyrics import kugou_lyric
            return kugou_lyric(key, q.get('duration', 0))
        if provider == 'qishui':
            from .lyrics import qishui_lyric
            return qishui_lyric(key)
        if provider == 'qq':
            from .lyrics import qq_lyric
            return qq_lyric(key)
        if provider == 'netease':
            from music_app.providers.netease.lyrics import ne_get_lyric
            if not str(key).isdigit():
                return dict(ok=False, error='lyric_id_invalid', message='歌曲标识无效')
            data = ne_get_lyric(key, strict=True)
            return dict(ok=True, lyric=data.get('lrc') or '', tlyric=data.get('tlyric') or '',
                        romalrc=data.get('romalrc') or '', klyric=data.get('klyric') or '', provider='netease',
                        source='网易云音乐', nolyric=data.get('nolyric', False), uncollected=data.get('uncollected', False))
    if path == '/api/local/catalog':
        charts = _web_charts.charts()
        _web_client_assets.remember_charts(charts)
        return dict(ok=True, playlists=[_web_charts.chart_playlist(c) for c in charts])
    if path == '/api/local/tracks':
        songs = _web_charts.chart_tracks(q.get('id', ''))
        offset, limit = int(q.get('offset', 0)), int(q.get('limit', 100))
        return dict(ok=True, tracks=songs[offset:offset + limit], total=len(songs),
                    hasMore=offset + limit < len(songs), nextOffset=offset + min(limit, len(songs)))
    if path == '/api/discover/home':
        return _web_charts.recommendations()
    if path == '/api/radio/metadata':
        return _web_client.upstream('/radio/metadata')
    if path in _web_auth_data.STATUS_ROUTES:
        return _web_authbridge.AUTH.status(_web_auth_data.STATUS_ROUTES[path])
    if path == '/api/spotify/status':
        return dict(loggedIn=False, searchReady=provider in _web_constants.PROVIDERS, publicCatalog=True, configured=False)
    if path == '/api/platform/capabilities':
        return {p: dict(playlists=True, likeRead=True, likeWrite=False, albumRead=True, albumWrite=False, artistRead=True,
                        commentsRead=True, commentsLike=True, commentsWrite=False, listenReport=False) for p in _web_constants.PROVIDERS}
    if path == '/api/app/version':
        return dict(version='2.2.1', platform='web')
    if path == '/api/update/latest':
        return dict(available=False, configured=False, currentVersion='2.2.1')
    if path.endswith('/user/playlists'):
        return dict(playlists=[])
    if path.endswith('/like/check'):
        return dict(liked=False, likes={})
    if path == '/api/beatmap/cache/status':
        return dict(ok=True, count=0, available=False)
    return dict(supported=False, songs=[], playlists=[], message='当前网页适配版未提供此桌面功能')

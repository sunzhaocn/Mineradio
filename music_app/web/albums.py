"""专辑元数据转成播放器格式，保留分页和平台歌曲标识。"""
import json
import re
import urllib.error
from music_app.core import request_credentials

from . import client, constants, songs


ROUTES = {'/api/album/detail': 'netease', '/api/qq/album/detail': 'qq',
          '/api/kugou/album/detail': 'kugou', '/api/qishui/album/detail': 'qishui'}


def _native_number(value):
    value = str(value or '')
    return value if re.fullmatch(r'[1-9]\d{0,24}', value) else ''


def resolve_album_identifier(provider, song_id):
    """仅按原生歌曲元数据恢复专辑，不探测播放/音质，不按标题搜索。"""
    key = str(song_id or '')
    cookie = request_credentials.cookie(provider)
    if provider == 'netease':
        if not _native_number(key):
            raise ValueError()
        from music_app.providers.netease.metadata import ne_song_detail
        payload = ne_song_detail(key, cookie=cookie)
        track = next((row for row in payload.get('songs', []) if isinstance(row, dict) and str(row.get('id')) == key), None)
        if not track:
            raise ValueError()
        return _native_number((track.get('al') or track.get('album') or {}).get('id'))
    if provider == 'qq':
        from music_app.providers.qqmusic.metadata import qq_song_detail
        if _native_number(key):
            track = qq_song_detail(song_id=key, cookie=cookie)
            matches = str(track.get('id') or '') == key
        elif re.fullmatch(r'[A-Za-z0-9]{10,14}', key):
            track = qq_song_detail(mid=key, cookie=cookie)
            matches = str(track.get('mid') or track.get('songmid') or '') == key
        else:
            raise ValueError()
        if not matches:
            raise ValueError()
        album = track.get('album') or {}
        mid = str(album.get('mid') or '')
        return mid if re.fullmatch(r'[A-Za-z0-9]{14}', mid) else _native_number(album.get('id'))
    if provider == 'kugou':
        from music_app.providers.kugou.metadata import kg_songinfo
        from music_app.providers.kugou.quality import kg_album_id_of
        is_hash = bool(re.fullmatch(r'[A-Fa-f0-9]{32}', key))
        numeric = _native_number(key)
        if not (is_hash or numeric or re.fullmatch(r'[A-Za-z0-9]{4,12}', key)):
            raise ValueError()
        mode = 'hash' if is_hash else 'album_audio_id' if numeric else 'encode_album_audio_id'
        try:
            track = kg_songinfo(key, cookie, key=mode).get('data') or {}
        except Exception:
            if is_hash:
                return _native_number(kg_album_id_of(key, cookie, require_hash_match=True))
            raise
        actual = str(track.get('hash') or '') if is_hash else str(track.get(mode) or '')
        matches = actual.lower() == key.lower() if is_hash else actual == key
        if not matches:
            raise ValueError()
        album = _native_number(track.get('album_id'))
        return album or (_native_number(kg_album_id_of(key, cookie, require_hash_match=True)) if is_hash else '')
    if provider == 'qishui':
        if not _native_number(key):
            raise ValueError()
        from music_app.providers.qishui.api import details
        track = details(key)
        if str(track.get('id') or '') != key:
            raise ValueError()
        return _native_number(track.get('album_id'))
    raise ValueError()


def detail(provider, query):
    try:
        offset = int(query.get('offset', 0))
        limit = int(query.get('limit', 100))
        if offset < 0 or not 1 <= limit <= 200:
            raise ValueError
    except (ValueError, TypeError):
        return dict(ok=False, error='album_params_invalid', message='offset 应为非负整数，limit 应为 1–200')
    identifier = next((query.get(key) for key in ('mid', 'album_mid', 'albumMid', 'id', 'album_id', 'albumId') if query.get(key)), '')
    if not identifier:
        if not query.get('songId'):
            return dict(ok=False, error='album_id_required', message='当前歌曲缺少专辑 ID')
        try:
            identifier = resolve_album_identifier(provider, query['songId'])
        except ValueError:
            return dict(ok=False, error='album_not_found', message='未能确认当前歌曲的专辑资料，请重新加载', provider=provider)
        except Exception:
            return dict(ok=False, error='album_metadata_failed', message='歌曲资料读取失败，请稍后重试', provider=provider)
        if not identifier:
            # A verified native song with album ID 0 is a normal terminal state,
            # common for QQ user audio. Never replace it with a same-title song.
            return dict(ok=True, albumAvailable=False, reason='song_has_no_album',
                        message='当前平台未为这首音频关联专辑', provider=provider,
                        album=None, songs=[], total=0, offset=0, limit=limit,
                        nextOffset=0, hasMore=False)
    try:
        data = client.upstream('/album', platform=constants.PROVIDERS[provider],
                               id=identifier, offset=offset, limit=limit)
    except urllib.error.HTTPError as error:
        # 只采用本机 API 的公开提示，不把上游地址或鉴权材料送入网页。
        message, reason = '专辑读取失败，请稍后重试', 'album_upstream_failed'
        try:
            payload = json.loads(error.read(65536))
            message = payload.get('msg') or message
            reason = payload.get('reason') or reason
        except (ValueError, OSError, TypeError):
            pass
        finally:
            error.close()
        return dict(ok=False, error=reason, message=message, provider=provider)
    except (OSError, ValueError, RuntimeError):
        return dict(ok=False, error='album_upstream_failed', message='专辑读取失败，请稍后重试', provider=provider)
    album = dict(data.get('album') or {})
    album.update(albumId=album.get('id') or '', albumMid=album.get('mid') or '')
    rows = []
    for raw in data.get('songs', []):
        row = songs.song_row(raw, provider)
        for field in ('track_number', 'disc'):
            if field in raw:
                row[field] = raw[field]
        if provider == 'kugou':
            row.update(albumAudioId=raw.get('album_audio_id') or '',
                       mixSongId=raw.get('mixsongid') or '',
                       emix_id=raw.get('emix_id') or '')
        rows.append(row)
    return dict(ok=True, provider=provider, album=album, songs=rows,
                total=data.get('total', len(rows)), offset=offset, limit=limit,
                nextOffset=offset + len(rows), hasMore=bool(data.get('has_more')))

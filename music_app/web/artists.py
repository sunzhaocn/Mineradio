"""将四平台歌手资料和热门歌曲适配给现有详情弹窗。"""
import json
import urllib.error

from . import client, constants, songs


ROUTES = {'/api/artist/detail': 'netease', '/api/qq/artist/detail': 'qq',
          '/api/kugou/artist/detail': 'kugou', '/api/qishui/artist/detail': 'qishui'}


def detail(provider, query):
    try:
        offset, limit = int(query.get('offset', 0)), int(query.get('limit', 50))
        if offset < 0 or not 1 <= limit <= 100:
            raise ValueError
    except (ValueError, TypeError):
        return dict(ok=False, error='artist_params_invalid', message='offset 应为非负整数，limit 应为 1–100')
    identifier = next((query.get(key) for key in ('mid', 'artistMid', 'artist_mid', 'id', 'artistId', 'artist_id') if query.get(key)), '')
    song_id = query.get('song_id') or query.get('songId') or ''
    if not identifier and not song_id:
        return dict(ok=False, error='artist_id_required', message='当前歌曲缺少可用的歌手或歌曲标识')
    try:
        data = client.upstream('/artist', platform=constants.PROVIDERS[provider], id=identifier,
                               song_id=song_id, name=query.get('name', ''), offset=offset, limit=limit)
    except urllib.error.HTTPError as error:
        message, reason = '歌手主页加载失败，请稍后重试', 'artist_upstream_failed'
        try:
            payload = json.loads(error.read(65536))
            message, reason = payload.get('msg') or message, payload.get('reason') or reason
        except (ValueError, TypeError, OSError):
            pass
        finally:
            error.close()
        return dict(ok=False, error=reason, message=message, provider=provider)
    return dict(ok=True, provider=provider, artist=dict(data.get('artist') or {}),
                resolvedArtist=data.get('resolved_artist'),
                songs=[songs.song_row(row, provider) for row in data.get('songs', [])],
                total=data.get('total'), nextOffset=offset + len(data.get('songs', [])),
                offset=offset, limit=limit, hasMore=bool(data.get('has_more')),
                totalEstimated=bool(data.get('total_is_estimate')), scope=data.get('scope', 'hot'))

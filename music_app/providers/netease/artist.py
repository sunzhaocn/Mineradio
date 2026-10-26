"""网易云歌手资料及平台热门歌曲；不把热门 50 首称作完整作品库。"""
import json
import re
import urllib.error

from music_app.core import request_credentials
from music_app.core.artists import select_reference
from . import search_views, transport


def _identifier(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError('网易云歌手或歌曲编号无效')
    value = str(value).strip()
    if not re.fullmatch(r'[0-9]{1,20}', value) or int(value) <= 0:
        raise ValueError('网易云歌手或歌曲编号无效')
    return str(int(value))


def _pagination(offset, limit):
    if type(offset) is not int or type(limit) is not int or offset < 0 or not 1 <= limit <= 200:
        raise ValueError('歌手分页参数无效')
    return offset, limit


def _request(path, payload):
    cookie = request_credentials.cookie('netease')
    try:
        result = transport.ne_weapi_post(path, dict(payload, csrf_token=transport.ne_cookie_fields(cookie)['csrf']),
                                        cookie=cookie)
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        if status == 404:
            raise FileNotFoundError('网易云歌手或歌曲不存在') from None
        raise RuntimeError('网易云歌手资料请求失败，请稍后重试') from None
    except Exception:
        raise RuntimeError('网易云歌手资料请求失败，请稍后重试') from None
    if not isinstance(result, dict):
        raise RuntimeError('网易云歌手资料响应格式异常')
    if result.get('code') in (404, '404'):
        raise FileNotFoundError('网易云歌手或歌曲不存在')
    if result.get('code') not in (200, '200'):
        raise RuntimeError('网易云暂时无法读取歌手资料，请稍后重试')
    return result


def resolve_artist(song_id, name=''):
    """用原生歌曲元数据恢复旧收藏的歌手编号；按精确名称选择合作者。"""
    song_id = _identifier(song_id)
    body = _request('/weapi/v3/song/detail', dict(c=json.dumps([{'id': int(song_id)}]), ids=json.dumps([int(song_id)])))
    rows = body.get('songs')
    if not isinstance(rows, list):
        raise RuntimeError('网易云歌曲元数据响应不完整')
    song = next((row for row in rows if isinstance(row, dict) and str(row.get('id')) == song_id), None)
    if song is None:
        raise FileNotFoundError('网易云歌曲不存在或已下架')
    artists = song.get('ar') or song.get('artists') or []
    if not isinstance(artists, list):
        raise RuntimeError('网易云歌曲歌手资料格式异常')
    return select_reference(artists, name)


def fetch_artist(artist_id, offset=0, limit=50):
    """读取资料与固定热门目录后切页；total 始终是该热门目录的实际长度。"""
    artist_id = _identifier(artist_id)
    offset, limit = _pagination(offset, limit)
    body = _request('/weapi/v1/artist/' + artist_id, {})
    raw = body.get('artist')
    if not isinstance(raw, dict) or not raw.get('id') or not raw.get('name'):
        raise RuntimeError('网易云歌手资料响应不完整')
    if str(raw['id']) != artist_id:
        raise RuntimeError('网易云返回的歌手编号不匹配')
    tracks = body.get('hotSongs')
    if not isinstance(tracks, list):
        raise RuntimeError('网易云热门歌曲响应不完整')
    count = raw.get('musicSize')
    count = int(count) if type(count) is int and count >= 0 else None
    alias = [name for name in raw.get('alias') or [] if isinstance(name, str)]
    artist = dict(id=artist_id, mid='', name=raw['name'],
                  avatar=str(raw.get('img1v1Url') or raw.get('picUrl') or '').replace('http://', 'https://'),
                  description=raw.get('briefDesc') or '', alias=alias, song_count=count)
    songs = []
    try:
        for track in tracks[offset:offset + limit]:
            if not isinstance(track, dict) or not track.get('id'):
                raise ValueError
            row = search_views.nes__song_row(track)
            row['cover'] = str(row.get('cover') or '').replace('http://', 'https://')
            songs.append(row)
    except (TypeError, ValueError, AttributeError):
        raise RuntimeError('网易云热门歌曲包含无效记录') from None
    total = len(tracks)
    return dict(code=200, artist=artist, songs=songs, total=total, offset=offset, limit=limit,
                has_more=offset + len(songs) < total, scope='hot')

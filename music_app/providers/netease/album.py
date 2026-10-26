"""网易云专辑详情与曲目，只使用当前请求凭据，不获取播放地址。"""
from datetime import datetime, timedelta, timezone
import re
import urllib.error

from music_app.core import request_credentials
from . import search_views, transport


def _identifier(value):
    value = str(value if value is not None else '').strip()
    if not re.fullmatch(r'[0-9]{1,20}', value) or int(value) <= 0:
        raise ValueError('网易云专辑编号无效')
    return str(int(value))


def _pagination(offset, limit):
    try:
        if isinstance(offset, bool) or isinstance(limit, bool):
            raise ValueError
        if str(offset).strip() != str(int(offset)) or str(limit).strip() != str(int(limit)):
            raise ValueError
        offset, limit = int(offset), int(limit)
        if offset < 0 or not 1 <= limit <= 500:
            raise ValueError
    except (TypeError, ValueError, OverflowError):
        raise ValueError('专辑分页参数无效，offset 需非负，limit 需为 1 至 500') from None
    return offset, limit


def _number(value, default=0):
    try:
        return max(0, int(value))
    except (TypeError, ValueError, OverflowError):
        return default


def _publish_time(value):
    if value in (None, ''):
        return ''
    try:
        # 网易发行日期以北京时间零点记录，按 UTC 截日会显示为前一天。
        return datetime.fromtimestamp(int(value) / 1000, timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    except (TypeError, ValueError, OverflowError, OSError):
        return str(value)


def fetch_album(album_id, offset=0, limit=100):
    """读取完整专辑后按上游顺序切页；缺失专辑与上游错误分别抛出异常。"""
    album_id = _identifier(album_id)
    offset, limit = _pagination(offset, limit)
    cookie = request_credentials.cookie('netease')
    try:
        result = transport.ne_weapi_post('/weapi/v1/album/' + album_id,
                                        {'csrf_token': transport.ne_cookie_fields(cookie)['csrf']},
                                        cookie=cookie)
    except urllib.error.HTTPError as exc:
        status = exc.code
        exc.close()
        if status == 404:
            raise FileNotFoundError('网易云专辑不存在') from None
        raise RuntimeError('网易云专辑请求失败，请稍后重试') from None
    except Exception:
        raise RuntimeError('网易云专辑请求失败，请稍后重试') from None
    if not isinstance(result, dict):
        raise RuntimeError('网易云专辑响应格式错误')
    if result.get('code') in (404, '404'):
        raise FileNotFoundError('网易云专辑不存在')
    if result.get('code') not in (200, '200'):
        raise RuntimeError('网易云暂时无法读取该专辑，请稍后重试')
    raw_album = result.get('album')
    if not isinstance(raw_album, dict) or not raw_album.get('id') or not raw_album.get('name'):
        raise RuntimeError('网易云专辑详情响应不完整')
    if str(raw_album['id']) != album_id:
        raise RuntimeError('网易云返回的专辑编号不匹配')
    raw_songs = result.get('songs')
    if not isinstance(raw_songs, list):
        raw_songs = raw_album.get('songs')
    if not isinstance(raw_songs, list):
        raise RuntimeError('网易云专辑曲目响应不完整')
    total = max(_number(raw_album.get('size')), len(raw_songs))
    if len(raw_songs) < total:
        raise RuntimeError('网易云未返回完整专辑曲目，请稍后重试')
    artists = [row['name'] for row in raw_album.get('artists') or []
               if isinstance(row, dict) and row.get('name')]
    if not artists and isinstance(raw_album.get('artist'), dict) and raw_album['artist'].get('name'):
        artists = [raw_album['artist']['name']]
    album = dict(id=album_id, mid='', name=raw_album['name'], artist=' / '.join(artists), artists=artists,
                 cover=str(raw_album.get('picUrl') or raw_album.get('blurPicUrl') or '').replace('http://', 'https://'),
                 description=raw_album.get('description') or raw_album.get('briefDesc') or '',
                 publish_time=_publish_time(raw_album.get('publishTime')), company=raw_album.get('company') or '',
                 type=raw_album.get('type') or raw_album.get('subType') or '', total=total)
    songs = []
    try:
        for raw in raw_songs[offset:offset + limit]:
            if not isinstance(raw, dict) or not raw.get('id'):
                raise ValueError
            row = search_views.nes__song_row(raw)
            row['album_id'] = row.get('album_id') or album_id
            row['album'] = row.get('album') or album['name']
            row['cover'] = str(row.get('cover') or album['cover']).replace('http://', 'https://')
            if raw.get('no') is not None:
                row['track_number'] = _number(raw['no'])
            if raw.get('cd', raw.get('disc')) is not None:
                row['disc'] = str(raw.get('cd', raw.get('disc')))
            songs.append(row)
    except (TypeError, ValueError, AttributeError):
        raise RuntimeError('网易云专辑包含无效曲目') from None
    return dict(code=200, album=album, songs=songs, total=total, offset=offset, limit=limit,
                has_more=offset + len(songs) < total)

"""QQ 音乐专辑详情与原生曲目分页；兼容数字 ID 和专辑 mid。"""
import html
import re
import urllib.error

from music_app.core import request_credentials
from . import search_views, transport


_PAGE_SIZE = 100


def _identifier(value):
    value = str(value if value is not None else '').strip()
    if re.fullmatch(r'[0-9]{1,20}', value) and int(value) > 0:
        return str(int(value)), True
    if re.fullmatch(r'[A-Za-z0-9]{14}', value) and not value.isdigit():
        return value, False
    raise ValueError('QQ 音乐专辑编号无效，请使用数字 ID 或 14 位专辑 mid')


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


def _rpc(module, method, param, cookie, missing=False):
    try:
        result = transport.qq_musicu({'comm': {'ct': 24, 'cv': 0}, 'req': {
            'module': module, 'method': method, 'param': param}}, cookie=cookie)
    except urllib.error.HTTPError as exc:
        exc.close()
        raise RuntimeError('QQ 音乐专辑请求失败，请稍后重试') from None
    except Exception:
        raise RuntimeError('QQ 音乐专辑请求失败，请稍后重试') from None
    block = result.get('req') if isinstance(result, dict) else None
    if not isinstance(block, dict):
        raise RuntimeError('QQ 音乐专辑响应格式错误')
    if result.get('code') not in (0, '0'):
        raise RuntimeError('QQ 音乐暂时无法读取该专辑，请稍后重试')
    # GetAlbumDetail 对不存在的 mid 明确返回 104400；权限/限流等其他码不能当作不存在。
    if missing and block.get('code') in (104400, '104400'):
        raise FileNotFoundError('QQ 音乐专辑不存在')
    if block.get('code') not in (0, '0') or not isinstance(block.get('data'), dict):
        raise RuntimeError('QQ 音乐暂时无法读取该专辑，请稍后重试')
    return block['data']


def _song(raw, album):
    track = raw.get('songInfo') if isinstance(raw.get('songInfo'), dict) else raw
    if not track.get('mid'):
        raise RuntimeError('QQ 音乐专辑包含无效曲目')
    try:
        row = search_views.qqs_song_row(track)
    except (TypeError, ValueError, AttributeError):
        raise RuntimeError('QQ 音乐专辑包含无效曲目') from None
    row['name'] = html.unescape(row.get('name') or '')
    row['album'] = row.get('album') or album['name']
    row['album_id'] = str((track.get('album') or {}).get('id') or album['id'])
    row['album_mid'] = row.get('album_mid') or album['mid']
    row['cover'] = row.get('cover') or album['cover']
    if track.get('index_album') is not None:
        row['track_number'] = track['index_album']
    if track.get('index_cd') is not None:
        try:
            row['disc'] = str(int(track['index_cd']) + 1)
        except (TypeError, ValueError, OverflowError):
            row['disc'] = str(track['index_cd'])
    return row


def fetch_album(album_id, offset=0, limit=100):
    """读取专辑元数据后按 begin/num 拉取曲目，保持平台给出的碟片与曲序。"""
    album_id, numeric = _identifier(album_id)
    offset, limit = _pagination(offset, limit)
    cookie = request_credentials.cookie('qqmusic')
    detail = _rpc('music.musichallAlbum.AlbumInfoServer', 'GetAlbumDetail',
                  {'albumId': int(album_id)} if numeric else {'albumMid': album_id}, cookie, missing=True)
    basic = detail.get('basicInfo')
    if not isinstance(basic, dict):
        raise RuntimeError('QQ 音乐专辑详情响应不完整')
    # 不存在的数字 ID 会返回 code=0，并回显 ID；空名称及 mid 是上游明确的空记录。
    if not basic.get('albumName') and not basic.get('albumMid'):
        raise FileNotFoundError('QQ 音乐专辑不存在')
    mid = str(basic.get('albumMid') or '')
    aid = str(basic.get('albumID') or '')
    if not re.fullmatch(r'[A-Za-z0-9]{14}', mid) or not aid.isdigit() or not basic.get('albumName'):
        raise RuntimeError('QQ 音乐专辑详情响应不完整')
    if (numeric and aid != album_id) or (not numeric and mid != album_id):
        raise RuntimeError('QQ 音乐返回的专辑编号不匹配')
    singer = detail.get('singer') if isinstance(detail.get('singer'), dict) else {}
    artists = [row['name'] for row in singer.get('singerList') or []
               if isinstance(row, dict) and row.get('name')]
    company = detail.get('company') if isinstance(detail.get('company'), dict) else {}
    album = dict(id=aid, mid=mid, name=html.unescape(basic['albumName']), artist=' / '.join(artists),
                 artists=artists, cover=search_views.qqs_cover_of(mid), description=basic.get('desc') or '',
                 publish_time=str(basic.get('publishDate') or ''), company=company.get('name') or '',
                 type=basic.get('albumType') or '', total=0)
    songs, total = [], None
    while len(songs) < limit:
        begin = offset + len(songs)
        size = min(_PAGE_SIZE, limit - len(songs))
        page = _rpc('music.musichallAlbum.AlbumSongList', 'GetAlbumSongList',
                    dict(albumMid=mid, albumID=int(aid), begin=begin, num=size, order=2), cookie)
        raw_songs = page.get('songList')
        try:
            if isinstance(page.get('totalNum'), bool) or int(page['totalNum']) < 0:
                raise ValueError
            page_total = int(page['totalNum'])
            if page.get('curBegin') is not None and int(page['curBegin']) != begin:
                raise ValueError
        except (KeyError, TypeError, ValueError, OverflowError):
            raise RuntimeError('QQ 音乐专辑分页响应不完整') from None
        if (not isinstance(raw_songs, list) or (total is not None and total != page_total) or
                any(not isinstance(row, dict) for row in raw_songs)):
            raise RuntimeError('QQ 音乐专辑曲目响应不完整，请稍后重试')
        total = page_total
        if not raw_songs and begin < total:
            raise RuntimeError('QQ 音乐专辑分页没有推进，请稍后重试')
        if len(raw_songs) > size or (raw_songs and begin + len(raw_songs) > total):
            raise RuntimeError('QQ 音乐专辑分页范围错误')
        songs.extend(_song(raw, album) for raw in raw_songs)
        if offset + len(songs) >= total:
            break
    album['total'] = total
    return dict(code=200, album=album, songs=songs, total=total, offset=offset, limit=limit,
                has_more=offset + len(songs) < total)

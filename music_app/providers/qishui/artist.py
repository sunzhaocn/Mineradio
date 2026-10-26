"""汽水歌手资料及原生排序单曲；凭据仅来自本次请求。"""
import re

from .api import cover_url, normalize_track
from .client import QishuiError, request_json


def _identifier(value):
    if isinstance(value, bool):
        raise ValueError('汽水歌手或歌曲 ID 格式不正确')
    value = str(value if value is not None else '').strip()
    if not re.fullmatch(r'[1-9][0-9]{0,18}', value) or int(value) > 9223372036854775807:
        raise ValueError('汽水歌手或歌曲 ID 格式不正确')
    return value


def _pagination(offset, limit):
    try:
        if isinstance(offset, bool) or isinstance(limit, bool):
            raise ValueError
        if str(offset).strip() != str(int(offset)) or str(limit).strip() != str(int(limit)):
            raise ValueError
        offset, limit = int(offset), int(limit)
        if offset < 0 or not 1 <= limit <= 500 or offset + limit > 10000:
            raise ValueError
    except (TypeError, ValueError, OverflowError):
        raise ValueError('歌手分页参数无效，offset 需非负，limit 需为 1 至 500，范围不超过前 10000 首') from None
    return offset, limit


def _request(route, query=None, body=None):
    try:
        data = request_json(route, query, body) if body is not None else request_json(route, query)
    except QishuiError as error:
        if getattr(error, 'upstream_code', None) in (1000005, '1000005'):
            raise FileNotFoundError('汽水歌手或歌曲不存在或已下架') from None
        if error.status == 503:
            raise
        raise RuntimeError('汽水暂时无法读取歌手资料，请稍后重试') from None
    except (OSError, RuntimeError):
        raise RuntimeError('汽水歌手请求失败，请稍后重试') from None
    if not isinstance(data, dict):
        raise RuntimeError('汽水歌手响应格式异常')
    if data.get('status_code') in (1000005, '1000005'):
        raise FileNotFoundError('汽水歌手或歌曲不存在或已下架')
    if data.get('status_code', 0) not in (None, 0, '0'):
        raise RuntimeError('汽水暂时无法读取歌手资料，请稍后重试')
    return data


def _song(track):
    try:
        if not isinstance(track, dict) or not isinstance(track.get('name'), str) or not track['name'].strip():
            raise ValueError
        _identifier(track.get('id'))
        row = normalize_track(track)
        if row['duration_s'] < 0:
            raise ValueError
        return row
    except (TypeError, ValueError, AttributeError, OverflowError):
        raise RuntimeError('汽水歌手包含无效曲目资料') from None


def _song_count(value):
    if value is None:
        return None
    if isinstance(value, bool) or not re.fullmatch(r'[0-9]+', str(value)):
        raise RuntimeError('汽水歌手歌曲总数格式异常')
    return int(value)


def fetch_artist(artist_id, offset=0, limit=50):
    """读取歌手资料及 ListArtistTracks 的 Hot 原生排序。

    官方 Soda 3.7.0 固定 GET artists/{id} 与 artists/{id}/tracks，
    sort_type=0。后者可能忽略 count，且 next_cursor 的推进量可能大于可见
    歌曲数量；因此沿真实游标累积后切页，不能直接把 offset 当成上游游标。
    """
    artist_id = _identifier(artist_id)
    offset, limit = _pagination(offset, limit)
    detail = _request('artists/' + artist_id, {'locate_item_id': ''})
    raw = detail.get('artist_info')
    if (not isinstance(raw, dict) or str(raw.get('id', '')) != artist_id or
            not isinstance(raw.get('name'), str) or not raw['name'].strip()):
        raise RuntimeError('汽水歌手资料不完整或标识不匹配')
    count = _song_count(raw.get('count_tracks'))
    profile = raw.get('artist_profile') or {}
    if not isinstance(profile, dict):
        raise RuntimeError('汽水歌手简介格式异常')
    aliases = raw.get('aliases') or raw.get('alias') or profile.get('aliases') or []
    if isinstance(aliases, str):
        aliases = [aliases] if aliases.strip() else []
    if not isinstance(aliases, list) or any(not isinstance(name, str) for name in aliases):
        raise RuntimeError('汽水歌手别名格式异常')
    try:
        artist = dict(id=artist_id, mid='', name=raw['name'],
                      avatar=cover_url({'url_cover': raw.get('url_avatar') or {}}),
                      description=str(profile.get('intro') or ''),
                      alias=[name.strip() for name in aliases if name.strip()], song_count=count)
    except (TypeError, AttributeError, IndexError):
        raise RuntimeError('汽水歌手头像格式异常') from None
    rows, seen, cursors = [], set(), {''}
    cursor, exhausted, end = '', False, offset + limit
    for _ in range(200):
        data = _request('artists/' + artist_id + '/tracks',
                        {'cursor': cursor, 'count': '50', 'sort_type': '0'})
        batch = data.get('tracks', [] if count == 0 else None)
        more = data.get('has_more', False)
        if not isinstance(batch, list) or not isinstance(more, bool):
            raise RuntimeError('汽水歌手单曲分页格式异常')
        for track in batch:
            row = _song(track)
            if row['id'] in seen:
                raise RuntimeError('汽水歌手单曲分页返回重复曲目')
            seen.add(row['id'])
            rows.append(row)
        exhausted = not more
        if exhausted:
            break
        next_cursor = data.get('next_cursor')
        if not batch or not isinstance(next_cursor, (str, int)):
            raise RuntimeError('汽水歌手单曲分页没有继续返回资料')
        next_cursor = str(next_cursor)
        if not next_cursor or next_cursor in cursors or len(next_cursor) > 512:
            raise RuntimeError('汽水歌手单曲分页游标重复或无效')
        cursors.add(next_cursor)
        # 有可靠声明总数时只读本页所需部分；缺失/低报总数则读到末尾求真值。
        if len(rows) >= end and count is not None and count > len(rows):
            break
        cursor = next_cursor
    else:
        raise RuntimeError('汽水歌手单曲数量超出本次读取范围')
    total = len(rows) if exhausted else max(count or 0, len(rows))
    songs = rows[offset:end]
    return dict(code=200, artist=artist, songs=songs, total=total, offset=offset, limit=limit,
                has_more=len(rows) > end or not exhausted, total_is_estimate=not exhausted, scope='hot')


def resolve_artist(song_id, name=''):
    """旧歌曲没有 artist_id 时，仅取原平台 Track 的艺人引用，不解析播放模型。"""
    from music_app.core.artists import select_reference

    song_id = _identifier(song_id)
    data = _request('track_v2', body={'track_id': song_id, 'media_type': 'track',
                                    'queue_type': 'search_one_track', 'scene_name': 'search'})
    track = data.get('track')
    if not isinstance(track, dict) or str(track.get('id', '')) != song_id:
        raise RuntimeError('汽水歌曲资料不完整或标识不匹配')
    artists = track.get('artists')
    if not isinstance(artists, list):
        raise RuntimeError('汽水歌曲未返回有效歌手资料')
    references = []
    for row in artists:
        if not isinstance(row, dict) or not isinstance(row.get('name'), str) or not row['name'].strip():
            continue
        try:
            native_id = _identifier(row.get('id'))
        except ValueError:
            continue
        references.append(dict(id=native_id, mid='', name=row['name']))
    return select_reference(references, name)

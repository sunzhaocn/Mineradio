"""汽水专辑资料及曲目；只使用当前请求会话，不获取播放地址。"""
from datetime import datetime, timedelta, timezone
import re

from .api import cover_url, normalize_track
from .client import QishuiError, request_json


def _identifier(value):
    if isinstance(value, bool):
        raise ValueError('汽水专辑 ID 格式不正确')
    value = str(value if value is not None else '').strip()
    if not re.fullmatch(r'[1-9][0-9]{0,18}', value) or int(value) > 9223372036854775807:
        raise ValueError('汽水专辑 ID 格式不正确')
    return value


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


def _publish_time(value):
    if value in (None, ''):
        return ''
    try:
        # 客户端以本地日期展示 release_date（秒）；中国发行日期按 UTC+8 截日。
        return datetime.fromtimestamp(int(value), timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    except (TypeError, ValueError, OverflowError, OSError):
        raise RuntimeError('汽水专辑发行时间格式异常') from None


def fetch_album(album_id, offset=0, limit=100):
    """读取完整专辑后本地切页。

    Soda 3.7.0 的 GetAlbumDetail 是 GET /luna/pc/albums/{album_id}，
    query 为 ignore_tracks=false；AlbumQueueItem 明确不分页。
    上游 count_tracks 偶尔少于实际 tracks，不能据此截掉返回的曲目。
    """
    album_id = _identifier(album_id)
    offset, limit = _pagination(offset, limit)
    try:
        result = request_json('albums/' + album_id, {'ignore_tracks': 'false'})
    except QishuiError as error:
        # 真实缺失响应：status_info.status_msg = ERR_RESOURCE_NOT_FOUND。
        if getattr(error, 'upstream_code', None) in (1000005, '1000005'):
            raise FileNotFoundError('汽水专辑不存在或已下架') from None
        if error.status == 503:
            raise  # 保留缺少本次会话/客户端签名 SDK 的明确服务状态。
        raise RuntimeError('汽水暂时无法读取该专辑，请稍后重试') from None
    except (OSError, RuntimeError):
        raise RuntimeError('汽水专辑请求失败，请稍后重试') from None
    if not isinstance(result, dict):
        raise RuntimeError('汽水专辑响应格式异常')
    if result.get('status_code') in (1000005, '1000005'):
        raise FileNotFoundError('汽水专辑不存在或已下架')
    if result.get('status_code', 0) not in (None, 0, '0'):
        raise RuntimeError('汽水暂时无法读取该专辑，请稍后重试')
    raw_album, tracks = result.get('album_info'), result.get('tracks')
    if (not isinstance(raw_album, dict) or str(raw_album.get('id', '')) != album_id or
            not isinstance(raw_album.get('name'), str) or not raw_album['name'].strip()):
        raise RuntimeError('汽水返回的专辑资料不完整或标识不匹配')
    if not isinstance(tracks, list):
        raise RuntimeError('汽水专辑响应缺少完整曲目列表')
    try:
        declared = raw_album.get('count_tracks', len(tracks))
        if isinstance(declared, bool) or not re.fullmatch(r'[0-9]+', str(declared)):
            raise ValueError
        total = max(int(declared), len(tracks))
        if len(tracks) < total:
            raise ValueError
        artist_rows = raw_album.get('artists') or []
        if not isinstance(artist_rows, list) or any(not isinstance(row, dict) for row in artist_rows):
            raise ValueError
        artists = [str(row['name']) for row in artist_rows if row.get('name')]
        album = dict(id=album_id, mid='', name=raw_album['name'],
                     artist=' / '.join(artists), artists=artists, cover=cover_url(raw_album),
                     description=str(raw_album.get('intro') or ''),
                     publish_time=_publish_time(raw_album.get('release_date')),
                     company=str(raw_album.get('company') or ''),
                     type=str(raw_album.get('type') or ''), total=total)
        songs, seen = [], set()
        # 验证全集，避免请求末页时把先前丢失/重复曲目误报为完整专辑。
        for index, track in enumerate(tracks):
            if not isinstance(track, dict) or not isinstance(track.get('name'), str) or not track['name'].strip():
                raise ValueError
            song_id = _identifier(track.get('id'))
            if song_id in seen:
                raise ValueError
            seen.add(song_id)
            if not offset <= index < offset + limit:
                continue
            track = dict(track)
            source_album = track.get('album') or {}
            if not isinstance(source_album, dict):
                raise ValueError
            track['album'] = {**raw_album, **source_album}
            row = normalize_track(track)
            row['track_number'] = index + 1
            songs.append(row)
    except (TypeError, ValueError, AttributeError, OverflowError):
        raise RuntimeError('汽水专辑包含无效或不完整的曲目资料') from None
    return dict(code=200, album=album, songs=songs, total=total, offset=offset, limit=limit,
                has_more=offset + len(songs) < total)

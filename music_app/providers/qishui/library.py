"""汽水已登录用户的个人音乐库，只读取歌单与歌曲元信息。"""

import re
import time

from music_app.providers.qishui.client import QishuiError, read_track, request_json, write_library


_PAGE_SIZE = 100
_MAX_PAGES = 1000
_LIKED_ID = 'qishui-liked'


def _number(value, default=None):
    try:
        result = int(value)
        return result if result >= 0 else default
    except (TypeError, ValueError):
        return default


def _data(result):
    data = result.get('data', result)
    if not isinstance(data, dict):
        raise ValueError('汽水个人音乐库响应格式异常')
    return data


def _cover(value):
    if isinstance(value, str):
        return value if value.startswith(('https://', 'http://')) else ''
    if isinstance(value, list):
        return next((url for item in value if (url := _cover(item))), '')
    if isinstance(value, dict):
        urls = value.get('urls') or value.get('url_list') or []
        if urls:
            url = _cover(urls[0])
            uri = value.get('uri') or ''
            if uri and url.endswith('/'):
                return url + uri + '~' + value.get('template_prefix', 'tplv-b829550vbb') + '-crop-center:400:400.jpg'
            return url
        return _cover(value.get('url'))
    return ''


def _count(item):
    return next((_number(item[k]) for k in ('count_tracks', 'track_count', 'media_count', 'count', 'total', 'song_count') if _number(item.get(k)) is not None),
                _number((item.get('resource_cnt') or {}).get('track_cnt'), 0))


def _playlist(item, kind):
    playlist_id = str(item.get('playlist_id') or item.get('collection_id') or item.get('id') or '')
    name = str(item.get('title') or item.get('public_title') or item.get('name') or item.get('playlist_name') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', playlist_id) or not name:
        raise ValueError('汽水个人歌单缺少有效的标识或名称')
    liked = kind == 'created' and (item.get('type') in (1, '1') or item.get('is_liked') is True
                or bool(re.search(r'我的?喜欢|liked music|my favorites?', name, re.I)))
    owner = item.get('owner') or {}
    editable = kind == 'created'
    return {'id': playlist_id, 'provider': 'qishui', 'source': 'qishui', 'type': 'playlist',
            'name': name, 'cover': _cover(item.get('url_cover') or item.get('cover_url') or item.get('cover')),
            'trackCount': _count(item), 'kind': 'liked' if liked else kind, 'isLiked': liked,
            'editable': editable, 'canAdd': editable, 'canRemove': editable,
            'creator': str(owner.get('public_name') or owner.get('nickname') or item.get('creator_name') or '')}


def _playlists(data, kind):
    """Only follow playlist containers; a track/album must never become a card."""
    result, seen = [], set()
    def visit(node, direct=False, depth=0):
        if depth > 8:
            raise ValueError('汽水歌单资料层级异常')
        if isinstance(node, list):
            for item in node:
                visit(item, direct, depth + 1)
        elif isinstance(node, dict):
            if direct and any(k in node for k in ('id', 'playlist_id', 'collection_id')):
                row = _playlist(node, kind)
                if row['id'] not in seen:
                    seen.add(row['id'])
                    result.append(row)
                return
            for key, item in node.items():
                if key in ('playlist', 'playlist_info', 'playlists', 'playlist_list', 'collect_playlist', 'fav_playlist'):
                    visit(item, True, depth + 1)
                elif key in ('entity', 'resource', 'resources', 'media_resources', 'collection', 'collections', 'items', 'list', 'playlist_wrapper', 'mixed_resources'):
                    visit(item, False, depth + 1)
    visit(data)
    return result


def _next_page(data, cursor, count, known_count):
    next_cursor = str(data.get('next_cursor') or data.get('nextCursor') or '')
    if next_cursor == '0':
        next_cursor = ''
    total = next((_number(data[k]) for k in ('total_num', 'total', 'total_count') if _number(data.get(k)) is not None), None)
    explicit = data.get('has_more', data.get('hasMore'))
    more = bool(explicit) if explicit is not None else (known_count < total if total is not None else bool(next_cursor))
    if more and (not count or not next_cursor or next_cursor == cursor):
        raise ValueError('汽水个人音乐库分页没有继续返回资料，请稍后重试')
    if not more and total is not None and known_count < total:
        raise ValueError('汽水个人音乐库分页提前结束，请稍后重试')
    return more, next_cursor, total


def _catalog_group(route, query, kind):
    cursor, rows, seen, cursors, received = '', [], set(), set(), 0
    for _ in range(_MAX_PAGES):
        data = _data(request_json(route, {**query, 'cursor': cursor, 'count': _PAGE_SIZE}))
        batch = _playlists(data, kind)
        raw_count = next((len(data[k]) for k in ('playlists', 'playlist_list', 'media_resources', 'resources', 'mixed_resources', 'items', 'list', 'collections') if isinstance(data.get(k), list)), len(batch))
        # The official empty collection response has status_info and no list.
        if not batch and not any(k in data for k in ('status_info', 'playlists', 'playlist_list', 'items', 'media_resources', 'total_num', 'total', 'has_more')):
            raise ValueError('汽水个人歌单响应缺少列表')
        added = 0
        for row in batch:
            if row['id'] not in seen:
                seen.add(row['id'])
                rows.append(row)
                added += 1
        received += raw_count
        more, next_cursor, _ = _next_page(data, cursor, raw_count, received)
        if not more:
            return rows
        if (batch and not added) or next_cursor in cursors:
            raise ValueError('汽水个人歌单分页重复，请稍后重试')
        cursors.add(next_cursor)
        cursor = next_cursor
    raise ValueError('汽水个人歌单数量超出本次读取范围，请稍后重试')


def catalog(account=None):
    """通过当前登录会话验证身份，读取创建与收藏目录的全部 cursor 页。"""
    data = _data(request_json('me'))
    user = next((data[k] for k in ('my_info', 'user', 'user_info', 'account', 'me') if isinstance(data.get(k), dict)), data)
    user_id = str(user.get('id') or user.get('user_id') or user.get('uid') or '')
    if not re.fullmatch(r'[1-9]\d{0,24}', user_id):
        raise ValueError('汽水登录未返回有效账号，请重新登录')
    rows = _catalog_group('user/playlist', {'user_id': user_id}, 'created')
    seen = {row['id'] for row in rows}
    for row in _catalog_group('me/collection/mixed', {}, 'collected'):
        if row['id'] not in seen:
            seen.add(row['id'])
            rows.append(row)
    if not any(row['isLiked'] for row in rows):
        # Missing the native default playlist is not proof of zero likes.
        raise ValueError('汽水未返回我的喜欢歌单，请稍后重试或重新登录')
    return {'playlists': rows, 'total': len(rows), 'hasMore': False, 'nextOffset': len(rows)}


def _song(item):
    from music_app.web.songs import song_row
    from music_app.providers.qishui.api import normalize_track
    if not isinstance(item, dict):
        raise ValueError('汽水歌单歌曲资料格式异常')
    entity = item.get('entity') or item
    media = entity.get('media') or entity
    wrapper = entity.get('track_wrapper') or media.get('track_wrapper') or item.get('track_wrapper') or {}
    track = wrapper.get('track') or media.get('track_entity') or item.get('track_entity') or media.get('track') or item.get('track') or media
    base = track.get('base_info') or track
    related = track.get('related_info') or {}
    display = track.get('display_info') or {}
    key, name = str(base.get('id') or track.get('id') or ''), str(base.get('name') or base.get('title') or '')
    if not re.fullmatch(r'[1-9]\d{0,24}', key) or not name:
        raise ValueError('汽水歌单歌曲缺少有效标识或名称')
    album = related.get('album_link') or track.get('album') or base.get('album') or {}
    artists = related.get('artist_links') or base.get('artists') or track.get('artists') or []
    normalized = normalize_track({**track, 'id': key, 'name': name, 'album': album,
                                  'artists': artists, 'duration': base.get('duration_ms') or base.get('duration') or track.get('duration') or 0})
    normalized['cover'] = _cover(display.get('cover_url') or display.get('url_cover') or base.get('cover_url') or base.get('url_cover') or album.get('url_cover') or album.get('cover_url'))
    result = song_row(normalized, 'qishui')
    # A MediaResource can be wrapped as type=track while its actual playable
    # type is ugc_clip. Preserve the inner type used by the official service.
    result['nativeMediaType'] = normalized['nativeMediaType']
    return result


def _media(data):
    for key in ('media_resources', 'media_list', 'tracks', 'track_list', 'songs', 'items', 'list'):
        if key in data:
            if not isinstance(data[key], list):
                raise ValueError('汽水歌单歌曲列表格式异常')
            return data[key]
    # A real empty default list has playlist metadata, but no media array.
    meta = data.get('playlist') or data.get('playlist_info')
    if isinstance(meta, dict) and _count(meta) == 0 and not data.get('has_more'):
        return []
    raise ValueError('汽水歌单详情响应缺少歌曲列表')


def tracks(playlist_id, offset=0, limit=100, account=None):
    """从头遍历不透明 cursor 到指定窗口；不把前 100 首冒充全部歌单。"""
    playlist_id = str(playlist_id)
    if playlist_id == _LIKED_ID:
        playlist_id = next(row['id'] for row in catalog(account)['playlists'] if row['isLiked'])
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', playlist_id):
        raise ValueError('汽水歌单 ID 格式不正确')
    if not isinstance(offset, int) or not isinstance(limit, int) or offset < 0 or not 1 <= limit <= 1000:
        raise ValueError('汽水歌单分页参数不正确')
    cursor, rows, seen, total = '', [], set(), None
    for _ in range(_MAX_PAGES):
        data = _data(request_json('playlist/detail', {'playlist_id': playlist_id, 'cursor': cursor, 'count': _PAGE_SIZE}))
        meta = data.get('playlist') or data.get('playlist_info') or {}
        if not isinstance(meta, dict) or str(meta.get('id') or meta.get('playlist_id') or '') != playlist_id:
            raise ValueError('汽水返回的歌单标识不匹配，请稍后重试')
        batch = _media(data)
        before = len(rows)
        for item in batch:
            row = _song(item)
            if row['id'] not in seen:
                seen.add(row['id'])
                rows.append(row)
        if 'count_tracks' in meta or (meta.get('resource_cnt') or {}).get('track_cnt') is not None:
            total = _count(meta)
        next_cursor = str(data.get('next_cursor') or data.get('nextCursor') or '')
        if next_cursor == '0':
            next_cursor = ''
        explicit = data.get('has_more', data.get('hasMore'))
        more = bool(explicit) if explicit is not None else (len(rows) < total if total is not None else bool(next_cursor))
        if more and (len(rows) == before or not next_cursor or next_cursor == cursor):
            raise ValueError('汽水歌单歌曲分页没有继续返回资料，请稍后重试')
        if not more and total is not None and len(rows) < total:
            raise ValueError('汽水歌单歌曲分页提前结束，请稍后重试')
        if not more or len(rows) >= offset + limit:
            selected = rows[offset:offset + limit]
            next_offset = offset + len(selected)
            return {'tracks': selected, 'total': max(total, len(rows)) if total is not None else (len(rows) if not more else None),
                    'hasMore': len(rows) > next_offset or more, 'nextOffset': next_offset}
        cursor = next_cursor
    raise ValueError('汽水歌单歌曲数量超出本次读取范围，请稍后重试')


def _song_key(song):
    if not isinstance(song, dict) or song.get('provider', song.get('source')) != 'qishui':
        raise ValueError('只能将汽水原版歌曲同步到汽水歌单')
    key = str(song.get('id') or '')
    if not re.fullmatch(r'[1-9]\d{0,24}', key):
        raise ValueError('汽水云同步需要原始歌曲 ID，请重新搜索后重试')
    return key


def _song_type(song):
    native = song.get('nativeMediaType')
    if not native:
        key = _song_key(song)
        track = (read_track(key, requester=request_json).get('track') or {})
        if str(track.get('id') or '') != key:
            raise ValueError('汽水未返回当前歌曲的有效原生资料，请重新搜索后同步')
        native = track.get('media_type')
    if native not in ('track', 'ugc_clip'):
        raise ValueError('当前汽水音源类型暂不支持云歌单同步')
    return native


def _find_song(playlist_id, key, account=None):
    offset = 0
    for _ in range(_MAX_PAGES):
        page = tracks(playlist_id, offset, 100, account)
        if any(row['id'] == key for row in page['tracks']):
            return True
        if not page['hasMore']:
            return False
        if page['nextOffset'] <= offset:
            raise ValueError('汽水歌单查询分页没有继续返回资料')
        offset = page['nextOffset']
    raise ValueError('汽水歌单歌曲数量超出本次同步查询范围')


def memberships(song, account=None):
    key, rows = _song_key(song), []
    matched_song = dict(song, nativeMediaType=_song_type(song))
    for playlist in catalog(account)['playlists']:
        if playlist.get('editable') and _find_song(playlist['id'], key, account):
            rows.append(dict(playlist, matchedSong=matched_song))
    return {'playlists': rows, 'total': len(rows)}


def mutate(playlist_id, song, operation, account=None):
    if operation not in ('add', 'remove'):
        raise ValueError('汽水歌单同步操作必须为 add 或 remove')
    key = _song_key(song)
    target = next((row for row in catalog(account)['playlists'] if row['id'] == str(playlist_id)), None)
    if not target or not target.get('editable'):
        raise ValueError('该汽水歌单不属于当前账号的可编辑歌单')
    if not target.get('canAdd' if operation == 'add' else 'canRemove'):
        raise ValueError(target.get('removeMessage') or '该汽水歌单暂不支持此操作')
    media_type = _song_type(song)
    existing = _find_song(target['id'], key, account)
    if (operation == 'add' and existing) or (operation == 'remove' and not existing):
        return {'ok': True, 'success': True, 'verified': True, 'changed': False, 'provider': 'qishui', 'playlistId': target['id'], 'operation': operation}
    write_library(operation, target['id'], key, liked=bool(target['isLiked']), media_type=media_type)
    for attempt in range(3):
        if attempt:
            time.sleep(1)
        try:
            if _find_song(target['id'], key, account) == (operation == 'add'):
                return {'ok': True, 'success': True, 'verified': True, 'changed': True, 'provider': 'qishui', 'playlistId': target['id'], 'operation': operation}
        except (QishuiError, ValueError, OSError):
            continue
    raise ValueError('汽水已收到同步请求，但云端回读尚未确认，请刷新歌单后检查')

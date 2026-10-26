"""酷狗个人歌单与歌曲的只读访问；签名及凭据只在服务端使用。"""

import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from music_app.core import request_credentials


_HOST = 'https://gateway.kugou.com'
_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
_PAGE_SIZE = 50
_MAX_PAGES = 1000


def _number(value, default=None):
    try:
        result = int(value)
        return result if result >= 0 else default
    except (ValueError, TypeError):
        return default


def _text(value):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value or ''))).strip()


def _credentials():
    from .transport import kg_cookie_fields
    fields = kg_cookie_fields()
    raw, uid, token = fields['raw'], fields['uid'], fields['cloud_token']
    if not re.fullmatch(r'[1-9]\d{0,24}', uid) or not token:
        raise ValueError('酷狗登录资料不完整，请重新登录后加载个人歌单')
    if any(char in raw for char in '\r\n\0'):
        raise ValueError('酷狗登录资料格式异常，请重新登录')
    mid = fields['mid']
    mid = mid or hashlib.md5(('mineradio-kugou:' + uid).encode()).hexdigest()
    dfid = fields['dfid'] or '-'
    return {'uid': uid, 'token': token, 'web_token': fields['token'], 'mid': mid, 'dfid': dfid, 'raw': raw}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('酷狗个人歌单服务返回了不支持的跳转')


def _request(route, body, credentials=None):
    if route not in ('/v7/get_all_list', '/v4/get_list_all_file'):
        raise ValueError('不支持的酷狗个人歌单读取接口')
    return _gateway(route, body, credentials)


def _gateway(route, body, credentials=None, extra=None):
    auth = credentials or _credentials()
    now = int(time.time() * 1000)
    params = {'srcappid': '2919', 'clientver': '20000', 'clienttime': now,
              'mid': auth['mid'], 'uuid': auth['mid'], 'dfid': auth['dfid'], 'appid': 1014,
              'token': auth['token'], 'userid': int(auth['uid']), 'plat': 1}
    params.update(extra or {})
    body_text = json.dumps(body, ensure_ascii=False, separators=(',', ':'))
    signed = ''.join('%s=%s' % (key, params[key]) for key in sorted(params)) + body_text
    params['signature'] = hashlib.md5((_SALT + signed + _SALT).encode('utf-8')).hexdigest()
    request = urllib.request.Request(_HOST + route + '?' + urllib.parse.urlencode(params),
        data=body_text.encode('utf-8'), headers={
            'Content-Type': 'application/json', 'Cookie': auth['raw'],
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36',
            'Referer': 'https://www.kugou.com/', 'x-router': 'cloudlist.service.kugou.com'})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=20) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError()
        result = json.loads(raw)
    except (OSError, ValueError, UnicodeError):
        raise OSError('酷狗个人歌单请求失败或响应异常，请稍后重试') from None
    from .session_status import observe
    observe(auth['raw'], result)
    if not isinstance(result, dict) or result.get('status') not in (1, '1'):
        error = ValueError('酷狗未接受个人歌单请求，请检查登录是否过期')
        error.upstream_code = result.get('error_code') if isinstance(result,dict) else None
        raise error
    if result.get('error_code', 0) not in (0, '0', None):
        error = ValueError('酷狗个人歌单读取失败，请重新登录或稍后重试')
        error.upstream_code = result.get('error_code')
        raise error
    data = result.get('data')
    if not isinstance(data, dict):
        raise ValueError('酷狗个人歌单响应缺少必要数据')
    return data


def _list_id(value):
    value = str(value or '')
    match = re.fullmatch(r'collection_\d+_\d+_(\d+)_\d+', value)
    if match:
        value = match[1]
    if not re.fullmatch(r'[1-9]\d{0,24}', value):
        raise ValueError('酷狗歌单 ID 格式不正确')
    return value


def _playlist(item, kind):
    if not isinstance(item, dict):
        raise ValueError('酷狗歌单资料格式异常')
    # list_create_listid belongs to the original owner and can collide with a
    # local default list; listid is the current account's unique library key.
    raw_id = item.get('listid') or item.get('list_id') or item.get('global_collection_id') or item.get('list_create_listid') or item.get('specialid') or item.get('id')
    playlist_id = _list_id(raw_id)
    name = _text(item.get('name') or item.get('listname') or item.get('specialname') or item.get('title'))
    if not name:
        raise ValueError('酷狗歌单缺少名称')
    liked = kind == 'liked' or item.get('is_def') in (2, '2')
    liked = liked or (kind != 'collected' and item.get('type') not in (1, '1') and bool(re.search(r'我喜欢|liked music|my favorites?', name, re.I)))
    kind = 'liked' if liked else kind
    editable = item.get('type') not in (1, '1')
    return {'id': playlist_id, 'provider': 'kugou', 'source': 'kugou', 'type': 'playlist',
            'name': name, 'cover': str(item.get('pic') or item.get('img') or item.get('imgurl') or item.get('sizable_cover') or '').replace('{size}', '240'),
            'trackCount': next((_number(item[k]) for k in ('count', 'm_count', 'song_count', 'total', 'list_count') if _number(item.get(k)) is not None), 0),
            'kind': kind, 'isLiked': liked,
            'editable': editable, 'canAdd': editable, 'canRemove': editable,
            'creator': _text(item.get('nickname') or item.get('username') or item.get('list_create_username'))}


def _catalog_rows(data):
    info = data.get('info', data)
    if isinstance(info, list):
        return [(item, 'collected' if item.get('type') in (1, '1') or item.get('is_def') in (1, '1') else 'created') for item in info]
    if info is None and _number(data.get('list_count')) == 0:
        return []
    if not isinstance(info, dict):
        raise ValueError('酷狗个人歌单目录格式异常')
    rows, found = [], False
    for name, kind in (('collect', 'collected'), ('love', 'liked'), ('self', 'created'), ('list', 'created')):
        if name in info:
            if not isinstance(info[name], list):
                raise ValueError('酷狗个人歌单分组格式异常')
            found = True
            rows.extend((item, kind) for item in info[name])
    if info is not data and isinstance(data.get('list'), list):
        found = True
        rows.extend((item, 'created') for item in data['list'])
    if not found:
        raise ValueError('酷狗个人歌单响应缺少列表')
    return rows


def catalog(account=None):
    """逐页读取创建、收藏及默认喜欢列表，不把第一页视作完整目录。"""
    auth, rows, seen = _credentials(), [], set()
    for page in range(1, _MAX_PAGES + 1):
        data = _request('/v7/get_all_list', {'userid': int(auth['uid']), 'token': auth['token'],
            'total_ver': 979, 'type': 2, 'page': page, 'pagesize': _PAGE_SIZE}, auth)
        batch = _catalog_rows(data)
        added = 0
        for item, kind in batch:
            row = _playlist(item, kind)
            if row['id'] not in seen:
                seen.add(row['id'])
                rows.append(row)
                added += 1
            elif row['isLiked']:
                existing = next(row_ for row_ in rows if row_['id'] == row['id'])
                existing.update(kind='liked', isLiked=True)
        total = next((_number(data[k]) for k in ('total', 'total_count', 'list_count', 'count') if _number(data.get(k)) is not None), None)
        explicit_more = data.get('has_more', data.get('hasMore'))
        more = bool(explicit_more) if explicit_more is not None else (len(rows) < total if total is not None else len(batch) >= _PAGE_SIZE)
        if not more:
            if total is not None and total > len(rows):
                raise ValueError('酷狗个人歌单分页提前结束，请稍后重试')
            return {'playlists': rows, 'total': len(rows), 'hasMore': False, 'nextOffset': len(rows)}
        if not added:
            raise ValueError('酷狗个人歌单分页没有继续返回资料，请稍后重试')
    raise ValueError('酷狗个人歌单数量超出本次读取范围，请稍后重试')


def _song(item):
    from music_app.web.songs import song_row
    if not isinstance(item, dict):
        raise ValueError('酷狗歌单歌曲资料格式异常')
    singers = item.get('singerinfo') or item.get('Singers') or []
    artist = ' / '.join(_text(x.get('name') or x.get('SingerName')) for x in singers if isinstance(x, dict))
    artist = artist or _text(item.get('SingerName') or item.get('singer'))
    name = _text(item.get('name') or item.get('SongName') or item.get('filename'))
    name = re.sub(r'\.(mp3|flac|m4a|wav|ape|ogg)$', '', name, flags=re.I)
    if artist and name.startswith(artist):
        name = re.sub(r'^[\s\-–—]+', '', name[len(artist):]) or name
    key = str(item.get('hash') or item.get('FileHash') or item.get('mixsongid') or item.get('album_audio_id') or '')
    if not key or not name:
        raise ValueError('酷狗歌单歌曲缺少标识或名称')
    album = item.get('albuminfo') or {}
    row = {**item, 'id': key, 'title': name, 'artist': artist,
        'album': _text(album.get('name') or item.get('album_name') or item.get('AlbumName')),
        'album_id': str(album.get('id') or item.get('album_id') or item.get('AlbumID') or ''),
        'cover': str(item.get('cover') or item.get('img') or item.get('Image') or (item.get('trans_param') or {}).get('union_cover') or '').replace('{size}', '240'),
        'duration_s': item.get('duration') or item.get('Duration') or float(item.get('timelen') or 0) / 1000}
    row.update(id=key, title=name, artist=artist)
    result = song_row(row, 'kugou')
    file_id = item.get('fileid', item.get('file_id'))
    if file_id is not None:
        result['fileId'] = str(file_id)
    for target, names in (('mixSongId', ('mixsongid', 'MixSongID', 'album_audio_id')),
                           ('albumAudioId', ('album_audio_id', 'EMixSongID', 'mixsongid'))):
        result[target] = next((str(item[key]) for key in names if item.get(key)), '')
    return result


def tracks(playlist_id, offset=0, limit=100, account=None):
    """按固定上游页宽读取任意窗口，跨页时继续请求且保留真实总数。"""
    playlist_id = _list_id(playlist_id)
    if not isinstance(offset, int) or not isinstance(limit, int) or offset < 0 or not 1 <= limit <= 1000:
        raise ValueError('酷狗歌单分页参数不正确')
    auth, result, total = _credentials(), [], None
    position, more = offset, False
    while len(result) < limit:
        page, in_page = divmod(position, _PAGE_SIZE)
        data = _request('/v4/get_list_all_file', {'listid': int(playlist_id), 'userid': int(auth['uid']),
            'area_code': 1, 'show_relate_goods': 0, 'pagesize': _PAGE_SIZE, 'allplatform': 1,
            'show_cover': 1, 'type': 0, 'token': auth['token'], 'page': page + 1}, auth)
        batch = next((data[k] for k in ('info', 'songs', 'lists', 'file') if isinstance(data.get(k), list)), None)
        if batch is None and isinstance(data.get('info'), dict):
            batch = data['info'].get('file')
        # Empty native default collections return info:null with an explicit
        # zero count. A missing array without that proof remains an error.
        if batch is None and 'info' in data and data['info'] is None and _number(data.get('count')) == 0:
            batch = []
        if not isinstance(batch, list):
            raise ValueError('酷狗歌单详情响应缺少歌曲列表')
        total = next((_number(data[k]) for k in ('count', 'total', 'total_count') if _number(data.get(k)) is not None), total)
        page_end = page * _PAGE_SIZE + len(batch)
        if not batch and total is not None and position < total:
            raise ValueError('酷狗歌单歌曲分页提前结束，请稍后重试')
        take = batch[in_page:in_page + limit - len(result)]
        result.extend(_song(item) for item in take)
        position += len(take)
        more = position < total if total is not None else len(batch) >= _PAGE_SIZE
        if not take or not more or len(batch) < _PAGE_SIZE:
            if total is not None and page_end < total and len(batch) < _PAGE_SIZE:
                raise ValueError('酷狗歌单歌曲分页不完整，请稍后重试')
            break
    if total is None and not more:
        total = position
    return {'tracks': result, 'total': total, 'hasMore': more, 'nextOffset': position}


def _song_key(song):
    if not isinstance(song, dict) or song.get('provider', song.get('source')) != 'kugou':
        raise ValueError('只能将酷狗原版歌曲同步到酷狗歌单')
    key = str(song.get('hash') or song.get('id') or '').lower()
    if not re.fullmatch(r'[a-f0-9]{32}', key):
        raise ValueError('酷狗云同步需要歌曲的原始文件 Hash，请重新搜索后重试')
    return key


def _editable_playlist(playlist_id, account=None):
    playlist_id = _list_id(playlist_id)
    target = next((row for row in catalog(account)['playlists'] if row['id'] == playlist_id), None)
    if not target or not target.get('editable'):
        raise ValueError('该酷狗歌单不属于当前账号的可编辑歌单')
    return target


def _find_song(playlist_id, key, account=None):
    offset = 0
    for _ in range(_MAX_PAGES):
        page = tracks(playlist_id, offset, 100, account)
        match = next((row for row in page['tracks'] if str(row.get('hash') or row['id']).lower() == key), None)
        if match:
            return match
        if not page['hasMore']:
            return None
        if page['nextOffset'] <= offset:
            raise ValueError('酷狗歌单查询分页没有继续返回资料')
        offset = page['nextOffset']
    raise ValueError('酷狗歌单歌曲数量超出本次同步查询范围')


def memberships(song, account=None):
    """只报告已在云端可编辑歌单中找到原始 Hash 的位置。"""
    key, rows = _song_key(song), []
    for playlist in catalog(account)['playlists']:
        if playlist.get('editable') and _find_song(playlist['id'], key, account):
            rows.append(playlist)
    return {'playlists': rows, 'total': len(rows)}


def _write(operation, playlist_id, song, credentials, existing=None):
    """固定的加歌/删歌协议；不会开放任意 gateway 路由。"""
    auth = credentials
    base = {'userid': int(auth['uid']), 'token': auth['token'], 'listid': int(playlist_id), 'list_ver': 0, 'type': 0}
    if operation == 'add':
        name = str(song.get('name') or song.get('title') or '').strip()
        if not name or len(name) > 1000:
            raise ValueError('酷狗云同步缺少有效歌曲名')
        try:
            duration_ms = round(float(song.get('duration') or 0) * 1000)
        except (TypeError, ValueError, OverflowError):
            raise ValueError('酷狗歌曲时长格式错误') from None
        if duration_ms < 0:
            raise ValueError('酷狗歌曲时长格式错误')
        resource = {'number': 1, 'name': name, 'hash': _song_key(song), 'size': 0,
                    'sort': 0, 'timelen': duration_ms, 'bitrate': 0,
                    'album_id': _number(song.get('albumId') or song.get('album_id'), 0),
                    'mixsongid': _number(song.get('mixSongId') or song.get('albumAudioId') or song.get('album_audio_id'), 0)}
        return _gateway('/v6/add_song', {**base, 'slow_upload': 1, 'scene': 'false;null', 'data': [resource]},
                        auth, {'last_time': int(time.time()), 'last_area': 'gztx'})
    if operation == 'remove':
        file_id = str((existing or {}).get('fileId') or '')
        if not re.fullmatch(r'[1-9]\d{0,24}', file_id):
            raise ValueError('酷狗未返回该歌曲在目标歌单中的文件标识，无法移除')
        return _gateway('/v4/delete_songs', {**base, 'data': [{'fileid': int(file_id)}]}, auth)
    raise ValueError('不支持的酷狗歌单同步操作')


def mutate(playlist_id, song, operation, account=None):
    if operation not in ('add', 'remove'):
        raise ValueError('酷狗歌单同步操作必须为 add 或 remove')
    key = _song_key(song)
    target = _editable_playlist(playlist_id, account)
    existing = _find_song(target['id'], key, account)
    if (operation == 'add' and existing) or (operation == 'remove' and not existing):
        return {'ok': True, 'success': True, 'verified': True, 'changed': False, 'provider': 'kugou', 'playlistId': target['id'], 'operation': operation}
    _write(operation, target['id'], song, _credentials(), existing)
    for attempt in range(3):
        if attempt:
            time.sleep(0.25)
        try:
            present = bool(_find_song(target['id'], key, account))
            if present == (operation == 'add'):
                return {'ok': True, 'success': True, 'verified': True, 'changed': True, 'provider': 'kugou', 'playlistId': target['id'], 'operation': operation}
        except (ValueError, OSError):
            continue
    raise ValueError('酷狗已收到同步请求，但云端回读尚未确认，请刷新歌单后检查')

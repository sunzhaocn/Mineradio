"""酷狗歌手资料、按热度排序的单曲及旧歌曲的原生歌手标识解析。"""

import hashlib
import json
import math
import re
import time
import urllib.parse
import urllib.request

from music_app.providers.kugou import album, transport
from music_app.core import request_lifecycle


_PAGE_SIZE = 50
_HOT_ROUTE = '/openapi/kmr/v2/audio_group/author'


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('酷狗歌手服务返回了不支持的跳转')


def _read(request):
    request_lifecycle.check()
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=20) as response:
            raw = response.read(album._MAX_BYTES + 1)
        if len(raw) > album._MAX_BYTES:
            raise ValueError()
        request_lifecycle.check()
        return raw
    except (OSError, ValueError, UnicodeError):
        raise RuntimeError('酷狗歌手请求失败或响应异常，请稍后重试') from None


def _json(raw):
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError):
        raise RuntimeError('酷狗歌手响应格式异常，请稍后重试') from None
    if (not isinstance(result, dict) or result.get('status') not in (1, '1') or
            any(result.get(key, 0) not in (0, '0', None) for key in ('error_code', 'errcode'))):
        raise RuntimeError('酷狗未接受歌手请求，请稍后重试')
    return result


def _request(route, body):
    if route not in ('/kmr/v3/author', '/kmr/v2/audio', _HOT_ROUTE):
        raise ValueError('不支持的酷狗歌手读取接口')
    auth = transport.kg_cookie_fields()
    now = int(time.time())
    params = {'dfid': auth['dfid'] or '-', 'mid': auth['mid'] or album._GUEST_MID,
              'uuid': '-', 'appid': 1005, 'clientver': 20489, 'clienttime': now}
    if auth['token']:
        params['token'] = auth['token']
    if re.fullmatch(r'[1-9]\d{0,24}', auth['uid']):
        params['userid'] = auth['uid']
    is_get = route == _HOT_ROUTE
    body_text = '' if is_get else json.dumps(body, ensure_ascii=False, separators=(',', ':'))
    if is_get:
        params.update(body)
    signed = ''.join('%s=%s' % (key, params[key]) for key in sorted(params)) + body_text
    params['signature'] = hashlib.md5((album._SALT + signed + album._SALT).encode()).hexdigest()
    headers = {'Content-Type': 'application/json', 'kg-tid': '238' if route == '/kmr/v2/audio' else '36',
               'mid': params['mid'], 'dfid': params['dfid'], 'clienttime': str(now),
               'Referer': 'https://www.kugou.com/',
               'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi'}
    # The prefixed GET route is routed by the gateway itself. Sending x-router
    # there makes the otherwise valid hot-song request fail with HTTP 502.
    if not is_get:
        headers['x-router'] = 'openapi.kugou.com'
    if auth['raw']:
        headers['Cookie'] = auth['raw']
    request = urllib.request.Request(album._HOST + route + '?' + urllib.parse.urlencode(params),
        data=None if is_get else body_text.encode('utf-8'), headers=headers)
    return _json(_read(request))


def _native_id(value, label='歌手'):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError('酷狗%s ID 格式不正确' % label)
    value = str(value).strip()
    if not re.fullmatch(r'[1-9]\d{0,24}', value):
        raise ValueError('酷狗%s ID 格式不正确' % label)
    return value


def _references(authors):
    if not isinstance(authors, list):
        raise RuntimeError('酷狗歌曲歌手资料格式异常')
    result, seen = [], set()
    for row in authors:
        if not isinstance(row, dict):
            continue
        base = row.get('base', row)
        if not isinstance(base, dict):
            continue
        key = str(base.get('author_id') or '')
        name = album._text(base.get('author_name'))
        if re.fullmatch(r'[1-9]\d{0,24}', key) and name and key not in seen:
            result.append({'id': key, 'mid': '', 'name': name})
            seen.add(key)
    return result


def _metadata(artist_id):
    row = _request('/kmr/v3/author', {'author_id': artist_id}).get('data')
    if row == {} or row == [] or row is None:
        # A genuinely absent author returns status=1 and data={} on this API.
        if row is None:
            raise RuntimeError('酷狗歌手响应缺少资料')
        raise FileNotFoundError('未找到该酷狗歌手，或歌手资料已下架')
    if (not isinstance(row, dict) or str(row.get('author_id')) != artist_id or
            not album._text(row.get('author_name'))):
        raise RuntimeError('酷狗歌手响应资料不完整')
    alias = row.get('alias') or row.get('author_alias') or []
    if isinstance(alias, str):
        alias = [alias]
    if not isinstance(alias, list):
        raise RuntimeError('酷狗歌手别名格式异常')
    alias = list(dict.fromkeys(album._text(name) for name in alias if isinstance(name, str) and album._text(name)))
    intro = album._text(row.get('intro'))
    if not intro and isinstance(row.get('long_intro'), list):
        intro = '\n\n'.join(album._text(part.get('content')) for part in row['long_intro']
                            if isinstance(part, dict) and part.get('title') == '简介')
    return {'id': artist_id, 'mid': '', 'name': album._text(row['author_name']),
            'avatar': album._cover(row.get('sizable_avatar') or row.get('avatar')),
            'description': intro, 'alias': alias, 'song_count': album._number(row.get('song_count'))}


def _track_page(artist_id, page):
    response = _request(_HOT_ROUTE, {'author_id': artist_id, 'area_code': 'all', 'sort': 1,
        'page': page, 'pagesize': _PAGE_SIZE, 'replace_api_version': 1, 'mvdata_need': 1,
        'show_audio_honor': 1, 'show_audio_tag': 1, 'replace_need': 1})
    data = response.get('data')
    if not isinstance(data, dict) or not isinstance(data.get('songs'), list):
        raise RuntimeError('酷狗歌手响应缺少热门歌曲列表')
    total = album._number(data.get('total'))
    if total is None:
        raise RuntimeError('酷狗歌手歌曲总数格式异常')
    batch = data['songs']
    expected = min(_PAGE_SIZE, max(0, total - (page - 1) * _PAGE_SIZE))
    if len(batch) != expected:
        raise RuntimeError('酷狗歌手歌曲分页不完整，请稍后重试')
    return batch, total


def _song(row, artist):
    if not isinstance(row, dict) or not isinstance(row.get('audio_info'), dict):
        raise RuntimeError('酷狗歌手歌曲资料格式异常')
    refs = _references(row.get('authors') or [])
    audio = row['audio_info']
    title = album._text(row.get('audio_name'))
    hash_ = str(audio.get('hash') or '')
    audio_id = str(row.get('album_audio_id') or '')
    if not title or not (hash_ or audio_id) or (hash_ and not re.fullmatch(r'[a-fA-F0-9]{32}', hash_)):
        raise RuntimeError('酷狗歌手歌曲缺少有效标识或名称')
    try:
        duration = float(audio.get('timelength') or 0) / 1000
        if not math.isfinite(duration) or duration < 0:
            raise ValueError()
    except (ValueError, TypeError, OverflowError):
        raise RuntimeError('酷狗歌手歌曲时长格式异常') from None
    names = [ref['name'] for ref in refs] or [album._text(row.get('author_name')) or artist['name']]
    singer = ' / '.join(names)
    album_id = str(row.get('album_id') or '')
    info = row.get('album_info') if isinstance(row.get('album_info'), dict) else {}
    goods = row.get('goods_info') if isinstance(row.get('goods_info'), dict) else {}
    return {'id': hash_ or audio_id, 'hash': hash_, 'title': title, 'name': title,
            'artist': singer, 'singer': singer, 'artists': names,
            'artist_id': refs[0]['id'] if refs else '', 'artist_refs': refs,
            'album': album._text(info.get('album_name')), 'album_id': album_id,
            'cover': album._cover(info.get('cover')), 'duration_s': duration, 'duration': duration,
            'hash_320': str(audio.get('hash_320') or ''), 'hash_sq': str(audio.get('hash_flac') or ''),
            'album_audio_id': audio_id, 'mixsongid': audio_id, 'emix_id': audio_id,
            'pay_type': goods.get('audio_pay_type'),
            'page': 'https://www.kugou.com/song/#' + urllib.parse.urlencode({'hash': hash_, 'album_id': album_id})}


def fetch_artist(artist_id, offset=0, limit=50):
    """按上游真实热度顺序返回歌曲窗口，不请求音频地址。"""
    artist_id = _native_id(artist_id)
    if type(offset) is not int or type(limit) is not int or offset < 0 or not 1 <= limit <= 1000:
        raise ValueError('酷狗歌手分页参数不正确')
    artist = _metadata(artist_id)
    first, total = _track_page(artist_id, 1)
    songs, position, end = [], offset, min(total, offset + limit)
    while position < end:
        page, within = divmod(position, _PAGE_SIZE)
        if page == 0:
            batch = first
        else:
            batch, current_total = _track_page(artist_id, page + 1)
            if current_total != total:
                raise RuntimeError('酷狗歌手曲目数量发生变化，请刷新后重试')
        take = batch[within:within + end - position]
        if not take:
            raise RuntimeError('酷狗歌手歌曲分页没有继续返回资料')
        songs.extend(_song(row, artist) for row in take)
        position += len(take)
    return {'code': 200, 'artist': artist, 'songs': songs, 'scope': 'hot', 'total': total,
            'offset': offset, 'limit': limit, 'has_more': offset + len(songs) < total}


def _song_entity(song_id):
    """只读取歌曲元数据，将 hash、原生曲目 ID 或 mixsong 编码映射成实体 ID。"""
    if isinstance(song_id, bool) or not isinstance(song_id, (str, int)):
        raise ValueError('酷狗歌曲 ID 格式不正确')
    song_id = str(song_id).strip()
    if re.fullmatch(r'[1-9]\d{0,24}', song_id):
        return song_id
    headers = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kugou.com/'}
    cookie = transport.kg_cookie_fields()['raw']
    if cookie:
        headers['Cookie'] = cookie
    if re.fullmatch(r'[a-fA-F0-9]{32}', song_id):
        response = _json(_read(urllib.request.Request(
            'https://mobiles.kugou.com/api/v3/song/info?' + urllib.parse.urlencode({'hash': song_id}), headers=headers)))
        data = response.get('data')
        if not isinstance(data, dict):
            raise RuntimeError('酷狗歌曲响应缺少元数据')
        rows = data.get('album')
        if not rows and not data:
            raise FileNotFoundError('未找到该酷狗歌曲的歌手资料')
        if not isinstance(rows, list):
            raise RuntimeError('酷狗歌曲响应缺少专辑曲目标识')
        entity = next((str(row.get('album_audio_id')) for row in rows if isinstance(row, dict)
                       and re.fullmatch(r'[1-9]\d{0,24}', str(row.get('album_audio_id') or ''))), '')
    elif re.fullmatch(r'[a-zA-Z0-9]{4,12}', song_id):
        raw = _read(urllib.request.Request('https://www.kugou.com/mixsong/' + song_id + '.html', headers=headers))
        text = raw.decode('utf-8', 'replace')
        match = re.search(r'\bvar\s+dataFromSmarty\s*=\s*', text)
        if not match:
            raise FileNotFoundError('未找到该酷狗歌曲的歌手资料')
        try:
            rows, _ = json.JSONDecoder().raw_decode(text[match.end():])
        except ValueError:
            raise RuntimeError('酷狗歌曲页面元数据格式异常') from None
        if not isinstance(rows, list):
            raise RuntimeError('酷狗歌曲页面元数据格式异常')
        row = next((row for row in rows if isinstance(row, dict) and row.get('encode_album_audio_id') == song_id), {})
        entity = str(row.get('mixsongid') or '')
    else:
        raise ValueError('酷狗歌曲 ID 格式不正确')
    if not re.fullmatch(r'[1-9]\d{0,24}', entity):
        raise FileNotFoundError('未找到该酷狗歌曲的歌手资料')
    return entity


def resolve_artist(song_id, name=''):
    """用原版歌曲元数据找原生歌手；同名多 ID 或多个歌手时交给调用方选择。"""
    from music_app.core.artists import select_reference
    entity_id = _song_entity(song_id)
    data = _request('/kmr/v2/audio', {'data': [{'entity_id': int(entity_id)}], 'fields': 'base,authors.base'}).get('data')
    if not isinstance(data, list):
        raise RuntimeError('酷狗歌曲歌手响应格式异常')
    rows = [row for row in data if isinstance(row, dict) and isinstance(row.get('base'), dict)
            and str(row['base'].get('album_audio_id') or '') == entity_id]
    if not rows:
        raise FileNotFoundError('未找到该酷狗歌曲的歌手资料')
    refs = _references(rows[0].get('authors') or [])
    if not name and len({row['id'] for row in refs}) > 1:
        raise FileNotFoundError('该歌曲包含多位酷狗歌手，请指定歌手名称')
    return select_reference(refs, name)

"""酷狗专辑资料与原版曲目，只调用固定的只读 HTTPS 接口。"""

import hashlib
import html
import json
import math
import re
import time
import urllib.parse
import urllib.request

from music_app.providers.kugou import transport
from music_app.core import request_lifecycle
from music_app.core.artists import fields as artist_fields


_HOST = 'https://gateway.kugou.com'
_SALT = 'OIlwieks28dk2k092lksi2UIkp'
# The live album_audio/lite gateway accepts 50, but rejects 100 with 20010.
_PAGE_SIZE = 50
_MAX_BYTES = 8 * 1024 * 1024
_FIELDS = ('album_id,album_name,publish_date,sizable_cover,intro,type,authors,'
           'author_name,publish_company')
_GUEST_MID = hashlib.md5(b'mineradio-kugou-public-albums').hexdigest()


def _text(value):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value or ''))).strip()


def _cover(value):
    value = str(value or '').replace('{size}', '480')
    if value.startswith('http://'):
        value = 'https://' + value[7:]
    return value


def _number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and re.fullmatch(r'\d+', value):
        return int(value)
    return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('酷狗专辑服务返回了不支持的跳转')


def _request(route, body):
    """凭据来自当前请求上下文，错误信息不包含 URL、Cookie 或原始响应。"""
    request_lifecycle.check()
    if route not in ('/kmr/v2/albums', '/v1/album_audio/lite'):
        raise ValueError('不支持的酷狗专辑读取接口')
    auth = transport.kg_cookie_fields()
    now = int(time.time())
    params = {'dfid': auth['dfid'] or '-', 'mid': auth['mid'] or _GUEST_MID,
              'uuid': '-', 'appid': 1005, 'clientver': 20489, 'clienttime': now}
    if auth['token']:
        params['token'] = auth['token']
    if re.fullmatch(r'[1-9]\d{0,24}', auth['uid']):
        params['userid'] = auth['uid']
    body_text = json.dumps(body, ensure_ascii=False, separators=(',', ':'))
    signed = ''.join('%s=%s' % (key, params[key]) for key in sorted(params)) + body_text
    params['signature'] = hashlib.md5((_SALT + signed + _SALT).encode('utf-8')).hexdigest()
    headers = {'Content-Type': 'application/json', 'x-router': 'openapi.kugou.com',
               'kg-tid': '255', 'mid': params['mid'], 'dfid': params['dfid'],
               'clienttime': str(now), 'Referer': 'https://www.kugou.com/',
               'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi'}
    if auth['raw']:
        headers['Cookie'] = auth['raw']
    request = urllib.request.Request(_HOST + route + '?' + urllib.parse.urlencode(params),
                                     data=body_text.encode('utf-8'), headers=headers)
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=20) as response:
            raw = response.read(_MAX_BYTES + 1)
        if len(raw) > _MAX_BYTES:
            raise ValueError()
        result = json.loads(raw)
    except (OSError, ValueError, UnicodeError):
        raise RuntimeError('酷狗专辑请求失败或响应异常，请稍后重试') from None
    request_lifecycle.check()
    if (not isinstance(result, dict) or result.get('status') not in (1, '1') or
            any(result.get(key, 0) not in (0, '0', None) for key in ('error_code', 'errcode'))):
        raise RuntimeError('酷狗未接受专辑请求，请稍后重试')
    return result


def _artists(row):
    authors = row.get('authors') or []
    if not isinstance(authors, list):
        raise RuntimeError('酷狗专辑歌手资料格式异常')
    names = [_text(author.get('author_name')) for author in authors if isinstance(author, dict)]
    names = list(dict.fromkeys(name for name in names if name))
    if not names and _text(row.get('author_name')):
        names = [_text(row['author_name'])]
    return names


def _metadata(album_id):
    response = _request('/kmr/v2/albums', {
        'data': [{'album_id': album_id}], 'is_buy': 0, 'fields': _FIELDS})
    rows = response.get('data')
    if not isinstance(rows, list):
        raise RuntimeError('酷狗专辑响应缺少专辑资料')
    if not rows or rows == [{}]:
        raise FileNotFoundError('未找到该酷狗专辑，或专辑已下架')
    row = next((row for row in rows if isinstance(row, dict) and str(row.get('album_id')) == album_id), None)
    if row is None or not _text(row.get('album_name')):
        raise RuntimeError('酷狗专辑响应资料不完整')
    artists = _artists(row)
    return {'id': album_id, 'mid': '', 'name': _text(row['album_name']),
            'artist': ' / '.join(artists), 'artists': artists,
            'cover': _cover(row.get('sizable_cover')), 'description': _text(row.get('intro')),
            'publish_time': _text(row.get('publish_date')), 'company': _text(row.get('publish_company')),
            'type': _text(row.get('type')), 'total': 0}


def _track_page(album_id, page):
    response = _request('/v1/album_audio/lite', {
        'album_id': album_id, 'is_buy': '', 'page': page, 'pagesize': _PAGE_SIZE})
    data = response.get('data')
    if not isinstance(data, dict) or not isinstance(data.get('songs'), list):
        raise RuntimeError('酷狗专辑响应缺少歌曲列表')
    total = _number(data.get('total', response.get('total')))
    if total is None or (response.get('total') is not None and _number(response['total']) != total):
        raise RuntimeError('酷狗专辑歌曲总数格式异常')
    batch = data['songs']
    expected = min(_PAGE_SIZE, max(0, total - (page - 1) * _PAGE_SIZE))
    if len(batch) != expected:
        raise RuntimeError('酷狗专辑歌曲分页不完整，请稍后重试')
    return batch, total


def _song(row, album):
    if not isinstance(row, dict):
        raise RuntimeError('酷狗专辑歌曲资料格式异常')
    base, audio = row.get('base'), row.get('audio_info')
    if not isinstance(base, dict) or not isinstance(audio, dict):
        raise RuntimeError('酷狗专辑歌曲缺少必要资料')
    title = _text(base.get('audio_name'))
    hash_ = str(audio.get('hash') or audio.get('hash_128') or '')
    audio_id = str(base.get('album_audio_id') or '')
    if not title or not (hash_ or audio_id):
        raise RuntimeError('酷狗专辑歌曲缺少标识或名称')
    if hash_ and not re.fullmatch(r'[a-fA-F0-9]{32}', hash_):
        raise RuntimeError('酷狗专辑歌曲 Hash 格式异常')
    album_id = str(base.get('album_id') or album['id'])
    if album_id != album['id']:
        raise RuntimeError('酷狗返回了其他专辑的歌曲')
    artists = _artists(row) or ([_text(base.get('author_name'))] if _text(base.get('author_name')) else album['artists'])
    try:
        duration = float(audio.get('duration') or 0) / 1000
        if not math.isfinite(duration) or duration < 0:
            raise ValueError()
    except (ValueError, TypeError, OverflowError):
        raise RuntimeError('酷狗专辑歌曲时长格式异常') from None
    info = row.get('album_info') if isinstance(row.get('album_info'), dict) else {}
    trans = row.get('trans_param') if isinstance(row.get('trans_param'), dict) else {}
    copyright_ = row.get('copyright') if isinstance(row.get('copyright'), dict) else {}
    deprecated = row.get('deprecated') if isinstance(row.get('deprecated'), dict) else {}
    artist = ' / '.join(artists)
    return {'id': hash_ or audio_id, 'hash': hash_, 'title': title, 'name': title,
            'artist': artist, 'singer': artist, 'artists': artists,
            **artist_fields(row.get('authors')),
            'album': _text(info.get('album_name')) or album['name'], 'album_id': album_id,
            'cover': _cover(info.get('cover') or trans.get('union_cover')) or album['cover'],
            'duration_s': duration, 'duration': duration,
            'hash_320': str(audio.get('hash_320') or ''), 'hash_sq': str(audio.get('hash_flac') or ''),
            'album_audio_id': audio_id, 'mixsongid': audio_id, 'emix_id': audio_id,
            'privilege': copyright_.get('privilege'), 'pay_type': deprecated.get('pay_type'),
            'page': 'https://www.kugou.com/song/#' + urllib.parse.urlencode({'hash': hash_, 'album_id': album_id})}


def fetch_album(album_id, offset=0, limit=100):
    """读取专辑及指定曲目窗口；保留唱片顺序，不请求播放地址。"""
    if isinstance(album_id, bool) or not isinstance(album_id, (str, int)):
        raise ValueError('酷狗专辑 ID 格式不正确')
    album_id = str(album_id).strip()
    if not re.fullmatch(r'[1-9]\d{0,24}', album_id):
        raise ValueError('酷狗专辑 ID 格式不正确')
    if (type(offset) is not int or type(limit) is not int or offset < 0 or not 1 <= limit <= 1000):
        raise ValueError('酷狗专辑分页参数不正确')
    album = _metadata(album_id)
    # The gateway rejects pages beyond the album end. Read its first page to
    # establish the true total before requesting an arbitrary offset.
    first, total = _track_page(album_id, 1)
    album['total'] = total
    songs, position = [], offset
    end = min(total, offset + limit)
    while position < end:
        page, in_page = divmod(position, _PAGE_SIZE)
        if page == 0:
            batch = first
        else:
            batch, current_total = _track_page(album_id, page + 1)
            if current_total != total:
                raise RuntimeError('酷狗专辑曲目数量发生变化，请刷新后重试')
        take = batch[in_page:in_page + end - position]
        if not take:
            raise RuntimeError('酷狗专辑歌曲分页没有继续返回资料')
        songs.extend(_song(row, album) for row in take)
        position += len(take)
    return {'code': 200, 'album': album, 'songs': songs, 'total': total,
            'offset': offset, 'limit': limit, 'has_more': offset + len(songs) < total}

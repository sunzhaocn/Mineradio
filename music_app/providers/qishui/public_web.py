"""Bounded official public H5 catalog/audio reads, independent of account SDKs.

Keyword queries filter only the small official directory already returned by
song pages. They are never sent to a fabricated search endpoint. Signed media
URLs stay unchanged and in memory; no user Cookie or account header is used.
"""
import copy
import json
import math
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque

from .client import QishuiError

ENDPOINT = 'https://beta-luna.douyin.com/luna/h5/seo_track'
SEED_TRACK_ID = '7634441185327745025'
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_PROBE_BYTES = 128 * 1024
MAX_AUDIO_BYTES = 128 * 1024 * 1024
MAX_CATALOG = 128
MAX_CACHE = 64
CACHE_TTL = 90
CATALOG_TTL = 600
REQUESTS_PER_MINUTE = 24
TIMEOUT = 10
_ID = re.compile(r'[1-9][0-9]{0,24}\Z')
_SHARE_HOSTS = {'www.douyin.com', 'm.douyin.com', 'music.douyin.com',
                'www.qishui.com', 'qishui.com'}
_QUALITIES = ('medium', 'higher', 'highest')
_LOCK = threading.RLock()
_CATALOG_FETCH_LOCK = threading.Lock()
_METADATA = {}
_RESOLVED = {}
_CATALOG = {}
_REQUEST_TIMES = deque()


def _error(code, message, status=502):
    return QishuiError(status, 'qishui_public_' + code, message)


def _positive_number(value, maximum):
    return (not isinstance(value, bool) and isinstance(value, (int, float)) and
            0 < value <= maximum and math.isfinite(value))


def _text(value, limit=512):
    return value[:limit] if isinstance(value, str) else ''


def _url_parts(value):
    if (not isinstance(value, str) or not value or len(value) > 16384 or
            any(ord(c) <= 32 or ord(c) == 127 for c in value)):
        return None
    try:
        p = urllib.parse.urlsplit(value)
        if p.scheme != 'https' or p.port not in (None, 443) or p.username or p.password or p.fragment:
            return None
        return p
    except ValueError:
        return None


def allowed_audio_url(value):
    """Keep the original signed query; only the audited official CDN family."""
    p = _url_parts(value)
    host = (p.hostname or '').lower() if p else ''
    return bool(host == 'douyinvod.com' or host.endswith('.douyinvod.com'))


def parse_track_id(value):
    """Parse an exact numeric ID or official song/share URL without fetching it."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if _ID.fullmatch(value):
        return value
    p = _url_parts(value)
    if not p or (p.hostname or '').lower() not in _SHARE_HOSTS:
        return None
    match = re.fullmatch(r'/qishui/song/([1-9][0-9]{0,24})/?', p.path)
    if match:
        return match[1]
    if p.path.rstrip('/') in ('/qishui/share/track', '/qishui/share/song'):
        values = urllib.parse.parse_qs(p.query).get('track_id', [])
        if len(values) == 1 and _ID.fullmatch(values[0]):
            return values[0]
    return None


class _Redirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, media):
        super().__init__()
        self.media = media

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # The verified routes return direct resources. Do not spend an
        # uncounted redirect request or silently change the inspected resource.
        raise _error('redirect_rejected', '汽水公开资源跳转地址未确认')


def _request(url, *, media=False):
    if media and not allowed_audio_url(url):
        raise _error('media_url_invalid', '汽水公开音源地址无效')
    with _LOCK:
        now = time.monotonic()
        while _REQUEST_TIMES and now - _REQUEST_TIMES[0] >= 60:
            _REQUEST_TIMES.popleft()
        if len(_REQUEST_TIMES) >= REQUESTS_PER_MINUTE:
            raise _error('rate_limit', '公开目录请求过于频繁，请稍后重试', 429)
        _REQUEST_TIMES.append(now)
    headers = {'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity',
               'Accept': 'audio/mp4' if media else 'application/json'}
    if media:
        headers['Range'] = 'bytes=0-' + str(MAX_PROBE_BYTES - 1)
    # A fresh opener has no account Cookie processor or authorization handler.
    request = urllib.request.Request(url, headers=headers, method='GET')
    try:
        with urllib.request.build_opener(_Redirect(media)).open(request, timeout=TIMEOUT) as response:
            status = response.status
            if status not in ((200, 206) if media else (200,)):
                raise _error('upstream_status', '汽水公开资源暂时无法读取')
            if media and not allowed_audio_url(response.geturl()):
                raise _error('redirect_rejected', '汽水公开资源跳转地址无效')
            content_type = response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            if not media and content_type != 'application/json':
                raise _error('response_invalid', '汽水公开目录返回了验证页或异常内容')
            if media and content_type not in ('audio/mp4', 'video/mp4', 'application/mp4',
                                              'application/octet-stream'):
                raise _error('media_invalid', '汽水公开音源格式未确认')
            limit = MAX_PROBE_BYTES if media else MAX_JSON_BYTES
            length = response.headers.get('Content-Length')
            if length and (not length.isdecimal() or
                           int(length) > (MAX_AUDIO_BYTES if media else limit)):
                raise _error('response_too_large', '汽水公开资源超出读取限制')
            content_range = response.headers.get('Content-Range', '')
            if media and status == 206:
                found = re.fullmatch(r'bytes 0-([0-9]+)/([0-9]+)', content_range)
                if (not found or int(found[1]) >= int(found[2]) or
                        int(found[2]) > MAX_AUDIO_BYTES):
                    raise _error('media_invalid', '汽水音源范围响应无效')
            data = response.read(limit if media else limit + 1)
            if not data or len(data) > limit:
                raise _error('response_invalid', '汽水公开资源为空或超出读取限制')
            return data
    except QishuiError:
        raise
    except (OSError, ValueError, urllib.error.URLError):
        raise _error('network_failed', '汽水公开资源连接失败，请检查网络后重试') from None


def _safe_track(track, expected_id=None):
    if not isinstance(track, dict):
        raise _error('track_invalid', '汽水公开歌曲资料格式异常')
    track_id = str(track.get('id') or '')
    if not _ID.fullmatch(track_id) or expected_id and track_id != expected_id:
        raise _error('track_invalid', '汽水公开歌曲标识不一致')
    duration = track.get('duration')
    if not _positive_number(duration, 86400000) or not _text(track.get('name')):
        raise _error('track_invalid', '汽水公开歌曲缺少名称或时长')
    artists = []
    raw_artists = track.get('artists') or []
    if not isinstance(raw_artists, list):
        raise _error('track_invalid', '汽水公开歌手资料格式异常')
    for a in raw_artists[:20]:
        if isinstance(a, dict) and _text(a.get('name')):
            artists.append({k: _text(str(a.get(k) or '')) for k in ('id', 'name', 'simple_display_name')})
    album = track.get('album') if isinstance(track.get('album'), dict) else {}
    result = {'id': track_id, 'name': _text(track['name']), 'duration': int(duration),
              'media_type': 'track', 'artists': artists,
              'album': {'id': _text(str(album.get('id') or '')), 'name': _text(album.get('name'))}}
    cover = album.get('url_cover')
    if isinstance(cover, dict) and isinstance(cover.get('urls'), list):
        urls = []
        for u in cover['urls'][:4]:
            p = _url_parts(u)
            if p and not p.query and any((p.hostname or '').endswith('.' + d)
                                        for d in ('douyinpic.com', 'byteimg.com', 'qishui.com', 'pstatp.com')):
                urls.append(u)
        uri = _text(cover.get('uri'), 2048)
        if urls and re.fullmatch(r'[A-Za-z0-9_./~@:-]*', uri) and not uri.startswith('//'):
            result['album']['url_cover'] = {'urls': urls, 'uri': uri,
                'template_prefix': _text(cover.get('template_prefix'), 128)}
    labels = track.get('label_info')
    if isinstance(labels, dict):
        if any(k in labels and type(labels[k]) is not bool
               for k in ('only_vip_playable', 'only_vip_download', 'only_purchase_playable')):
            raise _error('track_invalid', '汽水公开播放限制格式异常')
        result['label_info'] = {k: labels[k] for k in ('only_vip_playable', 'only_vip_download',
                                                     'only_purchase_playable')
                                if type(labels.get(k)) is bool}
        for key in ('quality_only_vip_can_play', 'quality_only_vip_can_download'):
            if isinstance(labels.get(key), list):
                result['label_info'][key] = [v for v in labels[key][:10] if isinstance(v, str)][:10]
    for key in ('preview', 'audition_info', 'playable_range'):
        if isinstance(track.get(key), dict):
            result[key] = {k: v for k, v in track[key].items()
                           if k in ('start', 'duration', 'start_time_ms', 'duration_ms') and
                           _positive_number(v, 86400000)}
    if 'share_status' in track:
        result['share_status'] = track['share_status'] if type(track['share_status']) is int else -1
    # Unknown nonempty state needs interpretation before offering any media.
    result['hasUnresolvedState'] = bool(track.get('state'))
    # A digital sale needs its own entitlement contract; do not infer rights
    # from a public URL or interpret an unreviewed sale_period enum as access.
    result['hasUnresolvedDigitalTrack'] = bool(track.get('digital_track_info'))
    return result


def _remember_catalog(tracks):
    now = time.monotonic()
    with _LOCK:
        for key in list(_CATALOG):
            if _CATALOG[key][0] <= now:
                del _CATALOG[key]
        for track in tracks:
            _CATALOG[track['id']] = (now + CATALOG_TTL, copy.deepcopy(track))
        while len(_CATALOG) > MAX_CATALOG:
            del _CATALOG[next(iter(_CATALOG))]


def _cache_put(cache, key, value, ttl=CACHE_TTL):
    now = time.monotonic()
    with _LOCK:
        for old in list(cache):
            if cache[old][0] <= now:
                del cache[old]
        if len(cache) >= MAX_CACHE:
            del cache[next(iter(cache))]
        cache[key] = (now + max(0, ttl), copy.deepcopy(value))


def _cache_get(cache, key):
    with _LOCK:
        entry = cache.get(key)
        return copy.deepcopy(entry[1]) if entry and entry[0] > time.monotonic() else None


def _metadata(track_id):
    cached = _cache_get(_METADATA, track_id)
    if cached is not None:
        return cached
    raw = _request(ENDPOINT + '?' + urllib.parse.urlencode({'track_id': track_id, 'device_platform': 'web'}))
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get('status_code') not in (None, 0):
            raise ValueError()
        track = _safe_track((data.get('seo_track') or {}).get('track'), track_id)
        player = data.get('track_player') or {}
        model = player.get('video_model') or '{}'
        model = json.loads(model) if isinstance(model, str) else model
        if not isinstance(model, dict):
            raise ValueError()
        expires = [v for v in (player.get('expire_at'), model.get('url_expire'))
                   if _positive_number(v, time.time() + 7 * 86400)]
        expires_at = min(expires) if expires else 0
        lyric = data.get('lyric') or {}
        result = {'track': track, 'lyric': {'content': _text(lyric.get('content'), 262144),
                  'type': _text(lyric.get('type'), 32)}, 'model': model,
                  'expiresAt': expires_at,
                  'hasPlayAuth': bool(player.get('play_auth') or model.get('spade_a'))}
        catalog = [track]
        for name in ('chart_tracks', 'artist_tracks', 'related_tracks'):
            rows = data.get(name) or []
            if not isinstance(rows, list):
                continue
            for row in rows[:50]:
                try:
                    catalog.append(_safe_track(row.get('track')))
                except (QishuiError, AttributeError):
                    continue
        _remember_catalog(catalog[:MAX_CATALOG])
        ttl = min(CACHE_TTL, max(0, expires_at - time.time() - 10)) if expires_at else CACHE_TTL
        _cache_put(_METADATA, track_id, result, ttl)
        return result
    except (ValueError, TypeError, AttributeError):
        raise _error('response_invalid', '汽水公开歌曲资料格式异常') from None


def _clear_aac_duration(data):
    """Inspect a complete early moov inside a bounded prefix; never decrypt."""
    from .media.mp4 import _boxes, _one, _uint, _fullbox
    position, moov, ftyp = 0, None, False
    while position + 8 <= len(data):
        size = int.from_bytes(data[position:position + 4], 'big')
        kind = data[position + 4:position + 8]
        header = 8
        if size == 1:
            if position + 16 > len(data):
                raise ValueError()
            size, header = int.from_bytes(data[position + 8:position + 16], 'big'), 16
        if size < header or kind in (b'moof', b'pssh'):
            raise ValueError()
        if position + size > len(data):
            break
        if kind == b'ftyp':
            ftyp = size >= 16
        if kind == b'moov':
            moov = _boxes(data, position, position + size)[0]
            break
        if kind == b'mdat':
            break
        position += size
    if not ftyp or not moov:
        raise ValueError()
    movie = _boxes(data, moov.payload, moov.end)
    if any(b.kind in (b'pssh', b'mvex') for b in movie):
        raise ValueError()
    trak = _one(movie, b'trak')
    mdia = _one(_boxes(data, trak.payload, trak.end), b'mdia')
    media = _boxes(data, mdia.payload, mdia.end)
    handler = _one(media, b'hdlr')
    if data[handler.payload + 8:handler.payload + 12] != b'soun':
        raise ValueError()
    header = _one(media, b'mdhd')
    version, _ = _fullbox(data, header)
    if version not in (0, 1):
        raise ValueError()
    offset = header.payload + (20 if version == 1 else 12)
    scale = _uint(data, offset, 4, header.end)
    duration = _uint(data, offset + 4, 8 if version == 1 else 4, header.end)
    if not scale or not _positive_number(duration / scale, 86400):
        raise ValueError()
    minf = _one(media, b'minf')
    stbl = _one(_boxes(data, minf.payload, minf.end), b'stbl')
    tables = _boxes(data, stbl.payload, stbl.end)
    if any(b.kind in (b'senc', b'saio', b'saiz') for b in tables):
        raise ValueError()
    stsd = _one(tables, b'stsd')
    if _fullbox(data, stsd) != (0, 0) or _uint(data, stsd.payload + 4, 4, stsd.end) != 1:
        raise ValueError()
    entries = _boxes(data, stsd.payload + 8, stsd.end)
    if len(entries) != 1 or entries[0].kind != b'mp4a':
        raise ValueError()
    entry = entries[0]
    entry_version = _uint(data, entry.payload + 8, 2, entry.end)
    extension = {0: 0, 1: 16, 2: 36}.get(entry_version)
    if extension is None:
        raise ValueError()
    children = _boxes(data, entry.payload + 28 + extension, entry.end)
    if not any(b.kind == b'esds' for b in children) or any(b.kind == b'sinf' for b in children):
        raise ValueError()
    return round(duration / scale * 1000)


def resolve(value):
    """Return sanitized official track/lyric and independently checked AAC options."""
    track_id = parse_track_id(value)
    if track_id is None:
        raise _error('track_id_invalid', '请输入汽水数字歌曲 ID 或官方歌曲分享链接', 400)
    cached = _cache_get(_RESOLVED, track_id)
    if cached is not None:
        return cached
    metadata = _metadata(track_id)
    track, model = metadata['track'], metadata['model']
    result = {'track': track, 'lyric': metadata['lyric'], 'audio': [],
              'access': 'unknown', 'scope': 'public_catalog', 'playable': False}
    model_duration = model.get('video_duration')
    if (metadata['expiresAt'] <= time.time() + 10 or metadata['hasPlayAuth'] or
            model.get('status') != 10 or model.get('version') != 3 or
            model.get('media_type') != 'audio' or model.get('enable_ssl') is not True or
            not _positive_number(model_duration, 86400) or
            track.get('share_status') not in (None, 0) or track.get('hasUnresolvedState') or
            track.get('hasUnresolvedDigitalTrack')):
        return result
    videos = model.get('video_list')
    if not isinstance(videos, list):
        return result
    seen = set()
    for video in videos[:10]:
        if not isinstance(video, dict):
            continue
        meta = video.get('video_meta') or {}
        if not isinstance(meta, dict):
            continue
        key = meta.get('quality')
        encryption = video.get('encrypt_info')
        if (key not in _QUALITIES or key in seen or meta.get('vtype') != 'm4a' or
                meta.get('codec_type') != 'aac' or
                encryption and (not isinstance(encryption, dict) or encryption.get('encrypt') is not False) or
                any(video.get(k) for k in ('play_auth', 'spade_a', 'kid')) or
                not _positive_number(meta.get('size'), MAX_AUDIO_BYTES) or
                not _positive_number(meta.get('bitrate'), 3000000)):
            continue
        seen.add(key)
        url = video.get('main_url')
        if not allowed_audio_url(url):
            continue
        try:
            duration = _clear_aac_duration(_request(url, media=True))
        except QishuiError as error:
            result['reason'] = error.code
            continue
        except ValueError:
            result['reason'] = 'qishui_public_media_unverified'
            continue
        if abs(duration - model_duration * 1000) > 1000:
            continue
        total = track['duration']
        if duration < total - 1000:
            access = 'preview'
        elif abs(duration - total) <= 1000 and not any((track.get('label_info') or {}).get(k)
                for k in ('only_vip_playable', 'only_purchase_playable')):
            access = 'full_public'
        else:
            continue
        result['audio'].append({'key': key, 'quality': key, 'url': url,
            # An unprobed backup is not a verified substitute for a preview.
            'backupUrl': '', 'durationMs': duration,
            'expiresAt': metadata['expiresAt'], 'format': 'm4a', 'codec': 'aac',
            'bitrate': int(meta['bitrate']), 'size': int(meta['size']),
            'access': access, 'encrypted': False})
    result['playable'] = bool(result['audio'])
    if result['audio']:
        result.pop('reason', None)
        result['access'] = ('preview' if any(a['access'] == 'preview' for a in result['audio']) else 'full_public')
        ttl = min(CACHE_TTL, max(0, metadata['expiresAt'] - time.time() - 10))
        _cache_put(_RESOLVED, track_id, result, ttl)
    return result


def _song(track):
    from music_app.core.artists import fields as artist_fields
    album = track.get('album') or {}
    artist = ' / '.join(a['name'] for a in track['artists'])
    cover = album.get('url_cover') or {}
    urls = cover.get('urls') or []
    image = (urls[0] + cover.get('uri', '') + '~' +
             (cover.get('template_prefix') or 'tplv-b829550vbb') + '-crop-center:400:400.jpg') if urls else ''
    return {'platform': 'qishui', 'id': track['id'], 'song_id': track['id'], 'target': track['id'],
            'title': track['name'], 'name': track['name'], 'artist': artist, 'author': artist,
            'album': album.get('name', ''), 'album_id': album.get('id', ''),
            **artist_fields(track['artists']),
            'duration_s': track['duration'] / 1000, 'cover': image, 'nativeMediaType': 'track',
            'sourceScope': 'public_catalog', 'publicAccess': 'unknown'}


def catalog_search(query, page=1, size=20):
    """One initial directory read; bounded local filter or exact official ID import."""
    if (not isinstance(query, str) or len(query) > 2048 or type(page) is not int or
            type(size) is not int or not 1 <= page <= 128 or not 1 <= size <= 100):
        raise _error('query_invalid', '公开目录搜索参数无效', 400)
    query = query.strip()
    track_id = parse_track_id(query)
    if track_id:
        songs = [_song(_metadata(track_id)['track'])]
    else:
        if query.startswith(('https:', 'http:')) or query.isdecimal():
            raise _error('track_id_invalid', '请输入汽水数字歌曲 ID 或官方歌曲分享链接', 400)
        with _CATALOG_FETCH_LOCK:
            now = time.monotonic()
            with _LOCK:
                ready = any(expiry > now for expiry, _ in _CATALOG.values())
            if not ready:
                _metadata(SEED_TRACK_ID)
        now = time.monotonic()
        with _LOCK:
            tracks = [copy.deepcopy(track) for expiry, track in _CATALOG.values() if expiry > now]
        needle = query.casefold()
        songs = [_song(t) for t in tracks if needle in ' '.join((t['name'],
                 (t.get('album') or {}).get('name', ''), ' '.join(a['name'] for a in t['artists']))).casefold()]
    start, end = (page - 1) * size, page * size
    visible = songs[start:end]
    return {'keyword': query, 'page': page, 'size': size, 'songs': visible, 'count': len(visible),
            'total': len(songs), 'has_more': len(songs) > end, 'scope': 'public_catalog',
            'scopeNote': '仅筛选官方已返回的有限公开目录；可输入歌曲 ID 或官方分享链接。'}

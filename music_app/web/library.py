"""四平台个人音乐库的只读桥接、账号隔离与分页。

凭据由客户端随请求传入；缓存按凭据摘要隔离。
"""
import concurrent.futures
import copy
import importlib
import threading
import time

from music_app.core import request_credentials


PROVIDERS = ('netease', 'qq', 'kugou', 'qishui')
LABELS = dict(netease='网易云音乐', qq='QQ 音乐', kugou='酷狗音乐', qishui='汽水音乐')
MODULES = dict(netease='netease', qq='qqmusic', kugou='kugou', qishui='qishui')
_CACHE = {}
_PENDING = {}
_VERSIONS = {}
_LOCK = threading.Lock()
_TTL = 90
_ROUTES = {}
for _provider in PROVIDERS:
    _prefix = '/api' + ('' if _provider == 'netease' else '/' + _provider)
    _ROUTES[_prefix + '/user/playlists'] = (_provider, 'catalog')
    _ROUTES[_prefix + '/playlist/tracks'] = (_provider, 'tracks')


class LibraryError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def is_private_route(path):
    return path.startswith('/api/library/') or path in _ROUTES


def _provider(value):
    value = 'qq' if value == 'qqmusic' else value
    if value not in PROVIDERS:
        raise LibraryError('library_provider_invalid', '请选择网易云、QQ、酷狗或汽水音乐')
    return value


def _number(value, default, maximum=None):
    try:
        number = int(value if value not in (None, '') else default)
        if number < 0:
            raise ValueError
        return min(number, maximum) if maximum is not None else number
    except (ValueError, TypeError, OverflowError):
        raise LibraryError('library_page_invalid', '歌单分页参数无效') from None


def _snapshot(provider):
    fingerprint = request_credentials.fingerprint(MODULES[provider])
    return dict(provider=provider, configured=bool(fingerprint), loggedIn=False, userId=''), fingerprint


def _module(provider):
    return importlib.import_module('music_app.providers.' + MODULES[provider] + '.library')


def _cached(provider, operation, args=(), force=False):
    status, fingerprint = _snapshot(provider)
    if not status.get('configured') or not fingerprint:
        raise LibraryError('library_login_required', '请先登录' + LABELS[provider] + '，再刷新音乐库')
    with _LOCK:
        version = _VERSIONS.get((provider, fingerprint), 0)
        key = (provider, fingerprint, operation, args, version)
        # 多个客户端的缓存各自保留，凭据摘要只用于索引。
        cached = _CACHE.get(key)
        if not force and cached and time.monotonic() - cached[0] < _TTL:
            return copy.deepcopy(cached[1])
        future = _PENDING.get(key)
        owner = future is None
        if owner:
            future = concurrent.futures.Future()
            _PENDING[key] = future
    if not owner:
        return copy.deepcopy(future.result(timeout=120))
    try:
        module = _module(provider)
        if operation == 'catalog':
            result = module.catalog(account=status)
        elif operation == 'memberships':
            import json
            result = module.memberships(json.loads(args[0]), account=status)
        else:
            result = module.tracks(*args, account=status)
        if not isinstance(result, dict) or result.get('ok') is False:
            raise LibraryError('library_upstream_unavailable', LABELS[provider] + '的音乐库读取失败，请重试或重新登录')
        if _snapshot(provider)[1] != fingerprint:
            raise LibraryError('library_account_changed', '账号已切换，请刷新音乐库')
        with _LOCK:
            if _VERSIONS.get((provider, fingerprint), 0) != version:
                raise LibraryError('library_state_changed', '平台歌单已更新，请刷新后重试')
            _CACHE[key] = (time.monotonic(), copy.deepcopy(result))
            while len(_CACHE) > 256:
                _CACHE.pop(next(iter(_CACHE)))
        future.set_result(result)
        return copy.deepcopy(result)
    except Exception as error:
        future.set_exception(error)
        raise
    finally:
        with _LOCK:
            _PENDING.pop(key, None)


def _failure(provider, error):
    # 上游异常可能带签名 URL 或鉴权文本，不回传原始异常。
    known = isinstance(error, LibraryError)
    from music_app.core.session_health import LoginExpired
    if isinstance(error, LoginExpired) and error.provider == provider:
        return dict(ok=False, provider=provider, error='account_session_expired',
                    message=LABELS[provider] + '登录已失效，请重新登录', authState='expired', reauthRequired=True)
    if provider == 'kugou' and str(getattr(error, 'upstream_code', '')) == '20017':
        return dict(ok=False, provider=provider, error='account_session_expired',
                    message='酷狗登录已失效，请重新登录', authState='expired', reauthRequired=True)
    if provider == 'qishui':
        # This exception type only contains fixed, credential-free messages.
        # Keep missing device sessions/SDKs distinct from a temporary read
        # failure, so the UI does not tell every user to log in again.
        from music_app.providers.qishui.client import QishuiError
        known = known or isinstance(error, QishuiError)
    return dict(ok=False, provider=provider, error=error.code if known else 'library_upstream_unavailable',
                message=str(error) if known else LABELS[provider] + '的音乐库读取失败，请重试或重新登录')


def _catalog_provider(provider, force=False):
    status, _ = _snapshot(provider)
    summary = dict(provider=provider, configured=bool(status.get('configured')),
                   loggedIn=bool(status.get('loggedIn')))
    try:
        result = _cached(provider, 'catalog', force=force)
        rows = []
        seen = set()
        for row in result.get('playlists') or []:
            if not isinstance(row, dict) or row.get('id') in (None, ''):
                continue
            identifier = str(row['id'])
            if identifier in seen:
                continue
            seen.add(identifier)
            kind = row.get('kind') or ('liked' if row.get('isLiked') else 'collected')
            editable = bool(row.get('editable', kind in ('created', 'liked')))
            rows.append(dict(id=identifier, name=str(row.get('name') or '未命名歌单'),
                             cover=str(row.get('cover') or ''), trackCount=_number(row.get('trackCount'), 0),
                             provider=provider, kind=kind if kind in ('liked', 'created', 'collected') else 'collected',
                             isLiked=kind == 'liked' or bool(row.get('isLiked')), readonly=True,
                             creator=LABELS[provider], source=provider, shelfPane='mine', editable=editable,
                             canAdd=bool(row.get('canAdd', editable)), canRemove=bool(row.get('canRemove', editable)),
                             dirid=str(row.get('dirid') or ''), virtual=bool(row.get('virtual'))))
        summary.update(ok=True, message='', playlistCount=len(rows), libraryVerified=True)
        from .account_health import cached
        health = cached(provider)
        summary.update(authState=health['authState'], reauthRequired=health['reauthRequired'])
        return rows, summary
    except Exception as error:
        summary.update(_failure(provider, error))
        return [], summary


def catalog(provider=None, force=False):
    selected = (_provider(provider),) if provider else PROVIDERS
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(selected), thread_name_prefix='library') as executor:
        values = request_credentials.map_with_context(executor, lambda p: _catalog_provider(p, force), selected)
    rows, summaries = [], {}
    for p, (playlists, status) in zip(selected, values):
        rows.extend(playlists)
        summaries[p] = status
    return dict(ok=True, playlists=rows, providers=summaries, total=len(rows), hasMore=False,
                nextOffset=len(rows), partial=any(s['configured'] and not s['ok'] for s in summaries.values()))


def tracks(provider, identifier='', offset=0, limit=100, *, liked=False, force=False):
    provider = _provider(provider)
    offset, limit = _number(offset, 0), max(1, _number(limit, 100, 200))
    try:
        if liked:
            lists = _cached(provider, 'catalog', force=force).get('playlists') or []
            row = next((r for r in lists if r.get('isLiked') or r.get('kind') == 'liked'), None)
            if row is None:
                raise LibraryError('library_likes_missing', LABELS[provider] + '未返回喜欢歌单，请刷新或重新登录')
            identifier = str(row['id'])
        if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 512:
            raise LibraryError('library_id_invalid', '请选择有效的歌单')
        result = _cached(provider, 'tracks', (identifier, offset, limit), force)
        songs = result.get('tracks')
        if not isinstance(songs, list):
            raise LibraryError('library_tracks_invalid', '平台歌曲数据异常，请重试')
        # 平台适配器只返回网页歌曲字段；这里再做白名单，避免上游认证字段外泄。
        allowed = ('id', 'mid', 'hash', 'mediaMid', 'name', 'artist', 'artists', 'artistId', 'artistMid', 'album', 'albumId',
                   'albumMid', 'cover', 'duration', 'vipRequired', 'paid', 'qualityVip', 'qualityVipKeys',
                   'isOriginal', 'badges', 'nativeMediaType', 'playable', 'encrypted', 'decryption_supported')
        songs = [dict({k: row[k] for k in allowed if k in row}, provider=provider, source=provider, type='song')
                 for row in songs if isinstance(row, dict)]
        total = _number(result.get('total'), offset + len(songs))
        if songs:
            total = max(offset + len(songs), total)
        next_offset = _number(result.get('nextOffset'), offset + len(songs))
        has_more = bool(result.get('hasMore', next_offset < total))
        if has_more and next_offset <= offset:
            raise LibraryError('library_pagination_stalled', '平台分页未前进，请刷新后重试')
        return dict(ok=True, provider=provider, tracks=songs, total=total, nextOffset=next_offset,
                    hasMore=has_more, message='')
    except Exception as error:
        return dict(_failure(provider, error), tracks=[], total=0, hasMore=False, nextOffset=offset)


def dispatch(path, query):
    force = query.get('force', query.get('refresh')) == '1'
    try:
        if path == '/api/library/catalog':
            return catalog(query.get('provider'), force)
        if path in ('/api/library/tracks', '/api/library/likes'):
            return tracks(query.get('provider', ''), query.get('id', ''), query.get('offset', 0),
                          query.get('limit', 100), liked=path.endswith('/likes'), force=force)
        if path in _ROUTES:
            provider, operation = _ROUTES[path]
            if operation == 'catalog':
                return catalog(provider, force)
            return tracks(provider, query.get('id', ''), query.get('offset', 0), query.get('limit', 100), force=force)
    except LibraryError as error:
        return dict(ok=False, error=error.code, message=str(error), playlists=[], tracks=[])
    return dict(ok=False, error='library_route_missing', message='音乐库接口不存在')

"""由用户明确选择触发的云歌单同步；本机红心不调用这里。"""
import concurrent.futures
import hashlib
import json
import re
import threading

from music_app.core import request_credentials
from . import library

POST_ROUTES = ('/api/library/membership', '/api/library/mutate')
_WRITE_LOCKS = {}
_RESULTS = {}
_SONG_FIELDS = ('id', 'mid', 'hash', 'mediaMid', 'providerSongId', 'name', 'artist', 'album',
                'albumId', 'albumMid', 'cover', 'duration', 'qqId', 'songid', 'mixsongid', 'fileid',
                'mixSongId', 'albumAudioId', 'album_audio_id', 'nativeMediaType')


def _song(value, provider=None):
    if not isinstance(value, dict):
        raise library.LibraryError('library_song_invalid', '请选择有效的歌曲')
    selected = library._provider(value.get('provider') or value.get('source') or provider or '')
    if provider and selected != provider:
        raise library.LibraryError('library_song_provider_mismatch', '平台音源不匹配，请先匹配同一首歌的平台音源')
    result = {}
    for key in _SONG_FIELDS:
        item = value.get(key)
        if item is None:
            continue
        if not isinstance(item, (str, int, float)) or isinstance(item, bool):
            raise library.LibraryError('library_song_invalid', '歌曲资料格式不正确')
        if isinstance(item, str) and (len(item) > (8192 if key == 'cover' else 2048) or any(ord(c) < 32 for c in item)):
            raise library.LibraryError('library_song_invalid', '歌曲资料过长或格式不正确')
        result[key] = item
    native = (result.get('mid') if selected == 'qq' else result.get('hash') if selected == 'kugou' else '') or result.get('id')
    if not native or len(str(native)) > 256:
        raise library.LibraryError('library_song_invalid', '歌曲缺少本平台的原始标识')
    result.update(provider=selected, source=selected, id=str(result.get('id') or native))
    return result


def _candidate_map(payload):
    base = payload.get('song')
    if not isinstance(base, dict):
        raise library.LibraryError('library_song_invalid', '请选择有效的歌曲')
    values = [base]
    for field in ('_webFavoriteSources', '_webSearchSources'):
        nested = base.get(field, [])
        if isinstance(nested, list):
            values.extend(nested[:16])
    extra = payload.get('sources', [])
    if not isinstance(extra, list) or len(extra) > 16:
        raise library.LibraryError('library_song_invalid', '平台音源资料格式不正确')
    values.extend(extra)
    result = {}
    for value in values:
        song = _song(value)
        result.setdefault(song['provider'], song)
    return result


def _memberships_one(provider, sources, force):
    status, _ = library._snapshot(provider)
    summary = dict(provider=provider, configured=bool(status.get('configured')), playlists=[])
    if not status.get('configured'):
        return dict(summary, ok=True, message='')
    song = sources.get(provider)
    if not song:
        return dict(summary, ok=False, error='library_source_missing', message='尚未匹配到此平台的同一版本音源')
    try:
        serialized = json.dumps(song, sort_keys=True, ensure_ascii=True, separators=(',', ':'))
        result = library._cached(provider, 'memberships', (serialized,), force)
        rows = []
        for row in result.get('playlists') or []:
            if not isinstance(row, dict) or row.get('id') in (None, ''):
                continue
            rows.append(dict(id=str(row['id']), name=str(row.get('name') or '未命名歌单'), provider=provider,
                             kind=row.get('kind') or ('liked' if row.get('isLiked') else 'created'),
                             isLiked=bool(row.get('isLiked')), editable=bool(row.get('editable', True)),
                             canAdd=bool(row.get('canAdd', True)), canRemove=bool(row.get('canRemove', True)),
                             dirid=str(row.get('dirid') or ''), matchedSong=_song(row.get('matchedSong') or row.get('song') or song, provider)))
        return dict(summary, ok=True, playlists=rows, message='')
    except Exception as error:
        return dict(summary, **{k: v for k, v in library._failure(provider, error).items() if k != 'provider'})


def membership(payload):
    if set(payload) - {'song', 'sources', 'force'}:
        raise library.LibraryError('library_input_invalid', '音乐库请求包含不支持的字段')
    sources = _candidate_map(payload)
    force = payload.get('force') is True
    with concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix='membership') as executor:
        values = request_credentials.map_with_context(executor, lambda p: _memberships_one(p, sources, force), library.PROVIDERS)
    summaries = dict(zip(library.PROVIDERS, values))
    return dict(ok=True, providers=summaries, playlists=[row for value in values for row in value['playlists']],
                partial=any(not value['ok'] for value in values))


def _invalidate(provider, fingerprint):
    with library._LOCK:
        library._VERSIONS[(provider, fingerprint)] = library._VERSIONS.get((provider, fingerprint), 0) + 1
        for key in list(library._CACHE):
            if key[:2] == (provider, fingerprint):
                del library._CACHE[key]


def mutate(payload):
    if set(payload) - {'provider', 'id', 'operation', 'song', 'requestId'}:
        raise library.LibraryError('library_input_invalid', '音乐库请求包含不支持的字段')
    provider = library._provider(payload.get('provider', ''))
    operation, identifier = payload.get('operation'), payload.get('id')
    if operation not in ('add', 'remove') or not isinstance(identifier, str) or not identifier or len(identifier) > 512:
        raise library.LibraryError('library_action_invalid', '请选择有效的歌单操作')
    request_id = payload.get('requestId', '')
    if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', request_id):
        raise library.LibraryError('library_request_id_required', '操作标识缺失，请重新打开平台歌单菜单')
    song = _song(payload.get('song'), provider)
    status, fingerprint = library._snapshot(provider)
    if not status.get('configured'):
        raise library.LibraryError('library_login_required', '请先登录' + library.LABELS[provider])
    digest = hashlib.sha256(json.dumps([provider, identifier, operation, song], sort_keys=True, ensure_ascii=True).encode()).hexdigest()
    replay_key = (provider, fingerprint, request_id)
    with library._LOCK:
        write_lock = _WRITE_LOCKS.setdefault((provider, fingerprint), threading.Lock())
    with write_lock:
        with library._LOCK:
            previous = _RESULTS.get(replay_key)
        if previous:
            if previous[0] != digest:
                raise library.LibraryError('library_request_id_conflict', '操作标识已被另一项操作使用，请重新选择')
            return dict(previous[1])
        attempted = False
        try:
            rows = library._cached(provider, 'catalog', force=True).get('playlists') or []
            target = next((r for r in rows if str(r.get('id')) == identifier), None)
            if not target:
                raise library.LibraryError('library_playlist_missing', '歌单已失效或不属于当前账号，请刷新后选择')
            editable = target.get('editable', target.get('kind') in ('created', 'liked'))
            if not editable or not target.get('canAdd' if operation == 'add' else 'canRemove', editable):
                raise library.LibraryError('library_playlist_readonly', '当前歌单不支持此同步操作，请选择自己的可编辑歌单')
            attempted = True
            result = library._module(provider).mutate(identifier, song, operation, account=status)
            if not isinstance(result, dict) or result.get('ok') is not True:
                raise library.LibraryError('library_sync_unconfirmed', '平台同步尚未确认，请刷新平台状态后重试')
            response = dict(ok=True, provider=provider, playlistId=identifier, operation=operation,
                            message='已同步到' + library.LABELS[provider] if operation == 'add' else '已从' + library.LABELS[provider] + '歌单移除')
        except Exception as error:
            response = library._failure(provider, error)
        finally:
            if attempted:
                _invalidate(provider, fingerprint)
        with library._LOCK:
            _RESULTS[replay_key] = (digest, response)
            while len(_RESULTS) > 512:
                _RESULTS.pop(next(iter(_RESULTS)))
        return response


def dispatch(path, payload):
    try:
        return membership(payload) if path.endswith('/membership') else mutate(payload)
    except library.LibraryError as error:
        return dict(ok=False, error=error.code, message=str(error))

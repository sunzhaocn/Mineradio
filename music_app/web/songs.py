"""歌曲搜索结果转换、详情合并请求和解析缓存。"""
import concurrent.futures
from contextlib import nullcontext
import time

from music_app.core.labels import song_labels
from music_app.core.artists import web_fields
from music_app.core import request_credentials
from music_app.core import request_lifecycle
from . import client as _web_client
from . import constants as _web_constants
from . import state as _web_state


def seconds(value):
    if isinstance(value, str) and ':' in value:
        parts = value.split(':')
        return sum(float(v) * 60 ** i for i, v in enumerate(reversed(parts)))
    return float(value or 0)

def qishui_source_fields(row):
    """Expose the official public-source boundary, never session/signing fields."""
    return {name: row[name] for name in (
        'scope', 'sourceScope', 'publicPlayback', 'publicSearch', 'access', 'isPreview', 'preview',
        'previewDuration', 'previewDurationMs', 'originalDuration_s', 'durationMs', 'streamDuration',
        'playback_supported', 'publicError', 'message',
    ) if name in row}


def qishui_playback_duration(data, selected=None):
    """A public excerpt's playable length must not become the original song length."""
    selected = selected or {}
    fields = qishui_source_fields(data)
    fields.update(qishui_source_fields(selected))
    duration = seconds(selected.get('duration_s', selected.get('duration',
                       data.get('duration_s', data.get('duration')))))
    if fields.get('isPreview'):
        preview = seconds(fields.get('previewDuration'))
        if preview > 0:
            duration = min(duration, preview) if duration > 0 else preview
    return duration


def qishui_playback_fields(data, selected=None):
    fields = qishui_source_fields(data)
    fields.update(qishui_source_fields(selected or {}))
    duration = qishui_playback_duration(data, selected)
    fields.update(duration_s=duration, duration=duration)
    if 'isPreview' in fields and 'preview' in fields:
        fields['preview'] = fields['isPreview']
    if 'durationMs' in fields:
        fields['durationMs'] = round(duration * 1000)
    if 'streamDuration' in fields:
        fields['streamDuration'] = duration
    if 'previewDurationMs' in fields and 'previewDuration' in fields:
        fields['previewDurationMs'] = round(seconds(fields['previewDuration']) * 1000)
    return fields


def song_row(row, provider=None):
    """搜索简化格式/榜单聚合格式 -> Mineradio 的统一歌曲对象。"""
    source = (row.get('sources') or [{}])[0]
    provider = provider or {'qqmusic': 'qq'}.get(source.get('platform'), source.get('platform', 'netease'))
    key = str(source.get('key') or row.get('mid') or row.get('id') or row.get('hash') or '')
    result = dict(id=key, name=row.get('title') or row.get('name') or '',
                  artist=row.get('artist') or row.get('author') or row.get('singer') or '', album=row.get('album') or '',
                  cover=row.get('cover') or '', duration=seconds(row.get('duration_s', row.get('duration'))),
                  provider=provider, source=provider, type='song',
                  albumId=row.get('album_id') or '', albumMid=row.get('album_mid') or '')
    refs = row.get('artist_refs') or row.get('artists') or row.get('singers') or row.get('Singers') or row.get('singerinfo') or []
    result.update(web_fields(refs))
    if row.get('artist_id') or row.get('artistId'):
        result.setdefault('artistId', str(row.get('artist_id') or row.get('artistId')))
    if row.get('artist_mid') or row.get('artistMid'):
        result.setdefault('artistMid', str(row.get('artist_mid') or row.get('artistMid')))
    if provider == 'qq':
        result.update(mid=key, mediaMid=row.get('media_mid') or '')
    if provider == 'kugou':
        result.update(hash=key)
        native = str(row.get('album_audio_id') or row.get('mixsongid') or source.get('album_audio_id') or source.get('mixsongid') or '')
        result.update(albumAudioId=native, album_audio_id=native, mixSongId=native,
                      emix_id=str(row.get('emix_id') or source.get('emix_id') or ''))
    # 精简 API 已保留平台标签；榜单旧记录没有证据时保持未知，不从歌名推断。
    labels = song_labels(_web_constants.PROVIDERS.get(provider, provider), row)
    for name in ('vipRequired', 'paid', 'qualityVip', 'qualityVipKeys', 'isOriginal', 'badges'):
        result[name] = row.get(name, labels[name])
    if provider == 'qishui':
        for name in ('nativeMediaType', 'playable', 'encrypted', 'decryption_supported'):
            if name in row:
                result[name] = row[name]
        result.update(qishui_playback_fields(row))
    # Keep only upstream-provided classification; never guess a genre from a title.
    for name in ('genre', 'genres', 'tags', 'language', 'lang'):
        value = row.get(name)
        if isinstance(value, (str, list)) and value:
            result[name] = value
    with _web_state.LOCK:
        scope = request_credentials.fingerprint(provider)
        label_key = (provider, key, scope) if scope else (provider, key)
        _web_state.SONG_LABELS[label_key] = {k: result[k] for k in labels}
        if len(_web_state.SONG_LABELS) > 3000:
            _web_state.SONG_LABELS.pop(next(iter(_web_state.SONG_LABELS)))
    return result

def detail(provider, key, quality='auto', *, playback_only=False, allow_quality_fallback=False):
    # 一次取得整首歌的所有档位，选择时直接匹配原生 key；不把 Hi-Res 偷换成无损。
    request_lifecycle.check()
    with _web_state.LOCK:
        generation = _web_state.DETAIL_GENERATIONS.get(provider, 0)
        cache_key = (provider, key, generation) if generation else (provider, key)
        if playback_only:
            # 快速取播放地址不能等待同歌正在加载的完整歌词/音质详情。
            # 档位和回落开关也隔离，避免一次 auto 请求污染精确档位。
            cache_key = (*cache_key, 'playback', quality, bool(allow_quality_fallback))
        scope = request_credentials.fingerprint(provider)
        if scope:
            cache_key = (*cache_key, scope)
        cached = _web_state.DETAILS.get(cache_key)
        if cached and time.time() - cached[0] < 180:
            return cached[1]
        task_scope = request_lifecycle.scope() if playback_only else ''
        pending_key = (*cache_key, 'task', task_scope) if task_scope else cache_key
        future = _web_state.DETAIL_PENDING.get(pending_key)
        owner = future is None
        if owner:
            future = concurrent.futures.Future()
            _web_state.DETAIL_PENDING[pending_key] = future
    # 开始播放、音质菜单和歌词可能同时请求同一首歌，只解析一次，避免叠加上游耗时。
    if not owner:
        return future.result(timeout=90)
    try:
        # Complete details may have real subscribers from other GET sockets.
        # Their entire owner load must outlive any one consumer, including the
        # internal API read and cache publication. Fast owners are task-scoped.
        load_context = nullcontext() if playback_only else request_lifecycle.detached()
        with load_context:
            request_lifecycle.check()
            param = {'netease': 'id', 'qq': 'mid', 'kugou': 'hash', 'qishui': 'id'}[provider]
            arguments = dict(playback=1, lyric=0, allowQualityFallback=int(allow_quality_fallback)) if playback_only else {}
            data = _web_client.upstream('/song', platform=_web_constants.PROVIDERS[provider],
                quality=quality if playback_only else 'auto', **{param: key}, **arguments)
            request_lifecycle.check()
            with _web_state.LOCK:
                if _web_state.DETAIL_GENERATIONS.get(provider, 0) == generation:
                    _web_state.DETAILS[cache_key] = (time.time(), data)
                    if len(_web_state.DETAILS) > 200:
                        _web_state.DETAILS.pop(next(iter(_web_state.DETAILS)))
                    for url in [data.get('url'), data.get('backup_url')] + [q.get('url') for q in data.get('qualities', [])]:
                        if provider == 'qishui' and url and url.startswith('/qishui/audio?'):
                            url = _web_client.local_qishui_audio_url(url)
                        if url:
                            _web_state.AUDIO_URLS.add(url)
                            _web_state.AUDIO_URL_OWNERS.setdefault(url, set()).add(provider)
                            _web_state.AUDIO_SCOPES.setdefault(url, set()).add((provider, scope))
            future.set_result(data)
            return data
    except Exception as error:
        future.set_exception(error)
        raise
    finally:
        with _web_state.LOCK:
            _web_state.DETAIL_PENDING.pop(pending_key, None)

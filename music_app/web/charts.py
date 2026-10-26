"""榜单歌单与按平台独立加载的公共推荐。"""
import concurrent.futures
import copy
import random
import threading
import time
from collections import OrderedDict
from contextvars import copy_context

from music_app.core import request_credentials
from . import client as _web_client
from . import constants as _web_constants
from . import songs as _web_songs


# Home discovery is a short, shared sampling task. Explicit chart browsing keeps
# its original complete pagination path below and is not cut to this budget.
RECOMMENDATION_BUDGET_SECONDS = 6.0
RECOMMENDATION_CACHE_SECONDS = 60.0
RECOMMENDATION_MAX_PENDING = 8
_recommendation_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=4, thread_name_prefix='home-recommendation')
_recommendation_slots = threading.BoundedSemaphore(RECOMMENDATION_MAX_PENDING)
_recommendation_lock = threading.Lock()
_recommendation_flights = {}
_recommendation_cache = OrderedDict()


def charts():
    return _web_client.upstream('/charts').get('charts', [])

def chart_playlist(chart):
    p = chart['platform']
    return dict(id='chart:' + p + ':' + str(chart['id']), name=chart['name'], cover=chart.get('cover', ''),
                trackCount=chart.get('track_count', 0), description=chart.get('description', ''),
                creator={'netease': '网易云', 'qqmusic': 'QQ 音乐', 'kugou': '酷狗', 'qishui': '汽水音乐'}[p],
                provider='mineradio', source='mineradio', builtin=True, readonly=True, shelfPane='mine')

def chart_tracks(identifier):
    _, platform, chart_id = identifier.split(':', 2)
    if platform not in _web_constants.CHART_PROVIDERS:
        raise ValueError('未知平台')
    provider = 'qq' if platform == 'qqmusic' else platform
    return [_web_songs.song_row(s, provider) for s in _web_client.upstream('/chart', platform=platform, id=chart_id).get('songs', [])]

def _remaining_recommendation_budget(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Home discovery budget expired')
    return remaining


def _load_recommendation_platform(platform, deadline):
    """One provider owns both its catalogue and track request within one budget."""
    result = dict(platform=platform, tracks=[], playlist=None, complete=False)
    try:
        catalog = _web_client.upstream('/charts', platform=platform,
            request_timeout=_remaining_recommendation_budget(deadline))
        pool = [row for row in catalog.get('charts', []) if row.get('platform') == platform]
        if not pool:
            result['complete'] = catalog.get('complete', True) is True
            return result
        selected = random.choice(pool[:min(12, len(pool))])
        result['playlist'] = chart_playlist(selected)
        data = _web_client.upstream('/chart', platform=platform, id=selected['id'],
            request_timeout=_remaining_recommendation_budget(deadline))
        provider = 'qq' if platform == 'qqmusic' else platform
        raw = list(data.get('songs', []))
        random.shuffle(raw)
        result['tracks'] = [_web_songs.song_row(song, provider) for song in raw[:15]]
        result['complete'] = (catalog.get('complete', True) is True
                              and data.get('complete', True) is True
                              and time.monotonic() < deadline)
        return result
    except (OSError, ValueError, KeyError, TypeError):
        result['error'] = 'discovery_platform_unavailable'
        return result


def _recommendation_task(platform, deadline):
    try:
        return _load_recommendation_platform(platform, deadline)
    finally:
        _recommendation_slots.release()


def _recommendation_finished(key, future):
    with _recommendation_lock:
        if _recommendation_flights.get(key) is future:
            del _recommendation_flights[key]
        if future.cancelled():
            return
        try:
            result = future.result()
        except Exception:
            return
        # A deadline/failed/incomplete page must never become a complete cache.
        if not result.get('complete') or not result.get('tracks'):
            return
        _recommendation_cache[key] = (time.monotonic(), copy.deepcopy(result))
        _recommendation_cache.move_to_end(key)
        while len(_recommendation_cache) > 128:
            _recommendation_cache.popitem(last=False)


def _recommendation_work(platform, deadline):
    key = (platform, request_credentials.fingerprint())
    with _recommendation_lock:
        cached = _recommendation_cache.get(key)
        if cached and time.monotonic() - cached[0] < RECOMMENDATION_CACHE_SECONDS:
            _recommendation_cache.move_to_end(key)
            return copy.deepcopy(cached[1]), None
        if cached:
            del _recommendation_cache[key]
        future = _recommendation_flights.get(key)
        if future is not None:
            return None, future
        if not _recommendation_slots.acquire(blocking=False):
            return None, None
        try:
            future = _recommendation_executor.submit(copy_context().run,
                _recommendation_task, platform, deadline)
        except Exception:
            _recommendation_slots.release()
            raise
        _recommendation_flights[key] = future
    # add_done_callback can execute synchronously for a fast, completed task.
    # Register it outside the registry lock to avoid self-deadlocking.
    future.add_done_callback(lambda completed: _recommendation_finished(key, completed))
    return None, future


def recommendations():
    """Return completed providers by the overall deadline; share bounded work."""
    deadline = time.monotonic() + RECOMMENDATION_BUDGET_SECONDS
    values, futures = {}, {}
    platforms = tuple(_web_constants.CHART_PROVIDERS)
    for platform in platforms:
        cached, future = _recommendation_work(platform, deadline)
        if cached is not None:
            values[platform] = cached
        elif future is not None:
            futures[platform] = future
    if futures:
        concurrent.futures.wait(set(futures.values()),
            timeout=max(0.0, deadline - time.monotonic()))
    for platform, future in futures.items():
        if future.done() and not future.cancelled():
            try:
                values[platform] = future.result()
            except Exception:
                values[platform] = dict(tracks=[], complete=False,
                                        error='discovery_platform_unavailable')
    rows = [copy.deepcopy(song) for value in values.values() for song in value.get('tracks', [])]
    random.shuffle(rows)
    seen, result = set(), []
    for song in rows:
        key = ''.join((song['name'] + '|' + song['artist']).lower().split())
        if key not in seen:
            seen.add(key)
            result.append(song)
    states = {platform: dict(complete=bool(values.get(platform, {}).get('complete')),
                ready=bool(values.get(platform, {}).get('tracks')),
                pending=platform not in values) for platform in platforms}
    complete = all(state['complete'] for state in states.values())
    # Keep the existing daily selection for older clients. Clients that verify
    # playback can continue through the remaining candidates when a song fails.
    return dict(loggedIn=False, publicDiscovery=True, mode='charts', dailySongs=result[:30],
                candidateSongs=result,
                playlists=[value['playlist'] for value in values.values() if value.get('playlist')],
                podcasts=[], updatedAt=int(time.time() * 1000), complete=complete, partial=not complete,
                pendingPlatforms=[platform for platform in platforms if states[platform]['pending']],
                platformStates=states)

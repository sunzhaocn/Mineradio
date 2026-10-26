"""Read-only login health, isolated by credential digest; never refresh tokens."""
from collections import OrderedDict
import hashlib
import threading
import time

from music_app.core import request_credentials

_LOCK = threading.RLock()
_CACHE = OrderedDict()
_PENDING = {}
_TTL = 60


def _key(cookie):
    return hashlib.sha256(cookie.encode()).hexdigest()


def _save(cookie, state, *, failed=False):
    key = _key(cookie)
    with _LOCK:
        previous = _CACHE.get(key, {})
        value = dict(state=previous.get('state', 'unknown') if failed else state,
                     checkFailed=failed, checkedAt=int(time.time()), at=time.monotonic())
        _CACHE[key] = value
        _CACHE.move_to_end(key)
        while len(_CACHE) > 128:
            _CACHE.popitem(last=False)
        return value.copy()


def observe(cookie, payload):
    """Library responses provide health without an additional provider call."""
    if not cookie or not isinstance(payload, dict):
        return
    if payload.get('status') in (1, '1') and payload.get('error_code', 0) in (0, '0', None):
        _save(cookie, 'valid')
    elif str(payload.get('error_code')) == '20017':
        _save(cookie, 'expired')


def _public(value, configured=True):
    state = value.get('state', 'unknown') if configured else 'logged_out'
    return dict(provider='kugou', configured=configured, authState=state,
                loggedIn=configured and state != 'expired', verified=state == 'valid',
                reauthRequired=state == 'expired', checkFailed=bool(value.get('checkFailed')),
                checkedAt=value.get('checkedAt', 0))


def cached():
    """Known authentication evidence, without trusting cached playlist contents."""
    cookie = request_credentials.cookie('kugou')
    with _LOCK:
        return _public(_CACHE.get(_key(cookie), {}), bool(cookie))


def check(force=False):
    cookie = request_credentials.cookie('kugou')
    if not cookie:
        return _public({}, False)
    key = _key(cookie)
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and not force and time.monotonic() - cached['at'] < (15 if cached['checkFailed'] else _TTL):
            return _public(cached)
        pending = _PENDING.get(key)
        owner = pending is None
        if owner:
            pending = threading.Event()
            _PENDING[key] = pending
    if not owner:
        pending.wait(25)
        with _LOCK:
            return _public(_CACHE.get(key, {'checkFailed': True}))
    try:
        from . import library
        auth = library._credentials()
        # One small authorized read. No QR, token exchange, registration or playback.
        library._request('/v7/get_all_list', {'userid': int(auth['uid']), 'token': auth['token'],
                         'total_ver': 979, 'type': 2, 'page': 1, 'pagesize': 1}, auth)
        with _LOCK:
            if _CACHE.get(key, {}).get('state') != 'valid':
                _save(cookie, 'valid')
    except Exception as error:
        if str(getattr(error, 'upstream_code', '')) == '20017':
            _save(cookie, 'expired')
        else:
            _save(cookie, 'unknown', failed=True)
    finally:
        with _LOCK:
            _PENDING.pop(key, None)
            pending.set()
    with _LOCK:
        return _public(_CACHE.get(key, {}))

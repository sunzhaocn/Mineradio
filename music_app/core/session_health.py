"""Bounded, request-credential-scoped authentication health; no login operations."""
from collections import OrderedDict
import threading
import time

from music_app.core import request_credentials


class LoginExpired(ValueError):
    def __init__(self, provider):
        super().__init__('登录已失效，请重新登录')
        self.provider = provider


class Tracker:
    def __init__(self, provider):
        self.provider = provider
        self.module = 'qqmusic' if provider == 'qq' else provider
        self.lock = threading.RLock()
        self.cache = OrderedDict()
        self.pending = {}

    def identity(self):
        return request_credentials.fingerprint(self.module) if request_credentials.cookie(self.module) else ''

    def save(self, key, state, failed=False):
        with self.lock:
            old = self.cache.get(key, {})
            value = dict(state=old.get('state', 'unknown') if failed else state,
                         checkFailed=failed, checkedAt=int(time.time()), at=time.monotonic())
            self.cache[key] = value
            self.cache.move_to_end(key)
            while len(self.cache) > 128:
                self.cache.popitem(last=False)

    def public(self, key):
        with self.lock:
            value = self.cache.get(key, {})
            state = value.get('state', 'unknown') if key else 'logged_out'
            return dict(provider=self.provider, configured=bool(key), authState=state,
                        loggedIn=bool(key) and state != 'expired', verified=state == 'valid',
                        reauthRequired=state == 'expired', checkFailed=bool(value.get('checkFailed')),
                        checkedAt=value.get('checkedAt', 0))

    def cached(self):
        return self.public(self.identity())

    def observe(self, state):
        key = self.identity()
        if key and state in ('valid', 'expired'):
            self.save(key, state)

    def check(self, probe, force=False):
        key = self.identity()
        if not key:
            return self.public(key)
        with self.lock:
            old = self.cache.get(key)
            if old and not force and time.monotonic() - old['at'] < (15 if old['checkFailed'] else 60):
                return self.public(key)
            event = self.pending.get(key)
            owner = event is None
            if owner:
                event = threading.Event()
                self.pending[key] = event
        if not owner:
            event.wait(25)
            return self.public(key)
        try:
            state = probe()
            self.save(key, state, failed=state not in ('valid', 'expired'))
        except LoginExpired:
            self.save(key, 'expired')
        except Exception:
            # Connectivity, challenges, rate limits and malformed responses
            # are not proof that the saved credentials have expired.
            self.save(key, 'unknown', failed=True)
        finally:
            with self.lock:
                self.pending.pop(key, None)
                event.set()
        return self.public(key)

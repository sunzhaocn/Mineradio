"""Low-priority local image preparation; never part of playback readiness.

Only public chart artwork and shipped platform logos are initialized. Platform
credentials, audio, and account catalogs are not requested by these workers.
"""
import json
import os
import queue
import threading
import uuid
from urllib.parse import urlsplit

from music_app import paths
from . import client, image_cache, media

VERSION = 1
STATE_FILE = 'asset-init-v1.json'
PROVIDERS = tuple(image_cache.PLATFORM_ICONS)
_service = None
_service_lock = threading.Lock()


def provider_key(value):
    return 'qq' if value == 'qqmusic' else value


def public_cover(value):
    try:
        return isinstance(value, str) and len(value) <= 4096 and media.allowed_media(value)
    except (ValueError, TypeError):
        return False


class ClientAssets:
    def __init__(self):
        self.state_path = paths.CACHE_DIR / STATE_FILE
        self.lock = threading.RLock()
        self.stopping = threading.Event()
        self.jobs = queue.Queue()
        self.pending = set()
        self.changed = set()
        self.threads = []
        self.state = {'version': VERSION, 'initialized': False, 'attempted': [], 'platforms': {}}
        try:
            if self.state_path.stat().st_size <= 1024 * 1024:
                saved = json.loads(self.state_path.read_text(encoding='utf-8'))
                if saved.get('version') == VERSION:
                    self.state['initialized'] = saved.get('initialized') is True
                    self.state['attempted'] = [p for p in saved.get('attempted', []) if p in PROVIDERS]
                    for provider, entry in saved.get('platforms', {}).items():
                        if provider in PROVIDERS and isinstance(entry, dict):
                            covers = entry.get('covers', [])
                            if isinstance(covers, list):
                                self.state['platforms'][provider] = {
                                    'catalogKnown': entry.get('catalogKnown') is True,
                                    'covers': list(dict.fromkeys(u for u in covers[:300] if public_cover(u)))}
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def _save(self):
        # All callers hold self.lock. A failed write only means another quiet
        # check next time; it must not prevent the client from opening.
        temporary = self.state_path.with_name(STATE_FILE + '.' + uuid.uuid4().hex + '.tmp')
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_text(json.dumps(self.state, ensure_ascii=False), encoding='utf-8')
            os.replace(temporary, self.state_path)
        except OSError:
            pass
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def start(self):
        # Two daemon workers bound network/disk pressure and cannot hold exit.
        for number in range(2):
            worker = threading.Thread(target=self._work, name='client-assets-' + str(number), daemon=True)
            worker.start()
            self.threads.append(worker)
        self.schedule('all')
        return self

    def schedule(self, provider='all'):
        selected = PROVIDERS if provider == 'all' else (provider_key(provider),)
        with self.lock:
            for value in selected:
                if value in PROVIDERS and value not in self.pending and not self.stopping.is_set():
                    self.pending.add(value)
                    self.jobs.put(value)

    def remember_charts(self, rows):
        # A normal catalog refresh supplies new covers without making a second
        # directory request merely to run the integrity check.
        groups = {}
        for row in rows:
            provider = provider_key(row.get('platform'))
            if provider in PROVIDERS:
                covers = groups.setdefault(provider, [])
                cover = row.get('cover')
                if public_cover(cover) and cover not in covers and len(covers) < 300:
                    covers.append(cover)
        with self.lock:
            for provider, covers in groups.items():
                entry = {'catalogKnown': True, 'covers': covers}
                if self.state['platforms'].get(provider) != entry:
                    self.state['platforms'][provider] = entry
                    self._save()
                    if provider in self.pending:
                        self.changed.add(provider)
                    else:
                        self.schedule(provider)

    def check_platform(self, provider):
        failed_hosts = {}
        downloaded = failed = 0

        def fetch(url):
            nonlocal downloaded
            if self.stopping.is_set():
                raise OSError('stopping')
            host = urlsplit(url).hostname
            if failed_hosts.get(host, 0) >= 3:
                raise OSError('host unavailable in this background pass')
            try:
                body = media.fetch_cover_image(url, timeout=6)
                downloaded += 1
                return body
            except (OSError, ValueError):
                failed_hosts[host] = failed_hosts.get(host, 0) + 1
                raise

        try:
            media.platform_icon(provider, fetch)
        except (OSError, ValueError):
            failed += 1
        with self.lock:
            entry = dict(self.state['platforms'].get(provider, {}))
        if not entry.get('catalogKnown') and not self.stopping.is_set():
            try:
                data = client.upstream('/charts', platform='qqmusic' if provider == 'qq' else provider, request_timeout=8)
                if data.get('complete') is False or data.get('errors'):
                    raise ValueError('catalog unavailable')
                covers = list(dict.fromkeys(row.get('cover') for row in data.get('charts', [])
                                            if provider_key(row.get('platform')) == provider and public_cover(row.get('cover'))))[:300]
                entry = {'catalogKnown': True, 'covers': covers}
                with self.lock:
                    current = self.state['platforms'].get(provider, {})
                    if current.get('catalogKnown'):
                        entry = dict(current)
                    else:
                        self.state['platforms'][provider] = entry
                        self._save()
            except (OSError, ValueError, TypeError, AttributeError):
                failed += 1
        for url in entry.get('covers', []):
            if self.stopping.is_set():
                break
            try:
                # cached_image verifies size + digest before calling fetch.
                image_cache.cached_image(url, fetch)
            except (OSError, ValueError):
                failed += 1
        with self.lock:
            if not self.stopping.is_set() and provider not in self.state['attempted']:
                attempted = set(self.state['attempted']) | {provider}
                self.state['attempted'] = [p for p in PROVIDERS if p in attempted]
                self.state['initialized'] = len(attempted) == len(PROVIDERS)
                self._save()
        return {'downloaded': downloaded, 'failed': failed}

    def _work(self):
        while not self.stopping.is_set():
            try:
                provider = self.jobs.get(timeout=.25)
            except queue.Empty:
                continue
            try:
                self.check_platform(provider)
            except Exception:
                # This optional job must not affect the server or playback.
                pass
            finally:
                with self.lock:
                    self.pending.discard(provider)
                    if provider in self.changed:
                        self.changed.discard(provider)
                        self.schedule(provider)
                self.jobs.task_done()

    def close(self):
        self.stopping.set()


def start():
    global _service
    with _service_lock:
        if _service is None or _service.stopping.is_set():
            _service = ClientAssets().start()
        return _service


def schedule(provider='all'):
    if _service is not None:
        _service.schedule(provider)


def remember_charts(rows):
    if _service is not None:
        _service.remember_charts(rows)


def stop():
    if _service is not None:
        _service.close()

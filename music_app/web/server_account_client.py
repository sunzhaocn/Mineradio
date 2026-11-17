"""Retrieve accounts over HTTPS, then use them inside the local request pipeline."""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
import os
import threading
import time

from music_app import paths
from music_app.core import request_credentials, server_accounts
from . import account_health, auth_security

STATUS = '/api/server-account/status'
MODE_HEADER = 'X-Mineradio-Account-Source'
MODE_QUERY = 'account_source'


def enabled():
    return os.environ.get('MINERADIO_DESKTOP_SERVER_ACCOUNTS') == '1'


def fetch_accounts(key):
    connection = http.client.HTTPSConnection(server_accounts.PUBLIC_HOST, timeout=4)
    try:
        connection.request('GET', server_accounts.CREDENTIALS, headers={'Authorization': 'Bearer ' + key})
        with connection.getresponse() as response:
            if response.status != 200:
                raise OSError('Server accounts are unavailable')
            content = response.read(server_accounts.MAX_BODY + 1)
            if len(content) > server_accounts.MAX_BODY:
                raise ValueError('Server account response is too large')
            data = json.loads(content)
            if not isinstance(data, dict) or not isinstance(data.get('credentials'), dict):
                raise ValueError('Invalid server account response')
            return request_credentials.normalize(data['credentials']), str(data.get('revision') or '')[:64]
    finally:
        connection.close()


class AccountCache:
    def __init__(self):
        self.lock = threading.Lock()
        self.key = ''
        self.next_fetch = 0
        self.snapshot = ({}, 'empty')

    def read(self):
        with self.lock:
            try:
                key = (paths.CONFIG_DIR / server_accounts.KEY_FILE).read_text(encoding='utf-8').strip()
            except (OSError, UnicodeError):
                key = ''
            if key != self.key:
                self.key = key
                self.next_fetch = 0
                self.snapshot = ({}, 'empty')
            if server_accounts.KEY_PATTERN.fullmatch(key) and time.monotonic() >= self.next_fetch:
                try:
                    self.snapshot = fetch_accounts(key)
                except (OSError, ValueError, RecursionError, http.client.HTTPException):
                    self.snapshot = ({}, 'unavailable')
                    self.next_fetch = time.monotonic() + 8
                else:
                    self.next_fetch = time.monotonic() + 30
            return self.snapshot


CACHE = AccountCache()


def parse_request(handler, query, provider=None):
    server_mode = handler.headers.get(MODE_HEADER) == 'server' or query.get(MODE_QUERY) == 'server'
    if enabled() and server_mode:
        auth_security.assert_local_request(handler, allow_query=True)
        return CACHE.read()[0]
    return request_credentials.parse_request(handler.headers, query, provider)


def status(handler):
    auth_security.assert_local_request(handler, allow_query=True)
    entries, revision = CACHE.read()
    configured = [provider for provider, key in account_health.PROVIDERS.items() if key in entries]

    def check(provider):
        key = account_health.PROVIDERS[provider]
        try:
            with request_credentials.bind({key: entries[key]}):
                data = account_health.check(provider)
            return {name: data[name] for name in ('configured', 'loggedIn', 'authState', 'reauthRequired', 'checkFailed')
                    if name in data}
        except (OSError, ValueError):
            return {'configured': True, 'authState': 'unknown', 'checkFailed': True}

    platforms = {provider: {'configured': False} for provider in account_health.PROVIDERS}
    if configured:
        with ThreadPoolExecutor(max_workers=len(configured)) as pool:
            platforms.update(zip(configured, pool.map(check, configured)))
    return {'platforms': platforms, 'revision': revision}

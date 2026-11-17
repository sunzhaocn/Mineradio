import http.client
from http.server import ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from music_app import paths
from music_app.core import request_credentials, server_accounts
from music_app.web import httpserver, server_account_client

GATEWAY_SOURCE = Path(__file__).resolve().parents[1] / 'deploy/server-accounts/gateway.py'
SPEC = importlib.util.spec_from_file_location('mineradio_account_gateway', GATEWAY_SOURCE)
gateway = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gateway)

DEVICE_KEY = 'd' * 43
DEVICE = {'Authorization': 'Bearer ' + DEVICE_KEY}
ADMIN = {
    'Authorization': 'Basic fixture',
    'Origin': server_accounts.PUBLIC_ORIGIN,
    'Content-Type': 'application/json',
}


class ServerAccounts(unittest.TestCase):
    def serve(self, server):
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def request(self, service, path, headers=None, payload=None):
        port = service.server_address[1]
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        try:
            connection.request('POST' if payload else 'GET', path,
                               json.dumps(payload) if payload else None, headers or {})
            with connection.getresponse() as response:
                return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_server_only_distributes_cookies_to_paired_devices(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        service = self.serve(ThreadingHTTPServer(('127.0.0.1', 0), gateway.Gateway))
        service.store = gateway.AccountStore(Path(temporary.name))
        service.device_header = DEVICE['Authorization'].encode()
        service.admin_header = ADMIN['Authorization'].encode()
        cookie_input = {'provider': 'netease', 'cookie': 'MUSIC_U=fixture-account'}
        admin_path = server_accounts.ADMIN + 'api/'

        self.assertEqual(self.request(service, admin_path + 'save', {**ADMIN, 'Origin': 'https://example.com'}, cookie_input)[0], 403)
        self.assertEqual(self.request(service, admin_path + 'save', ADMIN, cookie_input)[0], 200)
        self.assertEqual(self.request(service, admin_path + 'accounts', ADMIN)[1]['netease'], {'configured': True})
        self.assertEqual(self.request(service, server_accounts.CREDENTIALS)[0], 401)
        self.assertEqual(self.request(service, server_accounts.CREDENTIALS, ADMIN)[0], 401)
        self.assertEqual(self.request(service, server_accounts.CREDENTIALS, DEVICE)[1]['credentials'],
                         {'netease': {'cookie': cookie_input['cookie']}})
        self.assertEqual(self.request(service, '/api/server-account/v1/relay/api/search', DEVICE)[0], 404)
        self.assertEqual(self.request(service, admin_path + 'remove', ADMIN, {'provider': 'netease'})[0], 200)
        self.assertEqual(self.request(service, server_accounts.CREDENTIALS, DEVICE)[1]['credentials'], {})

    def test_desktop_applies_server_cookie_when_dispatching_locally(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        configuration = Path(temporary.name)
        key_file = configuration / server_accounts.KEY_FILE
        key_file.write_text(DEVICE_KEY, encoding='utf-8')
        service = self.serve(httpserver.create_server(port=0))
        local_calls = []

        def local_route(_handler, path, query):
            local_calls.append((path, query.get('keywords'), request_credentials.cookie('netease')))
            return {'songs': ['local result']}

        with patch.dict('os.environ', {'MINERADIO_DESKTOP_SERVER_ACCOUNTS': '1', 'MINERADIO_PUBLIC_ORIGIN': ''}), \
             patch.object(paths, 'CONFIG_DIR', configuration), \
             patch.object(server_account_client, 'CACHE', server_account_client.AccountCache()), \
             patch.object(server_account_client, 'fetch_accounts',
                          return_value=({'netease': {'cookie': 'MUSIC_U=server-fixture'}}, '1')) as fetch, \
             patch.object(httpserver.Handler, 'route', local_route):
            endpoint = '/api/search?keywords=fixture'
            remote_account = {server_account_client.MODE_HEADER: 'server',
                              'X-Music-Cookie': 'MUSIC_U=disregard-fixture'}
            self.assertEqual(self.request(service, endpoint, remote_account), (200, {'songs': ['local result']}))
            self.assertEqual(self.request(service, endpoint + '&account_source=server')[0], 200)
            self.assertEqual(self.request(service, endpoint, {'X-Music-Cookie': 'MUSIC_U=local-fixture'})[0], 200)
            self.assertEqual(self.request(service, endpoint, {**remote_account, 'Origin': 'https://example.com'})[0], 403)
            fetch.assert_called_once_with(DEVICE_KEY)
            key_file.unlink()
            self.assertEqual(self.request(service, endpoint, remote_account)[0], 200)

        self.assertEqual(local_calls, [
            ('/api/search', 'fixture', 'MUSIC_U=server-fixture'),
            ('/api/search', 'fixture', 'MUSIC_U=server-fixture'),
            ('/api/search', 'fixture', 'MUSIC_U=local-fixture'),
            ('/api/search', 'fixture', ''),
        ])

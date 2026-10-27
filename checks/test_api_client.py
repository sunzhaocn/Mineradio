"""Exercise the internal API boundary using real local HTTP redirects."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from music_app.core import request_credentials
from music_app.web import client


@contextmanager
def local_api(status=200, payload=None):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            requests.append((self.path, dict(self.headers)))
            body = json.dumps(payload).encode()
            self.send_response(status if not self.path.startswith('/redirect-target') else 200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Location', '/redirect-target')
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with patch.object(client._web_constants, 'API', 'http://127.0.0.1:%d' % server.server_port):
            yield requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


class InternalAPI(unittest.TestCase):
    def test_success_delivers_only_current_request_credentials_to_internal_api(self):
        with local_api(payload={'songs': []}) as requests:
            with request_credentials.bind({'qqmusic': {'cookie': 'test_session=synthetic'}}):
                self.assertEqual(client.upstream('/search', word='a & b'), {'songs': []})
            client.upstream('/search')
        self.assertEqual(requests[0][0], '/search?word=a+%26+b')
        self.assertIn('test_session=synthetic', requests[0][1]['X-Music-Credentials'])
        self.assertEqual(requests[1][1]['X-Music-Credentials'], '{}')

    def test_redirects_never_receive_credentials_or_cancellation_ticket(self):
        for status in (301, 302, 303, 307, 308):
            with self.subTest(status=status), local_api(status, {}) as requests:
                with request_credentials.bind({'qqmusic': {'cookie': 'test_session=synthetic'}}):
                    with patch.object(client.request_lifecycle, 'forward_ticket') as forward:
                        forward.return_value.__enter__.return_value = 'synthetic-ticket'
                        with self.assertRaisesRegex(ValueError, '非预期跳转'):
                            client.upstream('/search')
                self.assertEqual(len(requests), 1)
                self.assertEqual(requests[0][1]['X-Music-Read-Task'], 'synthetic-ticket')

    def test_non_object_json_returns_controlled_error(self):
        for payload in ([], None, 'unexpected', 12):
            with self.subTest(payload=payload), local_api(payload=payload):
                with self.assertRaisesRegex(ValueError, '数据格式无效'):
                    client.upstream('/search')

    def test_http_failure_is_preserved_and_response_closed(self):
        with local_api(503, {'error': 'temporary'}):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                client.upstream('/search')
        self.assertEqual(caught.exception.code, 503)
        self.assertTrue(caught.exception.closed)

    def test_platform_error_remains_a_controlled_failure(self):
        with local_api(payload={'error_code': 502, 'msg': 'upstream unavailable'}):
            with self.assertRaisesRegex(ValueError, 'upstream unavailable'):
                client.upstream('/search')


if __name__ == '__main__':
    unittest.main()

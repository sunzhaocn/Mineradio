"""Offline regressions for account isolation and HTTP media streaming."""
import copy
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request
import urllib.response

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from music_app.core import request_credentials
from music_app.web import media, state


URL = 'https://isure.stream.qqmusic.qq.com/example.m4a'


class Handler(media.MediaMixin):
    def __init__(self):
        self.headers = {'Range': 'bytes=0-3'}
        self.wfile = io.BytesIO()
        self.responses = []
        self.sent_headers = {}
        self.close_connection = False

    def json(self, data, status):
        self.responses.append(status)

    def send_response(self, status):
        self.responses.append(status)

    def send_header(self, name, value):
        self.sent_headers[name] = value

    def end_headers(self):
        pass


class MediaRegressions(unittest.TestCase):
    def setUp(self):
        self.caches = ('AUDIO_URLS', 'AUDIO_URL_OWNERS', 'AUDIO_SCOPES',
                       'DETAILS', 'SONG_LABELS', 'DETAIL_GENERATIONS')
        with state.LOCK:
            self.saved = {name: copy.deepcopy(getattr(state, name)) for name in self.caches}
            for name in self.caches:
                getattr(state, name).clear()
        self.network = patch('socket.create_connection', side_effect=AssertionError('test must not connect'))
        self.network.start()

    def tearDown(self):
        self.network.stop()
        with state.LOCK:
            for name, saved in self.saved.items():
                target = getattr(state, name)
                target.clear()
                target.update(saved)

    def test_redirect_does_not_send_account_headers_to_external_cdn(self):
        request = urllib.request.Request('http://127.0.0.1:8080/qishui/audio?id=1&quality=higher', headers={
            'X-Music-Credentials': '{"qishui":{"cookie":"synthetic-session"}}',
            'X-Music-Cookie': 'synthetic-cookie',
            'X-Music-Session': 'synthetic-session',
            'Cookie': 'synthetic-cookie', 'Authorization': 'Bearer synthetic-token',
            'Range': 'bytes=0-3',
        })
        redirect = media.MediaRedirect()
        for target in (URL, 'https://m701.music.126.net/example.mp3'):
            request = redirect.redirect_request(request, None, 302, 'Found', {}, target)
            headers = {key.lower(): value for key, value in request.header_items()}
            for name in ('x-music-credentials', 'x-music-cookie', 'x-music-session', 'cookie', 'authorization'):
                self.assertNotIn(name, headers)
            self.assertEqual(headers['range'], 'bytes=0-3')

    def test_trusted_loopback_audio_receives_credentials(self):
        url = media._web_client.local_qishui_audio_url('/qishui/audio?id=1&quality=higher')
        state.AUDIO_URLS.add(url)
        response = urllib.error.HTTPError(url, 416, 'Range unavailable',
            {'Content-Range': 'bytes */4', 'Content-Length': '0'}, io.BytesIO())
        opener = Mock()
        opener.open.side_effect = response
        with request_credentials.bind({'qishui': {'cookie': 'synthetic-cookie'}}), patch.object(
                media.urllib.request, 'build_opener', return_value=opener):
            handler = Handler()
            handler.media(url, audio=True)
            self.assertEqual(opener.open.call_args.args[0].get_header('X-music-credentials'),
                             request_credentials.header_value())
        self.assertEqual(handler.responses, [416])

    def test_only_loopback_audio_bypasses_system_proxy(self):
        local = media._web_client.local_qishui_audio_url('/qishui/audio?id=1&quality=higher')
        state.AUDIO_URLS.update((local, URL))
        captured = []

        class CaptureHTTP(urllib.request.HTTPHandler):
            def http_open(self, request):
                captured.append(request)
                response = urllib.response.addinfourl(io.BytesIO(b'data'),
                    {'Content-Length': '4'}, request.full_url, 200)
                response.msg = 'OK'
                return response

        class CaptureHTTPS(urllib.request.HTTPSHandler):
            https_open = CaptureHTTP.http_open

        real_builder = urllib.request.build_opener
        def build(*handlers):
            return real_builder(*handlers, CaptureHTTP(), CaptureHTTPS())

        with patch.object(media.urllib.request, 'build_opener', side_effect=build), patch.object(
                media.urllib.request, 'getproxies', return_value={'http': 'http://proxy.invalid:8080',
                                                                'https': 'http://proxy.invalid:8080'}), patch.object(
                media.urllib.request, 'proxy_bypass', return_value=False), request_credentials.bind(
                {'qishui': {'cookie': 'synthetic-cookie'}}):
            Handler().media(local, audio=True)
            Handler().media(URL, audio=True)
        self.assertEqual(len(captured), 2)
        self.assertNotEqual(captured[0].host, 'proxy.invalid:8080')
        self.assertEqual(captured[1].host, 'proxy.invalid:8080')
        self.assertIn('synthetic-cookie', captured[0].get_header('X-music-credentials'))
        self.assertIsNone(captured[1].get_header('X-music-credentials'))

    def test_cdn_unsatisfiable_range_is_forwarded_as_416(self):
        state.AUDIO_URLS.add(URL)
        response = urllib.error.HTTPError(URL, 416, 'Range unavailable',
            {'Content-Range': 'bytes */4', 'Content-Length': '0', 'Accept-Ranges': 'bytes'}, io.BytesIO())
        opener = Mock()
        opener.open.side_effect = response
        with patch.object(media.urllib.request, 'build_opener', return_value=opener):
            handler = Handler()
            handler.media(URL, audio=True)
        self.assertEqual(handler.responses, [416])
        self.assertEqual(handler.sent_headers['Content-Range'], 'bytes */4')
        self.assertEqual(handler.sent_headers['Content-Length'], '0')
        self.assertEqual(handler.wfile.getvalue(), b'')

    def test_other_http_errors_are_closed_and_preserved(self):
        state.AUDIO_URLS.add(URL)
        response = urllib.error.HTTPError(URL, 503, 'Unavailable', {}, io.BytesIO(b'error'))
        opener = Mock()
        opener.open.side_effect = response
        with patch.object(media.urllib.request, 'build_opener', return_value=opener):
            handler = Handler()
            with self.assertRaises(urllib.error.HTTPError) as caught:
                handler.media(URL, audio=True)
        self.assertEqual(caught.exception.code, 503)
        self.assertTrue(caught.exception.closed)
        self.assertEqual(handler.responses, [])

    def test_invalid_content_length_fails_before_sending_headers(self):
        state.AUDIO_URLS.add(URL)
        for length in ('-1', 'NaN', '3, 4'):
            with self.subTest(length=length):
                response = Mock(status=200, headers={'Content-Length': length})
                response.read.side_effect = [b'data', b'']
                response.__enter__ = Mock(return_value=response)
                response.__exit__ = Mock(return_value=False)
                opener = Mock()
                opener.open.return_value = response
                with patch.object(media.urllib.request, 'build_opener', return_value=opener):
                    handler = Handler()
                    with self.assertRaises(ValueError):
                        handler.media(URL, audio=True)
                self.assertEqual(handler.responses, [])
                response.__exit__.assert_called_once()

    def test_midstream_failure_closes_connection_without_second_response(self):
        state.AUDIO_URLS.add(URL)
        response = Mock(status=206, headers={'Content-Length': '8', 'Content-Range': 'bytes 0-7/8'})
        response.read.side_effect = [b'first', TimeoutError('upstream timed out')]
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = response
        with patch.object(media.urllib.request, 'build_opener', return_value=opener):
            handler = Handler()
            handler.media(URL, audio=True)
        self.assertEqual(handler.responses, [206])
        self.assertEqual(handler.wfile.getvalue(), b'first')
        self.assertTrue(handler.close_connection)

    def test_premature_eof_closes_connection_instead_of_waiting_for_missing_bytes(self):
        state.AUDIO_URLS.add(URL)
        response = Mock(status=206, headers={'Content-Length': '8', 'Content-Range': 'bytes 0-7/8'})
        response.read.side_effect = [b'four', b'']
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = response
        with patch.object(media.urllib.request, 'build_opener', return_value=opener):
            handler = Handler()
            handler.media(URL, audio=True)
        self.assertEqual(handler.responses, [206])
        self.assertEqual(handler.wfile.getvalue(), b'four')
        self.assertTrue(handler.close_connection)

    def test_logout_removes_only_that_providers_authorizations_on_shared_url(self):
        state.AUDIO_URLS.add(URL)
        state.AUDIO_URL_OWNERS[URL] = {'qq', 'netease'}
        with request_credentials.bind({'qq': {'cookie': 'synthetic-old-account'}}):
            old_scope = request_credentials.fingerprint('qq')
            state.AUDIO_SCOPES[URL] = {('qq', old_scope), ('netease', 'another-account')}
            state.invalidate_login_cache('qq')
            with patch.object(media.urllib.request, 'build_opener') as opener:
                handler = Handler()
                handler.media(URL, audio=True)
            self.assertEqual(handler.responses, [403])
            opener.assert_not_called()
        self.assertIn(URL, state.AUDIO_URLS)
        self.assertEqual(state.AUDIO_URL_OWNERS[URL], {'netease'})
        self.assertEqual(state.AUDIO_SCOPES[URL], {('netease', 'another-account')})


if __name__ == '__main__':
    unittest.main()

"""Public H5 playback survives the web adapter without granting arbitrary media."""
import copy
import io
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from music_app.core import request_credentials
from music_app.providers.qishui import api as qishui_api, public_web
from music_app.web import media, qualities, router, songs, state


URL = 'https://v11-luna.douyinvod.com/audio/?sign=a%2Bb%2Fc&part=first&part=second'
FULL_URL = 'https://v5-ex-luna.douyinvod.com/full/?sign=keep%2Bexact'
MESSAGE = '当前提供官方公开试听版本；原曲时长 180 秒'


def quality(key='higher', *, preview=True, url=URL):
    duration = 30 if preview else 180
    return dict(key=key, quality='标准 · 官方试听' if preview else '标准 · 官方公开版本',
                kind='官方试听' if preview else '官方公开版本', available=bool(url), url=url,
                encrypted=False, duration_s=duration, duration=duration, durationMs=duration * 1000,
                sourceScope='public_catalog', publicPlayback=True,
                access='preview' if preview else 'full_public', isPreview=preview,
                previewDuration=duration if preview else 0, originalDuration_s=180,
                message=MESSAGE if preview else '当前为官方公开版本',
                filesize=480000 if preview else 2880000)


def detail():
    return dict(id='123', title='Example Song', author='Example Artist', duration_s=180,
                scope='public_catalog', sourceScope='public_catalog', publicPlayback=True,
                access='preview', isPreview=True, previewDuration=30, previewDurationMs=30000,
                originalDuration_s=180, durationMs=180000, message=MESSAGE,
                qualities=[quality()], url=URL)


class StateIsolation(unittest.TestCase):
    def setUp(self):
        self.caches = ('AUDIO_URLS', 'AUDIO_URL_OWNERS', 'AUDIO_SCOPES', 'DETAILS',
                       'DETAIL_PENDING', 'DETAIL_GENERATIONS', 'SONG_LABELS')
        with state.LOCK:
            self.saved = {name: copy.deepcopy(getattr(state, name)) for name in self.caches}
            for name in self.caches:
                getattr(state, name).clear()
        self.network = patch('socket.create_connection', side_effect=AssertionError('test must not connect'))
        self.network.start()

    def tearDown(self):
        self.network.stop()
        with state.LOCK:
            for name, values in self.saved.items():
                target = getattr(state, name)
                target.clear()
                target.update(values)


class PublicMetadata(StateIsolation):
    def test_search_keeps_public_scope_and_warning_and_does_not_return_session_fields(self):
        row = detail()
        row.update(session_config={'headers': {'cookie': 'must-not-leak'}}, authorization='secret')
        upstream = dict(songs=[row], scope='public_catalog', message=MESSAGE, has_more=False, total=1)
        with patch.object(router._web_client, 'upstream', return_value=upstream) as fetch:
            result = router.dispatch('/api/qishui/search', {'keywords': 'Example', 'limit': '10', 'offset': '0'})
        self.assertEqual(result['scope'], 'public_catalog')
        self.assertEqual(result['message'], MESSAGE)
        self.assertFalse(result['hasMore'])
        self.assertEqual(result['songs'][0]['sourceScope'], 'public_catalog')
        self.assertTrue(result['songs'][0]['isPreview'])
        self.assertEqual(result['songs'][0]['duration'], 30)
        self.assertEqual(result['songs'][0]['durationMs'], 30000)
        self.assertEqual(result['songs'][0]['originalDuration_s'], 180)
        self.assertNotIn('session_config', result['songs'][0])
        self.assertNotIn('authorization', result['songs'][0])
        fetch.assert_called_once_with('/search', platform='qishui', keyword='Example', size=10, page=1, simple=1)

    def test_other_platform_search_does_not_inherit_public_mode(self):
        with patch.object(router._web_client, 'upstream', return_value={
                'songs': [detail()], 'scope': 'public_catalog', 'message': MESSAGE}):
            result = router.dispatch('/api/netease/search', {})
        self.assertNotIn('scope', result)
        self.assertNotIn('message', result)
        self.assertNotIn('sourceScope', result['songs'][0])
        self.assertEqual(result['songs'][0]['duration'], 180)

    def test_each_quality_retains_its_own_access_and_playable_duration(self):
        data = detail()
        data['qualities'].append(quality('highest', preview=False, url=FULL_URL))
        options = qualities.quality_rows(data, 'qishui', '123')
        preview, full = options
        self.assertEqual((preview['access'], preview['isPreview'], preview['duration_s']), ('preview', True, 30))
        self.assertEqual((full['access'], full['isPreview'], full['duration_s']), ('full_public', False, 180))
        self.assertEqual(preview['previewDuration'], 30)
        self.assertEqual(full['previewDuration'], 0)
        self.assertEqual(full['originalDuration_s'], 180)
        self.assertEqual(preview['sourceScope'], 'public_catalog')
        self.assertEqual(preview['kind'], '官方试听')
        self.assertEqual(full['kind'], '官方公开版本')
        self.assertEqual(preview['bitrate'], 128)
        self.assertEqual(full['bitrate'], 128)
        self.assertEqual(preview['url'], URL)
        self.assertEqual(full['url'], FULL_URL)

    def test_song_url_reports_actual_excerpt_length_and_preserves_signed_url(self):
        with patch.object(router._web_songs, 'detail', return_value=detail()):
            result = router.dispatch('/api/qishui/song/url', {'id': '123', 'quality': 'higher'})
        self.assertTrue(result['playable'])
        self.assertTrue(result['trial'])
        self.assertTrue(result['isPreview'])
        self.assertEqual(result['url'], URL)
        self.assertEqual(result['duration'], 30)
        self.assertEqual(result['duration_s'], 30)
        self.assertEqual(result['durationMs'], 30000)
        self.assertEqual(result['previewDuration'], 30)
        self.assertEqual(result['originalDuration_s'], 180)
        self.assertEqual(result['sourceScope'], 'public_catalog')
        self.assertEqual(result['message'], MESSAGE)
        self.assertEqual(result['access'], 'preview')

    def test_selected_full_public_quality_is_not_marked_as_trial_by_top_level_preview(self):
        data = detail()
        data['qualities'].append(quality('highest', preview=False, url=FULL_URL))
        with patch.object(router._web_songs, 'detail', return_value=data):
            result = router.dispatch('/api/qishui/song/detail', {'id': '123', 'quality': 'highest'})
        self.assertEqual(result['duration'], 180)
        self.assertEqual(result['access'], 'full_public')
        self.assertFalse(result['trial'])
        self.assertFalse(result['isPreview'])
        self.assertEqual(result['previewDuration'], 0)
        self.assertEqual(result['previewDurationMs'], 0)
        self.assertEqual(result['message'], '当前为官方公开版本')
        self.assertEqual(result['url'], FULL_URL)

    def test_unavailable_exact_quality_does_not_silently_substitute_a_public_excerpt(self):
        with patch.object(router._web_songs, 'detail', return_value=detail()):
            result = router.dispatch('/api/qishui/song/url', {'id': '123', 'quality': 'lossless'})
        self.assertFalse(result['playable'])
        self.assertEqual(result['url'], '')
        self.assertEqual(result['reason'], 'quality_unavailable')
        self.assertEqual(result['nativeQuality'], 'lossless')
        self.assertTrue(result['localExactQuality'])
        self.assertFalse(result['qualityFallback'])

    def test_unverified_public_source_cannot_become_playable_from_metadata(self):
        data = detail()
        data.update(access='unknown', isPreview=False, publicPlayback=False, qualities=[], url='')
        with patch.object(router._web_songs, 'detail', return_value=data):
            result = router.dispatch('/api/qishui/song/url', {'id': '123'})
        self.assertFalse(result['playable'])
        self.assertEqual(result['url'], '')
        self.assertEqual(result['access'], 'unknown')
        self.assertFalse(result['publicPlayback'])

    def test_preview_metadata_does_not_make_encrypted_media_playable(self):
        data = detail()
        data['qualities'][0].update(encrypted=True, decryption_supported=False)
        with patch.object(router._web_songs, 'detail', return_value=data):
            result = router.dispatch('/api/qishui/song/url', {'id': '123', 'quality': 'higher'})
        self.assertTrue(result['encrypted'])
        self.assertFalse(result['playable'])
        self.assertEqual(result['url'], '')
        self.assertEqual(result['reason'], 'encrypted_media')


class Response:
    status = 206
    headers = {'Content-Type': 'audio/mp4', 'Content-Length': '4', 'Content-Range': 'bytes 0-3/500', 'Accept-Ranges': 'bytes'}

    def __init__(self):
        self.body = io.BytesIO(b'M4A!')

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size):
        return self.body.read(size)


class Handler(media.MediaMixin):
    def __init__(self):
        self.headers = {'Range': 'bytes=0-3'}
        self.wfile = io.BytesIO()
        self.sent_headers = {}

    def json(self, data, status):
        self.error = (status, data)

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.sent_headers[name] = value

    def end_headers(self):
        pass


class RegisteredPublicMedia(StateIsolation):
    def test_real_public_api_schema_survives_anonymous_song_route_and_audio_proxy(self):
        resolved = dict(track=dict(id='123', name='Example Song', duration=180000,
                artists=[{'id': '12', 'name': 'Example Artist'}], album={'name': 'Example Album'},
                label_info={'only_vip_playable': True}), lyric={},
            audio=[dict(key='higher', url=URL, durationMs=30000, expiresAt=time.time() + 600,
                format='m4a', codec='aac', bitrate=128000, size=480000, access='preview', encrypted=False)])
        with patch.object(public_web, 'resolve', return_value=resolved):
            upstream = qishui_api._public_details('123')
        with request_credentials.bind({}):
            original = songs.song_row(upstream, 'qishui')
            self.assertTrue(original['vipRequired'])
            with patch.object(songs._web_client, 'upstream', return_value=upstream):
                result = router.dispatch('/api/qishui/song/url', {'id': '123', 'quality': 'auto'})
            self.assertTrue(result['vipRequired'])
            self.assertFalse(result['qualities'][0]['vip_required'])
            self.assertEqual(result['duration'], 30)
            self.assertEqual(result['originalDuration_s'], 180)
            self.assertEqual(result['sourceScope'], 'public_catalog')
            self.assertIn('官方试听', result['message'])
            self.assertEqual(result['url'], URL)
            self.assertEqual(state.AUDIO_SCOPES[URL], {('qishui', '')})
            opener = Mock()
            opener.open.return_value = Response()
            with patch.object(media.urllib.request, 'build_opener', return_value=opener):
                handler = Handler()
                handler.media(result['url'], audio=True)
            self.assertEqual(handler.status, 206)
            self.assertEqual(handler.wfile.getvalue(), b'M4A!')

    def test_private_quality_still_inherits_original_vip_rights(self):
        state.SONG_LABELS[('qishui', '123')] = {'vipRequired': True}
        private = {'duration_s': 180, 'qualities': [dict(key='higher', available=True, url=URL, vip_required=False)]}
        self.assertTrue(qualities.quality_rows(private, 'qishui', '123')[0]['vip_required'])

    def test_resolved_public_urls_remain_registered_to_the_resolving_request(self):
        account = {'qishui': {'cookie': 'sessionid=synthetic-client-a'}}
        with request_credentials.bind(account), patch.object(songs._web_client, 'upstream', return_value=detail()):
            songs.detail('qishui', '123', playback_only=True)
            fingerprint = request_credentials.fingerprint('qishui')
        self.assertIn(URL, state.AUDIO_URLS)
        self.assertEqual(state.AUDIO_URL_OWNERS[URL], {'qishui'})
        self.assertEqual(state.AUDIO_SCOPES[URL], {('qishui', fingerprint)})
        state.invalidate_login_cache('qishui')
        self.assertNotIn(URL, state.AUDIO_URLS)
        self.assertNotIn(URL, state.AUDIO_URL_OWNERS)
        self.assertNotIn(URL, state.AUDIO_SCOPES)

    def test_official_cdn_url_without_registration_is_denied_before_network(self):
        handler = Handler()
        with patch.object(media.urllib.request, 'build_opener') as opener:
            handler.media(URL, audio=True)
        opener.assert_not_called()
        self.assertEqual(handler.error[0], 403)

    def test_a_different_account_cannot_reuse_a_registered_public_url(self):
        with request_credentials.bind({'qishui': {'cookie': 'sessionid=synthetic-client-a'}}):
            fingerprint = request_credentials.fingerprint('qishui')
        state.AUDIO_URLS.add(URL)
        state.AUDIO_URL_OWNERS[URL] = {'qishui'}
        state.AUDIO_SCOPES[URL] = {('qishui', fingerprint)}
        with request_credentials.bind({'qishui': {'cookie': 'sessionid=synthetic-client-b'}}), patch.object(
                media.urllib.request, 'build_opener') as opener:
            handler = Handler()
            handler.media(URL, audio=True)
        opener.assert_not_called()
        self.assertEqual(handler.error[0], 403)

    def test_registered_douyin_stream_keeps_range_and_never_forwards_account_headers(self):
        state.AUDIO_URLS.add(URL)
        state.AUDIO_URL_OWNERS[URL] = {'qishui'}
        with request_credentials.bind({'qishui': {'cookie': 'sessionid=synthetic-client-a'}}):
            state.AUDIO_SCOPES[URL] = {('qishui', request_credentials.fingerprint('qishui'))}
            opener = Mock()
            opener.open.return_value = Response()
            with patch.object(media.urllib.request, 'build_opener', return_value=opener):
                handler = Handler()
                handler.media(URL, audio=True)
        request = opener.open.call_args.args[0]
        headers = dict((key.lower(), value) for key, value in request.header_items())
        self.assertEqual(request.full_url, URL)
        self.assertEqual(headers['referer'], 'https://www.douyin.com/')
        self.assertEqual(headers['range'], 'bytes=0-3')
        for name in ('cookie', 'authorization', 'x-music-credentials', 'x-music-cookie'):
            self.assertNotIn(name, headers)
        self.assertEqual(handler.status, 206)
        self.assertEqual(handler.sent_headers['Content-Range'], 'bytes 0-3/500')
        self.assertEqual(handler.sent_headers['Accept-Ranges'], 'bytes')
        self.assertEqual(handler.wfile.getvalue(), b'M4A!')

    def test_existing_platform_referers_are_preserved(self):
        for url, referer in (('https://isure.stream.qqmusic.qq.com/example.m4a', 'https://y.qq.com/'),
                             ('https://m701.music.126.net/example.mp3', 'https://music.163.com/')):
            with self.subTest(url=url):
                state.AUDIO_URLS.add(url)
                opener = Mock()
                opener.open.return_value = Response()
                with patch.object(media.urllib.request, 'build_opener', return_value=opener):
                    Handler().media(url, audio=True)
                self.assertEqual(opener.open.call_args.args[0].get_header('Referer'), referer)

    def test_registration_does_not_authorize_a_non_platform_host(self):
        url = 'https://douyinvod.com.example.invalid/steal?sign=anything'
        state.AUDIO_URLS.add(url)
        with patch.object(media.urllib.request, 'build_opener') as opener:
            handler = Handler()
            handler.media(url, audio=True)
        opener.assert_not_called()
        self.assertEqual(handler.error[0], 403)


if __name__ == '__main__':
    unittest.main()

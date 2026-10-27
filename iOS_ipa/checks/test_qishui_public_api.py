"""Public/native mode routing and response semantics; synthetic, offline only."""
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from music_app import platform_runtime
from music_app.providers.qishui import api, public_web
from music_app.providers.qishui.client import QishuiError

ID = '7634441185327745025'
URL = 'https://v11-luna.douyinvod.com/media?sign=keep%2Bexact&x=1&x=2'


def resolved(access='preview'):
    duration = 30000 if access == 'preview' else 180000
    return {'track': {'id': ID, 'name': 'Synthetic Song', 'duration': 180000,
            'artists': [{'id': '12', 'name': 'Synthetic Artist'}], 'album': {'name': 'Album'},
            'label_info': {'only_vip_playable': access == 'preview'}},
        'lyric': {'content': '[1000,1000]<0,1000,0>Example line'},
        'scope': 'public_catalog', 'access': access, 'playable': True,
        'audio': [{'key': 'higher', 'quality': 'higher', 'url': URL, 'backupUrl': '',
                   'durationMs': duration, 'expiresAt': int(time.time()) + 600,
                   'format': 'm4a', 'codec': 'aac', 'bitrate': 129900, 'size': 487143,
                   'access': access, 'encrypted': False}]}


def one(values):
    return lambda *keys: next((values[k] for k in keys if k in values), '')


class PublicAPI(unittest.TestCase):
    def setUp(self):
        api._CACHE.clear()
        api._SOURCES.clear()

    def test_mode_requires_explicit_missing_ios_configuration(self):
        with patch.object(platform_runtime, 'is_ios', return_value=True):
            self.assertTrue(api._public_mode({'configurationAvailable': False,
                                             'error': 'signer_configuration_missing'}))
            for status in ({}, {'configurationAvailable': True},
                           {'configurationAvailable': True, 'error': 'signer_configuration_rejected'},
                           {'configurationAvailable': False, 'error': 'signer_library_missing'}):
                self.assertFalse(api._public_mode(status))
        with patch.object(platform_runtime, 'is_ios', return_value=False):
            self.assertFalse(api._public_mode({'configurationAvailable': False}))

    def test_local_status_marks_limited_public_capability_without_claiming_signer_ready(self):
        with patch.object(platform_runtime, 'is_ios', return_value=True), \
                patch.object(api, '_ios_signer_status', return_value={
                    'configurationAvailable': False, 'error': 'signer_configuration_missing',
                    'initialized': False, 'libraryAvailable': False}), \
                patch.object(api, 'load_session', return_value={'guest': True}), \
                patch.object(api, 'media_capable', return_value=False):
            status = api.local_status()
        self.assertTrue(status['available'])
        self.assertTrue(status['direct_playback'])
        self.assertTrue(status['public_catalog_available'])
        self.assertEqual(status['search_scope'], 'public_catalog')
        self.assertFalse(status['sdk_configuration_available'])
        self.assertFalse(status['signer_ready'])
        self.assertFalse(status['signer_initialized'])

    def test_public_search_preserves_directory_scope_and_never_uses_music_signer(self):
        fixture = {'keyword': 'Example', 'page': 2, 'size': 3, 'songs': [], 'count': 0,
                   'total': 0, 'has_more': False, 'scope': 'public_catalog'}
        with patch.object(api, '_public_mode', return_value=True), \
                patch.object(public_web, 'catalog_search', return_value=fixture) as search, \
                patch.object(api, 'request_json') as native:
            result = api.search('Example', size=3, page=2)
        search.assert_called_once_with('Example', page=2, size=3)
        native.assert_not_called()
        self.assertEqual(result['sourceScope'], 'public_catalog')
        self.assertTrue(result['publicSearch'])

    def test_configured_signing_failure_never_switches_to_public(self):
        error = QishuiError(503, 'qishui_signing_failed', 'Synthetic signing failure')
        with patch.object(api, '_public_mode', return_value=False), \
                patch.object(api, 'request_json', side_effect=error), \
                patch.object(public_web, 'catalog_search') as public:
            with self.assertRaises(QishuiError) as caught:
                api.search('Example')
        self.assertIs(caught.exception, error)
        public.assert_not_called()

    def test_configured_detail_failure_never_switches_to_public(self):
        error = QishuiError(401, 'qishui_upstream_rejected', 'Synthetic account rejection')
        with patch.object(api, '_public_mode', return_value=False), \
                patch.object(api, 'read_track', side_effect=error), \
                patch.object(public_web, 'resolve') as public:
            with self.assertRaises(QishuiError) as caught:
                api.details(ID)
        self.assertIs(caught.exception, error)
        public.assert_not_called()

    def test_preview_metadata_uses_actual_seconds_and_separate_original_duration(self):
        with patch.object(api, '_public_mode', return_value=True), \
                patch.object(public_web, 'resolve', return_value=resolved()), \
                patch.object(api, 'read_track') as native:
            result = api.details(ID)
        native.assert_not_called()
        self.assertEqual(result['duration_s'], 30)
        self.assertEqual(result['duration'], 30)
        self.assertEqual(result['durationMs'], 30000)
        self.assertEqual(result['originalDuration_s'], 180)
        self.assertEqual(result['previewDuration'], 30)
        self.assertTrue(result['isPreview'])
        self.assertTrue(result['vipRequired'])  # original song rights remain visible
        self.assertEqual(result['sourceScope'], 'public_catalog')
        self.assertIn('[00:01.000]Example line', result['lrc'])
        quality = result['qualities'][0]
        self.assertEqual(quality['kind'], '官方试听')
        self.assertIn('官方试听', quality['message'])
        self.assertEqual(result['message'], quality['message'])
        self.assertEqual(quality['url'], URL)
        self.assertEqual(quality['encode'], 'aac')
        self.assertFalse(quality['vip_required'])  # a public preview is not VIP verification

    def test_full_public_quality_is_not_fabricated_lossless(self):
        with patch.object(api, '_public_mode', return_value=True), \
                patch.object(public_web, 'resolve', return_value=resolved('full_public')):
            result = api.details(ID)
        self.assertFalse(result['isPreview'])
        self.assertEqual(result['access'], 'full_public')
        self.assertEqual(result['previewDuration'], 0)
        self.assertEqual(result['qualities'][0]['kind'], '官方公开版本')
        self.assertEqual(result['qualities'][0]['key'], 'higher')
        self.assertNotIn('无损', result['qualities'][0]['quality'])

    def test_api_also_rejects_full_public_if_explicit_rights_contradict_it(self):
        for key in ('only_vip_playable', 'only_purchase_playable', 'hasUnresolvedDigitalTrack'):
            fixture = resolved('full_public')
            if key == 'hasUnresolvedDigitalTrack':
                fixture['track'][key] = True
            else:
                fixture['track']['label_info'][key] = True
            with patch.object(public_web, 'resolve', return_value=fixture):
                result = api._public_details(ID)
            self.assertFalse(result['playback_supported'], key)
            self.assertEqual(result['access'], 'unknown', key)

    def test_unknown_or_insufficient_audio_is_not_playable(self):
        for change in ('empty', 'duration', 'codec', 'encrypted', 'expiry', 'host'):
            result = resolved()
            if change == 'empty':
                result['audio'] = []
            elif change == 'duration':
                result['audio'][0].pop('durationMs')
            elif change == 'codec':
                result['audio'][0]['codec'] = 'flac'
            elif change == 'encrypted':
                result['audio'][0]['encrypted'] = None
            elif change == 'expiry':
                result['audio'][0]['expiresAt'] = time.time() - 1
            else:
                result['audio'][0]['url'] = 'https://evil.invalid/a'
            with patch.object(public_web, 'resolve', return_value=result):
                item = api._public_details(ID)
            self.assertFalse(item['playback_supported'], change)
            self.assertIsNone(item['encrypted'], change)
            self.assertEqual(item['access'], 'unknown', change)

    def test_quality_handler_passes_public_metadata_and_imports_official_url(self):
        values = {'url': 'https://www.douyin.com/qishui/song/' + ID}
        with patch.object(api, '_public_mode', return_value=True), \
                patch.object(public_web, 'resolve', return_value=resolved()) as resolve:
            code, result = api.handle(one(values), lambda _: False, '/qualities', 'id')
        self.assertEqual(code, 200)
        resolve.assert_called_once_with(ID)
        self.assertEqual(result['previewDuration'], 30)
        self.assertEqual(result['originalDuration_s'], 180)
        self.assertEqual(result['sourceScope'], 'public_catalog')

    def test_stream_keeps_signed_url_and_lossless_is_unavailable(self):
        with patch.object(api, '_public_mode', return_value=True), \
                patch.object(public_web, 'resolve', return_value=resolved()):
            code, result = api.handle(one({'id': ID}), lambda _: False, '/stream', 'id')
            missing_code, missing = api.handle(one({'id': ID, 'quality': 'lossless'}),
                                               lambda _: False, '/best', 'id')
        self.assertEqual((code, result), (302, {'_location': URL}))
        self.assertEqual(missing_code, 404)
        self.assertEqual(missing['code'], 'quality_unavailable')

    def test_no_audio_error_survives_main_response_selection(self):
        fixture = resolved()
        fixture.update(audio=[], reason='qishui_public_network_failed')
        with patch.object(api, '_public_mode', return_value=True), \
                patch.object(public_web, 'resolve', return_value=fixture):
            code, result = api.handle(one({'id': ID}), lambda _: False, '/link', 'id')
        self.assertEqual(code, 200)
        self.assertFalse(result['playback_supported'])
        self.assertTrue(result['error'])
        self.assertEqual(result['publicError'], 'qishui_public_network_failed')

    def test_public_directory_is_explicitly_not_an_official_complete_chart(self):
        data = {'songs': [{'id': '12', 'cover': ''}], 'total': 1, 'has_more': False}
        with patch.object(api, '_public_mode', return_value=True), \
                patch.object(public_web, 'catalog_search', return_value=data), \
                patch.object(api, 'request_json') as native:
            catalog = api.chart_catalog()
            rows, total = api.chart_tracks('public_catalog')
            with self.assertRaises(QishuiError):
                api.chart_tracks('unavailable-signed-chart')
        native.assert_not_called()
        self.assertEqual((len(rows), total), (1, 1))
        self.assertFalse(catalog[0]['isChart'])
        self.assertEqual(catalog[0]['category'], '公开目录')
        self.assertIn('不是完整榜单', catalog[0]['description'])


if __name__ == '__main__':
    unittest.main()

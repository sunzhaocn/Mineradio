"""Official public H5 boundaries with synthetic data; no accounts/network."""
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from music_app.providers.qishui import public_web as public
from music_app.providers.qishui.client import QishuiError

ID = '7634441185327745025'
URL = 'https://v11-luna.douyinvod.com/media/?a=7&sign=x%2By%2Fz&order=first&order=second'


def box(kind, payload):
    return (len(payload) + 8).to_bytes(4, 'big') + kind + payload


def aac_header(duration_ms=30000, *, protected=False, sample_type=b'mp4a', video=False):
    mdhd = box(b'mdhd', bytes(12) + (1000).to_bytes(4, 'big') + duration_ms.to_bytes(4, 'big') + bytes(4))
    hdlr = box(b'hdlr', bytes(8) + (b'vide' if video else b'soun') + bytes(12))
    sample = box(sample_type, bytes(28) + box(b'esds', bytes(4)) +
                 (box(b'sinf', box(b'tenc', bytes(8))) if protected else b''))
    stsd = box(b'stsd', bytes(4) + (1).to_bytes(4, 'big') + sample)
    mdia = box(b'mdia', mdhd + hdlr + box(b'minf', box(b'stbl', stsd)))
    return box(b'ftyp', b'M4A ' + bytes(4) + b'isom') + box(b'moov', box(b'trak', mdia))


def track(track_id=ID, name='Root Song', duration=180000, vip=None):
    data = {'id': track_id, 'name': name, 'duration': duration,
            'artists': [{'id': '123', 'name': 'Example Artist'}],
            'album': {'id': '456', 'name': 'Example Album'}}
    if vip is not None:
        data['label_info'] = {'only_vip_playable': vip}
    return data


def document(*, duration=30, vip=True, recommendations=None):
    model = {'status': 10, 'version': 3, 'media_type': 'audio', 'enable_ssl': True,
             'video_duration': duration, 'url_expire': int(time.time()) + 3600,
             'video_list': [{'main_url': URL, 'backup_url': 'https://v5-ex-luna.douyinvod.com/backup?sign=keep',
                'video_meta': {'quality': 'higher', 'vtype': 'm4a', 'codec_type': 'aac',
                               'size': 247207, 'bitrate': 129900}}]}
    return {'seo_track': {'track': track(vip=vip)},
            'track_player': {'expire_at': int(time.time()) + 1800, 'video_model': json.dumps(model)},
            'lyric': {'content': '[0,1000]<0,1000,0>Example', 'type': 'LRC'},
            'chart_tracks': [{'track': t} for t in recommendations or []]}


class FakeResponse:
    def __init__(self, data, url=public.ENDPOINT, content_type='application/json', status=200):
        self.data, self.url, self.status = data, url, status
        self.headers = {'Content-Type': content_type, 'Content-Length': str(len(data))}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        return self.data[:limit]

    def geturl(self):
        return self.url


class PublicWeb(unittest.TestCase):
    def setUp(self):
        with public._LOCK:
            for cache in (public._METADATA, public._RESOLVED, public._CATALOG):
                cache.clear()
            public._REQUEST_TIMES.clear()

    def reader(self, doc, header=None):
        def read(url, *, media=False):
            return header if media else json.dumps(doc).encode()
        return read

    def test_exact_id_and_official_url_parsing_never_fetches_urls(self):
        for value in (ID, 'https://www.douyin.com/qishui/song/' + ID,
                      'https://m.douyin.com/qishui/song/' + ID,
                      'https://music.douyin.com/qishui/share/track?track_id=' + ID):
            self.assertEqual(public.parse_track_id(value), ID)
        for value in ('https://www.douyin.com.evil.invalid/qishui/song/' + ID,
                      'http://www.douyin.com/qishui/song/' + ID,
                      'https://user@www.douyin.com/qishui/song/' + ID,
                      'https://www.douyin.com:444/qishui/song/' + ID,
                      'https://music.douyin.com/qishui/share/track?track_id=1&track_id=2'):
            self.assertIsNone(public.parse_track_id(value))

    def test_cdn_validation_preserves_signed_query_and_rejects_bad_origins(self):
        self.assertTrue(public.allowed_audio_url(URL))
        for value in ('http://v11-luna.douyinvod.com/a', 'https://douyinvod.com.evil.invalid/a',
                      'https://v11-luna.douyinvod.com@evil.invalid/a',
                      'https://v11-luna.douyinvod.com:8443/a', URL + '#part', '\n' + URL):
            self.assertFalse(public.allowed_audio_url(value))

    def test_fresh_http_opener_never_sends_cookie_or_authorization(self):
        class Opener:
            def open(self, req, timeout):
                self.request = req
                return FakeResponse(b'{}')
        opener = Opener()
        with patch.object(public.urllib.request, 'build_opener', return_value=opener) as build:
            self.assertEqual(public._request(public.ENDPOINT), b'{}')
        self.assertNotIn('Cookie', opener.request.headers)
        self.assertNotIn('Authorization', opener.request.headers)
        self.assertEqual(opener.request.get_method(), 'GET')
        self.assertEqual(len(build.call_args.args), 1)
        self.assertIsInstance(build.call_args.args[0], public._Redirect)

    def test_cross_origin_redirects_are_rejected(self):
        for handler, url in ((public._Redirect(False), 'https://evil.invalid/a'),
                             (public._Redirect(True), 'https://evil.invalid/a'),
                             (public._Redirect(True), URL)):
            with self.assertRaises(QishuiError):
                handler.redirect_request(None, None, 302, '', {}, url)

    def test_empty_html_oversized_and_rate_limited_reads_are_distinct_failures(self):
        for response in (FakeResponse(b''), FakeResponse(b'<html/>', content_type='text/html'),
                         FakeResponse(bytes(public.MAX_JSON_BYTES + 1))):
            with patch.object(public.urllib.request, 'build_opener') as build:
                build.return_value.open.return_value = response
                with self.assertRaises(QishuiError):
                    public._request(public.ENDPOINT)
        public._REQUEST_TIMES.extend([time.monotonic()] * public.REQUESTS_PER_MINUTE)
        with self.assertRaises(QishuiError) as caught:
            public._request(public.ENDPOINT)
        self.assertEqual(caught.exception.status, 429)

    def test_preview_is_confirmed_by_media_header_and_never_called_member_full(self):
        with patch.object(public, '_request', side_effect=self.reader(document(), aac_header())) as read:
            result = public.resolve(ID)
            again = public.resolve(ID)
        self.assertTrue(result['playable'])
        self.assertEqual(result['access'], 'preview')
        self.assertEqual(result['audio'][0]['durationMs'], 30000)
        self.assertEqual(result['audio'][0]['url'], URL)
        self.assertEqual(result['audio'][0]['backupUrl'], '')
        self.assertEqual(read.call_count, 2)
        self.assertEqual(result, again)
        self.assertNotIn('authorized', result)

    def test_missing_vip_flag_alone_does_not_make_a_full_stream(self):
        doc = document(duration=180, vip=None)
        with patch.object(public, '_request', side_effect=self.reader(doc, aac_header(180000))):
            self.assertEqual(public.resolve(ID)['access'], 'full_public')
        public._RESOLVED.clear()
        with patch.object(public, '_request', return_value=aac_header(30000)):
            result = public.resolve(ID)
            self.assertFalse(result['playable'])  # model/header duration disagree
            self.assertEqual(result['access'], 'unknown')

    def test_explicit_vip_never_returns_an_anonymous_full_stream(self):
        with patch.object(public, '_request', side_effect=self.reader(document(duration=180), aac_header(180000))):
            self.assertFalse(public.resolve(ID)['playable'])

    def test_explicit_purchase_never_returns_an_anonymous_full_stream(self):
        doc = document(duration=180, vip=None)
        doc['seo_track']['track']['label_info'] = {'only_purchase_playable': True}
        with patch.object(public, '_request', side_effect=self.reader(doc, aac_header(180000))):
            result = public.resolve(ID)
        self.assertFalse(result['playable'])
        self.assertEqual(result['access'], 'unknown')
        self.assertEqual(result['audio'], [])
        self.assertTrue(result['track']['label_info']['only_purchase_playable'])

    def test_unresolved_digital_sale_never_probes_or_offers_audio(self):
        for info in ({'sale_period': 1}, {'sale_period': 3}, 'unrecognized'):
            doc = document(duration=180, vip=None)
            doc['seo_track']['track']['digital_track_info'] = info
            public._METADATA.clear()
            with patch.object(public, '_request', side_effect=self.reader(doc, aac_header(180000))) as read:
                result = public.resolve(ID)
            self.assertFalse(result['playable'])
            self.assertEqual(result['access'], 'unknown')
            self.assertEqual(result['audio'], [])
            self.assertEqual(read.call_count, 1)

    def test_unverified_or_encrypted_audio_is_not_offered(self):
        for header in (aac_header(protected=True), aac_header(sample_type=b'enca'),
                       aac_header(video=True), b'not mp4', aac_header()[:40]):
            public._METADATA.clear()
            with patch.object(public, '_request', side_effect=self.reader(document(), header)):
                result = public.resolve(ID)
            self.assertFalse(result['playable'])
            self.assertEqual(result['audio'], [])

    def test_expired_missing_duration_or_playauth_never_reads_media(self):
        for change in ('expired', 'duration', 'playauth'):
            doc = document()
            model = json.loads(doc['track_player']['video_model'])
            if change == 'expired':
                doc['track_player']['expire_at'] = int(time.time()) - 1
            elif change == 'duration':
                model.pop('video_duration')
            else:
                doc['track_player']['play_auth'] = 'synthetic-never-decode'
            doc['track_player']['video_model'] = json.dumps(model)
            public._METADATA.clear()
            with patch.object(public, '_request', side_effect=self.reader(doc)) as read:
                self.assertFalse(public.resolve(ID)['playable'])
            self.assertEqual(read.call_count, 1)

    def test_keyword_search_filters_one_official_directory_without_crawling(self):
        doc = document(recommendations=[track('12345', '海边 Live'), track('23456', 'Another Song')])
        with patch.object(public, '_request', return_value=json.dumps(doc).encode()) as read:
            first = public.catalog_search('海边', size=1)
            second = public.catalog_search('Another', page=1)
            exact = public.catalog_search('https://www.douyin.com/qishui/song/' + ID)
        self.assertEqual(first['scope'], 'public_catalog')
        self.assertEqual(first['songs'][0]['id'], '12345')
        self.assertEqual(second['songs'][0]['id'], '23456')
        self.assertEqual(exact['songs'][0]['id'], ID)
        self.assertEqual(read.call_count, 1)
        self.assertNotIn('海边', read.call_args.args[0])

    def test_directory_and_cache_are_bounded_and_results_are_not_shared_mutable(self):
        recommendations = [track(str(1000 + i), 'Song ' + str(i)) for i in range(150)]
        doc = document(recommendations=recommendations[:50])
        doc['artist_tracks'] = [{'track': t} for t in recommendations[50:100]]
        doc['related_tracks'] = [{'track': t} for t in recommendations[100:]]
        with patch.object(public, '_request', return_value=json.dumps(doc).encode()) as read:
            public.catalog_search('Song', size=100)
            self.assertLessEqual(len(public._CATALOG), public.MAX_CATALOG)
            self.assertEqual(read.call_count, 1)
            data = public._metadata(ID)
            data['track']['name'] = 'corrupted by caller'
            self.assertEqual(public._metadata(ID)['track']['name'], 'Root Song')

    def test_no_unknown_hosts_are_fetched_as_imports(self):
        with patch.object(public, '_request') as read:
            with self.assertRaises(QishuiError):
                public.catalog_search('https://evil.invalid/qishui/song/' + ID)
        read.assert_not_called()


if __name__ == '__main__':
    unittest.main()

"""Passport identity must not depend on media signing or another client's state."""
import gzip
import io
import json
from pathlib import Path
import socket
import sys
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from music_app.core import request_credentials
from music_app.core.session_health import Tracker
from music_app.providers.qishui import passport_account, session_status
from music_app.web import account_profiles


def successful(uid='123', **fields):
    return {'message': 'success', 'data': {'user': {'user_id': uid, 'nickname': '测试账号', **fields}}}


def credentials(cookie='sessionid=client-one', device='123456', install='654321', **query):
    return {'qishui': {'cookie': cookie, 'session_config': {
        'query': dict(device_id=device, iid=install, version_name='3.7.0', **query),
        'headers': {'cookie': 'sessionid=wrong-header', 'user-agent': 'Synthetic-Qishui/3.7.0'}}}}


class Response:
    def __init__(self, value, encoding=None):
        self.raw = value if isinstance(value, bytes) else json.dumps(value).encode()
        self.headers = {'Content-Encoding': encoding} if encoding else {}
        self.stream = io.BytesIO(self.raw)
        self.amount = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self, amount):
        self.amount = amount
        return self.stream.read(amount)


class PassportReadBoundaries(unittest.TestCase):
    def setUp(self):
        self.network = patch.object(socket, 'create_connection', side_effect=AssertionError('network forbidden'))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.dns = patch.object(socket, 'getaddrinfo', side_effect=AssertionError('DNS forbidden'))
        self.dns.start()
        self.addCleanup(self.dns.stop)
        self.opener = Mock()
        self.opener.open.return_value = Response(successful())
        self.build = patch.object(passport_account.urllib.request, 'build_opener', return_value=self.opener)
        self.build.start()
        self.addCleanup(self.build.stop)

    def read(self, value=None):
        with request_credentials.bind(value or credentials()):
            return passport_account.read()

    def test_current_session_identifiers_cookie_and_ua_are_sent_only_to_fixed_passport(self):
        self.read(credentials(aid='wrong-aid', account_sdk_source='wrong-source',
                              redirect_url='https://example.invalid/', msToken='must-not-copy'))
        request = self.opener.open.call_args.args[0]
        target = urllib.parse.urlsplit(request.full_url)
        query = urllib.parse.parse_qs(target.query)
        self.assertEqual((target.scheme, target.netloc, target.path),
                         ('https', 'api.qishui.com', '/passport/account/info/v2/'))
        self.assertEqual(query['aid'], ['386088'])
        self.assertEqual(query['account_sdk_source'], ['web'])
        self.assertEqual(query['language'], ['zh'])
        self.assertEqual(query['device_platform'], ['PC'])
        self.assertEqual(query['device_id'], query['did'])
        self.assertEqual(query['device_id'], ['123456'])
        self.assertEqual(query['iid'], query['install_id'])
        self.assertEqual(query['iid'], ['654321'])
        self.assertNotIn('redirect_url', query)
        self.assertNotIn('msToken', query)
        self.assertEqual(request.get_header('Cookie'), 'sessionid=client-one')
        self.assertEqual(request.get_header('User-agent'), 'Synthetic-Qishui/3.7.0')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(self.opener.open.call_args.kwargs['timeout'], 12)
        self.assertEqual(request_credentials.current(), {})

    def test_sequential_clients_never_reuse_identifiers_or_cookies(self):
        for cookie, device, install in [('sessionid=first', '111', '222'), ('sessionid=second', '333', '444')]:
            self.opener.open.return_value = Response(successful())
            self.read(credentials(cookie, device, install))
            request = self.opener.open.call_args.args[0]
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
            self.assertEqual(request.get_header('Cookie'), cookie)
            self.assertEqual(query['device_id'], [device])
            self.assertEqual(query['install_id'], [install])

    def test_no_cookie_means_no_network_and_no_fallback_account(self):
        with request_credentials.bind({}), self.assertRaises(ValueError):
            passport_account.read()
        self.opener.open.assert_not_called()

    def test_bad_device_query_is_not_sent_upstream(self):
        with self.assertRaises(ValueError):
            self.read(credentials(device='https://example.invalid/'))
        self.opener.open.assert_not_called()

    def test_missing_ids_remain_missing_instead_of_being_invented(self):
        self.read({'qishui': {'cookie': 'sessionid=synthetic'}})
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.opener.open.call_args.args[0].full_url).query)
        for name in ('device_id', 'did', 'install_id', 'iid'):
            self.assertNotIn(name, query)

    def test_response_is_bounded_and_gzip_is_decoded_before_classification(self):
        response = Response(gzip.compress(json.dumps(successful()).encode()), 'gzip')
        self.opener.open.return_value = response
        self.assertEqual(passport_account.classify(self.read()), 'valid')
        self.assertEqual(response.amount, passport_account.MAX_RESPONSE + 1)
        self.opener.open.return_value = Response(b' ' * (passport_account.MAX_RESPONSE + 3))
        with self.assertRaises(ValueError):
            self.read()
        self.opener.open.return_value = Response(gzip.compress(b' ' * (passport_account.MAX_RESPONSE + 3)), 'gzip')
        with self.assertRaises(ValueError):
            self.read()

    def test_malformed_response_is_not_a_valid_profile(self):
        for body in (b'not JSON', b'[]', b'null', b'\xff'):
            self.opener.open.return_value = Response(body)
            with self.subTest(body=body), self.assertRaises(ValueError):
                self.read()

    def test_redirects_cannot_forward_current_cookie_to_another_endpoint(self):
        request = urllib.request.Request('https://api.qishui.com/passport/account/info/v2/',
                                         headers={'Cookie': 'sessionid=synthetic'})
        for target in ('https://example.invalid/collect', 'http://api.qishui.com/',
                       'https://api.qishui.com/passport/login/'):
            with self.subTest(target=target), self.assertRaises(ValueError):
                passport_account._NoRedirect().redirect_request(request, None, 302, '', {}, target)


class StrictPassportClassification(unittest.TestCase):
    def test_nested_and_flat_positive_account_ids_are_supported(self):
        for key in ('my_info', 'user', 'user_info', 'account', 'me'):
            self.assertEqual(passport_account.classify({'message': 'success', 'data': {
                key: {'id': 123}}}), 'valid')
        self.assertEqual(passport_account.classify({'message': 'success', 'data': {'uid': '123'}}), 'valid')

    def test_nonzero_errors_cannot_be_hidden_by_success_text_and_an_id(self):
        for root_error, data_error in [(7, None), (None, 7), ('13', None), (None, '13'), (False, 0), (0, False)]:
            result = successful()
            result['error_code'] = root_error
            result['data']['error_code'] = data_error
            with self.subTest(root=root_error, data=data_error):
                self.assertEqual(passport_account.classify(result), 'unknown')

    def test_fake_or_missing_ids_are_not_identity_proof(self):
        for value in (None, '', '0', 0, -1, 'abc', True, 123.5, '1' * 26):
            self.assertEqual(passport_account.classify(successful(value)), 'unknown')

    def test_only_explicit_invalid_account_response_is_expired(self):
        self.assertEqual(passport_account.classify({'message': 'error', 'data': {
            'error_code': 13, 'name': 'account_info_error'}}), 'expired')
        for result in ({'message': 'error', 'data': {'error_code': 7, 'name': 'risk_control'}},
                       {'message': 'error', 'data': {'error_code': 13, 'name': 'unknown'}},
                       {'message': 'error', 'data': {'error_code': 2046}},
                       {'message': 'success', 'data': {'error_code': 13, 'user_id': 123}}, {}):
            self.assertEqual(passport_account.classify(result), 'unknown')


class SharedHealthAndProfile(unittest.TestCase):
    def setUp(self):
        self.network = patch.object(socket, 'create_connection', side_effect=AssertionError('network forbidden'))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_health_and_profile_use_the_same_passport_reader_without_music_sdk(self):
        tracker = Tracker('qishui')
        with request_credentials.bind(credentials()), patch.dict('os.environ', MINERADIO_IOS='1'), \
                patch.object(passport_account, 'read', return_value=successful()) as read, \
                patch.object(session_status, 'tracker', tracker), \
                patch('music_app.providers.qishui.client.request_json', side_effect=AssertionError('music SDK forbidden')) as music:
            health = session_status.check(force=True)
            profile = account_profiles.read('qishui')
            self.assertEqual(health['authState'], 'valid')
            self.assertFalse(health['checkFailed'])
            self.assertEqual(profile['account']['id'], '123')
            self.assertEqual(profile['account']['name'], '测试账号')
            self.assertEqual(read.call_count, 2)
            music.assert_not_called()

    def test_ios_profile_failure_does_not_call_me_or_return_fabricated_identity(self):
        with request_credentials.bind(credentials()), patch.dict('os.environ', MINERADIO_IOS='1'), \
                patch.object(passport_account, 'read', side_effect=OSError('synthetic TLS/risk failure')), \
                patch('music_app.providers.qishui.client.request_json', side_effect=AssertionError('music SDK forbidden')) as music:
            with self.assertRaises(OSError):
                account_profiles.read('qishui')
            music.assert_not_called()

    def test_network_or_risk_failure_preserves_valid_session_and_reports_check_failed(self):
        tracker = Tracker('qishui')
        with request_credentials.bind(credentials()), patch.object(session_status, 'tracker', tracker), \
                patch.object(passport_account, 'read', return_value=successful()) as read:
            self.assertTrue(session_status.check(force=True)['verified'])
            for result in (OSError('synthetic network'), urllib.error.HTTPError('https://api.qishui.com/', 429, '', {}, None),
                           {'message': 'error', 'data': {'error_code': 2046}}):
                read.side_effect = result if isinstance(result, Exception) else None
                read.return_value = result if not isinstance(result, Exception) else None
                health = session_status.check(force=True)
                self.assertEqual(health['authState'], 'valid')
                self.assertTrue(health['checkFailed'])
                self.assertFalse(health['reauthRequired'])

    def test_desktop_keeps_existing_music_profile_fallback(self):
        with request_credentials.bind(credentials()), patch.dict('os.environ', MINERADIO_IOS='0'), \
                patch.object(passport_account, 'read', side_effect=OSError('synthetic')), \
                patch('music_app.providers.qishui.client.request_json', return_value={
                    'data': {'me': {'id': '123', 'nickname': '桌面原资料'}}}) as music:
            self.assertEqual(account_profiles.read('qishui')['account']['name'], '桌面原资料')
            music.assert_called_once_with('me')


if __name__ == '__main__':
    unittest.main()

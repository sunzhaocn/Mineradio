"""The iPad must verify the music account, retain retryable failures and scope cookies."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from music_app.auth.netease import ios_browser
from music_app.core import request_credentials
from music_app.core.session_health import Tracker
from music_app.providers.netease import session_status, library, transport


def cookies():
    return [{'domain': '.music.163.com', 'name': 'MUSIC_U', 'value': 'synthetic-session', 'expires': -1},
            {'domain': '.music.163.com', 'name': '__csrf', 'value': 'synthetic-csrf', 'expires': -1}]


class OfficialIOSAccountProof(unittest.TestCase):
    def state(self, snapshot):
        runtime = Mock()
        runtime.call.return_value = snapshot
        return {'manual_login': True, 'browser_runtime': runtime}

    def test_cookie_alone_is_not_music_account_authorization(self):
        state = self.state({'cookies': cookies()})
        result = ios_browser.check_session(state)
        self.assertEqual(result['status'], 'waiting')
        self.assertNotIn('cookie', result)
        self.assertNotIn('authorized', state)
        state['browser_runtime'].close.assert_not_called()

    def test_failed_account_lookup_keeps_the_same_browser_and_cookies_for_retry(self):
        state = self.state({'cookies': cookies(), 'account_lookup_failed': True})
        result = ios_browser.check_session(state)
        self.assertEqual(result['status'], 'waiting')
        self.assertIn('未丢失', result['message'])
        self.assertNotIn('cookie', result)
        self.assertNotIn('authorized', state)
        state['browser_runtime'].close.assert_not_called()
        state['browser_runtime'].call.return_value = {'cookies': cookies(),
            'account': {'code': 200, 'account': {'id': 123}, 'profile': {'userId': 123, 'nickname': '测试账号'}}}
        authorized = ios_browser.check_session(state)
        self.assertEqual(authorized['status'], 'authorized')
        self.assertEqual(authorized['account']['id'], '123')
        self.assertIn('MUSIC_U=synthetic-session', authorized['cookie'])

    def test_invalid_or_challenged_accounts_are_not_reported_authorized(self):
        for account in ({'code': 301}, {'code': 200, 'account': None, 'profile': None},
                        {'code': 200, 'account': {'id': 0}}, {'code': 8821},
                        {'code': 200, 'profile': {'userId': False}}):
            with self.subTest(account=account):
                state = self.state({'cookies': cookies(), 'account': account})
                result = ios_browser.check_session(state)
                self.assertEqual(result['status'], 'waiting')
                self.assertNotIn('cookie', result)
                self.assertNotIn('authorized', state)

    def test_valid_account_read_cannot_authorize_without_current_session_cookie(self):
        state = self.state({'cookies': [], 'account': {'code': 200, 'account': {'id': 123}}})
        result = ios_browser.check_session(state)
        self.assertNotEqual(result['status'], 'authorized')

    def test_closed_session_has_a_reopen_message_without_a_qr_instruction(self):
        state = self.state({'closed': True, 'cookies': []})
        result = ios_browser.check_session(state)
        self.assertEqual(result['status'], 'cancelled')
        self.assertIn('重新打开', result['message'])
        self.assertNotIn('二维码', result['message'])

    def test_expiry_of_the_sites_initial_qr_does_not_close_manual_password_or_sms_login(self):
        state = self.state({'cookies': [], 'upstream_code': 800, 'closed': False})
        result = ios_browser.check_session(state)
        self.assertEqual(result['status'], 'waiting')
        state['browser_runtime'].close.assert_not_called()


class HealthAndCredentialScope(unittest.TestCase):
    def test_transport_failure_does_not_revoke_a_previously_verified_account(self):
        tracker = Tracker('netease')
        with request_credentials.bind({'netease': {'cookie': 'MUSIC_U=synthetic-session'}}):
            good = tracker.check(lambda: 'valid', force=True)
            self.assertTrue(good['verified'])
            def unavailable():
                raise OSError('synthetic TLS/network failure')
            failed = tracker.check(unavailable, force=True)
            self.assertEqual(failed['authState'], 'valid')
            self.assertTrue(failed['checkFailed'])
            self.assertFalse(failed['reauthRequired'])

    def test_explicit_expiry_is_distinct_from_a_rate_limit_or_unknown_response(self):
        self.assertEqual(session_status.classify({'code': 301}), 'expired')
        self.assertEqual(session_status.classify({'code': 200, 'account': None, 'profile': None}), 'expired')
        for response in ({'code': 429}, {'code': 8821}, {'code': 200}, None, {}):
            self.assertEqual(session_status.classify(response), 'unknown')

    def test_private_library_uses_this_request_cookie_and_its_csrf(self):
        with patch.object(transport, 'ne_weapi_post', return_value={
                'code': 200, 'account': {'id': 123}, 'profile': None}) as post:
            for cookie, csrf in [('MUSIC_U=first; __csrf=one', 'one'), ('MUSIC_U=second; __csrf=two', 'two')]:
                with request_credentials.bind({'netease': {'cookie': cookie}}):
                    library._request('/weapi/w/nuser/account/get', {})
                args, kwargs = post.call_args
                self.assertEqual(args[1]['csrf_token'], csrf)
                self.assertEqual(kwargs['cookie'], cookie)
        self.assertEqual(request_credentials.current(), {})

    def test_ios_protocol_crypto_works_without_the_desktop_crypto_extension(self):
        # A fresh interpreter avoids platform/config import caches. Compare
        # deterministic WEAPI encryption with a separately decrypted AES-CBC
        # round trip, without making any network request.
        code = r'''
import base64,json,os,socket,sys
sys.path.insert(0,sys.argv[1]);sys.path.insert(0,sys.argv[2])
os.environ['MINERADIO_IOS']='1'
def no_network(*args,**kwargs):raise AssertionError('network forbidden')
socket.create_connection=no_network
from music_app.providers.netease import config,transport
from unittest.mock import patch
assert config.AES.__module__=='music_app.ios_crypto'
payload={'csrf_token':'synthetic-csrf','ids':'[347230]','level':'standard'}
with patch.object(transport.os,'urandom',return_value=b'0123456789abcdef'):
    encoded=transport.ne_weapi_payload(payload)
key=base64.b64encode(b'0123456789abcdef')[:16]
outer=base64.b64decode(encoded['params'])
plain=config.AES.new(key,config.AES.MODE_CBC,config.ne_CBC_IV).decrypt(outer)
inner=base64.b64decode(plain[:-plain[-1]])
plain=config.AES.new(config.ne_CBC_KEY,config.AES.MODE_CBC,config.ne_CBC_IV).decrypt(inner)
assert json.loads(plain[:-plain[-1]])==payload
assert len(encoded['encSecKey'])==256
print('IOS_NETEASE_CRYPTO_PASS')
'''
        vendor = ROOT / 'iOS_ipa/src/mineradio/vendor'
        result = subprocess.run([sys.executable, '-c', code, str(ROOT), str(vendor)],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('IOS_NETEASE_CRYPTO_PASS', result.stdout)


if __name__ == '__main__':
    unittest.main()

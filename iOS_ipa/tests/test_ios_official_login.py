"""Official login origin boundaries and real music-session authorization gates."""
from pathlib import Path
import sys
import threading
import time
import unittest
import types
from unittest.mock import Mock, patch

PROJECT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PROJECT / 'src'), str(PROJECT.parent)]
from mineradio import official_login
from music_app.auth import ios_official
from music_app.auth import router
from music_app.web import auth_data
from music_app.core import request_credentials


def cookie(name, value, domain='.qq.com', expires=-1):
    return dict(name=name, value=value, domain=domain, expires=expires)


def session(provider, cookies):
    runtime = Mock()
    runtime.closed = threading.Event()
    runtime.call.return_value = {'cookies': cookies}
    return dict(provider=provider, browser_runtime=runtime, deadline=time.monotonic() + 600)


class OfficialMusicLoginTests(unittest.TestCase):
    def test_oauth_main_navigation_does_not_grant_native_messages(self):
        for url in ('https://y.qq.com/', 'https://graph.qq.com/oauth2.0/authorize',
                    'https://xui.ptlogin2.qq.com/cgi-bin/xlogin'):
            self.assertTrue(official_login.allowed_navigation(url, 'qq'))
        self.assertTrue(official_login.allowed_message_url('https://y.qq.com/', 'qq'))
        self.assertFalse(official_login.allowed_message_url('https://graph.qq.com/', 'qq'))
        self.assertFalse(official_login.allowed_message_url('https://xui.ptlogin2.qq.com/', 'qq'))
        self.assertFalse(official_login.allowed_navigation('https://y.qq.com.evil.example/', 'qq'))
        self.assertFalse(official_login.allowed_navigation('https://music.163.com/', 'qq'))

    def test_https_captcha_subframe_keeps_normal_sop_without_main_or_native_permission(self):
        url = 'https://captcha.example/verify'
        self.assertTrue(official_login.allowed_navigation(url, 'kugou', main_frame=False))
        self.assertFalse(official_login.allowed_navigation(url, 'kugou'))
        self.assertFalse(official_login.allowed_message_url(url, 'kugou'))
        for url in ('http://captcha.example/', 'https://user@captcha.example/', 'file:///account'):
            self.assertFalse(official_login.allowed_navigation(url, 'kugou', main_frame=False))

    def test_create_only_prepares_hidden_page_and_aliases_qqmusic(self):
        with patch.object(official_login, 'open', return_value={'manual_login': True}) as opened, \
                patch.object(official_login, 'show') as shown:
            created = ios_official.create_session('qqmusic')
        opened.assert_called_once_with(created['state']['browser_runtime'].key, provider='qq')
        self.assertTrue(created['manual_login'])
        self.assertEqual(created['qr_image'], '')
        shown.assert_not_called()

    def test_normal_qq_login_cannot_authorize_music(self):
        state = session('qq', [cookie('uin', '12345'), cookie('skey', 'synthetic'),
                               cookie('p_skey', 'synthetic')])
        with patch('music_app.web.account_health.check') as check:
            result = ios_official.check_session(state)
        self.assertEqual(result['status'], 'waiting')
        self.assertNotIn('cookie', result)
        check.assert_not_called()

    def test_qq_music_uid_normalizes_real_o_prefixed_zero_padding(self):
        self.assertEqual(ios_official._credentials('uin=o00012345; qqmusic_key2=synthetic', 'qq'), '12345')
        self.assertIsNone(ios_official._credentials('uin=o000; qqmusic_key2=synthetic', 'qq'))
        self.assertTrue(auth_data._valid_cookie('qq', 'uin=o00012345; qqmusic_key2=synthetic'))

    def test_only_ios_routes_official_method_and_keeps_real_session_ownership(self):
        adapter = types.SimpleNamespace(create_session=Mock(return_value={
            'manual_login': True, 'interactive_window': True, 'state': {}, 'expires_in': 600}),
            show_session=Mock(return_value=True), close_session=Mock(),
            check_session=Mock(return_value={'status': 'waiting'}))
        with patch.object(router, '_sessions', {}), patch.object(router, '_stopping', False), \
                patch.object(router, '_adapter', return_value=adapter), \
                patch('music_app.platform_runtime.is_ios', return_value=True), \
                patch.object(router.importlib, 'import_module', return_value=adapter):
            created = router.create('qqmusic', method='official')
            self.assertTrue(created['manual_login'])
            self.assertNotIn('qr_image', created)
            adapter.create_session.assert_called_once_with(platform='qqmusic')
            with self.assertRaises(router.AuthError):
                router.show('kugou', created['key'])
            adapter.show_session.assert_not_called()
            self.assertTrue(router.show('qqmusic', created['key'])['shown'])
        with patch.object(router, '_adapter', return_value=adapter), \
                patch('music_app.platform_runtime.is_ios', return_value=False):
            with self.assertRaises(router.AuthError):
                router.create('qqmusic', method='official')

    def test_manual_flag_without_a_native_window_cannot_replace_a_missing_qr(self):
        adapter = types.SimpleNamespace(create_session=Mock(return_value={
            'manual_login': True, 'interactive_window': True, 'state': {}, 'qr_url': ''}),
            close_session=Mock())
        with patch.object(router, '_sessions', {}), patch.object(router, '_stopping', False), \
                patch.object(router, '_adapter', return_value=adapter), patch.object(router, '_image', return_value=''):
            with self.assertRaises(router.AuthError):
                router.create('netease')
            adapter.close_session.assert_called_once()

    def test_foreign_expired_and_injected_music_keys_cannot_authorize(self):
        for item in (cookie('qqmusic_key', 'synthetic', 'evil.example'),
                     cookie('qqmusic_key', 'synthetic', expires=time.time() - 1),
                     cookie('qqmusic_key', 'synthetic; skey=injected')):
            with self.subTest(cookie=item), patch('music_app.web.account_health.check') as check:
                result = ios_official.check_session(session('qq', [cookie('uin', '12345'), item]))
                self.assertEqual(result['status'], 'waiting')
                check.assert_not_called()

    def test_music_key_requires_actual_private_health_and_uses_only_current_store_cookie(self):
        state = session('qq', [cookie('uin', '12345'), cookie('qm_keyst', 'synthetic-current'),
                               cookie('skey', 'synthetic-qq-ticket')])
        seen = []
        def check(provider, force):
            seen.append(request_credentials.current())
            self.assertEqual(provider, 'qq')
            self.assertTrue(force)
            return dict(authState='valid', verified=True, checkFailed=False)
        with request_credentials.bind({'qq': 'uin=88888; qm_keyst=synthetic-ambient'}), \
                patch('music_app.web.account_health.check', side_effect=check), \
                patch('music_app.web.account_profiles.read', return_value={'account': {'id': '12345', 'name': '测试'}}):
            result = ios_official.check_session(state)
            self.assertIn('synthetic-ambient', request_credentials.cookie('qq'))
        self.assertEqual(result['status'], 'authorized')
        self.assertIn('synthetic-current', seen[0]['qqmusic']['cookie'])
        self.assertNotIn('skey=', result['cookie'])
        self.assertNotIn('synthetic-ambient', result['cookie'])
        self.assertIs(ios_official.check_session(state), result)

    def test_network_error_and_stale_valid_health_are_waiting(self):
        cookies = [cookie('uin', '12345'), cookie('qqmusic_key', 'synthetic')]
        for response in (OSError('synthetic-network-error'),
                         dict(authState='valid', verified=True, checkFailed=True),
                         dict(authState='unknown', verified=False, checkFailed=False)):
            with self.subTest(response=response), patch('music_app.web.account_health.check') as check:
                if isinstance(response, Exception):
                    check.side_effect = response
                else:
                    check.return_value = response
                result = ios_official.check_session(session('qq', cookies))
                self.assertEqual(result['status'], 'waiting')
                self.assertNotIn('cookie', result)
                self.assertNotIn('synthetic', str(result))

    def test_kugou_legacy_cookie_parser_and_real_health_are_both_required(self):
        state = session('kugou', [cookie('KuGoo', 'KugooID%3D12345%26t%3Dsynthetic-token', '.kugou.com')])
        with patch('music_app.web.account_health.check', return_value={
                'authState': 'valid', 'verified': True, 'checkFailed': False}) as check, \
                patch('music_app.web.account_profiles.read', return_value={'account': {'id': '12345'}}):
            result = ios_official.check_session(state)
        self.assertEqual(result['status'], 'authorized')
        check.assert_called_once_with('kugou', force=True)

    def test_repeated_pending_poll_does_not_hammer_music_service(self):
        state = session('qq', [cookie('uin', '12345'), cookie('qqmusic_key', 'synthetic')])
        with patch('music_app.web.account_health.check', return_value={
                'authState': 'unknown', 'verified': False, 'checkFailed': True}) as check:
            self.assertEqual(ios_official.check_session(state)['status'], 'waiting')
            self.assertEqual(ios_official.check_session(state)['status'], 'waiting')
        check.assert_called_once()

    def test_closed_during_health_read_cannot_become_authorized(self):
        state = session('qq', [cookie('uin', '12345'), cookie('qqmusic_key', 'synthetic')])
        def check(*args, **kwargs):
            state['browser_runtime'].closed.set()
            return dict(authState='valid', verified=True, checkFailed=False)
        with patch('music_app.web.account_health.check', side_effect=check), \
                patch('music_app.web.account_profiles.read', side_effect=OSError()):
            result = ios_official.check_session(state)
        self.assertEqual(result['status'], 'cancelled')
        self.assertNotIn('authorized', state)


if __name__ == '__main__':
    unittest.main()

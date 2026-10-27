"""Exercise real router/official adapter concurrency without network or accounts."""
import sys
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'iOS_ipa/src'))

from music_app.auth import ios_official, router
from music_app.web import account_health


class OfficialWindowRouter(unittest.TestCase):
    def setUp(self):
        for guard in (
            patch.object(router, '_sessions', {}),
            patch.object(router, '_stopping', False),
            patch('socket.create_connection', side_effect=AssertionError('No fixture network')),
            patch('urllib.request.urlopen', side_effect=AssertionError('No fixture network')),
        ):
            guard.start()
            self.addCleanup(guard.stop)
        # Retain the actual runtime's key and closed checks; only native UIKit
        # operations are substituted. All cookies below are synthetic fixtures.
        self.runtime = object.__new__(ios_official._Runtime)
        self.runtime.provider, self.runtime.key = 'qq', 'a' * 32
        self.runtime.closed, self.runtime.native = threading.Event(), Mock()
        self.runtime.native.check.return_value = dict(cookies=[
            dict(name='uin', value='12345', domain='.qq.com', expires=-1),
            dict(name='qqmusic_key', value='synthetic-music-key', domain='.qq.com', expires=-1),
        ])
        self.state = dict(provider='qq', browser_runtime=self.runtime, deadline=time.monotonic() + 120)
        created = router._register_created('qqmusic', 'official', ios_official,
            dict(state=self.state, expires_in=120, manual_login=True, interactive_window=True))
        self.key, self.session = created['key'], router._sessions[created['key']]
        self.addCleanup(self.runtime.closed.set)

    def held_health_read(self, action):
        """Run action while the real check() owns the session's health lock."""
        entered, release, done = threading.Event(), threading.Event(), threading.Event()
        check_errors, outcome = [], {}

        def health(*args, **kwargs):
            entered.set()
            if not release.wait(4):
                raise AssertionError('Fixture health read was never released')
            return dict(verified=False, authState='unknown', checkFailed=True)

        def check():
            try:
                router.check('qqmusic', self.key)
            except BaseException as error:
                check_errors.append(error)

        def show():
            try:
                outcome['result'] = action()
            except BaseException as error:
                outcome['error'] = error
            finally:
                done.set()

        with patch.object(account_health, 'check', side_effect=health):
            checker = threading.Thread(target=check, daemon=True)
            opener = threading.Thread(target=show, daemon=True)
            checker.start()
            try:
                self.assertTrue(entered.wait(2), 'The real adapter must reach its private health read')
                self.assertTrue(self.session['lock'].locked())
                opener.start()
                # This must complete before the health read is allowed to end.
                responsive = done.wait(1)
                still_checking = checker.is_alive() and self.session['lock'].locked()
            finally:
                release.set()
                checker.join(2)
                if opener.ident is not None:
                    opener.join(2)
            self.assertFalse(checker.is_alive(), 'Fixture check thread must finish')
            self.assertFalse(opener.is_alive(), 'Fixture show thread must finish')
        self.assertEqual(check_errors, [])
        self.assertTrue(responsive, 'Showing an owned official window must not wait for health/session.lock')
        self.assertTrue(still_checking, 'The show result must arrive while health is still blocked')
        return outcome

    def test_show_remains_responsive_during_real_official_music_health_read(self):
        outcome = self.held_health_read(lambda: router.show('qqmusic', self.key))
        self.assertNotIn('error', outcome)
        self.assertTrue(outcome['result']['shown'])
        self.assertEqual(outcome['result']['platform'], 'qqmusic')
        self.runtime.native.show.assert_called_once_with(self.runtime.key)

    def test_closed_runtime_is_rejected_even_while_health_owns_session_lock(self):
        def close_then_show():
            self.runtime.closed.set()
            return router.show('qqmusic', self.key)
        outcome = self.held_health_read(close_then_show)
        self.assertNotIn('result', outcome)
        self.assertIsInstance(outcome['error'], router.AuthError)
        self.assertEqual(outcome['error'].code, 'official_login_closed')
        self.assertEqual(outcome['error'].status, 409)
        self.runtime.native.show.assert_not_called()

    def test_other_provider_cannot_show_the_owned_window_during_a_health_read(self):
        outcome = self.held_health_read(lambda: router.show('kugou', self.key))
        self.assertIsInstance(outcome.get('error'), router.AuthError)
        self.assertEqual(outcome['error'].code, 'login_session_missing')
        self.assertEqual(outcome['error'].status, 404)
        self.runtime.native.show.assert_not_called()

    def test_terminal_and_expired_sessions_never_reopen_native_windows(self):
        for status in ('authorized', 'cancelled', 'expired'):
            with self.subTest(status=status):
                self.session['result'] = dict(status=status)
                result = router.show('qqmusic', self.key)
                self.assertFalse(result['shown'])
                self.assertEqual(result['status'], status)
        self.session['result'] = dict(status='waiting')
        self.session['expires'] = time.monotonic() - 1
        self.assertEqual(router.show('qqmusic', self.key)['status'], 'expired')
        self.assertIsNone(self.session['state'])
        self.runtime.native.show.assert_not_called()
        self.runtime.native.close.assert_called_once_with(self.runtime.key)

    def test_noninteractive_missing_and_invalid_provider_do_not_enter_native_ui(self):
        self.session['interactive_window'] = False
        for provider, key, expected in (
            ('qqmusic', self.key, 'login_window_unavailable'),
            ('kugou', self.key, 'login_session_missing'),
            ('qqmusic', 'missing-fixture', 'login_session_missing'),
            ('unsupported', self.key, 'login_key_required'),
            ('qqmusic', '', 'login_key_required'),
        ):
            with self.subTest(provider=provider, key=key):
                with self.assertRaises(router.AuthError) as error:
                    router.show(provider, key)
                self.assertEqual(error.exception.code, expected)
        self.runtime.native.show.assert_not_called()


if __name__ == '__main__':
    unittest.main()

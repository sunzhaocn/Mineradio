"""Qishui phone boundaries; all upstream requests are synthetic and isolated."""
from pathlib import Path
import http.cookiejar
import os
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from music_app.auth.qishui import phone
from music_app.auth.qishui.common import AuthError, HOST


MOBILE = '13800000000'  # Synthetic fixture: never sent to an upstream service.
CAPTCHA = '123456'
ENCODED_MOBILE = '2e3d332534363d3535353535353535'
ENCODED_CAPTCHA = '343736313033'


class PhoneLoginBoundaries(unittest.TestCase):
    def setUp(self):
        self.clock = self.enterContext(patch.object(phone.time, 'time', return_value=1000.0))
        self.blank_state_factory = phone._new_state
        # Most protocol tests start after anonymous preparation. Dedicated
        # tests below clear this synthetic cookie to exercise the first call.
        self.enterContext(patch.object(phone, '_new_state', side_effect=self.seeded_state))
        self.request = self.enterContext(patch.object(phone, '_request'))
        # Keep any adapter helper reads on the same fake transport, never the
        # real urllib/browser, including future changes to authorization.
        self.enterContext(patch.object(phone.adapter, '_request', self.request))
        self.enterContext(patch('urllib.request.OpenerDirector.open',
                                side_effect=AssertionError('Unexpected network request')))
        self.enterContext(patch('socket.create_connection',
                                side_effect=AssertionError('Unexpected network connection')))

    def new_state(self):
        return phone.create_session()['state']

    def seeded_state(self):
        state = self.blank_state_factory()
        self.add_csrf(state)
        return state

    @staticmethod
    def add_csrf(state, name='passport_csrf_token'):
        state['jar'].set_cookie(http.cookiejar.Cookie(
            version=0, name=name, value='synthetic-csrf-only',
            port=None, port_specified=False, domain='.qishui.com',
            domain_specified=True, domain_initial_dot=True,
            path='/', path_specified=True, secure=True,
            expires=None, discard=True, comment=None, comment_url=None, rest={}))

    def assert_rejected(self, action, code=None):
        with self.assertRaises(AuthError) as caught:
            action()
        if code:
            self.assertEqual(caught.exception.code, code)
        return caught.exception

    def assert_secret_absent(self, value, secret):
        # Compare complete stored values: a numeric account/device ID may
        # coincidentally contain the same digits as a synthetic SMS code.
        if isinstance(value, dict):
            for item in value.values():
                self.assert_secret_absent(item, secret)
        elif isinstance(value, (list, tuple)):
            for item in value:
                self.assert_secret_absent(item, secret)
        elif isinstance(value, str):
            self.assertNotEqual(value, secret)

    @staticmethod
    def ok(data=None):
        return {'message': 'success', 'data': {'error_code': 0, **(data or {})}}

    def successful_transport(self, profile=None, cookie=True):
        if profile is None:
            profile = self.ok({'user_info': {'user_id': '123456789', 'nickname': '测试账号'}})

        def respond(state, route, **options):
            if route == '/passport/web/send_code/':
                return self.ok()
            if route == '/passport/web/sms_login/':
                return self.ok({'session_cookie': 'sessionid=unit-test-only-session'} if cookie else {})
            if route == '/passport/account/info/v2/':
                return profile
            self.fail('Unexpected upstream route: ' + route)
        self.request.side_effect = respond

    def test_creating_session_is_offline_and_has_an_isolated_ten_minute_lifetime(self):
        with patch.object(phone, '_new_state', self.blank_state_factory):
            first, second = phone.create_session(), phone.create_session()
        self.assertTrue(first['phone_login'])
        self.assertFalse(first.get('manual_login', False))
        self.assertEqual(first['expires_in'], 600)
        self.assertEqual(first['state']['expires_at'], 1600)
        self.assertIsNot(first['state']['jar'], second['state']['jar'])
        self.assertEqual(list(first['state']['jar']), [])
        self.assertNotIn('signed_runtime', first['state'])
        self.assertEqual(phone.check_session(first['state'])['status'], 'waiting')
        self.request.assert_not_called()

    def test_first_sms_prepares_csrf_in_the_same_session_without_exposing_or_polling_qr(self):
        state = self.new_state()
        state['jar'].clear()
        runtime = state['signed_runtime'] = Mock()
        qr_token, qr_url = 'discard-this-synthetic-qr-token', 'https://www.qishui.com/synthetic-qr'

        def respond(current, route, **options):
            self.assertIs(current, state)
            self.assertIs(current['signed_runtime'], runtime)
            if route == '/passport/web/get_qrcode/':
                self.assertNotIn('form', options)
                self.assertEqual(options['query']['next'], HOST)
                self.add_csrf(current)
                return self.ok({'token': qr_token, 'qrcode_index_url': qr_url,
                                'user_info': {'user_id': '777000777', 'nickname': 'discard-qr-account'}})
            if route == '/passport/web/send_code/':
                self.assertTrue(any(c.name == 'passport_csrf_token' for c in current['jar']))
                return self.ok()
            self.fail('Unexpected upstream route: ' + route)
        self.request.side_effect = respond

        self.assertTrue(phone.send_sms(state, MOBILE)['sms_sent'])
        self.assertEqual([call.args[1] for call in self.request.call_args_list],
                         ['/passport/web/get_qrcode/', '/passport/web/send_code/'])
        self.assertEqual(phone.check_session(state)['status'], 'waiting')
        self.assertFalse(phone.send_sms(state, MOBILE)['sms_sent'])
        self.assertEqual(self.request.call_count, 2)
        self.assertNotIn('token', state)
        self.assertNotIn('account', state)
        for value in (qr_token, qr_url, '777000777', 'discard-qr-account'):
            self.assert_secret_absent(state, value)
        self.assertFalse(any(c.name in ('sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard')
                             for c in state['jar']))
        runtime.close.assert_not_called()

    def test_first_login_prepares_csrf_before_submitting_code_without_sending_sms(self):
        state = self.new_state()
        state['jar'].clear()
        self.successful_transport()
        submit = self.request.side_effect

        def respond(current, route, **options):
            if route == '/passport/web/get_qrcode/':
                self.add_csrf(current)
                return self.ok({'token': 'discard-login-preparation-token'})
            return submit(current, route, **options)
        self.request.side_effect = respond
        result = phone.login_phone(state, MOBILE, captcha=CAPTCHA)
        self.assertEqual(result['status'], 'authorized')
        self.assertEqual([call.args[1] for call in self.request.call_args_list],
            ['/passport/web/get_qrcode/', '/passport/web/sms_login/', '/passport/account/info/v2/'])
        self.assertTrue(all(call.args[0] is state for call in self.request.call_args_list))
        self.assert_secret_absent(state, 'discard-login-preparation-token')
        self.assert_secret_absent(state, CAPTCHA)

    def test_default_csrf_cookie_also_skips_anonymous_preparation(self):
        for action in ('sms', 'login'):
            with self.subTest(action=action):
                self.request.reset_mock(side_effect=True)
                state = self.new_state()
                state['jar'].clear()
                self.add_csrf(state, 'passport_csrf_token_default')
                self.successful_transport()
                if action == 'sms':
                    self.assertTrue(phone.send_sms(state, MOBILE)['sms_sent'])
                else:
                    self.assertEqual(phone.login_phone(state, MOBILE, captcha=CAPTCHA)['status'], 'authorized')
                self.assertNotIn('/passport/web/get_qrcode/',
                                 [call.args[1] for call in self.request.call_args_list])

    def test_missing_csrf_stops_before_sending_sms_or_submitting_login(self):
        for action in ('sms', 'login'):
            with self.subTest(action=action):
                self.request.reset_mock(side_effect=True)
                state = self.new_state()
                state['jar'].clear()
                self.request.return_value = self.ok({'token': 'discard-unprepared-token'})
                if action == 'sms':
                    submit = lambda: phone.send_sms(state, MOBILE)
                else:
                    submit = lambda: phone.login_phone(state, MOBILE, captcha=CAPTCHA)
                self.assert_rejected(submit, 'qishui_phone_csrf_missing')
                self.assertEqual(self.request.call_count, 1)
                self.assertEqual(self.request.call_args.args[1], '/passport/web/get_qrcode/')
                self.assertNotIn('sms_next_at', state)
                self.assert_secret_absent(state, 'discard-unprepared-token')
                self.assert_secret_absent(state, CAPTCHA)

    def test_default_csrf_cookie_is_used_in_the_passport_request_header(self):
        from music_app.auth.qishui import transport
        state = self.new_state()
        state['jar'].clear()
        self.add_csrf(state, 'passport_csrf_token_default')
        with patch.object(transport, '_browser_request', return_value=self.ok()) as browser:
            transport._request(state, '/passport/web/send_code/', query=state['query'],
                               form={'mobile': ENCODED_MOBILE, 'type': '3731'})
        self.assertEqual(browser.call_count, 1)
        self.assertEqual(browser.call_args.args[2]['X-Tt-Passport-Csrf-Token'], 'synthetic-csrf-only')

    def test_sms_request_uses_pc_client_and_protocol_field_goldens(self):
        state = self.new_state()
        self.request.return_value = self.ok()
        result = phone.send_sms(state, MOBILE, '+86')
        self.assertTrue(result['sms_sent'])
        self.assertEqual(self.request.call_count, 1)
        args, options = self.request.call_args
        self.assertIs(args[0], state)
        self.assertEqual(args[1], '/passport/web/send_code/')
        self.assertEqual(options['query']['aid'], '386088')
        self.assertEqual(options['query']['device_id'], state['query']['device_id'])
        self.assertEqual(options['query']['install_id'], state['query']['install_id'])
        self.assertEqual(options['form'], {'mix_mode': '1', 'fixed_mix_mode': '1',
            'is6Digits': '1', 'mobile': ENCODED_MOBILE, 'type': '3731'})

    def test_sms_cooldown_covers_duplicate_submissions_and_uncertain_delivery(self):
        for uncertain in (False, True):
            with self.subTest(uncertain_delivery=uncertain):
                self.request.reset_mock(side_effect=True)
                state = self.new_state()
                if uncertain:
                    self.request.side_effect = AuthError(502, 'test_timeout', 'synthetic timeout')
                    self.assert_rejected(lambda: phone.send_sms(state, MOBILE), 'test_timeout')
                else:
                    self.request.return_value = self.ok()
                    phone.send_sms(state, MOBILE)
                result = phone.send_sms(state, MOBILE)
                self.assertEqual(result['status'], 'cooldown')
                self.assertFalse(result['sms_sent'])
                self.assertGreater(result['retry_after'], 0)
                self.assertEqual(self.request.call_count, 1)

    def test_sms_can_be_sent_again_only_after_the_cooldown_and_an_explicit_call(self):
        state = self.new_state()
        self.request.return_value = self.ok()
        phone.send_sms(state, MOBILE)
        self.clock.return_value = 1061.0
        self.assertEqual(self.request.call_count, 1)
        phone.send_sms(state, MOBILE)
        self.assertEqual(self.request.call_count, 2)

    def test_invalid_phone_or_country_never_reaches_upstream(self):
        for number, country in (('invalid', '86'), ('123', '86'), (MOBILE, '0'),
                                (MOBILE, '86;injected=1')):
            with self.subTest(number=number, country=country):
                self.assert_rejected(lambda: phone.send_sms(self.new_state(), number, country),
                                     'qishui_phone_invalid')
        self.request.assert_not_called()

    def test_invalid_code_or_unsupported_password_never_reaches_upstream(self):
        state = self.new_state()
        for value in ('', '12x456', '123', '1234', '12345', '1234567', '123456789'):
            with self.subTest(code=value):
                self.assert_rejected(lambda: phone.login_phone(state, MOBILE, captcha=value),
                                     'qishui_code_invalid')
        self.assert_rejected(lambda: phone.login_phone(state, MOBILE,
            password='synthetic-password-never-sent', captcha=CAPTCHA), 'qishui_password_unavailable')
        self.request.assert_not_called()
        self.assertNotIn('synthetic-password-never-sent', repr(state))

    def test_login_uses_same_state_service_and_mixed_fields_without_sending_an_sms(self):
        state = self.new_state()
        self.successful_transport()
        result = phone.login_phone(state, MOBILE, captcha=CAPTCHA)
        self.assertEqual(result['status'], 'authorized')
        first = self.request.call_args_list[0]
        self.assertIs(first.args[0], state)
        self.assertEqual(first.args[1], '/passport/web/sms_login/')
        self.assertEqual(first.kwargs['query']['aid'], '386088')
        form = first.kwargs['form']
        self.assertEqual(form['service'], HOST)
        self.assertEqual(form['login_only'], 'true')
        self.assertEqual(form['mix_mode'], '1')
        self.assertEqual(form['fixed_mix_mode'], '1')
        self.assertEqual(form['mobile'], ENCODED_MOBILE)
        self.assertEqual(form['code'], ENCODED_CAPTCHA)
        self.assertNotIn('is6Digits', form)
        self.assertNotIn('/passport/web/send_code/', [call.args[1] for call in self.request.call_args_list])
        self.assert_secret_absent(state, CAPTCHA)
        self.assert_secret_absent(state, ENCODED_CAPTCHA)

    def test_sending_then_logging_in_reuses_the_current_client_and_security_session(self):
        state = self.new_state()
        runtime = state['signed_runtime'] = Mock()
        self.successful_transport()
        phone.send_sms(state, MOBILE)
        phone.login_phone(state, MOBILE, captcha=CAPTCHA)
        self.assertTrue(all(call.args[0] is state for call in self.request.call_args_list))
        self.assertEqual({call.kwargs['query']['device_id'] for call in self.request.call_args_list},
                         {state['query']['device_id']})
        runtime.close.assert_called_once()

    def test_cookie_alone_does_not_establish_an_authenticated_account(self):
        self.successful_transport(profile=self.ok())
        self.assert_rejected(lambda: phone.login_phone(self.new_state(), MOBILE, captcha=CAPTCHA),
                             'qishui_phone_account_missing')

    def test_profile_without_a_new_session_cookie_does_not_establish_login(self):
        self.successful_transport(cookie=False)
        self.assert_rejected(lambda: phone.login_phone(self.new_state(), MOBILE, captcha=CAPTCHA),
                             'qishui_phone_cookie_missing')
        self.assertEqual(self.request.call_count, 1)

    def test_profile_failure_does_not_return_authorized_even_with_a_cookie(self):
        self.successful_transport(profile={'message': 'error', 'data': {'error_code': 13}})
        self.assert_rejected(lambda: phone.login_phone(self.new_state(), MOBILE, captcha=CAPTCHA),
                             'qishui_phone_account_missing')

    def test_profile_error_code_cannot_be_masked_by_a_success_message_and_user_id(self):
        for location in ('outer', 'data'):
            with self.subTest(error_location=location):
                profile = self.ok({'user_info': {'user_id': '987654321'}})
                (profile if location == 'outer' else profile['data'])['error_code'] = 13
                self.successful_transport(profile=profile)
                self.assert_rejected(lambda: phone.login_phone(self.new_state(), MOBILE, captcha=CAPTCHA),
                                     'qishui_phone_account_missing')

    def test_profile_requires_a_positive_numeric_account_id(self):
        for identity in ('', '0', '-1', 'not-an-account', True):
            with self.subTest(account_id=identity):
                self.successful_transport(profile=self.ok({'user_info': {'user_id': identity}}))
                self.assert_rejected(lambda: phone.login_phone(self.new_state(), MOBILE, captcha=CAPTCHA),
                                     'qishui_phone_account_missing')

    def test_malformed_or_unsuccessful_upstream_envelopes_never_acknowledge_sms_delivery(self):
        responses = [None, {}, {'data': {}}, {'data': {'error_code': 0}},
                     {'message': 'success', 'data': None},
                     {'message': 'error', 'data': {'error_code': 0}},
                     {'message': 'success', 'data': {'error_code': 'invalid'}}]
        for response in responses:
            with self.subTest(response=response):
                self.request.reset_mock(side_effect=True)
                self.request.return_value = response
                self.assert_rejected(lambda: phone.send_sms(self.new_state(), MOBILE))
                self.assertEqual(self.request.call_count, 1)

    def test_rejected_login_does_not_retry_or_request_another_sms(self):
        for code in (16, 1105, 2032, 1454):
            with self.subTest(error_code=code):
                self.request.reset_mock(side_effect=True)
                self.request.return_value = {'message': 'error', 'data': {'error_code': code}}
                state = self.new_state()
                self.assert_rejected(lambda: phone.login_phone(state, MOBILE, captcha=CAPTCHA),
                                     'qishui_phone_rejected_' + str(code))
                self.assertEqual(self.request.call_count, 1)
                self.assert_secret_absent(state, CAPTCHA)

    def test_security_challenge_waits_for_user_action_without_resending(self):
        state = self.new_state()
        runtime = state['signed_runtime'] = Mock()
        self.request.return_value = {'message': 'error', 'data': {
            'error_code': 2046, 'verify_center_decision_conf': 'synthetic-challenge'}}
        result = phone.send_sms(state, MOBILE)
        self.assertTrue(result['verification_required'])
        self.assertTrue(state['mfa_pending'])
        self.assertEqual(runtime.call.call_args.args[0], 'verify_start')
        self.assertTrue(runtime.call.call_args.args[1]['phone'])
        self.assert_rejected(lambda: phone.send_sms(state, MOBILE), 'qishui_phone_verification')
        self.assertEqual(self.request.call_count, 1)
        runtime.call.return_value = {'status': True}
        checked = phone.check_session(state)
        self.assertEqual(checked['status'], 'waiting')
        self.assertFalse(state['mfa_pending'])
        self.assertEqual(self.request.call_count, 1)

    def test_expired_session_cannot_send_or_login_and_polling_never_sends(self):
        state = self.new_state()
        self.assertEqual(phone.check_session(state)['status'], 'waiting')
        self.clock.return_value = 1600.0
        self.assert_rejected(lambda: phone.send_sms(state, MOBILE), 'qishui_phone_expired')
        self.assert_rejected(lambda: phone.login_phone(state, MOBILE, captcha=CAPTCHA),
                             'qishui_phone_expired')
        self.assertEqual(phone.check_session(state)['status'], 'expired')
        self.request.assert_not_called()


class PhonePlatformBoundaries(unittest.TestCase):
    def setUp(self):
        from music_app.auth import router
        self.router = router
        self.enterContext(patch.object(router, '_sessions', {}))
        self.enterContext(patch.object(router, '_stopping', False))
        self.enterContext(patch('urllib.request.OpenerDirector.open',
                                side_effect=AssertionError('Unexpected network request')))

    def qishui_session(self):
        adapter = SimpleNamespace(AuthError=self.router.AuthError,
            send_sms=Mock(return_value={'status': 'waiting', 'sms_sent': True}))
        result = self.router._register_created('qishui', 'phone', adapter,
            {'state': {}, 'expires_in': 600}, requires_qr=False)
        return result['key'], adapter

    def test_netease_api_route_cannot_send_with_a_qishui_session_key(self):
        from music_app.api import router as api_router
        from music_app.api.params import RequestParams
        key, adapter = self.qishui_session()
        status, result = api_router.dispatch_request('/login/netease/sms/send',
            RequestParams(''), method='POST', payload={'key': key, 'phone': MOBILE}, credentials={})
        self.assertEqual(status, 404)
        self.assertEqual(result['code'], 'login_session_missing')
        adapter.send_sms.assert_not_called()

    def test_phone_action_requires_the_matching_platform_before_invoking_the_adapter(self):
        key, adapter = self.qishui_session()
        with self.assertRaises(self.router.AuthError) as caught:
            self.router.phone_action('send_sms', key, phone=MOBILE)
        self.assertEqual(caught.exception.code, 'login_session_missing')
        adapter.send_sms.assert_not_called()
        result = self.router.phone_action('send_sms', key, expected_platform='qishui', phone=MOBILE)
        self.assertEqual(result['platform'], 'qishui')
        adapter.send_sms.assert_called_once_with({}, phone=MOBILE)

    def test_local_auth_checks_provider_ownership_and_passes_the_explicit_platform(self):
        from music_app.web.authbridge import LocalAuth
        from music_app.web.auth_security import LocalAuthError
        key, client = 'k' * 43, 'c' * 32
        stub = SimpleNamespace(
            create=Mock(return_value={'key': key, 'status': 'waiting', 'method': 'phone'}),
            phone_action=Mock(return_value={'status': 'waiting', 'sms_sent': True}))
        auth = LocalAuth(auth=stub)
        with patch.dict(os.environ, MINERADIO_IOS='1'):
            auth.handle('session', {'provider': 'qishui', 'method': 'sms', 'client_id': client})
            with self.assertRaises(LocalAuthError) as caught:
                auth.handle('sms', {'provider': 'netease', 'key': key, 'phone': MOBILE, 'client_id': client})
            self.assertEqual(caught.exception.code, 'login_session_missing')
            stub.phone_action.assert_not_called()
            result = auth.handle('sms', {'provider': 'qishui', 'key': key, 'phone': MOBILE, 'client_id': client})
        self.assertTrue(result['sms_sent'])
        stub.phone_action.assert_called_once_with('send_sms', key,
            expected_platform='qishui', phone=MOBILE)


if __name__ == '__main__':
    unittest.main()

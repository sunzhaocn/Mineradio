"""Host checks for the isolated Passport wrapper and adapter boundary."""
import importlib
from ctypes import c_double, c_void_p
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PROJECT / 'src'), str(PROJECT.parent)]
from mineradio import passport


class PassportWrapperTests(unittest.TestCase):
    def assets(self):
        page = ('<html><head><script src="react.js"></script>'
                '<script src="react-dom.js"></script><script src="sdk-glue.js"></script>'
                '<script>function loadVerifyScript(url) { return true; }</script></head></html>')
        return {'security_seed.html': b'<html></html>', 'security_host.html': page.encode(),
                'react.js': b'window.React={};', 'react-dom.js': b'window.ReactDOM={};',
                'sdk-glue.js': b'window._SdkGlueInit=function(){};', 'bdms.js': b'window.bdms={};'}

    def test_wrapper_contains_only_pinned_inline_bootstrap(self):
        html = passport.build_security_html(self.assets(), 'unit_test_token==')
        self.assertNotIn('src="react.js"', html)
        self.assertNotIn('src="sdk-glue.js"', html)
        self.assertIn('data:text/javascript;base64,', html)
        self.assertIn("localStorage.setItem('xmst'", html)
        self.assertIn('__qishuiIOSAllowedResource', html)

    def test_missing_asset_and_markup_tokens_rejected(self):
        assets = self.assets()
        del assets['bdms.js']
        with self.assertRaises(ValueError):
            passport.build_security_html(assets, 'token')
        with self.assertRaises(ValueError):
            passport.build_security_html(self.assets(), '</SCRIPT><script>alert(1)</script>')

    def test_requests_have_exact_official_authority(self):
        self.assertTrue(passport.allowed_request_url('https://api.qishui.com/passport/web/get_qrcode/?aid=386088'))
        for value in ('http://api.qishui.com/passport/', 'https://api.qishui.com.evil.example/passport/',
                      'https://user@api.qishui.com/passport/', 'https://api.qishui.com:8443/passport/',
                      'https://127.0.0.1/', 'file:///private/config.json'):
            self.assertFalse(passport.allowed_request_url(value), value)

    def test_verification_resources_use_real_domain_suffixes(self):
        self.assertTrue(passport.allowed_resource_url('https://verify.zijieapi.com/component.js'))
        self.assertTrue(passport.allowed_resource_url('https://lf-c-flwb.bytetos.com/official.js'))
        self.assertFalse(passport.allowed_resource_url('https://zijieapi.com.evil.example/script.js'))
        self.assertFalse(passport.allowed_resource_url('javascript:alert(1)'))


class IOSAdapterTests(unittest.TestCase):
    def setUp(self):
        self.native = types.SimpleNamespace(open=lambda key, token: 'fingerprint',
            call=lambda *args: {'_aBogusLength':44, '_msTokenMatches':True,
                               'status':200, 'body':'{}', 'cookies':[]},
            close=lambda key: None, show=lambda key: True)
        self.module = importlib.import_module('music_app.auth.qishui.ios_browser')

    def state(self):
        return {'ms_token':'test_token==', 'jar':[]}

    def test_signature_metadata_is_required_and_not_returned(self):
        with patch('mineradio.passport.open', self.native.open), patch('mineradio.passport.call', self.native.call):
            browser = self.module.IOSSignedBrowser(self.state())
            result = browser.call('request', {'url':'https://api.qishui.com/passport/test/?aid=386088'})
        self.assertEqual(result['status'], 200)
        self.assertNotIn('_aBogusLength', result)
        self.assertNotIn('_msTokenMatches', result)

    def test_signature_failure_remains_failure(self):
        from music_app.auth.qishui.common import AuthError
        with patch('mineradio.passport.open', self.native.open), patch('mineradio.passport.call',
                lambda *args: {'_aBogusLength':0, '_msTokenMatches':False}):
            browser = self.module.IOSSignedBrowser(self.state())
            with self.assertRaises(AuthError) as result:
                browser.call('request', {'url':'https://api.qishui.com/passport/test/'})
        self.assertEqual(result.exception.code, 'qishui_security_signature')

    def test_user_open_is_separate_from_verify_start(self):
        operations = []
        with patch('mineradio.passport.open', self.native.open), patch('mineradio.passport.call',
                lambda key, method, payload: operations.append(method) or True), patch('mineradio.passport.show',
                lambda key: operations.append('show')):
            browser = self.module.IOSSignedBrowser(self.state())
            browser.call('verify_start', {'decision':{}, 'options':{}})
            self.assertEqual(operations, ['verify_start'])
            browser.show()
        self.assertEqual(operations, ['verify_start', 'show'])


class CookieDateABITests(unittest.TestCase):
    def test_expiry_uses_explicit_double_selector_instead_of_bound_getter(self):
        calls = []
        date = types.SimpleNamespace(timeIntervalSince1970=lambda: 1700000000.25)
        cookie = object()
        objc = types.ModuleType('rubicon.objc')
        objc.objc_id = c_void_p
        objc.ObjCInstance = lambda reference: date
        runtime = types.ModuleType('rubicon.objc.runtime')
        def send_message(receiver, selector, *, restype):
            calls.append((selector, restype))
            return c_void_p(1) if selector == 'expiresDate' else 1700000000.25
        runtime.send_message = send_message
        with patch.dict(sys.modules, {'rubicon': types.ModuleType('rubicon'),
                'rubicon.objc':objc, 'rubicon.objc.runtime':runtime}):
            value = passport._cookie_expiration(cookie)
        self.assertEqual(value, 1700000000.25)
        self.assertEqual(calls, [('expiresDate', c_void_p), ('timeIntervalSince1970', c_double)])

    def test_session_cookie_without_expiry_does_not_call_date_method(self):
        runtime = types.ModuleType('rubicon.objc.runtime')
        runtime.send_message = lambda *args, **kwargs: c_void_p()
        objc = types.ModuleType('rubicon.objc')
        objc.objc_id = c_void_p
        objc.ObjCInstance = lambda reference: self.fail('No NSDate exists for a session cookie')
        with patch.dict(sys.modules, {'rubicon':types.ModuleType('rubicon'),
                'rubicon.objc':objc, 'rubicon.objc.runtime':runtime}):
            self.assertEqual(passport._cookie_expiration(object()), -1)


if __name__ == '__main__':
    unittest.main()

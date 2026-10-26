"""iOS routing, official navigation and the same-store MUSIC_U authorization gate."""
from pathlib import Path
import json
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch

PROJECT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PROJECT / 'src'), str(PROJECT.parent)]
from mineradio import official_login
from music_app.auth.netease import ios_browser, qr, browser


class OfficialLoginTests(unittest.TestCase):
    def test_only_ios_selects_native_webkit_backend(self):
        with patch('music_app.platform_runtime.is_ios', return_value=True):
            self.assertIs(qr._browser_module(), ios_browser)
        with patch('music_app.platform_runtime.is_ios', return_value=False):
            self.assertIs(qr._browser_module(), browser)

    def test_main_navigation_stays_with_real_official_domains(self):
        for value in ('https://music.163.com/', 'https://reg.163.com/login', 'https://c.dun.163.com/verify'):
            self.assertTrue(official_login.allowed_navigation(value))
        for value in ('http://music.163.com/', 'https://music.163.com.evil.example/',
                      'https://user@music.163.com/', 'https://music.163.com:8443/',
                      'javascript:alert(1)', 'file:///private/account.json'):
            self.assertFalse(official_login.allowed_navigation(value))

    def test_create_keeps_native_canvas_and_does_not_present_a_window(self):
        original = 'data:image/png;base64,c3ludGhldGlj'
        with patch.object(official_login, 'open', return_value={'qr_image':original, 'qr_url':''}) as opened, \
                patch.object(official_login, 'show') as shown:
            created = ios_browser.create_session()
        self.assertEqual(created['qr_image'], original)
        self.assertTrue(created['interactive_window'])
        self.assertIs(created['state']['browser_runtime'].native, official_login)
        self.assertEqual(len(opened.call_args.args[0]), 32)
        shown.assert_not_called()

    def test_manual_official_window_does_not_fabricate_a_qr(self):
        with patch.object(official_login, 'open', return_value={'manual_login':True}), \
                patch.object(official_login, 'show') as shown:
            created = ios_browser.create_session()
        self.assertTrue(created['manual_login'])
        self.assertTrue(created['interactive_window'])
        self.assertEqual(created['qr_image'], '')
        self.assertEqual(created['qr_url'], '')
        self.assertIn('官网', created['message'])
        shown.assert_not_called()

    def test_manual_waiting_requires_user_to_open_the_same_official_window(self):
        runtime = Mock()
        runtime.call.return_value = {'cookies':[], 'page_loading':True}
        result = ios_browser.check_session({'browser_runtime':runtime, 'manual_login':True})
        self.assertEqual(result['status'], 'waiting')
        self.assertIn('密码与验证码只在官网输入', result['message'])
        self.assertNotIn('cookie', result)

    def test_803_or_foreign_expired_cookies_never_authorize(self):
        runtime = Mock()
        state = {'browser_runtime':runtime}
        runtime.call.return_value = {'upstream_code':803, 'cookies':[
            {'name':'MUSIC_U','value':'synthetic-foreign','domain':'evil.example','expires':-1},
            {'name':'MUSIC_U','value':'synthetic-expired','domain':'.music.163.com','expires':time.time()-1},
            {'name':'__csrf','value':'synthetic-csrf','domain':'.music.163.com','expires':-1}]}
        result = ios_browser.check_session(state)
        self.assertEqual(result['status'], 'scanned')
        self.assertNotIn('cookie', result)
        self.assertNotIn('authorized', state)

    def test_current_store_music_u_authorizes_and_result_is_sticky(self):
        runtime = Mock()
        runtime.call.return_value = {'upstream_code':8821, 'verification_required':True,
            'cookies':[{'name':'MUSIC_U','value':'synthetic-current-store','domain':'.music.163.com','expires':-1}],
            'account_lookup_failed':True}
        state = {'browser_runtime':runtime}
        result = ios_browser.check_session(state)
        self.assertEqual(result['status'], 'authorized')
        self.assertEqual(result['account'], {})
        self.assertNotIn('synthetic-current-store', json.dumps(result['diagnostics']))
        self.assertIs(ios_browser.check_session(state), result)
        runtime.call.assert_called_once_with('check')

    def test_show_and_close_keep_exact_login_key(self):
        with patch.object(official_login,'show',return_value=True) as shown, patch.object(official_login,'close') as closed:
            runtime = ios_browser._OfficialIOSBrowser({})
            state = {'browser_runtime':runtime}
            ios_browser.show_session(state)
            ios_browser.close_session(state)
        shown.assert_called_once_with(runtime.key)
        closed.assert_called_once_with(runtime.key)
        self.assertTrue(runtime.closed.is_set())

    def test_failed_create_closes_native_flow_and_is_not_a_success_placeholder(self):
        with patch.object(official_login,'open',side_effect=RuntimeError('synthetic startup failure')), \
                patch.object(official_login,'close') as closed:
            with self.assertRaises(ios_browser.AuthError):
                ios_browser.create_session()
        closed.assert_called_once()

    def test_response_observer_reports_codes_but_not_qr_or_session_values(self):
        script = r'''
const vm=require('node:vm'),assert=require('node:assert/strict');
let source='';process.stdin.on('data',x=>source+=x);process.stdin.on('end',()=>{
 const posts=[];class XHR {
  open(){this.arguments=[...arguments];}
  addEventListener(name,handler){this.handler=handler;}
 }
 const ctx={URL,XMLHttpRequest:XHR,location:{hostname:'music.163.com',href:'https://music.163.com/'},
  webkit:{messageHandlers:{mineradioNeteaseLogin:{postMessage:value=>posts.push(value)}}}};
 ctx.window=ctx;vm.runInNewContext(JSON.parse(source),ctx);
 const xhr=new XHR();xhr.open('POST','/weapi/login/qrcode/client/login');
 assert.equal(xhr.arguments[0],'POST');
 xhr.responseURL='https://music.163.com/weapi/login/qrcode/client/login?codekey=synthetic-ticket';
 xhr.status=200;xhr.responseType='json';xhr.response={code:'803',cookie:'synthetic-private-cookie',ticket:'synthetic-ticket'};
 xhr.handler.call(xhr);assert.equal(posts.length,1);assert.equal(posts[0].code,803);
 assert.equal(posts[0].path,'/weapi/login/qrcode/client/login');
 assert.ok(!JSON.stringify(posts).includes('synthetic-'));
 xhr.responseURL='https://music.163.com.evil.example/weapi/login/qrcode/client/login';xhr.handler.call(xhr);
 assert.equal(posts.length,1);
 console.log('Official response observer boundary passed');
});'''
        result = subprocess.run(['node','-e',script], input=json.dumps(official_login.OBSERVER),
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()

"""OAuth window recovery and same-flow music credential boundaries; no network."""
import asyncio
import importlib
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'iOS_ipa/src'))
from mineradio import official_login as native
from music_app.auth import ios_official as auth
from music_app.providers.kugou.transport import kg_cookie_fields


def cookie(name, value, domain):
    return dict(name=name, value=value, domain=domain, expires=-1)


class NoNetwork:
    def setUp(self):
        super().setUp()
        for target in ('socket.create_connection', 'urllib.request.urlopen'):
            guard = patch(target, side_effect=AssertionError('Official login fixture must not access the network'))
            guard.start()
            self.addCleanup(guard.stop)


class CookieBoundaries(NoNetwork, unittest.TestCase):
    def test_qq_retains_music_sso_fields_but_generic_qq_login_is_insufficient(self):
        header = auth._cookie_header([
            cookie('uin', '12345', '.qq.com'), cookie('skey', 'qq-only', '.qq.com'),
            cookie('wxopenid', 'fresh-open-id', '.qq.com'),
            cookie('psrf_qqaccess_token', 'fresh-access', '.qq.com'),
            cookie('foreign', 'never-read', 'unrelated.example')], 'qq')
        self.assertIn('wxopenid=fresh-open-id', header)
        self.assertIn('psrf_qqaccess_token=fresh-access', header)
        self.assertNotIn('foreign', header)
        self.assertIsNone(auth._credentials(header, 'qq'))
        self.assertEqual(auth._credentials(header + '; qqmusic_key=music-only', 'qq'), '12345')

    def test_credential_delimiters_and_foreign_cookie_domains_are_rejected(self):
        header = auth._cookie_header([
            cookie('qqmusic_key', 'music;injected=1', '.qq.com'),
            cookie('qqmusic_key', 'foreign', '.evil.qq.com'),
            cookie('uin', '12345', '.qq.com')], 'qq')
        self.assertEqual(header, 'uin=12345')

    def test_kugou_preserves_distinct_client_and_web_tokens_for_one_identity(self):
        header = 'KuGoo=KugooID%3D12345%26t%3Dweb-only; kg_mid=this-flow'
        joined = auth._kugou_music_cookie(header, {'client_authorization': {
            'token': 'client-only', 'userid': '12345'}})
        fields = kg_cookie_fields(joined)
        self.assertEqual(fields['uid'], '12345')
        self.assertEqual(fields['token'], 'web-only')
        self.assertEqual(fields['cloud_token'], 'client-only')
        self.assertEqual(fields['mid'], 'this-flow')

    def test_kugou_cannot_join_another_account_or_an_unvalidated_token(self):
        header = 'KuGoo=KugooID%3D12345%26t%3Dweb-only'
        for supplied in ({'token': 'client', 'userid': '54321'},
                         {'token': 'bad;injection=1', 'userid': '12345'},
                         {'token': '', 'userid': '12345'}, 'untrusted'):
            with self.subTest(supplied=supplied):
                self.assertEqual(auth._kugou_music_cookie(header, {'client_authorization': supplied}), '')

    def test_kugou_without_new_client_authorization_keeps_existing_web_fields(self):
        header = 'KuGoo=KugooID%3D12345%26t%3Dweb-only'
        self.assertEqual(auth._kugou_music_cookie(header, {}), header)

    def test_native_client_response_accepts_only_expected_route_and_complete_identity(self):
        base = dict(path='/v2/get_userinfo_qrcode', token='new-client', userid='12345')
        self.assertEqual(native.kugou_client_authorization(base), dict(token='new-client', userid='12345'))
        for changes in ({'path': '/v1/login'}, {'userid': '0'}, {'token': 'a\nb'}, {'token': 'a;b'}):
            self.assertIsNone(native.kugou_client_authorization({**base, **changes}))

    def test_kugou_authorization_still_requires_a_successful_private_music_read(self):
        runtime = Mock()
        runtime.closed = threading.Event()
        runtime.call.return_value = dict(cookies=[cookie('KuGoo', 'KugooID%3D12345%26t%3Dweb-only', '.kugou.com')],
            client_authorization=dict(token='client-only', userid='12345'))
        state = dict(provider='kugou', browser_runtime=runtime, deadline=float('inf'))
        with patch('music_app.web.account_health.check', return_value=dict(verified=False, authState='unknown', checkFailed=True)):
            self.assertEqual(auth.check_session(state)['status'], 'waiting')
        self.assertNotIn('authorized', state)
        state.pop('last_digest', None)
        with patch('music_app.web.account_health.check', return_value=dict(verified=True, authState='valid', checkFailed=False)), \
                patch('music_app.web.account_profiles.read', return_value={'account': {'id': '12345', 'name': 'fixture'}}):
            result = auth.check_session(state)
        self.assertEqual(result['status'], 'authorized')
        self.assertEqual(kg_cookie_fields(result['cookie'])['cloud_token'], 'client-only')

    def test_generic_qq_login_never_reaches_music_authorization(self):
        runtime = Mock()
        runtime.closed = threading.Event()
        runtime.call.return_value = dict(cookies=[cookie('uin', '12345', '.qq.com'), cookie('skey', 'qq-only', '.qq.com')])
        state = dict(provider='qq', browser_runtime=runtime, deadline=float('inf'))
        with patch('music_app.web.account_health.check') as health:
            self.assertEqual(auth.check_session(state)['status'], 'waiting')
        health.assert_not_called()
        self.assertNotIn('authorized', state)


class FakeView:
    def __init__(self):
        self.stopped = False
        self.children = []
        self.loaded_requests = []

    def removeFromSuperview(self):
        pass

    def addSubview(self, view):
        self.children.append(view)

    def stopLoading(self):
        self.stopped = True

    def loadRequest(self, request):
        self.loaded_requests.append(request)


class WindowLifecycle(NoNetwork, unittest.IsolatedAsyncioTestCase):
    def flow(self, provider='qq'):
        flow = native._Flow(Mock(), 'a' * 32, provider)
        flow.view, flow.container, flow.delegate, flow.data_store = FakeView(), FakeView(), object(), object()
        return flow

    async def test_reopen_waits_for_native_dismissal_instead_of_losing_the_button(self):
        flow = self.flow()
        flow.dismissal = asyncio.get_running_loop().create_future()
        flow._present = Mock(return_value=True)
        showing = asyncio.create_task(flow.show())
        await asyncio.sleep(0)
        flow._present.assert_not_called()
        flow.dismissal.set_result(True)
        self.assertTrue(await showing)
        flow._present.assert_called_once()

    async def test_closed_flow_cannot_reopen_after_waiting_for_dismissal(self):
        flow = self.flow()
        flow.dismissal = asyncio.get_running_loop().create_future()
        flow._present = Mock()
        showing = asyncio.create_task(flow.show())
        await asyncio.sleep(0)
        flow.closed = True
        flow.dismissal.set_result(True)
        with self.assertRaises(RuntimeError):
            await showing
        flow._present.assert_not_called()

    async def test_popup_uses_webkit_configuration_and_keeps_the_original_opener_page(self):
        flow = self.flow()
        child = FakeView()
        builder = Mock()
        builder.alloc.return_value.initWithFrame.return_value = child
        objc = types.ModuleType('rubicon.objc')
        objc.ObjCClass = Mock(return_value=builder)
        config = types.SimpleNamespace(websiteDataStore=None)
        with patch.dict(sys.modules, {'rubicon': types.ModuleType('rubicon'), 'rubicon.objc': objc}):
            returned = flow.create_popup(config)
        self.assertIs(returned, child)
        self.assertIs(config.websiteDataStore, flow.data_store)
        self.assertIs(builder.alloc.return_value.initWithFrame.call_args.kwargs['configuration'], config)
        self.assertIs(child.navigationDelegate, flow.delegate)
        self.assertIs(child.UIDelegate, flow.delegate)
        self.assertEqual(flow.view.loaded_requests, [], 'No OAuth navigation replaces the music opener')
        self.assertEqual(child.loaded_requests, [], 'WebKit loads its new-window request itself exactly once')
        self.assertIn(flow.view, flow.container.children)
        flow.close_popup(child)
        self.assertTrue(child.stopped)
        self.assertIs(flow.active_view(), flow.view)

    async def test_late_dismissal_callback_does_not_close_a_reopened_window(self):
        flow = self.flow()
        old, new = object(), object()
        flow.presentation = new
        flow.visible_controller = object()
        flow.presentation_dismissed(old)
        self.assertIs(flow.presentation, new)

    async def test_host_awaits_the_ui_reopen_operation(self):
        host = native._Host(Mock(), asyncio.get_running_loop())
        flow = Mock(key='a' * 32, closed=False)
        flow.show = AsyncMock()
        host.active = flow
        self.assertTrue(await host.perform('show', 'a' * 32))
        flow.show.assert_awaited_once()

    async def test_automatic_popup_probe_is_disabled_for_production_flow(self):
        self.assertFalse(self.flow().diagnostic_windows)
        flow = native._Flow(Mock(), 'b' * 32, 'qq', diagnostic_windows=True)
        self.assertTrue(flow.diagnostic_windows)

    async def test_diagnostic_never_replaces_an_active_user_login(self):
        host = Mock(active=Mock(closed=False))
        host.perform = AsyncMock()
        with patch.object(native, '_host', host):
            result = await native.diagnostic('qq', verify_windows=True)
        self.assertEqual(result['error'], 'session_active')
        self.assertFalse(result['accountAuthorized'])
        host.perform.assert_not_awaited()

    async def test_native_probe_reports_a_missing_opener_as_failure_without_account_reads(self):
        for opener_retained in (True, False):
            flow = self.flow()
            flow.diagnostic_windows = True
            flow.cookies = AsyncMock(side_effect=AssertionError('No diagnostic cookie access'))
            flow.check = AsyncMock(side_effect=AssertionError('No diagnostic private account access'))
            async def evaluate(source, timeout):
                if 'window.open(' in source:
                    flow.popups.append(FakeView())
                    return dict(opened=True, openerRetained=opener_retained)
                flow.popups.clear()
                return True
            async def show():
                if flow.dismissal and not flow.dismissal.done():
                    await flow.dismissal
                flow.presentation = object()
            def hide():
                flow.presentation = None
                flow.dismissal = asyncio.get_running_loop().create_future()
                asyncio.get_running_loop().call_soon(flow.dismissal.set_result, True)
            flow.evaluate, flow.show, flow.hide = AsyncMock(side_effect=evaluate), show, hide
            with patch.object(native, '_wait_presentation', new=AsyncMock(return_value=True)), \
                    patch.object(native, '_obj', side_effect=lambda obj, sel: object() if sel == 'rootViewController' else None):
                result = await native._diagnostic_windows(flow)
            self.assertIs(result['passed'], opener_retained)
            self.assertEqual(set(result['popup']), {'opened', 'openerRetained', 'nativeChildCreated', 'rootRetained', 'childClosed'})
            self.assertTrue(all(result['presentation'].values()))
            self.assertEqual(flow.evaluate.await_count, 2)
            flow.cookies.assert_not_awaited()
            flow.check.assert_not_awaited()

    async def test_netease_returns_to_music_origin_before_private_account_read(self):
        flow = self.flow('netease')
        flow.cookies = AsyncMock(return_value=[cookie('MUSIC_U', 'this-flow', '.music.163.com')])
        flow.evaluate = AsyncMock()
        factory = Mock()
        objc = types.ModuleType('rubicon.objc')
        objc.ObjCClass = factory
        with patch.dict(sys.modules, {'rubicon': types.ModuleType('rubicon'), 'rubicon.objc': objc}), \
                patch.object(native, '_obj', return_value=object()), patch.object(native, '_text', return_value='https://reg.163.com/'):
            snapshot = await flow.check()
        self.assertTrue(snapshot['account_lookup_failed'])
        self.assertTrue(snapshot['page_loading'])
        self.assertEqual(len(flow.view.loaded_requests), 1)
        flow.evaluate.assert_not_called()


if __name__ == '__main__':
    unittest.main()

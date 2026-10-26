"""Boundary tests: no remote backend, no implicit QR, no private build inputs."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(PROJECT))

from qishui_config import load_config
from music_app.auth import router
from music_app.web.authbridge import LocalAuth


class OptionalSDK(unittest.TestCase):
    def test_clean_build_needs_no_private_settings(self):
        self.assertEqual(load_config(), dict(configured=False, privacyAgreed=False))

    def test_only_sdk_fields_are_bundled_and_consent_is_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.json'
            path.write_text(json.dumps(dict(appId='synthetic', license='test-only',
                clientType=1, channel='test', cookie='never-bundle', deviceId='never-bundle',
                privacyAgreed=True)), encoding='utf-8')
            config = load_config(path)
        self.assertNotIn('cookie', config)
        self.assertNotIn('deviceId', config)
        self.assertFalse(config['privacyAgreed'])

    def test_partial_config_fails_before_preparation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.json'
            path.write_text('{"appId":"synthetic"}', encoding='utf-8')
            with self.assertRaises(ValueError):
                load_config(path)


class IOSLogin(unittest.TestCase):
    def test_pending_qishui_does_not_start_a_qr_browser(self):
        with patch.dict(os.environ, MINERADIO_IOS='1'), patch.object(router, '_adapter') as adapter:
            with self.assertRaises(router.AuthError) as result:
                router.create('qishui', 'official')
            self.assertEqual(result.exception.code, 'qishui_phone_login_pending')
            adapter.assert_not_called()

    def test_legacy_scan_methods_cannot_start_on_ios(self):
        with patch.dict(os.environ, MINERADIO_IOS='1'), patch.object(router, '_adapter') as adapter:
            for method in ('qq', 'wechat', 'mobile'):
                with self.assertRaises(router.AuthError):
                    router.create('qqmusic', method)
            adapter.assert_not_called()

    def test_official_qishui_request_reaches_an_honest_error(self):
        with patch.dict(os.environ, MINERADIO_IOS='1'):
            from music_app.web.auth_security import LocalAuthError
            with self.assertRaises(LocalAuthError) as result:
                LocalAuth().handle('session', dict(provider='qishui', method='official', client_id='a' * 32))
            self.assertEqual(result.exception.code, 'qishui_phone_login_pending')

    def test_a_different_client_cannot_take_over_a_login(self):
        auth = LocalAuth()
        with patch.dict(os.environ, MINERADIO_IOS='1'):
            with patch.object(router, 'create', return_value=dict(key='x' * 43, status='waiting',
                    manual_login=True, interactive_window=True, expires_in=600)):
                auth.handle('session', dict(provider='qq', method='official', client_id='a' * 32))
            from music_app.web.auth_security import LocalAuthError
            with self.assertRaises(LocalAuthError):
                auth.handle('check', dict(provider='qq', key='x' * 43, client_id='b' * 32))


class EmbeddedRuntime(unittest.TestCase):
    def test_real_local_http_server_starts_without_cloud_or_sdk_config(self):
        # Fresh interpreter: paths are read once when shared modules import.
        script = r'''
import json, pathlib, sys, tempfile, urllib.request
sys.path.insert(0, sys.argv[1])
from mineradio import backend
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    port = backend.start(root, bundle=sys.argv[2], api_port=0, web_port=0)
    base = 'http://127.0.0.1:' + str(port)
    try:
        with urllib.request.urlopen(base + '/?ios_layout=tablet') as response:
            page = response.read().decode('utf-8')
        assert 'ios-bridge.js' in page and 'width=1100' in page
        assert 'music.hbsuzh.cn' not in page
        with urllib.request.urlopen(base + '/api/app/version') as response:
            version = json.load(response)
        assert version['runtime'] == 'embedded-local'
        assert version['remoteBackendRequired'] is False
        with urllib.request.urlopen(base + '/api/platform/capabilities') as response:
            caps = json.load(response)
        assert caps['qishui']['available'] is False
        assert caps['qishui']['phoneLoginAvailable'] is False
    finally:
        backend.stop()
print('LOCAL_RUNTIME_PASS')
'''
        bundle = PROJECT / 'src/mineradio/bundle'
        self.assertTrue((bundle / 'source-manifest.json').is_file(), 'Run prepare.py first')
        result = subprocess.run([sys.executable, '-c', script, str(PROJECT / 'src'), str(bundle)],
                                capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('LOCAL_RUNTIME_PASS', result.stdout)


if __name__ == '__main__':
    unittest.main()

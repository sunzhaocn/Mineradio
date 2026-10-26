"""Run Passport in an isolated WKWebView owned by this iOS app.

All native work is marshalled to the app's existing UI loop. This adapter is
called by the local Python HTTP threads and never launches a child process.
"""
import json
import secrets
import threading
import urllib.parse

from .common import AuthError, _diagnostic


class IOSSignedBrowser:
    def __init__(self, state):
        from mineradio import passport
        self.native = passport
        self.key = secrets.token_hex(16)
        self.state = state
        self.closed = threading.Event()
        self.lock = threading.RLock()
        try:
            state['browser_info'] = str(self.native.open(self.key, state['ms_token']))
            _diagnostic(state, 'security_ready')
        except Exception:
            self.native.close(self.key)
            raise AuthError(503, 'qishui_security_unavailable',
                            '设备内的汽水登录引擎未就绪，请重试') from None

    def call(self, method, payload=None):
        with self.lock:
            if self.closed.is_set():
                raise AuthError(502, 'qishui_browser_closed', '登录窗口已关闭，请重新获取二维码')
            try:
                if method == 'request':
                    target = urllib.parse.urlsplit(payload['url'])
                    query = dict(urllib.parse.parse_qsl(target.query))
                    query['account_sdk_source_info'] = self.state['browser_info']
                    payload = dict(payload, url=urllib.parse.urlunsplit(
                        target._replace(query=urllib.parse.urlencode(query))))
                result = self.native.call(self.key, method, payload)
                if isinstance(result, str):
                    result = json.loads(result)
                if method == 'request':
                    if not isinstance(result, dict):
                        raise ValueError('Invalid response shape')
                    length = result.pop('_aBogusLength', 0)
                    matches = result.pop('_msTokenMatches', False)
                    _diagnostic(self.state, 'security_signature',
                                a_bogus_length=length, ms_token_matches=int(matches))
                    if length != 44 or matches is not True:
                        raise AuthError(502, 'qishui_security_signature',
                                        '汽水安全签名未就绪，请重新获取二维码')
                return result
            except AuthError:
                raise
            except Exception:
                raise AuthError(502, 'qishui_browser_request',
                                '设备本地登录窗口请求失败，请重试') from None

    def show(self):
        if self.closed.is_set():
            raise AuthError(502, 'qishui_browser_closed', '登录窗口已关闭，请重新获取二维码')
        try:
            self.native.show(self.key)
        except Exception:
            raise AuthError(503, 'qishui_verification_window',
                            '请先关闭其他系统窗口，再打开汽水安全验证') from None

    def close(self):
        self.closed.set()
        self.native.close(self.key)

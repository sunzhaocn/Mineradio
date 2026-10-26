"""Manual official NetEase login in this iOS app's isolated WKWebView."""
import concurrent.futures
import secrets
import threading
import time

from .browser import AuthError, TTL, _cookie_values, _diagnostics, _result


class _OfficialIOSBrowser:
    def __init__(self, state):
        from mineradio import official_login
        self.native, self.state = official_login, state
        self.key = secrets.token_hex(16)
        self.closed = threading.Event()

    def call(self, method):
        if self.closed.is_set():
            if method == 'check':
                return {'closed': True, 'cookies': []}
            raise AuthError(409, 'netease_browser_closed', '本次网易云官网登录窗口已关闭，请重新生成二维码')
        try:
            if method == 'create':
                return self.native.open(self.key)
            if method == 'check':
                return self.native.check(self.key)
            if method == 'show':
                return self.native.show(self.key)
            raise AuthError(400, 'netease_browser_operation', '不支持的网易云登录操作')
        except AuthError:
            raise
        except (TimeoutError, concurrent.futures.TimeoutError):
            self.close()
            raise AuthError(504, 'netease_browser_timeout', '网易云官网登录窗口响应超时，请重新生成二维码') from None
        except Exception:
            raise AuthError(503, 'netease_browser_unavailable', '设备内网易云官网登录窗口未能完成请求，请重试') from None

    def close(self):
        self.closed.set()
        self.native.close(self.key)


def create_session():
    state = {'deadline': time.monotonic() + TTL, 'manual_login': True}
    runtime = _OfficialIOSBrowser(state)
    state['browser_runtime'] = runtime
    try:
        result = runtime.call('create')
        image = result.get('qr_image') if isinstance(result, dict) else None
        if (not isinstance(result, dict) or result.get('manual_login') is not True
                and not (isinstance(image, str) and image.startswith('data:image/png;base64,'))):
            raise AuthError(502, 'netease_official_login_missing', '网易云官网登录会话尚未准备好，请重试')
    except Exception:
        runtime.close()
        raise
    _diagnostics(state, stage='official_window_ready')
    return dict(state=state, expires_in=TTL, interactive_window=True, manual_login=True,
        message='请点击“打开验证窗口”，在网易云官网按页面提供的密码、验证码等方式完成登录',
        qr_image=image or '', qr_url=result.get('qr_url') or '',
        diagnostics=dict(state.get('diagnostics') or {}))


def check_session(state):
    if state.get('authorized'):
        return state['authorized']
    snapshot = state['browser_runtime'].call('check')
    result = _result(state, snapshot)
    if state.get('manual_login') and result.get('status') == 'waiting':
        result['message'] = ('官网登录页面尚未加载完成，请打开验证窗口检查网络后重试' if snapshot.get('page_error') else
            '请点击“打开验证窗口”，在网易云官网完成登录；密码与验证码只在官网输入')
    return result


def show_session(state):
    return state['browser_runtime'].call('show')


def close_session(state):
    runtime = state.get('browser_runtime')
    if runtime:
        runtime.close()

"""Manual QQ Music/Kugou official login, verified with same-session music reads.

Passwords and SMS codes stay in the platform's own WKWebView form. This adapter
receives only native first-party cookies, never a browser profile or form values.
"""
import concurrent.futures
import hashlib
import math
import re
import secrets
import threading
import time

from music_app.core import request_credentials

TTL = 600
LABELS = {'qq': 'QQ 音乐', 'kugou': '酷狗音乐'}
QQ_KEYS = ('qqmusic_key', 'qm_keyst', 'qqmusic_key2', 'wxmusickey')


class AuthError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _provider(value):
    value = 'qq' if value == 'qqmusic' else value
    if value not in LABELS:
        raise AuthError(400, 'official_login_provider_invalid', '请选择 QQ 音乐或酷狗音乐官网登录')
    return value


class _Runtime:
    def __init__(self, provider):
        from mineradio import official_login
        self.native, self.provider = official_login, provider
        self.key, self.closed = secrets.token_hex(16), threading.Event()

    def call(self, operation):
        if self.closed.is_set():
            return {'closed': True, 'cookies': []} if operation == 'check' else self._closed()
        try:
            if operation == 'create':
                return self.native.open(self.key, provider=self.provider)
            return getattr(self.native, operation)(self.key)
        except (TimeoutError, concurrent.futures.TimeoutError):
            self.close()
            raise AuthError(504, 'official_login_timeout', '官网登录窗口响应超时，请重新打开') from None
        except Exception:
            raise AuthError(503, 'official_login_unavailable', '设备内官网登录窗口暂时无法使用，请重试') from None

    def _closed(self):
        raise AuthError(409, 'official_login_closed', '本次官网登录窗口已关闭，请重新开始')

    def close(self):
        self.closed.set()
        self.native.close(self.key)


def _cookie_header(cookies, provider):
    """Recheck native origin/expiry and reject delimiters before any HTTP read."""
    from mineradio.official_login import allowed_cookie_domain
    if not isinstance(cookies, list) or len(cookies) > 512:
        return ''
    fields = {}
    for item in cookies:
        if not isinstance(item, dict) or not allowed_cookie_domain(item.get('domain'), provider):
            continue
        name, value, expires = item.get('name'), item.get('value'), item.get('expires', -1)
        if (not isinstance(name, str) or not re.fullmatch(r'[!#$%&\'*+.^_`|~0-9A-Za-z-]{1,128}', name)
                or not isinstance(value, str) or not value or len(value) > 16384
                or any(ord(char) < 32 or ord(char) == 127 or char == ';' for char in value)
                or type(expires) not in (int, float) or not math.isfinite(expires)
                or expires != -1 and expires <= time.time()):
            continue
        # Keep the current flow's first-party music/SSO cookies together. In
        # particular, wxopenid and psrf_* participate in official music OAuth.
        # Authentication below still requires a music-specific key and a real
        # private music read; generic QQ cookies alone never authorize a login.
        fields[name] = value.strip('"')
    header = '; '.join(name + '=' + value for name, value in fields.items())
    return header if len(header) <= 65536 else ''


def _credentials(cookie, provider):
    if provider == 'qq':
        fields = dict(part.split('=', 1) for part in cookie.split('; ') if '=' in part)
        uid = fields.get('qqmusic_uin') or fields.get('uin') or fields.get('wxuin') or ''
        uid = uid.removeprefix('o').lstrip('0')
        # Generic p_skey/skey prove a QQ login, not QQ Music OAuth completion.
        if not re.fullmatch(r'[1-9]\d{0,24}', uid) or not any(fields.get(name) for name in QQ_KEYS):
            return None
        return uid
    from music_app.providers.kugou.transport import kg_cookie_fields
    parsed = kg_cookie_fields(cookie)
    return parsed['uid'] if re.fullmatch(r'[1-9]\d{0,24}', parsed['uid']) and parsed['cloud_token'] else None


def _kugou_music_cookie(cookie, snapshot):
    """Join the official QR client token with this same flow's web exchange."""
    supplied = snapshot.get('client_authorization')
    if supplied is None:
        return cookie
    from mineradio.official_login import kugou_client_authorization
    authorization = kugou_client_authorization(dict(path='/v2/get_userinfo_qrcode',
        token=supplied.get('token'), userid=supplied.get('userid'))) if isinstance(supplied, dict) else None
    from music_app.providers.kugou.transport import kg_cookie_fields
    fields = kg_cookie_fields(cookie)
    if (not authorization or authorization['userid'] != fields['uid'] or not fields['token']):
        return ''
    parts = dict(part.split('=', 1) for part in cookie.split('; ') if '=' in part)
    parts.update(token=authorization['token'], t=fields['token'], userid=fields['uid'], KugooID=fields['uid'])
    return '; '.join(name + '=' + value for name, value in parts.items())


def create_session(platform):
    provider = _provider(platform)
    runtime = _Runtime(provider)
    try:
        prepared = runtime.call('create')
        if not isinstance(prepared, dict) or prepared.get('manual_login') is not True:
            raise AuthError(502, 'official_login_missing', '官网登录会话尚未准备好，请重试')
    except Exception:
        runtime.close()
        raise
    return dict(state={'provider': provider, 'browser_runtime': runtime,
                       'deadline': time.monotonic() + TTL}, expires_in=TTL,
                manual_login=True, interactive_window=True, qr_image='', qr_url='',
                message='请点击“打开验证窗口”，在' + LABELS[provider] + '官网选择密码或验证码登录并完成音乐授权')


def check_session(state):
    provider = _provider(state.get('provider'))
    if state.get('authorized'):
        return state['authorized']
    if time.monotonic() >= state.get('deadline', 0):
        return {'status': 'expired', 'message': '官网登录会话已过期，请重新开始'}
    runtime = state['browser_runtime']
    snapshot = runtime.call('check')
    if snapshot.get('closed'):
        return {'status': 'cancelled', 'message': '官网登录窗口已关闭，请重新开始'}
    waiting = {'status': 'waiting', 'message': '请点击“打开验证窗口”，在' + LABELS[provider] +
               '官网完成登录与音乐授权；密码与验证码只在官网输入'}
    cookie = _cookie_header(snapshot.get('cookies'), provider)
    if provider == 'kugou':
        cookie = _kugou_music_cookie(cookie, snapshot)
    uid = _credentials(cookie, provider)
    if not uid:
        if snapshot.get('page_error'):
            waiting['message'] = '官网登录页面加载失败，请打开验证窗口检查网络后重试'
        return waiting
    digest = hashlib.sha256(cookie.encode()).hexdigest()
    now = time.monotonic()
    if digest == state.get('last_digest') and now - state.get('last_checked', 0) < 15:
        return dict(state.get('last_waiting') or waiting)
    state.update(last_digest=digest, last_checked=now)
    from music_app.web import account_health, account_profiles
    try:
        with request_credentials.bind({provider: {'cookie': cookie}}):
            health = account_health.check(provider, force=True)
            if not (health.get('verified') is True and health.get('authState') == 'valid'
                    and not health.get('checkFailed')):
                waiting['message'] = ('音乐授权尚未通过验证，请在官网完成授权后重试' if not health.get('checkFailed') else
                                      '音乐账号验证暂时失败，请检查网络后重试')
            else:
                account = {'id': uid}
                try:
                    account.update(account_profiles.read(provider)['account'])
                except Exception:
                    pass  # Successful private music read is sufficient; profile is optional.
                if runtime.closed.is_set():
                    return {'status': 'cancelled', 'message': '官网登录窗口已关闭，请重新开始'}
                result = {'status': 'authorized', 'message': LABELS[provider] + '官网登录成功',
                          'cookie': cookie, 'account': account}
                state['authorized'] = result
                return result
    except Exception:
        waiting['message'] = '音乐账号验证暂时失败，请检查网络后重试'
    state['last_waiting'] = waiting
    return waiting


def show_session(state):
    return state['browser_runtime'].call('show')


def close_session(state):
    if state.get('browser_runtime'):
        state['browser_runtime'].close()

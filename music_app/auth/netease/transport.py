"""网易云登录 HTTP、Cookie、WEAPI 编码及受信任跳转。"""

import base64
import http.cookiejar
import http.cookies
import json
import re
import secrets
import string
import time
import urllib.error
import urllib.parse
import urllib.request


QR_TYPE = 1


MAX_RESPONSE = 2 * 1024 * 1024


_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
       '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')


_PUBLIC_KEY = '''-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----'''


_LOGIN_COOKIE_NAMES = frozenset({'MUSIC_U', '__csrf', 'MUSIC_R_U', 'MUSIC_R_T', 'MUSIC_A_T', 'MUSIC_SNS'})


_NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')


_OFFICIAL_LOGIN_HOSTS = frozenset({'music.163.com', 'reg.163.com', 'dl.reg.163.com', 'id.163.com', 'dun.163.com'})


def _official_url(value, base='https://music.163.com/'):
    """Validate each navigation before sending this login session's cookies."""
    if not isinstance(value, str) or not value or len(value) > 16384 or re.search(r'[\r\n\x00]', value):
        return None
    try:
        parsed = urllib.parse.urlsplit(urllib.parse.urljoin(base, value))
        host = (parsed.hostname or '').lower()
        if parsed.username or parsed.password or parsed.port not in (None, 443):
            return None
    except ValueError:
        return None
    if host not in _OFFICIAL_LOGIN_HOSTS and not host.endswith(('.music.163.com', '.dun.163.com')):
        return None
    if parsed.scheme == 'http' and host == 'music.163.com':
        parsed = parsed._replace(scheme='https')
    if parsed.scheme != 'https':
        return None
    return urllib.parse.urlunsplit(parsed)


def _url_info(url):
    """Navigation diagnostics: field names only, never query/ticket values."""
    parsed = urllib.parse.urlsplit(url)
    segments = [':redacted' if re.fullmatch(r'[A-Za-z0-9_%=-]{25,}', part) else part for part in parsed.path.split('/')]
    return {'host': parsed.hostname, 'path': '/'.join(segments),
            'query_fields': _safe_names(urllib.parse.parse_qs(parsed.query, keep_blank_values=True))}


class _OfficialRedirectHandler(urllib.request.HTTPRedirectHandler):
    max_repeats = 2
    max_redirections = 5

    def __init__(self, state):
        super().__init__()
        self.state = state

    def redirect_request(self, request, fp, code, message, headers, newurl):
        target = _official_url(newurl, request.full_url)
        if not target:
            _diagnostics(self.state, redirect_blocked=True)
            raise AuthError(502, 'netease_untrusted_redirect', '网易云登录跳转到了不受支持的地址，已停止传递会话', _diagnostics(self.state))
        navigation = list(self.state.get('diagnostics', {}).get('redirect_hops', []))[-4:]
        navigation.append(_url_info(target))
        _diagnostics(self.state, redirect_hops=navigation)
        return super().redirect_request(request, fp, code, message, headers, target)


class AuthError(Exception):
    def __init__(self, status, code, message, diagnostics=None):
        super().__init__(message)
        self.status, self.code = status, code
        self.diagnostics = diagnostics or {}


def _safe_names(names):
    return sorted({name for name in names if isinstance(name, str) and _NAME.fullmatch(name)})[:64]


def _diagnostics(state, **updates):
    result = dict(state.get('diagnostics') or {})
    result.update(updates)
    result['protocol'] = 'weapi'
    if state.get('_login_flow') == 'phone':
        result.pop('qr_type', None)
        result['login_flow'] = 'phone'
    else:
        result['qr_type'] = QR_TYPE
    result['jar_cookie_names'] = _safe_names(c.name for c in state.get('jar', []))
    state['diagnostics'] = result
    return dict(result)


def _pad(data):
    length = 16 - len(data) % 16
    return data + bytes([length]) * length


def _weapi(data):
    try:
        from music_app.runtime_crypto import AES, RSA
    except ImportError:
        raise AuthError(503, 'netease_crypto_missing', '网易云扫码登录需要安装 pycryptodome') from None
    secret = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16)).encode('ascii')
    iv = b'0102030405060708'
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    first = base64.b64encode(AES.new(b'0CoJUm6Qyw8W8jud', AES.MODE_CBC, iv).encrypt(_pad(raw)))
    encrypted = base64.b64encode(AES.new(secret, AES.MODE_CBC, iv).encrypt(_pad(first))).decode('ascii')
    public = RSA.import_key(_PUBLIC_KEY)
    rsa_value = pow(int.from_bytes(secret[::-1], 'big'), public.e, public.n)
    return {'params': encrypted, 'encSecKey': format(rsa_value, '0256x')}


def _is_music_domain(domain):
    domain = domain.lstrip('.').lower()
    return domain == '163.com' or domain == 'music.163.com' or domain.endswith('.music.163.com')


def _cookie_values(state):
    return {c.name: c.value for c in state.get('jar', [])
            if _is_music_domain(c.domain) and c.value
            and not (hasattr(c, 'is_expired') and c.is_expired())}


def _capture_headers(state, headers):
    # Known login cookies from our fixed official endpoint can be normalized to
    # music.163.com when a valid parent Domain was not retained by CookieJar.
    received = []
    for raw in headers.get_all('Set-Cookie', []):
        parsed = http.cookies.SimpleCookie()
        try:
            parsed.load(raw)
        except http.cookies.CookieError:
            continue
        for name, morsel in parsed.items():
            received.append(name)
            if name not in _LOGIN_COOKIE_NAMES or not morsel.value or not _is_music_domain(morsel['domain'] or 'music.163.com'):
                continue
            if morsel['max-age'] == '0' or re.search(r'[\r\n;]', morsel.value):
                continue
            if _cookie_values(state).get(name) == morsel.value:
                continue
            state['jar'].set_cookie(http.cookiejar.Cookie(
                0, name, morsel.value, None, False, 'music.163.com', False, False,
                '/', True, True, None, True, None, None, {'HttpOnly': None}, False))
    return _safe_names(received)


def _request(state, route, data):
    stage = {'login/qrcode/unikey': 'create', 'login/qrcode/client/login': 'check',
             'w/nuser/account/get': 'account', 'w/login/cellphone': 'phone_login',
             'sms/captcha/sent': 'sms_send'}.get(route, 'request')
    values = _cookie_values(state)
    payload = dict(data)
    payload['csrf_token'] = values.get('__csrf', '')
    query = urllib.parse.urlencode({'csrf_token': values.get('__csrf', ''), 'timestamp': int(time.time() * 1000)})
    request = urllib.request.Request(
        'https://music.163.com/weapi/' + route + '?' + query,
        data=urllib.parse.urlencode(_weapi(payload)).encode('utf-8'),
        headers={'User-Agent': _UA, 'Referer': 'https://music.163.com/', 'Origin': 'https://music.163.com',
                 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache'})
    _diagnostics(state, stage=stage)
    try:
        with state['opener'].open(request, timeout=8 if stage == 'account' else 15) as response:
            cookie_names = _capture_headers(state, response.headers)
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ValueError
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError
            upstream_code = result.get('code')
            if isinstance(upstream_code, str) and re.fullmatch(r'-?[0-9]{1,10}', upstream_code):
                upstream_code = int(upstream_code)
                result['code'] = upstream_code
            _diagnostics(state, http_status=response.status,
                         upstream_code=upstream_code if isinstance(upstream_code, int) else None,
                         response_fields=_safe_names(result), set_cookie_names=cookie_names)
            if 'redirectUrl' in result and state.get('_login_flow') != 'phone':
                redirect = _official_url(result.get('redirectUrl'))
                candidate = None
                raw_redirect = result.get('redirectUrl')
                if isinstance(raw_redirect, str) and raw_redirect and len(raw_redirect) <= 16384:
                    try:
                        parsed = urllib.parse.urlsplit(raw_redirect)
                        scheme = parsed.scheme.lower()
                        host = parsed.hostname
                        # This records a rejected candidate's route shape only;
                        # it never changes the allowlist or performs navigation.
                        info = _url_info(raw_redirect)
                        candidate = {
                            'scheme': scheme if re.fullmatch(r'[a-z][a-z0-9+.-]{0,20}', scheme) else None,
                            'host': host if host and re.fullmatch(r'[A-Za-z0-9.-]{1,253}', host) else None,
                            'path': info['path'],
                            'query_fields': info['query_fields'],
                        }
                    except (ValueError, TypeError):
                        candidate = {'parse_failed': True}
                _diagnostics(state, redirect_present=bool(result.get('redirectUrl')),
                             redirect_trusted=bool(redirect),
                             redirect=_url_info(redirect) if redirect else None,
                             redirect_candidate=candidate)
        return result
    except urllib.error.HTTPError as exc:
        _diagnostics(state, http_status=exc.code)
        exc.close()
        raise AuthError(502, 'netease_login_upstream', '网易云登录服务请求失败，请稍后重试', _diagnostics(state)) from None
    except (OSError, ValueError, urllib.error.URLError):
        raise AuthError(502, 'netease_login_upstream', '网易云登录服务请求失败，请稍后重试', _diagnostics(state)) from None

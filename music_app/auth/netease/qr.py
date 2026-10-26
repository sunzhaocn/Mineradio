"""网易云二维码流程与独立官网登录窗口入口。"""

import html
import http.cookiejar
import http.cookies
import re
import urllib.error
import urllib.parse
import urllib.request
from music_app.auth.netease.phone import check_phone_session
from music_app.auth.netease.transport import AuthError, MAX_RESPONSE, QR_TYPE, _LOGIN_COOKIE_NAMES, _OfficialRedirectHandler, _UA, _capture_headers, _cookie_values, _diagnostics, _official_url, _request, _url_info


def _create_http_session():
    jar = http.cookiejar.CookieJar()
    state = {'jar': jar}
    state['opener'] = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), _OfficialRedirectHandler(state))
    result = _request(state, 'login/qrcode/unikey', {'type': QR_TYPE})
    key = result.get('unikey')
    if result.get('code') != 200 or not isinstance(key, str) or not key:
        raise AuthError(502, 'netease_qr_create_failed', '网易云未返回二维码，请稍后重试', _diagnostics(state))
    state['key'] = key
    return {'qr_url': 'https://music.163.com/login?' + urllib.parse.urlencode({'codekey': key}),
            'expires_in': 180, 'state': state, 'diagnostics': _diagnostics(state)}


def _missing_cookie(state):
    return AuthError(502, 'netease_login_cookie_missing',
                     '网易云已确认授权，但未取得 MUSIC_U 登录凭据，请重新生成二维码后再扫码',
                     _diagnostics(state, stage='confirmed_without_cookie', upstream_code=803))


def _html_navigation(raw):
    """Recognize literal browser navigations; never execute page JavaScript."""
    text = raw.decode('utf-8', 'replace')
    meta = re.search(r'<meta\b[^>]*http-equiv\s*=\s*[\'"]refresh[\'"][^>]*content\s*=\s*[\'"][^\'"]*?url=([^\'"<>]+)', text, re.I)
    if meta:
        return html.unescape(meta.group(1).strip())
    # Accept a script consisting solely of navigation. A location assignment
    # inside a function or conditional is not evidence that it should execute.
    for script in re.findall(r'<script\b[^>]*>([\s\S]*?)</script\s*>', text, re.I):
        patterns = (
            r'\s*(?:window\.|top\.)?location(?:\.href)?\s*=\s*[\'"]([^\'"<>]+)[\'"]\s*;?\s*',
            r'\s*(?:window\.|top\.)?location\.(?:replace|assign)\(\s*[\'"]([^\'"<>]+)[\'"]\s*\)\s*;?\s*',
        )
        for pattern in patterns:
            match = re.fullmatch(pattern, script, re.I)
            if match:
                return html.unescape(match.group(1).strip())
    return None


def _follow_login_redirect(state, url):
    """Follow a bounded official auth handoff using this QR's CookieJar only."""
    current = url
    for _ in range(3):
        _diagnostics(state, stage='official_login_redirect', redirect=_url_info(current))
        request = urllib.request.Request(current, headers={
            'User-Agent': _UA, 'Referer': 'https://music.163.com/',
            'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache',
        })
        try:
            with state['opener'].open(request, timeout=12) as response:
                final_url = _official_url(response.geturl(), current)
                if not final_url:
                    _diagnostics(state, redirect_blocked=True)
                    return False, current
                names = _capture_headers(state, response.headers)
                raw = response.read(min(MAX_RESPONSE, 256 * 1024))
                _diagnostics(state, http_status=response.status, set_cookie_names=names,
                             redirect=_url_info(final_url))
            current = final_url
            if _cookie_values(state).get('MUSIC_U'):
                _diagnostics(state, stage='redirect_cookie_received')
                return True, current
            # Captcha/identity/security pages are for the user. Fetching a page
            # is sufficient here; solving or submitting its challenge is not.
            if re.search(r'(?:captcha|verify|verification|security|risk|protect)', urllib.parse.urlsplit(current).path, re.I):
                break
            next_url = _html_navigation(raw)
            target = _official_url(next_url, current) if next_url else None
            if not target or target == current:
                break
            current = target
        except AuthError:
            _diagnostics(state, redirect_blocked=True)
            break
        except urllib.error.HTTPError as exc:
            _diagnostics(state, http_status=exc.code, redirect_request_failed=True)
            exc.close()
            break
        except (OSError, ValueError, urllib.error.URLError):
            _diagnostics(state, redirect_request_failed=True)
            break
    return False, current


def _verification_required(state, result):
    redirect = _official_url(result.get('redirectUrl'))
    # Each handoff is attempted once. Keep polling the same QR after the user
    # completes official verification, without repeatedly visiting its page.
    if redirect and state.get('attempted_redirect') != redirect:
        state['attempted_redirect'] = redirect
        authorized, final_url = _follow_login_redirect(state, redirect)
        if authorized:
            state['confirmed'] = True
            return None
        redirect = final_url
    elif redirect:
        redirect = state.get('verification_url') or redirect
    if redirect:
        state['verification_url'] = redirect
    verification_url = state.get('verification_url')
    has_handoff = bool(state.get('verification_url'))
    _diagnostics(state, stage='verification_required', upstream_code=8821,
                 verification_type='risk_control', verification_url=_url_info(verification_url or ''),
                 official_handoff_available=has_handoff)
    return {
        'status': 'verification_required',
        'message': ('网易云要求额外安全验证（8821），请打开官方验证页面完成后返回继续检查'
                    if has_handoff else
                    '网易云触发安全验证限制（8821），请重新生成二维码并在本次专属官网登录窗口完成登录'),
        'upstream_code': 8821,
        **({'verification_url': verification_url} if verification_url else {}),
        'verification_type': 'risk_control',
        'diagnostics': _diagnostics(state),
    }


def check_session(state):
    if state.get('_login_flow') == 'phone':
        return check_phone_session(state)
    if state.get('_browser_adapter'):
        return _browser_call('check_session', state)
    # Confirmation is sticky: a one-shot 803 cannot regress to waiting on retry.
    if state.get('authorized'):
        return state['authorized']
    if state.get('confirmed'):
        result = {'code': 803}
    else:
        result = _request(state, 'login/qrcode/client/login', {'key': state['key'], 'type': QR_TYPE})
    code = result.get('code')
    if code == 8821:
        verification = _verification_required(state, result)
        if verification is not None:
            return verification
        code = 803
    if code in (800, 801, 802):
        status, message = {800: ('expired', '二维码已过期，请重新生成'),
                           801: ('waiting', '等待网易云音乐 App 扫码'),
                           802: ('scanned', '已扫码，请在手机上确认登录')}[code]
        return {'status': status, 'message': message, 'upstream_code': code, 'diagnostics': _diagnostics(state)}
    if code != 803:
        raise AuthError(502, 'netease_qr_check_failed', '网易云未接受扫码状态查询，请重新生成二维码', _diagnostics(state))
    state['confirmed'] = True
    confirm_diagnostics = _diagnostics(state, stage='confirmed', upstream_code=803)
    values = _cookie_values(state)
    if not values.get('MUSIC_U'):
        raise _missing_cookie(state)
    account = {}
    try:
        user = _request(state, 'w/nuser/account/get', {})
        profile = user.get('profile') if isinstance(user.get('profile'), dict) else {}
        info = user.get('account') if isinstance(user.get('account'), dict) else {}
        user_id = profile.get('userId') or info.get('id')
        if user_id:
            account['id'] = str(user_id)
        for target, source in (('name', 'nickname'), ('avatar', 'avatarUrl')):
            if profile.get(source):
                account[target] = profile[source]
        if profile.get('vipType') is not None:
            account['vip_type'] = profile['vipType']
        confirm_diagnostics['account_code'] = user.get('code') if isinstance(user.get('code'), int) else None
    except AuthError:
        confirm_diagnostics['account_lookup_failed'] = True
    values = _cookie_values(state)
    authorized = {'status': 'authorized', 'message': '网易云音乐登录成功', 'upstream_code': 803,
                  'cookie': '; '.join(f'{k}={v}' for k, v in values.items()), 'account': account,
                  'credentials': {k: values[k] for k in _LOGIN_COOKIE_NAMES if k in values},
                  'diagnostics': confirm_diagnostics}
    state['authorized'] = authorized
    return authorized


def _browser_module():
    """Use the package browser backend for each isolated login session."""
    from music_app.platform_runtime import is_ios
    if is_ios():
        from . import ios_browser
        return ios_browser
    from . import browser
    return browser


def _browser_call(operation, state=None):
    try:
        backend = state['_browser_adapter'] if state else _browser_module()
    except (OSError, ImportError):
        raise AuthError(503, 'netease_browser_unavailable', '网易云官网登录会话模块不可用') from None
    try:
        if operation == 'create_session':
            created = backend.create_session()
            created['state']['_browser_adapter'] = backend
            created['interactive_window'] = True
            return created
        return getattr(backend, operation)(state)
    except backend.AuthError as exc:
        raise AuthError(exc.status, exc.code, str(exc), getattr(exc, 'diagnostics', {})) from None


def create_session():
    """官网原生二维码、验证与最终Cookie始终在同一个新浏览器会话中。"""
    return _browser_call('create_session')


def show_session(state):
    if not state or not state.get('_browser_adapter'):
        raise AuthError(409, 'netease_browser_session_required', '请重新生成二维码以使用本次专属官网登录窗口')
    return _browser_call('show_session', state)


def close_session(state):
    if state and state.get('_browser_adapter'):
        return _browser_call('close_session', state)

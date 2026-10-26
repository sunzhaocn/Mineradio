"""网易云手机号、密码及短信登录流程与频率限制。"""

import hashlib
import http.cookiejar
import http.cookies
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from music_app.auth.netease.transport import AuthError, _LOGIN_COOKIE_NAMES, _OfficialRedirectHandler, _cookie_values, _diagnostics, _request


_SMS_INTERVAL = 60


_LOGIN_INTERVAL = 3


_LOGIN_FAILURE_LIMIT = 5


_LOGIN_FAILURE_COOLDOWN = 60


_PHONE_VERIFICATION_CODES = frozenset({8821, -462, 415, 163})


_PHONE_DIGEST_SALT = secrets.token_bytes(32)


_PHONE_SEND_LOCK = threading.Lock()


_PHONE_SEND_TIMES = {}


_PHONE_SEND_MAX = 4096


def create_phone_session():
    jar = http.cookiejar.CookieJar()
    state = {'jar': jar, '_login_flow': 'phone', '_login_failures': 0}
    state['opener'] = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar), _OfficialRedirectHandler(state))
    pending = {'status': 'waiting', 'message': '请输入已有网易云账号的手机号，使用密码或短信验证码登录'}
    state['_phone_pending'] = pending
    return {'state': state, 'expires_in': 600, 'message': pending['message'],
            'diagnostics': _diagnostics(state, stage='phone_ready')}


def _require_phone_session(state):
    if not isinstance(state, dict) or state.get('_login_flow') != 'phone' or 'jar' not in state:
        raise AuthError(409, 'netease_phone_session_required', '请先创建网易云手机号登录会话')


def _validate_phone(phone, countrycode):
    if not isinstance(phone, str) or not re.fullmatch(r'[0-9]{5,15}', phone):
        raise AuthError(400, 'netease_phone_invalid', '手机号须为 5 至 15 位数字，不要包含空格或区号')
    if not isinstance(countrycode, str) or not re.fullmatch(r'[1-9][0-9]{0,3}', countrycode):
        raise AuthError(400, 'netease_countrycode_invalid', '国家或地区区号须为 1 至 4 位数字，不含加号')
    if countrycode == '86' and not re.fullmatch(r'1[0-9]{10}', phone):
        raise AuthError(400, 'netease_phone_invalid', '中国大陆手机号须为 11 位数字')
    return hashlib.sha256(_PHONE_DIGEST_SALT + (countrycode + ':' + phone).encode('ascii')).digest()


def _pending_phone(state, status, message, **fields):
    result = {'status': status, 'message': message, **fields,
              'diagnostics': _diagnostics(state)}
    state['_phone_pending'] = result
    if status == 'cooldown':
        state['_phone_pending_until'] = time.monotonic() + fields.get('retry_after', _LOGIN_FAILURE_COOLDOWN)
    else:
        state.pop('_phone_pending_until', None)
    return dict(result)


def _phone_verification(state, code):
    _diagnostics(state, stage='verification_required', upstream_code=code,
                 verification_type='risk_control')
    return _pending_phone(
        state, 'verification_required',
        '网易云要求额外安全验证，当前登录尚未完成；请在官方渠道解除限制后重新创建登录会话',
        upstream_code=code, verification_type='risk_control', sms_sent=False)


def _phone_wait_gate(state, *, sms=False):
    """No automatic request retries, including after server risk challenges."""
    cached = state.get('authorized')
    if cached:
        return dict(cached)
    pending = state.get('_phone_pending', {})
    if pending.get('status') == 'verification_required':
        return dict(pending)
    now = time.monotonic()
    until = state.get('_sms_retry_until' if sms else '_login_retry_until', 0)
    if now < until:
        remaining = max(1, int(until - now + 0.999))
        return _pending_phone(state, 'cooldown',
                              '请稍后再发送短信验证码' if sms else '登录尝试过于频繁，请稍后重试',
                              retry_after=remaining, sms_sent=False)
    if not sms and state.get('_login_failures', 0) >= _LOGIN_FAILURE_LIMIT:
        state['_login_failures'] = 0
    return None


def send_sms(state, phone, countrycode='86'):
    _require_phone_session(state)
    fingerprint = _validate_phone(phone, countrycode)
    gate = _phone_wait_gate(state, sms=True)
    if gate:
        return gate
    now = time.monotonic()
    with _PHONE_SEND_LOCK:
        for expired in [digest for digest, until in _PHONE_SEND_TIMES.items() if until <= now]:
            del _PHONE_SEND_TIMES[expired]
        until = _PHONE_SEND_TIMES.get(fingerprint, 0)
        if until > now or len(_PHONE_SEND_TIMES) >= _PHONE_SEND_MAX:
            remaining = max(1, int(until - now + 0.999)) if until > now else _SMS_INTERVAL
            state['_sms_retry_until'] = now + remaining
            return _pending_phone(state, 'cooldown', '请稍后再发送短信验证码',
                                  sms_sent=False, retry_after=remaining)
        _PHONE_SEND_TIMES[fingerprint] = now + _SMS_INTERVAL
    state['_sms_retry_until'] = now + _SMS_INTERVAL
    _diagnostics(state, stage='sms_send')
    try:
        result = _request(state, 'sms/captcha/sent', {
            'ctcode': countrycode, 'cellphone': phone,
            'secrete': 'music_middleuser_pclogin'})
    except AuthError:
        _pending_phone(state, 'waiting', '短信发送请求失败，请稍后重试', sms_sent=False)
        raise AuthError(502, 'netease_sms_unavailable', '短信发送请求失败，请稍后重试', _diagnostics(state)) from None
    code = result.get('code')
    if code in _PHONE_VERIFICATION_CODES:
        return _phone_verification(state, code)
    if code == 429:
        return _pending_phone(state, 'cooldown', '网易云限制了短信发送频率，请稍后重试',
                              sms_sent=False, retry_after=_SMS_INTERVAL, upstream_code=code)
    # Explicit false data means a failed delivery even if the envelope is 200.
    if code != 200 or result.get('data') is False:
        _pending_phone(state, 'waiting', '网易云未接受短信发送，请确认已有账号的手机号后稍后重试', sms_sent=False)
        raise AuthError(400, 'netease_sms_rejected',
                        '网易云未接受短信发送，请确认已有账号的手机号后稍后重试', _diagnostics(state))
    state['_sms_phone_hash'] = fingerprint
    _diagnostics(state, stage='sms_sent', upstream_code=200)
    return _pending_phone(state, 'waiting', '短信验证码已发送，请输入验证码登录',
                          sms_sent=True, retry_after=_SMS_INTERVAL, upstream_code=200)


def _phone_account(result):
    profile = result.get('profile') if isinstance(result.get('profile'), dict) else {}
    info = result.get('account') if isinstance(result.get('account'), dict) else {}
    account = {}
    user_id = profile.get('userId') or info.get('id')
    if isinstance(user_id, (str, int)) and not isinstance(user_id, bool) and len(str(user_id)) <= 128:
        account['id'] = str(user_id)
    for field, source, maximum in (('name', 'nickname', 256), ('avatar', 'avatarUrl', 4096)):
        value = profile.get(source)
        if isinstance(value, str) and len(value) <= maximum:
            account[field] = value
    if isinstance(profile.get('vipType'), int):
        account['vip_type'] = profile['vipType']
    return account


def _authorize_phone(state, result):
    if not _cookie_values(state).get('MUSIC_U'):
        _diagnostics(state, stage='phone_confirmed_without_cookie', upstream_code=200)
        _pending_phone(state, 'waiting', '网易云未返回登录凭据，请稍后重试')
        raise AuthError(502, 'netease_login_cookie_missing',
                        '网易云未返回 MUSIC_U 登录凭据，登录尚未完成，请稍后重试', _diagnostics(state))
    account = _phone_account(result)
    if not account:
        try:
            user = _request(state, 'w/nuser/account/get', {})
            if user.get('code') == 200:
                account = _phone_account(user)
            else:
                _diagnostics(state, account_lookup_failed=True)
        except AuthError:
            _diagnostics(state, account_lookup_failed=True)
    values = _cookie_values(state)
    # A failed optional profile lookup must not replace an issued login cookie.
    if not values.get('MUSIC_U'):
        raise AuthError(502, 'netease_login_cookie_missing', '网易云登录凭据失效，请重新登录', _diagnostics(state))
    authorized = {'status': 'authorized', 'message': '网易云音乐登录成功', 'upstream_code': 200,
                  'cookie': '; '.join(f'{k}={v}' for k, v in values.items()),
                  'account': account,
                  'credentials': {k: values[k] for k in _LOGIN_COOKIE_NAMES if k in values},
                  'diagnostics': _diagnostics(state, stage='phone_authorized', upstream_code=200)}
    state['authorized'] = authorized
    state.pop('_phone_pending', None)
    state.pop('_sms_phone_hash', None)
    return dict(authorized)


def login_phone(state, phone, countrycode='86', password='', captcha=''):
    _require_phone_session(state)
    fingerprint = _validate_phone(phone, countrycode)
    if not isinstance(password, str) or not isinstance(captcha, str):
        raise AuthError(400, 'netease_login_input_invalid', '密码和验证码须为文本')
    if bool(password) == bool(captcha):
        raise AuthError(400, 'netease_login_method_invalid', '请选择密码或短信验证码中的一种登录方式')
    try:
        password_bytes = password.encode('utf-8')
    except UnicodeEncodeError:
        raise AuthError(400, 'netease_password_invalid', '密码包含无效字符') from None
    if password and (len(password_bytes) > 1024 or '\x00' in password):
        raise AuthError(400, 'netease_password_invalid', '密码长度不得超过 1024 字节，且不能包含空字符')
    if captcha and not re.fullmatch(r'[0-9]{4,8}', captcha):
        raise AuthError(400, 'netease_captcha_invalid', '短信验证码须为 4 至 8 位数字')
    if captcha and state.get('_sms_phone_hash') != fingerprint:
        raise AuthError(400, 'netease_sms_phone_mismatch', '请先在本次会话为该手机号发送验证码')
    gate = _phone_wait_gate(state)
    if gate:
        return gate
    # Never retain the phone, raw password, hash of the password, or SMS code in
    # state/diagnostics. The request payload exists only for this one invocation.
    payload = {'type': '1', 'https': 'true', 'phone': phone, 'countrycode': countrycode,
               'remember': 'true', 'secureCaptcha': ''}
    if captcha:
        payload['captcha'] = captcha
    else:
        payload['password'] = hashlib.md5(password_bytes).hexdigest()
    state['_login_retry_until'] = time.monotonic() + _LOGIN_INTERVAL
    _diagnostics(state, stage='phone_login')
    try:
        result = _request(state, 'w/login/cellphone', payload)
    except AuthError:
        _pending_phone(state, 'waiting', '网易云登录服务暂时不可用，请稍后重试')
        raise AuthError(502, 'netease_login_unavailable', '网易云登录服务暂时不可用，请稍后重试', _diagnostics(state)) from None
    finally:
        payload.clear()
    code = result.get('code')
    if code in _PHONE_VERIFICATION_CODES:
        return _phone_verification(state, code)
    if code == 200:
        return _authorize_phone(state, result)
    state['_login_failures'] = state.get('_login_failures', 0) + 1
    if code == 429 or state['_login_failures'] >= _LOGIN_FAILURE_LIMIT:
        state['_login_retry_until'] = time.monotonic() + _LOGIN_FAILURE_COOLDOWN
        return _pending_phone(state, 'cooldown', '登录尝试过于频繁，请稍后重试',
                              retry_after=_LOGIN_FAILURE_COOLDOWN, upstream_code=code if isinstance(code, int) else None)
    _pending_phone(state, 'waiting', '手机号、密码或验证码不正确，或该账号暂不支持此方式登录')
    raise AuthError(401, 'netease_login_rejected',
                    '手机号、密码或验证码不正确，或该账号暂不支持此方式登录', _diagnostics(state))


def check_phone_session(state):
    _require_phone_session(state)
    if state.get('authorized'):
        return dict(state['authorized'])
    pending = dict(state.get('_phone_pending') or {
        'status': 'waiting', 'message': '请输入手机号并选择密码或短信验证码登录'})
    if pending.get('status') == 'cooldown':
        remaining = max(0, int(state.get('_phone_pending_until', 0) - time.monotonic() + 0.999))
        if remaining:
            pending['retry_after'] = remaining
        else:
            pending = {'status': 'waiting', 'message': '可以重新尝试登录', 'diagnostics': _diagnostics(state)}
    return pending

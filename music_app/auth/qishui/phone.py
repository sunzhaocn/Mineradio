"""Phone login in the current, isolated Qishui Passport browser session.

Creating/polling a session never sends an SMS. Every send and login request is
made once, only in response to the user's corresponding form submission.
"""
import re
import time

from .common import AuthError, HOST
from .transport import _new_state, _request, _allowed_url
from . import adapter


def create_session():
    state = _new_state()
    state.update(expires_at=time.time() + 600, phone_login=True,
                 last_result={'status': 'waiting', 'message': '请输入手机号并获取验证码'})
    return dict(state=state, phone_login=True, expires_in=600,
                message=state['last_result']['message'])


def _mobile(phone, countrycode):
    country = str(countrycode).strip().lstrip('+')
    phone = str(phone).strip()
    if (not re.fullmatch(r'[1-9][0-9]{0,3}', country) or
            not re.fullmatch(r'[0-9]{11}' if country == '86' else r'[0-9]{5,15}', phone)):
        raise AuthError(400, 'qishui_phone_invalid', '请输入正确的国家区号和手机号')
    return '+' + country + ' ' + phone


def _xor5(value):
    return ''.join(format(byte ^ 5, 'x') for byte in value.encode('utf-8'))


def _form():
    return {'mix_mode': '1', 'fixed_mix_mode': '1'}


def _ready(state):
    if time.time() >= state['expires_at']:
        raise AuthError(410, 'qishui_phone_expired', '登录会话已过期，请重新开始')
    if state.get('mfa_pending'):
        raise AuthError(409, 'qishui_phone_verification', '请先完成汽水安全验证，再手动重试')


def _prepare_passport(state):
    """Acquire the server-issued CSRF cookies in this exact browser session.

    The official music panel initializes its QR tab before its SMS tab. That
    anonymous GET provisions the cookies shared by both methods. We discard
    its response/token, never display an image, and never poll or authorize QR.
    This initialization only runs after an explicit SMS/login submission.
    """
    state['jar'].clear_expired_cookies()
    if any(c.name in ('passport_csrf_token', 'passport_csrf_token_default') and c.value for c in state['jar']):
        return
    _request(state, '/passport/web/get_qrcode/', query={**state['query'],
        'next': HOST, 'need_logo': 'false', 'need_short_url': 'false'})
    if not any(c.name in ('passport_csrf_token', 'passport_csrf_token_default') and c.value for c in state['jar']):
        raise AuthError(502, 'qishui_phone_csrf_missing', '汽水登录会话初始化未完成，请稍后重试')
    _ready(state)


def _data(result):
    if not isinstance(result, dict) or not isinstance(result.get('data'), dict):
        raise AuthError(502, 'qishui_phone_response', '汽水登录响应异常，请稍后重试')
    return result['data']


def _rejected(state, result):
    data = _data(result)
    error = data.get('error_code') or result.get('error_code') or 0
    try:
        error = int(error)
    except (ValueError, TypeError):
        raise AuthError(502, 'qishui_phone_response', '汽水登录响应异常，请稍后重试') from None
    if not error and result.get('message') == 'success':
        return None
    challenge = any(data.get(key) or result.get(key) for key in (
        'verify_center_decision_conf', 'verify_center_secondary_decision_conf'))
    if (error == 2046 or challenge) and state.get('signed_runtime'):
        decision = {**result, **data, 'verify_portrait_id': state['verify_portrait_id']}
        decision.pop('data', None)
        state['mfa_business'] = adapter._verification_params(decision)
        if isinstance(data.get('sms_code_key'), str) and len(data['sms_code_key']) <= 2048:
            state['mfa_business']['sms_code_key'] = data['sms_code_key']
        state['signed_runtime'].call('verify_start', {'phone': True, 'decision': decision, 'options': {'generalParams': {
            **state['query']}}})
        state['mfa_pending'] = True
        outcome = dict(status='verification_required', verification_required=True,
                       interactive_window=True, upstream_code=error,
                       message='请打开汽水安全验证窗口，完成后手动重试本次操作')
        state['last_result'] = outcome
        return outcome
    messages = {
        16: '汽水暂未向此客户端开放手机号登录，请稍后再试',
        1105: '汽水要求安全验证，当前手机号登录未完成，请稍后重试',
        2032: '汽水要求图形安全验证，当前手机号登录未完成，请稍后重试',
        1454: '该手机号关联多个汽水账号，需要在官方客户端先完成账号选择',
    }
    raise AuthError(403 if error == 16 else 400, 'qishui_phone_rejected_' + str(error),
                    messages.get(error, '汽水未接受本次操作（' + str(error) + '），请检查输入或稍后重试'))


def send_sms(state, phone, countrycode='86'):
    mobile = _mobile(phone, countrycode)
    _ready(state)
    remaining = state.get('sms_next_at', 0) - time.time()
    if remaining > 0:
        return dict(status='cooldown', sms_sent=False, retry_after=max(1, int(remaining)),
                    message='请稍后再获取验证码')
    _prepare_passport(state)
    # Also retain the cooldown after a timeout: delivery may have succeeded.
    state['sms_next_at'] = time.time() + 60
    result = _request(state, '/passport/web/send_code/', query=state['query'],
                      form={**_form(), 'is6Digits': '1', **state.get('mfa_business', {}),
                            'mobile': _xor5(mobile), 'type': _xor5('24')})
    rejected = _rejected(state, result)
    if rejected:
        return rejected
    outcome = dict(status='waiting', sms_sent=True, retry_after=60,
                   message='验证码已发送，请查看手机短信')
    state['last_result'] = outcome
    return outcome


def login_phone(state, phone, countrycode='86', password='', captcha=''):
    mobile = _mobile(phone, countrycode)
    _ready(state)
    if password:
        raise AuthError(400, 'qishui_password_unavailable', '请使用短信验证码登录汽水音乐')
    if not re.fullmatch(r'[0-9]{6}', str(captcha)):
        raise AuthError(400, 'qishui_code_invalid', '请输入短信验证码')
    _prepare_passport(state)
    result = _request(state, '/passport/web/sms_login/', query=state['query'],
                      form={**_form(), **state.get('mfa_business', {}), 'service': HOST,
                            'mobile': _xor5(mobile), 'code': _xor5(captcha), 'login_only': 'true'})
    rejected = _rejected(state, result)
    if rejected:
        return rejected
    data = _data(result)
    adapter._ingest_session_cookie(state, data)
    if data.get('session_cookie') and state.get('signed_runtime'):
        state['signed_runtime'].call('set_cookies', [
            dict(name=c.name, value=c.value, domain=c.domain, path=c.path)
            for c in state['jar'] if c.domain.lstrip('.') in ('qishui.com', 'api.qishui.com')])
    values = adapter._cookie_values(state)
    if not any(values.get(name) for name in ('sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard')):
        redirect = data.get('redirect_url')
        if redirect and _allowed_url(redirect):
            _request(state, redirect, json_response=False)
    values = adapter._cookie_values(state)
    if not any(values.get(name) for name in ('sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard')):
        raise AuthError(502, 'qishui_phone_cookie_missing', '汽水尚未签发登录会话，请重新登录')
    # A successful HTTP reply alone is insufficient. Validate this exact new
    # browser session against Passport; music APIs require a separate signer.
    profile = _request(state, '/passport/account/info/v2/', query=state['query'])
    account = adapter._account(_data(profile))
    if (profile.get('message') != 'success' or profile.get('error_code') not in (None, 0, '0')
            or profile['data'].get('error_code') not in (None, 0, '0')
            or not re.fullmatch(r'[1-9][0-9]*', account.get('id', ''))):
        raise AuthError(502, 'qishui_phone_account_missing', '汽水账号验证尚未完成，请重新登录')
    outcome = adapter._authorized(state, profile['data'], profile_verified=True)
    outcome.update(message='汽水音乐验证码登录成功', account=account)
    state['last_result'] = outcome
    return outcome


def check_session(state):
    if time.time() >= state['expires_at']:
        return dict(status='expired', message='登录会话已过期，请重新开始')
    if state.get('mfa_pending'):
        result = state['signed_runtime'].call('verify_status')
        if result is None:
            return state['last_result']
        state['mfa_pending'] = False
        if isinstance(result, dict) and result.get('status') is True:
            state['query']['isResend'] = 'true'
            for key in ('fp', 'verifyFp'):
                if isinstance(result.get(key), str) and 0 < len(result[key]) <= 512:
                    state['query'][key] = result[key]
            if isinstance(result.get('sms_code_key'), str) and len(result['sms_code_key']) <= 2048:
                state.setdefault('mfa_business', {})['sms_code_key'] = result['sms_code_key']
        else:
            state.pop('mfa_business', None)
        state['last_result'] = dict(status='waiting', message=(
            '安全验证已完成，请手动重试获取验证码或登录' if isinstance(result, dict) and result.get('status') is True
            else '安全验证未完成，请重新尝试'))
    return state['last_result']


def show_session(state):
    return adapter.show_session(state)


def close_session(state):
    adapter.close_session(state)


def diagnostic():
    """Anonymous native request check; no phone, SMS, login or account data."""
    state = create_session()['state']
    try:
        _prepare_passport(state)
        return dict(ready=True, anonymousPassportReady=True, smsSent=False, accountAuthorized=False)
    finally:
        close_session(state)


def verify_session(state, raw):
    return adapter.verify_session(state, raw)
